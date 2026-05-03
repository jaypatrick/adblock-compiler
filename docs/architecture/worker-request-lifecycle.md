# Worker Request Lifecycle

This document describes the full lifecycle of an HTTP request through the Bloqr Cloudflare Worker — from initial receipt at the Hono entry point through middleware, authentication, route handling, and response egress. It also documents three common crash patterns and their fixes.

---

## Pipeline Overview

```
Incoming Request
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│  app.use('*')  corsMiddleware()                              │
│  ─ reads Origin header                                       │
│  ─ checks CORS_ALLOWED_ORIGINS                               │
│  ─ returns 204 on OPTIONS (preflight)                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  app.use('*')  turnstileMiddleware()                         │
│  ─ skips GET / HEAD / OPTIONS                                │
│  ─ bypasses if Authorization: Bearer blq_*                  │
│  ─ reads CF-Turnstile-Token header or ?turnstileToken        │
│  ─ calls siteverify; returns 403 on failure                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  app.use('*')  authMiddleware()                              │
│  ─ calls auth.api.getSession({ headers })                    │
│  ─ validates API key if Authorization: Bearer blq_*         │
│  ─ stores authContext on c                                   │
│  ─ returns 401 if no valid session and route requires auth   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Route handler (e.g. POST /api/rules)                        │
│  ─ reads parsed body from c.get('body')                      │
│  ─ performs business logic                                   │
│  ─ writes to D1 / KV / R2 / Durable Objects                 │
│  ─ returns JSON response                                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Hono response egress                                        │
│  ─ CORS headers applied (after await next())                 │
│  ─ error handler catches any uncaught errors                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Request Body Lifecycle

The `Request` body is a **single-use readable stream**. Consuming it once (e.g., `await req.json()`) marks it as "used". Any subsequent call to `req.json()`, `req.text()`, or `req.arrayBuffer()` returns an error or empty value.

```
Request arrives at Worker
          │
          ▼
  Body stream: UNCONSUMED
          │
          │   bodyParserMiddleware calls await c.req.json()
          ▼
  Body stream: CONSUMED ──────────────────────────────────┐
          │                                               │
          │   Route handler calls await c.req.json()     │
          ▼                                               │
  ❌  "Body already used" crash                          │
                                                         │
       CORRECT PATTERN:                                  │
  bodyParserMiddleware stores result → c.set('body', …)  │
          │                                              │
          ▼                                              │
  Route handler reads c.get('body')  ──────────────────►┘
  ✅  Body consumed exactly once
```

**Body parser middleware (correct pattern):**

```typescript
// worker/middleware/body-parser.ts
export function bodyParserMiddleware() {
    return async (c: Context, next: Next): Promise<void> => {
        const contentType = c.req.header('Content-Type') ?? '';
        if (contentType.includes('application/json')) {
            try {
                const parsed = await c.req.json();
                c.set('body', parsed);
            } catch {
                // Invalid JSON — leave c.get('body') as undefined
                // Route handler is responsible for returning 400
            }
        }
        await next();
    };
}
```

**Route handler (correct pattern):**

```typescript
// worker/routes/rules.routes.ts
app.post('/api/rules', async (c) => {
    const body = c.get('body');          // ✅ already parsed, stream not re-consumed
    const parsed = CreateRuleSchema.safeParse(body);
    if (!parsed.success) {
        return c.json({ error: { code: 'VALIDATION_ERROR', issues: parsed.error.issues } }, 400);
    }
    // ...
});
```

---

## Crash Pattern 1 — "Body Already Used"

**Symptom:** Route handler returns empty body or throws `TypeError: Body is unusable` at the second `await c.req.json()` call.

**Cause:** A middleware or earlier handler called `await c.req.json()` (or `.text()`, `.arrayBuffer()`) before the route handler.

**Fix:** Use the body-parser middleware pattern above. The body is parsed once, stored on the Hono context, and read by all downstream consumers via `c.get('body')`. **Never** call `c.req.clone()` to work around this — cloning the request creates a new `Request` object but the underlying body stream is still shared in the Cloudflare Workers runtime.

---

## Crash Pattern 2 — KV Binding Not Guarded

**Symptom:** Worker throws `TypeError: Cannot read properties of undefined (reading 'get')` in a route that uses `env.CACHE_KV`.

**Cause:** `CACHE_KV` is a KV namespace binding that may not be present in all environments (e.g., local `wrangler dev` without a `--kv` flag). Code that calls `env.CACHE_KV.get(key)` unconditionally crashes when the binding is absent.

**Fix:** Guard all KV operations against an absent binding:

```typescript
// ❌ Crashes when CACHE_KV binding is absent
const cached = await c.env.CACHE_KV.get(cacheKey);

// ✅ Safe — returns null if binding is absent
const cached = c.env.CACHE_KV
    ? await c.env.CACHE_KV.get(cacheKey)
    : null;

if (cached) {
    return c.json(JSON.parse(cached));
}
```

Apply this pattern for every KV, R2, D1, and Durable Object binding that is optional in some deployment environments. Required bindings (those that must always be present) should be declared in the `Env` interface as non-optional so that TypeScript catches the absence at compile time.

---

## Crash Pattern 3 — Unsafe `event.params` Cast

**Symptom:** Workflow step handler or Durable Object alarm throws a runtime error because `event.params` fields have unexpected types or are missing.

**Cause:** Code casts `event.params` directly to a typed interface:

```typescript
// ❌ Unsafe — no validation, will crash if params are malformed
const config = event.params as WorkflowConfig;
```

**Fix:** Parse with `WorkflowConfigSchema.safeParse`:

```typescript
// ✅ Safe — rejects malformed params with a clear error before any business logic
const result = WorkflowConfigSchema.safeParse(event.params);
if (!result.success) {
    console.error('Invalid workflow params', result.error.issues);
    // In a Workflow step, throwing aborts this step attempt and triggers retry logic
    throw new Error(`Invalid workflow params: ${result.error.message}`);
}
const config: WorkflowConfig = result.data;
```

This applies to:
- `WorkflowEntrypoint.run()` — validate `event.params` before use
- Durable Object `alarm()` — parse any stored state retrieved from `this.state.storage`
- Queue consumer `queue.messages` — parse each message body before processing

---

## `waitUntil` — Non-Blocking Side Effects

Use `c.executionCtx.waitUntil(promise)` for operations that must not block the response but must complete before the Worker is torn down. The canonical example is writing to D1 after returning `204`:

```typescript
// worker/routes/log.routes.ts
app.post('/api/log/frontend-error', async (c) => {
    const body  = LogFrontendErrorSchema.parse(c.get('body'));
    const now   = new Date().toISOString();

    // Non-blocking D1 write — response returns immediately
    c.executionCtx.waitUntil(
        c.env.DB.prepare(
            `INSERT INTO error_events (id, timestamp, code, message, severity, source, url, user_agent)
             VALUES (?, ?, ?, ?, ?, 'angular', ?, ?)`,
        )
        .bind(
            crypto.randomUUID(),
            now,
            body.code,
            body.message,
            body.severity,
            body.url,
            body.userAgent,
        )
        .run(),
    );

    return c.body(null, 204);
});
```

> **Important:** `waitUntil` promises run to completion even after the response is sent, but only while the Worker isolate is alive. Do not use `waitUntil` for operations that require a response (e.g., redirects based on write results). Use `await` for those.

---

## Environment Bindings Reference

All Worker bindings are accessed via the `Env` typed object. `process.env` is **not available** in the Cloudflare Workers runtime.

```typescript
// worker/types/env.ts
export interface Env {
    // KV namespaces (optional in some environments)
    FLASH_STORE:  KVNamespace;
    CACHE_KV?:    KVNamespace;     // optional — guard before use

    // D1 database
    DB:           D1Database;

    // R2 bucket
    RULE_STORE:   R2Bucket;

    // Secrets (plain string bindings)
    TURNSTILE_SECRET_KEY:   string;
    BETTER_AUTH_SECRET:     string;
    CORS_ALLOWED_ORIGINS:   string;
    TRUSTED_ORIGINS:        string;
    SENTINEL_ENABLED:       string;   // 'true' | 'false'
}
```

Never use `process.env.SOME_KEY` — it will be `undefined` at runtime. Always read from `c.env.SOME_KEY` (in a Hono handler) or `env.SOME_KEY` (in a raw `fetch` / `scheduled` handler).

---

## Middleware Registration Order

Middleware is registered in this order in `worker/index.ts`:

```typescript
// worker/index.ts
const app = new Hono<{ Bindings: Env }>();

app.use('*', corsMiddleware());
app.use('*', bodyParserMiddleware());
app.use('*', turnstileMiddleware());
app.use('*', authMiddleware());

// Routes
app.route('/api/auth',   authRoutes);
app.route('/api/rules',  rulesRoutes);
app.route('/api/flash',  flashRoutes);
app.route('/api/log',    logRoutes);
app.route('/api/dash',   dashRoutes);

// Error handler
app.onError((err, c) => {
    console.error('Unhandled Worker error', err);
    return c.json({ error: { code: 'INTERNAL_ERROR' } }, 500);
});

export default app;
```

Order is significant:
1. `corsMiddleware` must run first so preflight `OPTIONS` requests return before auth middleware rejects them.
2. `bodyParserMiddleware` must run before `turnstileMiddleware` and `authMiddleware` if those middlewares need access to the parsed body — but in Bloqr's design, both read from headers/query only, so this is mainly for route handlers.
3. `turnstileMiddleware` must run before `authMiddleware` so that bot-submitted requests are rejected before a D1 session lookup is performed.
4. `authMiddleware` runs last in the global stack before routes.

---

## Related Documentation

- [CORS Policy](../middleware/cors.md) — `corsMiddleware()` details
- [Turnstile Middleware](../middleware/turnstile.md) — `turnstileMiddleware()` details and API key bypass
- [Secure Error-Passing Architecture](./error-passing.md) — `waitUntil` usage for D1 error event logging
- [Better Auth Security Audit](../auth/better-auth-audit-2026-05.md) — `authMiddleware` session validation findings
