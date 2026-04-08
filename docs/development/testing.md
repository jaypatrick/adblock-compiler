# Testing Guide

This document describes how the project's three test layers work, how to run them, and when to use each.

---

## Test Layers

| Layer | Location | Framework | Command |
|---|---|---|---|
| **Core library** (`src/`) | `src/**/*.test.ts` | Deno + `@std/assert` | `deno task test:src` |
| **Worker API** (`worker/`) | `worker/**/*.test.ts` | Deno + `@std/assert` | `deno task test:worker` |
| **Worker bindings** (`worker/`) | `worker/**/*.vitest.ts` | Vitest + `@cloudflare/vitest-pool-workers` | `deno task test:vitest` |
| **Angular frontend** (`frontend/`) | `frontend/src/**/*.spec.ts` | Vitest + Angular TestBed | `pnpm --filter adblock-frontend run test` |

Run all backend layers: `deno task test:all` (runs `test:src` + `test:worker` + `test:vitest`).

---

## Backend tests (`src/` + `worker/`)

### Running tests

```sh
# All src + worker tests
deno task test

# Only src/ (pure library)
deno task test:src

# Only worker/ (Cloudflare Worker unit tests)
deno task test:worker

# Watch mode (src/ only)
deno task test:watch

# With coverage
deno task test:coverage

# Single file — must pass explicit permissions
deno test --allow-read --allow-write --allow-net --allow-env src/path/to/foo.test.ts
```

> **Important:** Always use `deno task test` (or the specific task variants) rather than bare `deno test`.
> The tasks configure all required `--allow-*` permissions and environment variables.

### Test structure

Tests are co-located with the file they test as `*.test.ts`:

```
worker/
  handlers/
    compile.ts
    compile.test.ts      ← tests for compile.ts
  lib/
    prisma.ts
    prisma.test.ts
```

### Mocking Cloudflare bindings

Unit tests for `worker/` should **never** call real Cloudflare bindings (KV, D1, Queue,
Analytics Engine, etc.).  Use the `makeEnv(overrides)` fixture pattern instead:

```typescript
import { assertEquals } from '@std/assert';
import { makeEnv } from './test-helpers.ts';

Deno.test('my handler returns 200', async () => {
    const env = makeEnv({ KV: new InMemoryKVNamespace() });
    const req = new Request('https://example.com/api/health');
    const res = await handleHealth(req, env);
    assertEquals(res.status, 200);
});
```

Key stubs available via `makeEnv()`:

- `InMemoryKVNamespace` — for Workers KV
- `InMemoryD1Database` — for D1 (`.prepare().bind()` queries)
- Stub Analytics Engine (no-op `writeDataPoint`)

### Stubbing `_internals`

Many handlers use the `_internals` mutable object pattern to allow stubbable
imports in tests (ES module namespace exports are non-configurable):

```typescript
// In the handler:
import { _internals } from '../lib/prisma.ts';
const prisma = _internals.createPrismaClient(env.HYPERDRIVE.connectionString);

// In the test:
import { _internals } from '../lib/prisma.ts';
import { stub } from '@std/testing/mock';

Deno.test('returns user from prisma', async (t) => {
    const mockPrisma = { user: { findUnique: () => Promise.resolve({ id: 'u1' }) } };
    // `using` requires TypeScript 5.2+ with `"lib"` including `"esnext.disposable"`.
    // For older setups use the explicit pattern:
    //   const s = stub(_internals, 'createPrismaClient', () => mockPrisma as never);
    //   try { /* test body */ } finally { s.restore(); }
    using _ = stub(_internals, 'createPrismaClient', () => mockPrisma as never);
    // ... rest of test
});
```

### Prisma in Hono context

Route handlers that receive a Hono context can now read `c.get('prisma')` to access
the request-scoped `PrismaClient` set by `prismaMiddleware()` in `hono-app.ts`.

In **unit tests** that directly call handler functions (not via HTTP), the
`prisma` variable is still injected via `_internals.createPrismaClient()` (stubbed
as above).  Full integration paths that go through the Hono app can be tested by
either:

1. Passing `env.HYPERDRIVE` in `makeEnv()` — `prismaMiddleware()` will run and set `c.get('prisma')`.
2. Stubbing `_internals.createPrismaClient` so `prismaMiddleware()` returns a mock client.

---

## Frontend tests (`frontend/`)

### Running tests

```sh
# From the repo root
pnpm --filter adblock-frontend run test

# Inside frontend/
cd frontend && pnpm test

# With coverage
pnpm --filter adblock-frontend run test:coverage
```

### Test structure

Tests are co-located with their implementation as `*.spec.ts`:

```
frontend/src/app/
  services/
    compiler.service.ts
    compiler.service.spec.ts    ← Vitest unit tests
  components/
    my-component/
      my-component.component.ts
      my-component.component.spec.ts
```

### Testing framework

Frontend tests use **Vitest** with `@analogjs/vitest-angular` for the Angular compiler
transform.  The test environment is `jsdom`.

Vitest globals (`describe`, `it`, `expect`, `vi`, `beforeEach`, `afterEach`) are
available without explicit imports.  Spec files may import them explicitly for better
IDE support:

```typescript
import { describe, it, expect, vi } from 'vitest';
```

### Angular TestBed pattern

All service tests use `TestBed.configureTestingModule` with
`provideZonelessChangeDetection()`:

```typescript
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';

beforeEach(() => {
    TestBed.configureTestingModule({
        providers: [
            provideZonelessChangeDetection(),
            provideHttpClient(),
            provideHttpClientTesting(),
            { provide: API_BASE_URL, useValue: '/api' },
        ],
    });
    service = TestBed.inject(MyService);
    httpTesting = TestBed.inject(HttpTestingController);
});
```

### Mocking `fetch` in Vitest

Services that use `fetch` directly (e.g. `AuthedApiClientService`, `BetterAuthService`)
are mocked via `vi.spyOn(globalThis, 'fetch')`:

```typescript
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
    vi.restoreAllMocks();
});

it('calls the right URL', async () => {
    fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 })
    );

    await service.compile({ ... });

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain('/compile');
});
```

### AuthedApiClientService in tests

When testing components that inject `AuthedApiClientService`, mock it entirely
rather than setting up the full `hc<AppType>()` chain:

```typescript
const mockAuthedClient = {
    compile: vi.fn().mockResolvedValue({ success: true, ruleCount: 0, compiledAt: '' }),
    validateRules: vi.fn().mockResolvedValue({ valid: true, totalRules: 0, ... }),
    // ... other methods
};

TestBed.configureTestingModule({
    providers: [
        { provide: AuthedApiClientService, useValue: mockAuthedClient },
    ],
});
```

---

## Cloudflare Vitest Worker Pool

The `@cloudflare/vitest-pool-workers` package provides a Workers-native Vitest
environment that runs tests directly inside the real Cloudflare Workers runtime
(workerd / Miniflare 3), giving access to real Cloudflare binding implementations
(KV, D1, Queue, Durable Objects, Workflows, Analytics Engine).

### When to use it

Use `@cloudflare/vitest-pool-workers` for **binding-behaviour integration tests** that
require real Cloudflare runtime fidelity. These are behaviours that **cannot** be
accurately replicated with in-process mocks:

- **Queue batch semantics** — `ackAll`, `retryAll`, partial ack, retry backoff
- **Durable Object lifecycle** — `alarm()`, `webSocketMessage()`, hibernation, storage consistency
- **Workflow step sequencing** — `step.do` replay, `step.sleep`, durable execution guarantees
- **Runtime-specific behaviour** — `waitUntil`, `passThroughOnException`, Analytics Engine, Hyperdrive in an isolate

**Continue using Deno's built-in test runner (`deno task test:worker`) for all other tests:**

- Handler logic, auth flows, Zod validation, rate limiting
- Business logic that doesn't depend on binding-specific behaviour
- Unit tests that mock bindings

Deno tests start significantly faster, are simpler to stub, and do not require Cloudflare
bindings to be provisioned. Use `.vitest.ts` files **only** when you need real binding behaviour.

### Running tests

```sh
# Run all binding-behaviour tests
deno task test:vitest

# Run in watch mode
deno task test:vitest:watch

# Run with Vitest UI
deno task test:vitest:ui

# Run all backend test tiers (Deno + Vitest)
deno task test:all
```

### Test file naming

- **Deno unit tests** — `*.test.ts` (handler logic, mocks, fast unit tests)
- **Vitest binding tests** — `*.vitest.ts` (real Cloudflare runtime, binding-behaviour integration tests)
- **E2E tests** — `*.e2e.test.ts` (hits a live server)

### Configuration

The vitest-pool-workers configuration lives in `vitest.worker.config.ts` at the repo root.
It points to `wrangler.toml` for binding configuration:

```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
    test: {
        include: ['worker/**/*.vitest.ts'],
        poolOptions: {
            workers: {
                wrangler: { configPath: './wrangler.toml' },
                miniflare: {
                    compatibilityDate: '2026-01-01',
                    compatibilityFlags: ['nodejs_compat'],
                },
                main: './worker/worker.ts',
            },
        },
    },
});
```

### Example test

```typescript
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';

describe('KV binding behaviour', () => {
    it('should write and read from real KV binding', async () => {
        const kv = env.COMPILATION_CACHE as KVNamespace;

        await kv.put('test-key', 'test-value');
        const value = await kv.get('test-key');
        expect(value).toBe('test-value');

        await kv.delete('test-key');
    });
});
```

See `worker/example.vitest.ts` for a complete example.

### Key differences from Deno tests

| Concern | Deno (`deno task test:worker`) | CF Vitest Pool (`deno task test:vitest`) |
|---|---|---|
| **Bindings** | Stubbed/mocked via `makeEnv()` | Real Cloudflare runtime (workerd / Miniflare 3) |
| **Speed** | Fast (in-process) | Slower (isolated Workers runtime) |
| **Scope** | Unit tests | Binding-behaviour integration tests |
| **File extension** | `*.test.ts` | `*.vitest.ts` |
| **TypeScript** | Deno type-check (`deno check`) | Vitest + tsc |
| **When to use** | Handler logic, auth, validation (default) | Queue semantics, DO lifecycle, Workflows (specialized) |

---

## Full preflight

Before opening a PR, run the full preflight suite:

```sh
deno task preflight:full
```

This runs `deno task preflight` (fmt:check + lint + check + openapi:validate + schema:generate + check:drift)
followed by `deno task test` (all backend tests) and `deno task check:slow-types`.

Frontend lint and tests are run separately in CI (the `frontend-build` workflow job).
