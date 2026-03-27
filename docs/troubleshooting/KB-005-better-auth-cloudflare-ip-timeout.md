# KB-005: Better Auth + Cloudflare Workers — Hanging Worker and Rate Limiting Skipped

> **Status:** ✅ Resolved
> **Severity:** High (CPU timeout → hung requests; brute-force protection silently disabled)
> **Affected versions:** Any deployment where the 10 s `Promise.race` timeout guards are absent
> and/or `auth.ts` lacks `ipAddress.ipAddressHeaders`
> **Resolved in:**
> `worker/hono-app.ts` (`/api/auth/*` route handler timeout) +
> `worker/middleware/better-auth-provider.ts` (session verification timeout) +
> `worker/lib/auth.ts` (`ipAddress.ipAddressHeaders`)
> **Date:** 2026-03-27

---

## Summary

Two independent but easy-to-miss integration issues affect deployments of Better Auth on
Cloudflare Workers when backed by Neon PostgreSQL via Hyperdrive:

| # | Problem | Impact | Fix |
|---|---------|--------|-----|
| 1 | Missing `Promise.race` / `AbortController` timeout on Better Auth DB calls | Worker CPU budget exhausted → hung requests, double error log lines | Timeout guards in `worker/hono-app.ts` (route handler) and `worker/middleware/better-auth-provider.ts` (session verification) |
| 2 | Missing `ipAddress.ipAddressHeaders` in Better Auth config | BA cannot read client IP → all per-endpoint rate limiting silently skipped | Add `advanced.ipAddress.ipAddressHeaders: ['CF-Connecting-IP', 'X-Forwarded-For']` |

Both issues are dormant during local `wrangler dev` but surface in deployed Workers because:

- Cloudflare Workers enforce a **10–50 ms CPU-time budget per request** (not wall-clock time). A
  hung database call burns the full budget, leaving two correlated error lines in the log.
- `CF-Connecting-IP` is only injected by Cloudflare's edge in a deployed Worker; it is absent
  during `wrangler dev`, so the rate-limit bypass is invisible in local development.

---

## Problem 1 — Worker CPU Timeout: Hanging on Better Auth Endpoints

### Two Code Paths, Two Timeout Guards

The CPU timeout issue manifests on **two distinct code paths**, each with its own timeout guard:

| Code path | When it fires | File | Log signature |
|-----------|--------------|------|---------------|
| **A — Route handler** | Direct calls to `/api/auth/*` (sign-in, sign-up, get-session, two-factor, etc.) | `worker/hono-app.ts` (`app.on(...)`) | `[better-auth] Handler timeout: DB call exceeded 10s on /api/auth/...` |
| **B — Session verifier** | Any authenticated endpoint (compile, admin, etc.) verifying an existing session cookie or bearer token | `worker/middleware/better-auth-provider.ts` (`BetterAuthProvider.verifyToken()`) | `[better-auth] Token verification error: TimeoutError (DB call exceeded 10s)` |

Both share the same underlying cause (a cold Neon branch stalling the Prisma → Hyperdrive TCP
handshake) but sit at different layers of the request pipeline.

### Symptoms

In `wrangler tail` or the Cloudflare dashboard **Workers Logs** view, look for these
distinguishing log patterns:

**Path A — Route handler timeout (e.g. `GET /api/auth/get-session`, `POST /api/auth/sign-in/email`):**

```
[ERROR] [better-auth] Handler timeout: DB call exceeded 10s on /api/auth/get-session
```

The caller receives `504 { "error": "Authentication timed out" }`.

**Path B — Session verification timeout (e.g. `GET /api/compile` with a session cookie):**

```
[ERROR] [better-auth] Token verification error: TimeoutError (DB call exceeded 10s)
[ERROR] Worker exceeded CPU time limit
```

The double error pattern (verification error immediately followed by the CPU limit error) is the
tell for the **missing timeout** scenario — the timeout fires too late to prevent the CPU budget
being exhausted. Once the timeout guard is in place, only the first line appears.

The caller experiences:

- HTTP `500` or `504` after a long pause (exact response depends on the Cloudflare edge tier)
- Authenticated endpoints that reach the session verification middleware become unresponsive

### Root Cause

`auth.handler()` (Path A) and `auth.api.getSession()` (Path B) both trigger a Prisma →
Hyperdrive → Neon PostgreSQL round-trip. If the Neon branch is cold (first request after
scale-to-zero), or Hyperdrive's connection pool is saturated, the TCP handshake can take
several seconds. Without an explicit deadline, the Worker's `fetch` event handler holds its
CPU allocation open, eventually exhausting the runtime budget.

```mermaid
sequenceDiagram
    participant C as Client
    participant W as Cloudflare Worker
    participant H as Hyperdrive
    participant N as Neon PostgreSQL

    C->>W: GET /api/auth/get-session (cookie) [Path A]
    W->>H: auth.handler → createPrismaClient
    H->>N: TCP connect (cold branch — slow)
    Note over H,N: Scale-to-zero wake-up: 2–8 s
    W-->>W: No timeout → CPU budget exhausted
    W-->>C: 500 / 504 (after CPU limit hit)

    C->>W: GET /api/compile (session cookie) [Path B]
    W->>H: BetterAuthProvider.verifyToken → auth.api.getSession
    H->>N: TCP connect (cold branch — slow)
    Note over H,N: Scale-to-zero wake-up: 2–8 s
    W-->>W: No timeout → CPU budget exhausted
    W-->>C: 500 (after CPU limit hit)
```

Without a timeout, the Worker hangs silently until the runtime kills it. With a timeout, the
hang is surfaced as a named `TimeoutError` before the CPU budget is exhausted.

### How to Diagnose

**Step 1 — Search for the double error pattern in `wrangler tail`:**

```bash
wrangler tail --format pretty 2>&1 | grep -E "Handler timeout|Token verification error|CPU time limit"
```

- If you see `Handler timeout` → Path A (route handler) timeout guard is missing or not firing
- If you see `Token verification error` followed immediately by `Worker exceeded CPU time limit`
  → Path B (session verifier) timeout guard is missing or not firing
- If you see `Token verification error: TimeoutError` **without** a subsequent CPU limit error
  → the timeout guard is in place and working correctly

**Step 2 — Reproduce locally with an artificial slow DB call:**

To exercise the `Promise.race` timeout, the delay must be introduced *inside* the timed section
— specifically by wrapping the call itself in a delayed promise. Adding a delay *before* the
call only delays when the race starts; it does not simulate a slow DB call within the race.

For **Path A** (`worker/hono-app.ts` — route handler), replace:

```typescript
const response = await Promise.race([
    auth.handler(betterAuthRequest),
    new Promise<never>(/* ... timeout ... */),
]);
```

temporarily with:

```typescript
// Temporary diagnostic only — simulates a 12 s DB round-trip; remove before commit
const response = await Promise.race([
    new Promise<Response>(resolve =>
        setTimeout(() => resolve(auth.handler(betterAuthRequest)), 12_000),
    ),
    new Promise<never>(/* ... timeout ... */),
]);
```

For **Path B** (`worker/middleware/better-auth-provider.ts` — session verifier), replace:

```typescript
const sessionPromise = auth.api.getSession(betterAuthRequest as Request);
```

temporarily with:

```typescript
// Temporary diagnostic only — simulates a 12 s DB round-trip; remove before commit
const sessionPromise = new Promise<Awaited<ReturnType<typeof auth.api.getSession>>>(resolve =>
    setTimeout(() => resolve(auth.api.getSession(betterAuthRequest as Request)), 12_000),
);
```

In both cases, invoke the affected endpoint and confirm the timeout log line appears (at ~10 s)
before the Worker CPU limit error.

**Step 3 — Check Analytics Engine telemetry for `better_auth_timeout` events:**

Both timeout code paths call `AnalyticsService.trackSecurityEvent()` with
`reason: 'better_auth_timeout'`. Query the Analytics Engine SQL API to see how often and on
which paths this is occurring:

```bash
# Requires:
#   CLOUDFLARE_ACCOUNT_ID = your Cloudflare account ID
#   CLOUDFLARE_API_TOKEN  = Cloudflare API token with Analytics Engine read permissions
#
# Note: '\'' is the standard shell escape for a literal single quote inside a
# single-quoted string — copy the command as-is.

curl "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT index1 AS path, count() AS timeout_count FROM `adguard-compiler-analytics-engine` WHERE blob1 = '\''auth_failure'\'' AND blob3 = '\''better_auth_timeout'\'' AND timestamp > NOW() - INTERVAL '\''24'\'' HOUR GROUP BY index1 ORDER BY timeout_count DESC LIMIT 50"
  }'
```

Aggregating by `index1` (path) shows which Better Auth endpoints are hitting cold-start latency
most frequently.

### Resolution

**Path A — Route handler timeout (`worker/hono-app.ts`):**

The `/api/auth/*` route wraps `auth.handler()` in a `Promise.race` with an `AbortController`
and a `setTimeout(10_000)` deadline. The `finally` block cancels the timer if the handler
resolves before the deadline:

```typescript
app.on(['POST', 'GET'], '/api/auth/*', async (c) => {
    // ... guards for BETTER_AUTH_SECRET and HYPERDRIVE ...
    const auth = createAuth(c.env, url.origin);
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const betterAuthRequest = new Request(c.req.raw, { signal: abortController.signal });

    try {
        const response = await Promise.race([
            auth.handler(betterAuthRequest),
            new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                    abortController.abort();
                    reject(new DOMException('DB call exceeded 10s', 'TimeoutError'));
                }, 10_000);
            }),
        ]).finally(() => {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
        });
        return response;
    } catch (error) {
        if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
            console.error('[better-auth] Handler timeout: DB call exceeded 10s on', url.pathname);
            // ... trackSecurityEvent ...
            return c.json({ error: 'Authentication timed out' }, 504);
        }
        throw error;
    }
});
```

**Path B — Session verification timeout (`worker/middleware/better-auth-provider.ts`):**

`BetterAuthProvider.verifyToken()` uses the same `Promise.race` pattern for `auth.api.getSession()`:

```typescript
const abortController = new AbortController();
let timeoutId: ReturnType<typeof setTimeout> | undefined;
const betterAuthRequest = new Request(url.toString(), {
    method: 'GET',
    headers: request.headers,
    signal: abortController.signal,
});
const sessionPromise = auth.api.getSession(betterAuthRequest as Request);
const session = await Promise.race([
    sessionPromise.finally(() => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
    }),
    new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            abortController.abort();
            reject(new DOMException('DB call exceeded 10s', 'TimeoutError'));
        }, 10_000);
    }),
]);
```

Key design choices shared by both guards:

- `AbortController` is shared between the synthetic `Request` and the timeout branch — aborting
  the controller signals the in-flight Prisma/HTTP connection to close, releasing the TCP socket.
- `finally(() => clearTimeout(timeoutId))` cancels the timer if the DB call resolves before the
  deadline, preventing dangling timer handles.
- The catch block distinguishes `TimeoutError` from other errors and emits separate telemetry
  (`reason: 'better_auth_timeout'` vs `'better_auth_verification_error'`).

> **Why not `AbortSignal.timeout(10_000)`?**
>
> `AbortSignal.timeout()` is not universally available in the Cloudflare Workers runtime at the
> time of this writing. The manual `AbortController` + `setTimeout` pattern is functionally
> equivalent and works across all runtime versions.

---

## Problem 2 — Silent Rate Limit Skip: Brute-Force Protection Disabled

### Symptoms

All Better Auth per-endpoint rate limits are silently bypassed. An attacker can make unlimited
`POST /api/auth/sign-in` attempts without being throttled. There is no error message or log line
to indicate the skip — the request simply succeeds or fails based on credentials alone.

To confirm the issue:

```bash
# Rapid sign-in attempts — none should succeed after N attempts if rate limiting is active
for i in $(seq 1 20); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST https://adblock-frontend.jayson-knight.workers.dev/api/auth/sign-in/email \
    -H 'Content-Type: application/json' \
    -d '{"email":"test@example.com","password":"wrong"}'
done
```

If ALL 20 responses are `401` (or `200`), rate limiting is NOT active. Once the fix is applied,
responses should transition to `429 Too Many Requests` after Better Auth's per-endpoint threshold
is reached.

### Root Cause

Better Auth's built-in rate limiter (which guards `/sign-in`, `/sign-up`, `/two-factor/*`, and
other sensitive endpoints) requires the client's IP address to key its counters. It extracts the
IP by inspecting the incoming `Request` headers according to the `ipAddress.ipAddressHeaders`
configuration list.

Without `ipAddressHeaders`, Better Auth falls back to `request.socket?.remoteAddress` — which
is `undefined` inside a Cloudflare Worker (Workers have no raw socket access). When the IP
resolves to `undefined` or an empty string, Better Auth's rate limiter treats every request as
having the same "null" identity and **skips all rate limiting** rather than applying a catch-all
block.

Cloudflare injects the real client IP in the `CF-Connecting-IP` header. This header is:

- **Always present** in deployed Workers (injected by the Cloudflare edge, not forgeable by
  clients because the edge strips any client-supplied `CF-Connecting-IP`)
- **Absent** in `wrangler dev` (no Cloudflare edge in the loop), which is why the bypass is
  invisible locally

### How to Diagnose

**Step 1 — Check whether `ipAddressHeaders` is present in the auth config:**

```bash
grep -n "ipAddress\|ipAddressHeaders\|CF-Connecting" worker/lib/auth.ts
```

If this returns no matches, `ipAddressHeaders` is not configured and rate limiting is silently
skipped.

**Step 2 — Add a temporary debug log to confirm IP extraction:**

In `worker/lib/auth.ts`, add a temporary `console.log` inside `createAuth()` to surface
what Better Auth sees as the client IP during a sign-in attempt:

```typescript
// Temporary diagnostic only — remove before commit
console.log('[auth-debug] CF-Connecting-IP:', request.headers.get('CF-Connecting-IP'));
```

In a deployed Worker, this should log a non-null IP. In `wrangler dev`, it logs `null` — which
confirms the local silent-skip.

**Step 3 — Stress test after the fix to confirm 429s appear:**

After applying the fix, repeat the loop from the Symptoms section. Requests beyond Better Auth's
threshold should receive `429 Too Many Requests`.

### Resolution

Add `advanced.ipAddress.ipAddressHeaders` to the `betterAuth({...})` call in
`worker/lib/auth.ts`:

**`worker/lib/auth.ts` — current (fixed) implementation (inside `betterAuth({...})`):**

```typescript
advanced: {
    cookiePrefix: 'adblock',
    defaultCookieAttributes: {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
    },
    // ── Cloudflare reverse proxy IP extraction ────────────────────────────
    // Without this, Better Auth cannot determine the real client IP and its
    // built-in rate limiter (brute-force protection on /sign-in, /sign-up,
    // /two-factor/*) silently skips ALL rate limiting. CF-Connecting-IP is
    // injected by Cloudflare's edge and is the authoritative client IP.
    // X-Forwarded-For is included as fallback for local dev / wrangler dev.
    ipAddress: {
        ipAddressHeaders: ['CF-Connecting-IP', 'X-Forwarded-For'],
    },
},
```

Why this order matters:

| Header | Where it comes from | Trust level |
|--------|---------------------|-------------|
| `CF-Connecting-IP` | Cloudflare edge (always authoritative in deployed Workers) | High — edge-injected, client cannot forge |
| `X-Forwarded-For` | Load balancer / reverse proxy chain | Medium — useful for `wrangler dev`, but trust with care in production |

Better Auth reads the list in order and uses the first non-empty value. In a deployed Worker,
`CF-Connecting-IP` is always non-empty and is used. `X-Forwarded-For` is a fallback for local
dev where `CF-Connecting-IP` is absent.

> **Security note:** Never include `X-Real-IP` or trust `X-Forwarded-For` as the sole IP source
> in production without validating against trusted proxy CIDRs. Cloudflare's edge strips
> client-supplied `CF-Connecting-IP` before it reaches your Worker, so it is always safe to
> trust `CF-Connecting-IP` first.

---

## Prevention

Use this checklist when deploying Better Auth on a new Cloudflare Worker or migrating an
existing Worker to Better Auth:

- [ ] **`ipAddress.ipAddressHeaders` is configured** in `createAuth()` with
  `['CF-Connecting-IP', 'X-Forwarded-For']`
- [ ] **Both timeout guards are in place** — `worker/hono-app.ts` wraps `auth.handler()` and
  `worker/middleware/better-auth-provider.ts` wraps `auth.api.getSession()`, both using
  `Promise.race` + `AbortController` + `setTimeout(10_000)`
- [ ] **Analytics telemetry is wired up** — `AnalyticsService.trackSecurityEvent()` is called on
  `better_auth_timeout` from both code paths so timeouts are visible in the Cloudflare dashboard
- [ ] **Stress test `sign-in` in production** — confirm `429` responses appear after the BA
  threshold is reached (not possible to test locally, only in deployed Workers)
- [ ] **Monitor `wrangler tail` after first deploy** — look for the double error pattern
  (`Token verification error` followed by `Worker exceeded CPU time limit`) as an indicator
  of the missing-timeout issue

---

## Worker Code Reference

| File | Relevance |
|------|-----------|
| `worker/hono-app.ts` | `app.on(['POST','GET'], '/api/auth/*', ...)` — Path A timeout guard for all direct BA routes |
| `worker/middleware/better-auth-provider.ts` | `BetterAuthProvider.verifyToken()` — Path B timeout guard for session verification on non-auth endpoints |
| `worker/lib/auth.ts` | `createAuth()` — `advanced.ipAddress.ipAddressHeaders` configuration |
| `src/services/AnalyticsService.ts` | `trackSecurityEvent()` — telemetry for `better_auth_timeout` events (both paths) |

---

## Related KB Articles

- [KB-002](./KB-002-hyperdrive-database-down.md) — Hyperdrive binding connected but `database`
  service reports `down` (covers DB connectivity issues that can cause the timeout to fire)
- [KB-003](./KB-003-neon-hyperdrive-live-session-2026-03-25.md) — Live debugging session
  2026-03-25 (full context of Neon + Hyperdrive cold-start latency)
- [KB-004](./KB-004-prisma-wasm-cloudflare.md) — Prisma WASM error on Cloudflare Workers
  (covers another category of DB-layer failures that also cause `getSession` to hang)

### Related Auth Documentation

- [Better Auth Developer Guide](../auth/better-auth-developer-guide.md) — Plugin catalogue,
  adapter swapping, and configuration reference
- [ZTA Review Fixes](../auth/zta-review-fixes.md) — Auth telemetry, rate-limit semantics, and
  other security hardening applied alongside these fixes
- [Cloudflare Access](../auth/cloudflare-access.md) — Network-level protection for admin routes
  (complements BA's per-endpoint rate limiting)
