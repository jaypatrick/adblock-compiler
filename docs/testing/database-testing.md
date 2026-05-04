# Database Testing Guide

> **Practical guide** for testing Prisma-based code, storage adapters, Neon API
> services, and the D1 cache sync layer in the adblock-compiler.

---

## Table of Contents

- [Test Architecture](#test-architecture)
- [Running Tests](#running-tests)
- [PrismaClient Mock Patterns](#prismaclient-mock-patterns)
- [Testing HyperdriveStorageAdapter](#testing-hyperdrivestorageadapter)
- [Testing D1StorageAdapter](#testing-d1storageadapter)
- [Testing D1 Cache Sync](#testing-d1-cache-sync)
- [Testing Neon API Service](#testing-neon-api-service)
- [Testing Clerk Webhooks (Prisma)](#testing-clerk-webhooks-prisma)
- [Shared Test Fixtures](#shared-test-fixtures)
- [Best Practices](#best-practices)

---

## Test Architecture

All tests run under **Deno's built-in test runner** using `Deno.test()` and
`@std/assert`. Database tests use **in-memory mocks** — no real database
connections are needed.

```mermaid
flowchart TB
    subgraph Runner["Deno Test Runner"]
        direction TB
        SRC["src/**/*.test.ts<br/>(storage, services)"]
        WRK["worker/**/*.test.ts<br/>(middleware, handlers)"]
        E2E["worker/*.e2e.test.ts<br/>(API + WebSocket)"]
    end

    subgraph Mocks["Mock Layer (in-memory)"]
        MP["Mock PrismaClient<br/>(Map-backed stores)"]
        MD1["Mock D1Database<br/>(prepare/bind/run)"]
        MH["Mock Hyperdrive<br/>(connection string)"]
        MF["Stub fetch()<br/>(Neon API)"]
    end

    subgraph Real["Real Targets (E2E only)"]
        DB["Docker PostgreSQL<br/>or Neon Branch"]
        WK["Cloudflare Worker<br/>(wrangler dev)"]
    end

    SRC --> MP
    SRC --> MD1
    SRC --> MH
    SRC --> MF
    WRK --> MP
    WRK --> MH
    E2E --> WK --> DB

    style Runner fill:#e8f4f8,stroke:#2196F3
    style Mocks fill:#f3e5f5,stroke:#9C27B0
    style Real fill:#e8f5e9,stroke:#4CAF50
```

### Key Principles

| Principle | Why |
|---|---|
| **No real database in unit tests** | Tests must run without Docker, Neon, or network access |
| **Map-backed stores** | Each mock model uses a `Map<string, Record>` for in-memory CRUD |
| **Capturing mocks** | Record call arguments for assertion (`capturedUpsertArgs`) |
| **Stub `globalThis.fetch`** | Intercept Neon API calls; restore `originalFetch` in cleanup |
| **Deno permissions** | Tests use `--allow-read --allow-write --allow-net --allow-env` |

---

## Running Tests

| Command | Scope |
|---|---|
| `deno task test` | All unit tests (src + worker) |
| `deno task test:src` | Storage adapters, services, sync |
| `deno task test:worker` | Middleware, handlers, auth |
| `deno task test:watch` | Watch mode for `src/` (re-runs on save) |
| `deno task test:watch:worker` | Watch mode for `worker/` |
| `deno task test:coverage` | Coverage report for both src + worker |
| `deno task test:e2e` | End-to-end tests (requires running Worker) |
| `deno task test:e2e:api` | API endpoint E2E tests only |
| `deno task test:e2e:ws` | WebSocket E2E tests only |
| `deno task test:contract` | OpenAPI contract validation |

### Running a Single Test File

```bash
deno test --allow-read --allow-write --allow-net --allow-env src/storage/HyperdriveStorageAdapter.test.ts
```

### Running Tests Matching a Pattern

```bash
deno test --allow-read --allow-write --allow-net --allow-env --filter "upsert" src/
```

---

## PrismaClient Mock Patterns

The project uses two mock patterns depending on the test's needs.

### Pattern 1: Map-Backed Full Mock

For tests that need realistic CRUD behavior (storage adapters, sync):

```typescript
function createMockPrismaClient(): any {
    // One Map per Prisma model
    const stores: Record<string, Map<string, Record<string, unknown>>> = {
        storageEntry: new Map(),
        filterCache: new Map(),
        compilationMetadata: new Map(),
        user: new Map(),
        apiKey: new Map(),
    };

    function modelAccessor(name: string) {
        const store = stores[name]!;
        return {
            findUnique: async ({ where }: { where: { id?: string; key?: string } }) => {
                const key = where.id ?? where.key;
                return store.get(key!) ?? null;
            },
            findMany: async () => Array.from(store.values()),
            create: async ({ data }: { data: Record<string, unknown> }) => {
                const id = (data.id as string) ?? crypto.randomUUID();
                const record = { ...data, id };
                store.set(id, record);
                return record;
            },
            upsert: async ({ where, update, create }: {
                where: { id: string };
                update: Record<string, unknown>;
                create: Record<string, unknown>;
            }) => {
                const existing = store.get(where.id);
                if (existing) {
                    const merged = { ...existing, ...update };
                    store.set(where.id, merged);
                    return merged;
                }
                store.set(create.id as string ?? where.id, create);
                return create;
            },
            delete: async ({ where }: { where: { id: string } }) => {
                const record = store.get(where.id);
                store.delete(where.id);
                return record;
            },
            deleteMany: async () => {
                const count = store.size;
                store.clear();
                return { count };
            },
            count: async () => store.size,
        };
    }

    return {
        storageEntry: modelAccessor('storageEntry'),
        filterCache: modelAccessor('filterCache'),
        compilationMetadata: modelAccessor('compilationMetadata'),
        user: modelAccessor('user'),
        apiKey: modelAccessor('apiKey'),
        $disconnect: async () => {},
    };
}
```

### Pattern 2: Capturing Mock (for Assertions)

For tests that verify *what* was called, not the data flow:

```typescript
interface MockPrismaOptions {
    upsertResult?: { id: string };
    deleteManyResult?: { count: number };
    upsertError?: Error;
}

function createCapturingMockPrisma(opts: MockPrismaOptions = {}) {
    const mock = {
        capturedUpsertArgs: null as unknown,
        capturedDeleteArgs: null as unknown,
        user: {
            async upsert(args: unknown) {
                if (opts.upsertError) throw opts.upsertError;
                mock.capturedUpsertArgs = args;
                return opts.upsertResult ?? { id: 'uuid-mock-1' };
            },
            async deleteMany(args: unknown) {
                mock.capturedDeleteArgs = args;
                return opts.deleteManyResult ?? { count: 1 };
            },
        },
        async $disconnect() { /* noop */ },
    };
    return mock;
}

// Usage in a test
Deno.test('webhook handler maps Clerk fields to Prisma upsert', async () => {
    const prisma = createCapturingMockPrisma();
    await handleUserCreated(clerkPayload, prisma);

    // Assert the exact args passed to prisma.user.upsert()
    const args = prisma.capturedUpsertArgs as any;
    assertEquals(args.where.clerkUserId, 'user_abc123');
    assertEquals(args.create.email, 'test@example.com');
});
```

---

## Testing HyperdriveStorageAdapter

The `HyperdriveStorageAdapter` wraps PrismaClient to implement the `IStorageAdapter`
interface for the L2 (PostgreSQL) storage tier.

**Test file:** `src/storage/HyperdriveStorageAdapter.test.ts`

### Mock Setup

```typescript
import { assertEquals, assertExists } from '@std/assert';
import { HyperdriveStorageAdapter } from './HyperdriveStorageAdapter.ts';

// Mock the Hyperdrive binding
function createMockHyperdrive() {
    return {
        connectionString: 'postgresql://test:test@localhost:5432/test',
        host: 'localhost',
        port: 5432,
        user: 'test',
        password: 'test',
        database: 'test',
    };
}

// Mock PrismaClient factory (returns the Map-backed mock)
function createMockPrismaFactory() {
    const mockPrisma = createMockPrismaClient();
    return {
        factory: (_connectionString: string) => mockPrisma,
        prisma: mockPrisma,
    };
}

// Capturing logger for verifying log output
function createCapturingLogger() {
    const messages: Array<{ level: string; msg: string }> = [];
    return {
        messages,
        debug(msg: string) { messages.push({ level: 'debug', msg }); },
        info(msg: string) { messages.push({ level: 'info', msg }); },
        warn(msg: string) { messages.push({ level: 'warn', msg }); },
        error(msg: string) { messages.push({ level: 'error', msg }); },
    };
}
```

### Example Test

```typescript
Deno.test('HyperdriveStorageAdapter: set + get round-trip', async () => {
    const hyperdrive = createMockHyperdrive();
    const { factory, prisma } = createMockPrismaFactory();
    const logger = createCapturingLogger();

    const adapter = new HyperdriveStorageAdapter(hyperdrive, factory, {
        enableLogging: true,
    });
    adapter.setLogger(logger);
    await adapter.open();

    // Write
    const ok = await adapter.set(['test', 'key1'], { value: 42 }, 60_000);
    assertEquals(ok, true);

    // Read back
    const entry = await adapter.get(['test', 'key1']);
    assertExists(entry);
    assertEquals(entry.value, { value: 42 });

    // Verify logging
    const setLog = logger.messages.find(m => m.msg.includes('set'));
    assertExists(setLog);

    await adapter.close();
});
```

---

## Testing D1StorageAdapter

The `D1StorageAdapter` wraps a Cloudflare D1 binding for the L1 (edge SQLite)
storage tier.

**Test file:** `src/storage/D1StorageAdapter.test.ts`

### Mock D1 Binding

```typescript
function createMockD1(): any {
    return {
        prepare: (_sql: string) => ({
            bind: (..._values: unknown[]) => ({
                first: async () => null,
                run: async () => ({
                    results: [],
                    success: true,
                    meta: { duration: 0, changes: 0, last_row_id: 0 },
                }),
                all: async () => ({
                    results: [],
                    success: true,
                    meta: { duration: 0, changes: 0, last_row_id: 0 },
                }),
                raw: async () => [],
            }),
        }),
        dump: async () => new ArrayBuffer(0),
        batch: async (stmts: unknown[]) =>
            stmts.map(() => ({
                results: [],
                success: true,
                meta: { duration: 0, changes: 0, last_row_id: 0 },
            })),
        exec: async () => ({ count: 0, duration: 0 }),
    };
}
```

### Example Test

```typescript
Deno.test('D1StorageAdapter: lifecycle', async () => {
    const d1 = createMockD1();
    const adapter = new D1StorageAdapter(d1);

    assertEquals(adapter.isOpen(), false);
    await adapter.open();
    assertEquals(adapter.isOpen(), true);
    await adapter.close();
    assertEquals(adapter.isOpen(), false);
});
```

---

## Testing D1 Cache Sync

The `d1-cache-sync` module synchronizes records from Neon (L2) to D1 (L1) using
write-through or lazy strategies.

**Test file:** `src/storage/d1-cache-sync.test.ts`

### Mock D1 Prisma Delegate

```typescript
type RecordStore = Map<string, Record<string, unknown>>;

function createMockDelegate(store: RecordStore = new Map()) {
    return {
        upsert: async ({ where, update, create }: {
            where: { id: string };
            update: Record<string, unknown>;
            create: Record<string, unknown>;
        }) => {
            const existing = store.get(where.id);
            if (existing) {
                const merged = { ...existing, ...update };
                store.set(where.id, merged);
                return merged;
            }
            store.set(create.id as string, create);
            return create;
        },
        delete: async ({ where }: { where: { id: string } }) => {
            if (!store.has(where.id)) {
                const err = new Error('Record to delete does not exist.');
                (err as any).code = 'P2025'; // Prisma "not found" error
                throw err;
            }
            const record = store.get(where.id);
            store.delete(where.id);
            return record;
        },
        findUnique: async ({ where }: { where: { id: string } }) => {
            return store.get(where.id) ?? null;
        },
    };
}

// Full D1 Prisma mock with transaction support
function createMockD1Prisma(
    stores: Record<string, RecordStore> = {},
    opts?: { transactionFail?: boolean },
) {
    const getDelegate = (table: string) => {
        if (!stores[table]) stores[table] = new Map();
        return createMockDelegate(stores[table]);
    };

    return new Proxy({} as any, {
        get: (_, prop: string) => {
            if (prop === '$transaction') {
                return async (fn: (tx: any) => Promise<void>) => {
                    if (opts?.transactionFail) throw new Error('Simulated transaction failure');
                    await fn(new Proxy({}, { get: (_, t: string) => getDelegate(t) }));
                };
            }
            return getDelegate(prop);
        },
    });
}
```

### Example Test

```typescript
import { syncRecord, invalidateRecord, isCacheStale } from './d1-cache-sync.ts';

Deno.test('syncRecord: writes data to D1 cache', async () => {
    const store: RecordStore = new Map();
    const d1Prisma = createMockD1Prisma({ filterCache: store });

    const result = await syncRecord(
        'filterCache',
        'fc-1',
        { source: 'easylist.txt', content: 'rule1', hash: 'abc' },
        d1Prisma,
    );

    assertEquals(result.success, true);
    assertEquals(result.table, 'filterCache');
    assertEquals(store.has('fc-1'), true);
});

Deno.test('invalidateRecord: removes from D1 cache', async () => {
    const store: RecordStore = new Map();
    store.set('fc-1', { id: 'fc-1', source: 'easylist.txt' });

    const d1Prisma = createMockD1Prisma({ filterCache: store });
    const result = await invalidateRecord('filterCache', 'fc-1', d1Prisma);

    assertEquals(result.success, true);
    assertEquals(store.has('fc-1'), false);
});
```

---

## Testing Neon API Service

The `NeonApiService` wraps the Neon REST API v2. Tests stub `globalThis.fetch`
to intercept HTTP calls.

**Test file:** `src/services/neonApiService.test.ts`

### Fetch Stubbing Pattern

```typescript
// Save original fetch for cleanup
const originalFetch = globalThis.fetch;

// Simple stub — returns a fixed response
function stubFetch(status: number, body: unknown): void {
    (globalThis as any).fetch = (
        _input: string | URL | Request,
        _init?: RequestInit,
    ): Promise<Response> => {
        return Promise.resolve(
            new Response(JSON.stringify(body), {
                status,
                headers: { 'Content-Type': 'application/json' },
            }),
        );
    };
}

// Spy stub — captures request details for assertions
function spyFetch(status: number, body: unknown) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    (globalThis as any).fetch = (
        input: string | URL | Request,
        init?: RequestInit,
    ): Promise<Response> => {
        const url = typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        calls.push({ url, init });
        return Promise.resolve(
            new Response(JSON.stringify(body), {
                status,
                headers: { 'Content-Type': 'application/json' },
            }),
        );
    };
    return { calls };
}
```

### Example Test

```typescript
Deno.test({
    name: 'NeonApiService: listBranches returns parsed branches',
    async fn() {
        const branches = [
            { id: 'br-main-abc123', name: 'main', current_state: 'ready' },
            { id: 'br-preview-def456', name: 'preview/pr-42', current_state: 'ready' },
        ];

        const spy = spyFetch(200, { branches });

        const service = createNeonApiService({ apiKey: 'test-key' });
        const result = await service.listBranches('twilight-river-73901472');

        assertEquals(result.length, 2);
        assertEquals(result[0].name, 'main');

        // Verify correct URL was called
        assertEquals(spy.calls.length, 1);
        assert(spy.calls[0].url.includes('/projects/twilight-river-73901472/branches'));

        // Verify auth header
        assertEquals(spy.calls[0].init?.headers?.['Authorization'], 'Bearer test-key');
    },
    sanitizeOps: false,
    sanitizeResources: false,
    afterEach() {
        // Always restore original fetch
        globalThis.fetch = originalFetch;
    },
});
```

### Fixtures

```typescript
const FIXTURES = {
    project: {
        id: 'twilight-river-73901472',
        name: 'adblock-compiler',
        region_id: 'azure-eastus2',
        pg_version: 17,
    },
    branch: {
        id: 'br-cool-night-abc123',
        name: 'main',
        project_id: 'twilight-river-73901472',
        current_state: 'ready',
    },
};
```

---

## Testing Clerk Webhooks (Prisma)

Clerk webhook tests verify that incoming Clerk events (`user.created`,
`user.updated`, `user.deleted`) correctly map to Prisma `user.upsert()` /
`user.deleteMany()` calls.

**Test file:** `worker/clerk-webhook.test.ts`

### Example Test

```typescript
Deno.test('user.created webhook maps Clerk fields to Prisma upsert', async () => {
    const prisma = createCapturingMockPrisma({ upsertResult: { id: 'uuid-1' } });

    const payload = {
        type: 'user.created',
        data: {
            id: 'user_clerk_abc',
            email_addresses: [{ email_address: 'alice@example.com', id: 'em_1' }],
            primary_email_address_id: 'em_1',
            first_name: 'Alice',
            last_name: 'Smith',
            image_url: 'https://img.clerk.com/abc',
            public_metadata: { tier: 'pro' },
        },
    };

    await handleClerkUserWebhook(payload, prisma as any);

    const args = prisma.capturedUpsertArgs as any;
    assertEquals(args.where.clerkUserId, 'user_clerk_abc');
    assertEquals(args.create.email, 'alice@example.com');
    assertEquals(args.create.firstName, 'Alice');
    assertEquals(args.create.tier, 'pro');
});
```

---

## Shared Test Fixtures

### MockKVNamespace

A reusable in-memory KV store for testing KV-dependent code:

```typescript
// tests/fixtures/MockEnv.ts

export class MockKVNamespace {
    private store: Map<string, { value: string | ArrayBuffer; expiration?: number }> = new Map();

    async get(key: string, type?: 'text' | 'json' | 'arrayBuffer'): Promise<unknown> {
        const entry = this.store.get(key);
        if (!entry) return null;
        if (entry.expiration && Date.now() > entry.expiration) {
            this.store.delete(key);
            return null;
        }
        if (type === 'json' && typeof entry.value === 'string') {
            return JSON.parse(entry.value);
        }
        return entry.value;
    }

    async put(key: string, value: string | ArrayBuffer, options?: { expirationTtl?: number }) {
        this.store.set(key, {
            value,
            expiration: options?.expirationTtl
                ? Date.now() + options.expirationTtl * 1000
                : undefined,
        });
    }

    async delete(key: string) { this.store.delete(key); }
    async list() { return { keys: [...this.store.keys()].map(name => ({ name })) }; }
}
```

---

## Best Practices

### Do

- **Always restore stubs** — If you stub `globalThis.fetch`, restore `originalFetch`
  in an `afterEach` or `finally` block
- **Use Map-backed stores** — They give realistic CRUD behavior without a real database
- **Use capturing mocks** when you need to assert on exact call arguments
- **Keep tests independent** — Each `Deno.test()` should create its own mocks; don't
  share mutable state between tests
- **Use `sanitizeOps: false`** for tests with fire-and-forget operations (e.g., API key
  `last_used_at` updates)

### Don't

- **Don't connect to real databases** in unit tests — use mocks
- **Don't import `PrismaClient` directly** in tests — mock the factory function
- **Don't hardcode UUIDs** — use `crypto.randomUUID()` or deterministic test fixtures
- **Don't skip error paths** — test database errors, Prisma `P2025` (not found), and
  network failures

### Test File Naming

| Pattern | Location | Runner |
|---|---|---|
| `*.test.ts` | `src/` or `worker/` | `deno task test` |
| `*.e2e.test.ts` | `worker/` | `deno task test:e2e` |
| `*.bench.ts` | `src/` | Excluded from test runs |

---

## Further Reading

- [Testing Overview](./testing.md) — General testing strategy
- [E2E Testing](./E2E_TESTING.md) — End-to-end test setup and patterns
- [Postman Testing](./POSTMAN_TESTING.md) — API testing with Postman collections
- [Local Dev Guide](../database-setup/local-dev.md) — Setting up Docker PostgreSQL for E2E tests
