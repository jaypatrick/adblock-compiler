# Testing Guide

This document describes how the project's three test layers work, how to run them, and when to use each.

---

## Test Layers

| Layer | Location | Framework | Command |
|---|---|---|---|
| **Core library** (`src/`) | `src/**/*.test.ts` | Deno + `@std/assert` | `deno task test:src` |
| **Worker API** (`worker/`) | `worker/**/*.test.ts` | Deno + `@std/assert` | `deno task test:worker` |
| **Angular frontend** (`frontend/`) | `frontend/src/**/*.spec.ts` | Vitest + Angular TestBed | `pnpm --filter bloqr-frontend run test` |

Run all layers at once: `deno task test` (runs `test:src` + `test:worker`) and then `pnpm --filter bloqr-frontend run test`.

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
pnpm --filter bloqr-frontend run test

# Inside frontend/
cd frontend && pnpm test

# With coverage
pnpm --filter bloqr-frontend run test:coverage
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

## Cloudflare Vitest Worker Pool (future / beta)

The `@cloudflare/vitest-pool-workers` package provides a Workers-native Vitest
environment that runs tests directly inside a Miniflare sandbox, giving access to
real Cloudflare binding emulators (KV, D1, Queue, Durable Objects, Service Bindings).

### When to use it

Use `@cloudflare/vitest-pool-workers` for **integration tests** that need real binding
fidelity — for example, verifying that a KV write-then-read round-trip works correctly,
or that a D1 migration applies cleanly.

Continue using Deno's built-in test runner (`deno task test:worker`) for **unit tests**
that mock bindings, as Deno tests start significantly faster and are simpler to stub.

### Setup (not yet wired in CI)

1. Add to `devDependencies` in `package.json`:

   ```json
   "@cloudflare/vitest-pool-workers": "^0.8"
   ```

2. Create `vitest.worker.config.ts` at the repo root:

   ```typescript
   import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

   export default defineWorkersConfig({
       test: {
           poolOptions: {
               workers: {
                   wrangler: { configPath: './wrangler.toml' },
                   miniflare: {
                       kvNamespaces: ['RATE_LIMIT_STORE'],
                       d1Databases: ['DB'],
                       compatibilityDate: '2025-09-01',
                   },
               },
           },
       },
   });
   ```

3. Name integration test files `*.workers.test.ts` to distinguish them from the
   Deno unit tests in `worker/`.

4. Run with:

   ```sh
   npx vitest --config vitest.worker.config.ts
   ```

### Key differences from Deno tests

| Concern | Deno (`deno task test:worker`) | CF Vitest Pool (`@cloudflare/vitest-pool-workers`) |
|---|---|---|
| **Bindings** | Stubbed/mocked | Real Miniflare emulators |
| **Speed** | Fast (in-process) | Slower (Miniflare sandbox) |
| **Scope** | Unit tests | Integration tests |
| **Auth** | Manual stubs | Requires wrangler.toml secrets |
| **TypeScript** | Deno type-check (`deno check`) | Vitest + tsc |

---

## Full preflight

Before opening a PR, run the full preflight suite:

```sh
deno task preflight:full
```

This runs `deno task preflight` (fmt:check + lint + check + openapi:validate + schema:generate + check:drift)
followed by `deno task test` (all backend tests) and `deno task check:slow-types`.

Frontend lint and tests are run separately in CI (the `frontend-build` workflow job).
