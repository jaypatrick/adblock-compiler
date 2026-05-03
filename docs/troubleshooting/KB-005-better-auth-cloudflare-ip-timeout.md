# KB-005: Better Auth Cloudflare — Hanging Worker and Rate Limiting Skipped (IP Extraction Required)

> **Status:** ✅ Resolved
> **Affected components:** Better Auth session middleware, Better Auth rate limiter
> **Resolved in:** PR adding AbortSignal timeout + ipAddress.ipAddressHeaders config
> **Date:** 2026-03-27

---

## Summary

Documents two commonly encountered integration issues when using Better Auth with Cloudflare Workers:

1. **Worker CPU timeout** (hung requests, double error lines) on `/api/auth/get-session` and related endpoints — caused by missing `AbortSignal` timeout on `getSession` call.
2. **Silent skipping of all Better Auth per-endpoint rate limiting** (brute-force protection off!) — caused by missing `ipAddress.ipAddressHeaders` config, needed so Better Auth grabs the real client IP from Cloudflare's `CF-Connecting-IP` header.

Both issues are easy to miss, even if you read the Better Auth or Cloudflare SDK docs first.

---

## Issue #1: Worker CPU Timeout on Session Endpoints

### Symptom

The worker hangs on `/api/auth/get-session`, `/api/auth/sign-in`, or other Better Auth endpoints, eventually timing out with:

```
Error: The script will never generate a response.
Error: The script will never generate a response.
```

**Key tells:**
- The same error line appears **twice** in `wrangler tail` output
- Requests to `/api/auth/*` endpoints hang for ~30 seconds before failing
- The Cloudflare dashboard "CPU Time" metric shows 100% utilization on these requests
- No database error is logged — the hang happens before the DB call completes

### How to Diagnose

Run `wrangler tail` and trigger a session endpoint:

```bash
wrangler tail
```

Then in another terminal:

```bash
curl -v "https://your-worker.workers.dev/api/auth/get-session" \
  -H "Cookie: adblock.session_token=your_token"
```

If you see the double error line above and the request hangs for 30+ seconds, this KB applies.

### Root Cause

Better Auth's `auth.api.getSession()` performs a database query via Prisma to look up the session. In Cloudflare Workers, if that query hangs (e.g., due to Hyperdrive connection pool exhaustion, Neon database overload, or network timeout), the Worker will spin at 100% CPU waiting indefinitely.

Cloudflare Workers have a **CPU time budget** (typically 50ms for free tier, 30 seconds for paid). If a Promise never resolves, the Worker consumes its entire CPU budget and Cloudflare kills it with the double error line above.

**The problem:** The `getSession` call in `BetterAuthProvider.verifyToken()` had no timeout. If the database query hung, the Worker hung.

**The fix:** Wrap the `getSession` call with `AbortSignal.timeout()` or a manual `Promise.race()` timeout to force-fail after a reasonable duration (10 seconds).

### Resolution

The fix is in `worker/middleware/better-auth-provider.ts`:

```typescript
// Before: No timeout — hangs indefinitely if DB call stalls
const session = await auth.api.getSession(betterAuthRequest);

// After: Race against 10-second timeout
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
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }
    }),
    new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            abortController.abort();
            reject(new DOMException('DB call exceeded 10s', 'TimeoutError'));
        }, 10_000);
    }),
]);
```

**Why this works:**
- The `Promise.race()` returns whichever completes first: the session lookup or the 10-second timeout
- If the timeout wins, the catch block logs a `TimeoutError` and emits a security event to Analytics Engine
- The Worker returns a 401 (anonymous) response instead of hanging indefinitely
- The abort signal allows Better Auth/Prisma to cancel the in-flight database query

### Testing the Fix

**Local dev (with Hyperdrive local override):**

```bash
# Start wrangler dev
wrangler dev

# In another terminal, trigger a session check
curl "http://localhost:8787/api/auth/get-session" \
  -H "Cookie: adblock.session_token=test_token"
```

Should return a 401 within 10 seconds max (likely much faster if the DB is healthy).

**Production:**

```bash
curl "https://your-worker.workers.dev/api/auth/get-session" \
  -H "Cookie: adblock.session_token=your_token"
```

The request should complete in under 2 seconds if the database is healthy, or fail cleanly within 10 seconds if the database is overloaded.

---

## Issue #2: Rate Limiting Silently Skipped (IP Extraction Required)

### Symptom

Better Auth's built-in rate limiting (brute-force protection on `/sign-in`, `/sign-up`, `/two-factor/verify`) **silently does nothing**:

- Attackers can make unlimited sign-in attempts without being throttled
- The Better Auth rate limiter logs no errors — it just skips all rate limiting
- All requests succeed regardless of how many times the same IP hammers the endpoint

**Key tells:**
- No rate limit errors in logs, even after 100+ requests from the same IP
- Better Auth's `advanced.rateLimit` config is present and looks correct
- The issue only manifests in production on Cloudflare Workers (local dev may work)

### How to Diagnose

Run a rate limit smoke test:

```bash
# Hammer the sign-in endpoint 20 times in a row
for i in {1..20}; do
  curl -X POST "https://your-worker.workers.dev/api/auth/sign-in" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrong"}' \
    -w "\n%{http_code}\n"
done
```

**Expected behavior (with rate limiting working):**
- First 5 requests: `400` (invalid credentials)
- Requests 6–20: `429` (rate limit exceeded)

**Broken behavior (without IP extraction):**
- All 20 requests: `400` (invalid credentials)
- No `429` responses — rate limiting is skipped

### Root Cause

Cloudflare Workers run behind Cloudflare's reverse proxy. The client's real IP address is **not** in `request.headers.get('x-forwarded-for')` by default — Cloudflare removes that header and injects `CF-Connecting-IP` instead.

Better Auth's rate limiter needs to know the client IP to enforce per-IP limits. By default, it looks for the IP in:
1. `request.headers.get('x-forwarded-for')`
2. `request.socket.remoteAddress` (not available in Workers)
3. Falls back to `null` if neither is found

When Better Auth gets `null` as the IP, it **silently skips all rate limiting** rather than throwing an error. This is a security-critical silent failure.

**The problem:** The `ipAddress.ipAddressHeaders` config was missing from the Better Auth factory in `worker/lib/auth.ts`, so Better Auth couldn't extract the real client IP.

**The fix:** Add `ipAddress.ipAddressHeaders: ['CF-Connecting-IP', 'X-Forwarded-For']` to the `advanced` block in the Better Auth config.

### Resolution

The fix is in `worker/lib/auth.ts`:

```typescript
return betterAuth({
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    secret: env.BETTER_AUTH_SECRET,
    basePath: '/api/auth',
    baseURL: env.BETTER_AUTH_URL || baseURL,

    // ... other config ...

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

    plugins: [
        bearer(),
        twoFactor({ issuer: 'bloqr-backend' }),
        multiSession(),
        admin(),
    ],
});
```

**Why this works:**
- Better Auth now reads `CF-Connecting-IP` first (Cloudflare production)
- Falls back to `X-Forwarded-For` (local dev with `wrangler dev`)
- The rate limiter now sees the real client IP and enforces per-IP throttling

### Testing the Fix

**Local dev:**

```bash
# Start wrangler dev
wrangler dev

# Hammer the sign-in endpoint
for i in {1..10}; do
  curl -X POST "http://localhost:8787/api/auth/sign-in" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrong"}' \
    -w "\n%{http_code}\n"
done
```

Should see `429` responses after the first 5 attempts (Better Auth's default rate limit for sign-in is 5 requests per 15 minutes per IP).

**Production:**

```bash
# Same test against production
for i in {1..10}; do
  curl -X POST "https://your-worker.workers.dev/api/auth/sign-in" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"wrong"}' \
    -w "\n%{http_code}\n"
done
```

Should see `429` responses after the first 5 attempts.

---

## Prevention Checklist for New Better Auth + Cloudflare Deployments

When integrating Better Auth with Cloudflare Workers, verify all of the following:

- [ ] **Timeout all database-backed auth calls:** Wrap `auth.api.getSession()`, `auth.api.signIn()`, and other DB-dependent methods in a `Promise.race()` with a 10-second timeout
- [ ] **Configure IP extraction:** Add `advanced.ipAddress.ipAddressHeaders: ['CF-Connecting-IP', 'X-Forwarded-For']` to the Better Auth factory
- [ ] **Test rate limiting in production:** Hammer a rate-limited endpoint (e.g., `/sign-in`) and verify you get `429` responses
- [ ] **Monitor timeout errors:** Check Analytics Engine or logs for `TimeoutError` events — these indicate database overload or Hyperdrive issues
- [ ] **Verify ZTA telemetry:** Confirm `auth_failure` events with `reason: 'better_auth_timeout'` are emitted when timeouts occur

---

## Worker Code Reference

| File | Relevance |
|---|---|
| `worker/middleware/better-auth-provider.ts` | `BetterAuthProvider.verifyToken()` — wraps `getSession` with timeout |
| `worker/lib/auth.ts` | `createAuth()` — Better Auth factory with `ipAddress.ipAddressHeaders` config |
| `worker/lib/prisma.ts` | `createPrismaClient()` — Hyperdrive connection (timeout doesn't affect this layer) |
| `src/services/AnalyticsService.ts` | `trackSecurityEvent()` — ZTA telemetry sink for timeout events |

---

## Related KB Articles

- [KB-002](./KB-002-hyperdrive-database-down.md) — Hyperdrive binding connected but `database` service reports `down`
- [KB-004](./KB-004-prisma-wasm-cloudflare.md) — Prisma WASM instantiation error on Cloudflare Workers
- *(planned)* KB-006 — Hyperdrive connection pool exhaustion (when timeouts become frequent)

---

## Upstream References

- [Better Auth: IP Address Detection](https://better-auth.com/docs/concepts/security#ip-address-detection)
- [Better Auth: Rate Limiting](https://better-auth.com/docs/concepts/rate-limit)
- [Cloudflare: CF-Connecting-IP Header](https://developers.cloudflare.com/fundamentals/reference/http-request-headers/#cf-connecting-ip)
- [Cloudflare Workers: CPU Time Limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)

---

## Feedback & Contribution

If you encountered a variant of this issue or discovered a new failure mode, please open an issue tagged `troubleshooting` and `documentation` in `jaypatrick/bloqr-backend` with the details so it can be captured in a follow-up KB entry.
