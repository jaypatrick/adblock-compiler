# Hono Routing Architecture

## Overview

The Cloudflare Worker request router was migrated from a 589-line imperative if/else chain
(`worker/handlers/router.ts`) to a declarative [Hono](https://hono.dev/) application
(`worker/hono-app.ts`) in Phase 1.  Phase 2 extracted the repeated inline middleware
into reusable factories defined in `worker/middleware/hono-middleware.ts`.

Phase 3 introduced built-in Hono middleware for compression, logging, and caching (see
[Hono Built-in Middleware](../middleware/hono-built-in-middleware.md)).

All **handler function signatures remain unchanged**. Only the dispatch layer (the routing
glue) was migrated to Hono.

---

## Middleware Pipeline

```mermaid
flowchart TD
    R[Incoming Request] --> T[0. Server-Timing\nhono/timing]
    T --> AV[0a. X-API-Version header\n— set on every response]
    AV --> M1[1. Request Metadata\nrequestId · ip · analytics]
    M1 --> SSR[1a. SSR Origin Detection\nCF-Worker-Source: ssr → isSSR]
    SSR --> BA{/api/auth/* path?}
    BA -->|yes — but not /api/auth/providers| BAH[Better Auth handler\nauth.handler — session auth]
    BAH --> BARES[Better Auth Response]
    BA -->|no — or /api/auth/providers| AGENTS{/agents/* path?}
    AGENTS -->|yes| AGR[Agent Router\nCORS + SecureHeaders + agentRouter]
    AGR --> AGRES[Agent Response]
    AGENTS -->|no| POC{/poc/* path?}
    POC -->|yes| POCRL[Anonymous rate limit]
    POCRL --> POCASSETS[Serve ASSETS or 503]
    POC -->|no| PREAUTH{Pre-auth GET path?\n/api/version · /api/health etc.}
    PREAUTH -->|yes| PREAUTHRL[Anonymous rate limit]
    PREAUTHRL --> PREAUTHROUTE[Route to info handler]
    PREAUTH -->|no| AUTH[Unified Auth\nauthenticateRequestUnified\n— BetterAuthProvider]
    AUTH --> CORS[CORS middleware\nhono/cors]
    CORS --> SECURE[Secure Headers\nhono/secure-headers]
    SECURE --> PJ[prettyJSON\n— activate with ?pretty=true]
    PJ --> ZTA[routes sub-app\nlogger · compress · ZTA gate · permission check]
    ZTA --> PERM{permission\ncheck}
    PERM -->|denied| SEC[Security event + 403]
    PERM -->|allowed| ROUTE[Domain Route Handler]
    ROUTE --> RESP[Response]
```

> **Better Auth placement:** The Better Auth handler (`app.on(['POST','GET'], '/api/auth/*', ...)`) is
> mounted **before** the unified auth middleware so that session creation and sign-in flows
> (`/api/auth/sign-in/email`, `/api/auth/sign-up/email`, etc.) are not intercepted by the auth
> verifier. The one exception is `/api/auth/providers`, which falls through to the normal pre-auth
> GET path and is served without a Better Auth session check.

---

## Context Variables

These variables are set by middleware and available to all route handlers via `c.get(key)`:

| Variable      | Type               | Set by                       | Description                              |
|---------------|--------------------|------------------------------|------------------------------------------|
| `requestId`   | `string`           | Request metadata middleware  | Unique trace ID for the request          |
| `ip`          | `string`           | Request metadata middleware  | `CF-Connecting-IP` header or `'unknown'` |
| `analytics`   | `AnalyticsService` | Request metadata middleware  | Analytics/telemetry service instance     |
| `isSSR`       | `boolean`          | SSR origin middleware        | `true` when request originates from the SSR Worker (`CF-Worker-Source: ssr` header) |
| `authContext` | `IAuthContext`     | Auth middleware              | Authenticated user context (or anonymous)|

---

## /api Prefix Handling

The frontend uses `API_BASE_URL = '/api'`, so all API requests from the frontend arrive
as `/api/compile`, `/api/rules`, etc.

Prior to Phase 4, Hono's `app.route()` was used to mount the `routes` sub-app under
**both** `/` and `/api`. The bare-path mount was removed in Phase 4 (domain route split)
to eliminate the double-execution side-effect and simplify the routing surface:

```typescript
// Phase 4: /api is the canonical base path — bare-path mount removed.
app.route('/api', routes);
// app.route('/', routes);  ← removed in Phase 4
```

`/api` is the only canonical base path. Bare-path requests (`/compile`, `/health`, etc.)
are no longer served.

---

## Phase 2: Middleware Extraction (complete)

Phase 2 eliminated repeated inline boilerplate by introducing four `MiddlewareHandler`
factories in `worker/middleware/hono-middleware.ts`:

| Factory                  | Concern                          | Error code |
|--------------------------|----------------------------------|------------|
| `bodySizeMiddleware()`   | Body size validation             | 413        |
| `rateLimitMiddleware()`  | Per-user/IP tiered rate limiting | 429        |
| `turnstileMiddleware()`  | Cloudflare Turnstile CAPTCHA     | 400 / 403  |
| `requireAuthMiddleware()`| Require authenticated caller     | 401        |

### Execution Order for write endpoints

The recommended order preserves correct body-stream semantics:

```mermaid
sequenceDiagram
    participant C as Client
    participant B as bodySizeMiddleware
    participant R as rateLimitMiddleware
    participant Z as zValidator
    participant H as Route Handler

    C->>B: POST /compile (body stream)
    B->>B: clone() + read size
    B-->>C: 413 if too large
    B->>R: next()
    R->>R: KV quota check (no body read)
    R-->>C: 429 + Retry-After + ZTA event if exhausted
    R->>Z: next()
    Z->>Z: consume original body stream
    Z-->>C: 422 if schema invalid
    Z->>H: next() with c.req.valid('json')
    H->>H: verify Turnstile from c.req.valid('json').turnstileToken
    H-->>C: 403 + ZTA event if Turnstile fails
    H->>H: reconstruct Request from validated data
    H-->>C: 200 compile response
```

> **Why `zValidator` runs before Turnstile on `/compile`**: `turnstileMiddleware()` on other
> routes calls `Request.clone().json()` to extract the token while leaving the body intact.
> On the `/compile` route, `zValidator` would parse the body a second time — doubling the
> I/O for every compile request. By running `zValidator` first and reading
> `c.req.valid('json').turnstileToken` in the handler, the body is parsed exactly once.
> All other routes still use `turnstileMiddleware()` (clone-based) before any schema
> validation step.

### Before / After example

**Before (Phase 1 — inline):**

```typescript
routes.post('/compile', async (c) => {
    const sz = await validateRequestSize(c.req.raw, c.env);
    if (!sz.valid) return c.json({ success: false, error: sz.error || 'Request body too large' }, 413);
    const rl = await checkRateLimitTiered(c.env, c.get('ip'), c.get('authContext'));
    if (!rl.allowed) return rateLimitResponse(c, rl.limit, rl.resetAt);
    const tsErr = await checkTurnstile(c);
    if (tsErr) return tsErr;
    return handleCompileJson(c.req.raw, c.env, c.get('analytics'), c.get('requestId'));
});
```

**After (Phase 2 — factory stack with single-parse optimisation):**

```typescript
routes.post(
    '/compile',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // zValidator runs before Turnstile to avoid double body parsing
    zValidator('json', CompileRequestSchema as any, (result, c) => {
        if (!result.success) return c.json({ success: false, error: 'Invalid request body', details: result.error }, 422);
    }),
    async (c) => {
        // Turnstile reads from already-validated body — no second clone/parse
        if (c.env.TURNSTILE_SECRET_KEY) {
            const token = (c.req.valid('json') as any).turnstileToken ?? '';
            const tsResult = await verifyTurnstileToken(c.env, token, c.get('ip'));
            if (!tsResult.success) {
                c.get('analytics').trackSecurityEvent({ eventType: 'turnstile_rejection', ... });
                return c.json({ success: false, error: tsResult.error ?? 'Turnstile verification failed' }, 403);
            }
        }
        const validatedBody = c.req.valid('json');
        const syntheticReq = new Request(c.req.url, { method: 'POST', headers: c.req.raw.headers, body: JSON.stringify(validatedBody) });
        return handleCompileJson(syntheticReq, c.env, c.get('analytics'), c.get('requestId'));
    },
);
```

---

## Zod Validation Integration

`POST /compile` uses [`@hono/zod-validator`](https://github.com/honojs/middleware/tree/main/packages/zod-validator)
to validate the request body against `CompileRequestSchema` before the handler runs.

### Module-identity note

This project uses `jsr:@zod/zod` (Zod v4 from JSR), while `@hono/zod-validator` imports
`npm:zod`. Both modules resolve to Zod v4 with an identical runtime API, but TypeScript
treats them as distinct module identities. The `as any` cast on the schema avoids a
compile-time type mismatch that has no runtime effect:

```typescript
zValidator('json', CompileRequestSchema as any, (result, c) => { ... })
```

### Body stream consumption and Turnstile ordering

`zValidator` consumes the original `c.req.raw` body stream. On the `/compile` route,
`zValidator` runs **before** Turnstile verification so the body is only parsed once.
The Turnstile token is then read from the already-cached validated data:

```typescript
async (c) => {
    // Turnstile from validated body — no second clone/parse
    if (c.env.TURNSTILE_SECRET_KEY) {
        const token = (c.req.valid('json') as any).turnstileToken ?? '';
        const tsResult = await verifyTurnstileToken(c.env, token, c.get('ip'));
        if (!tsResult.success) { ... return 403; }
    }
    // Reconstruct Request for legacy handler signature
    const validatedBody = c.req.valid('json');
    const syntheticReq = new Request(c.req.url, {
        method: 'POST',
        headers: c.req.raw.headers,
        body: JSON.stringify(validatedBody),
    });
    return handleCompileJson(syntheticReq, c.env, c.get('analytics'), c.get('requestId'));
},
```

---

## tRPC endpoint

The tRPC v11 handler is mounted directly on the top-level `app` at `/api/trpc/*`:

```typescript
// Mounted BEFORE app.route('/api', routes) so the routes sub-app
// (with compress + logger middleware) never wraps tRPC responses.
app.all('/api/trpc/*', (c) => handleTrpcRequest(c));
```

This placement ensures:

- The global middleware chain (timing, metadata, Better Auth handler, unified auth, CORS, secure headers)
  **does** run before tRPC requests — `authContext` is already populated.
- The `compress()` and `logger()` middleware scoped to the `routes` sub-app **do not**
  wrap tRPC responses.

See [`docs/architecture/trpc.md`](./trpc.md) for the full tRPC procedure catalogue,
client usage, and ZTA notes.

---

## Phase 4 — Domain Route Modules (complete)

Phase 4 split the `worker/hono-app.ts` monolith into domain-scoped route files under
`worker/routes/`. Each file exports a single `OpenAPIHono` sub-app instance that is
mounted on the `routes` sub-app in `hono-app.ts`.

### New file layout

```
worker/
  hono-app.ts                      ← app setup + middleware only; imports route modules
  routes/
    compile.routes.ts              ← /compile/*, /validate, /ast/parse, /ws/compile, /validate-rule
    rules.routes.ts                ← /rules/*
    queue.routes.ts                ← /queue/*
    configuration.routes.ts        ← /configuration/*
    admin.routes.ts                ← /admin/* (users, neon, agents, auth-config, usage, storage)
    monitoring.routes.ts           ← /health/*, /metrics/*, /container/status
    api-keys.routes.ts             ← /keys/*
    webhook.routes.ts              ← /notify
    workflow.routes.ts             ← /workflow/*
    browser.routes.ts              ← /browser/* (stub — routes added in a future PR)
    index.ts                       ← barrel: exports all sub-apps
    shared.ts                      ← shared types (AppContext) and helpers used by route files
```

### Mount strategy

Each domain sub-app is mounted on the `routes` sub-app at the root path:

```typescript
routes.route('/', compileRoutes);
routes.route('/', rulesRoutes);
routes.route('/', queueRoutes);
// ... etc
```

The `routes` sub-app itself is mounted only at `/api`:

```typescript
app.route('/api', routes);
// app.route('/', routes);  ← bare-path double-mount removed in Phase 4
```

### Middleware inheritance

All middleware registered on `routes` (logger, compress with `NO_COMPRESS_PATHS`
exclusion, ZTA permission check) still wraps every sub-app route, because the
sub-apps are mounted on `routes` — not directly on `app`. No middleware changes
were needed.

### CI route-order guard

`scripts/lint-route-order.ts` validates four invariants on every CI run:

1. `timing()` is the first `app.use()` call
2. The Better Auth `/api/auth/*` handler is registered before `agentRouter`
3. `app.route('/', routes)` is absent (no bare-path double-mount)
4. The compress middleware uses the `NO_COMPRESS_PATHS` exclusion pattern

Run manually with: `deno task lint:routes`


