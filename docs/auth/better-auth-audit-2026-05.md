# Better Auth Security Audit — 2026-05

**Date:** 2026-05-01 to 2026-05-14  
**Scope:** `better-auth` integration across `src/`, `worker/`, `frontend/`, and relevant configuration files in the Bloqr monorepo.  
**Auditors:** Bloqr Security Team (internal review)  
**Linked PR milestone:** Findings tracked under the [Security](../../SECURITY.md) policy; individual fixes reference the PRs noted below.  
**Status:** All 13 findings resolved ✅

---

## Executive Summary

The May 2026 audit examined the `better-auth` integration surface against the Bloqr Zero Trust Architecture (ZTA) policy. Thirteen findings were raised; nine were in-sprint patches and four required coordination across the Worker, frontend, and infrastructure tiers. No exploitable session-hijack or privilege-escalation vulnerability was confirmed, but two medium-severity configuration weaknesses were present (findings 07 and 08).

---

## Findings

### AUDIT-01 — Sentinel Feature Flag Not Enforced at Auth Boundary

**Severity:** High  
**Fixed in:** PR #1721  

**Description:**  
The `sentinel()` middleware route group lacked a check against the `SENTINEL_ENABLED` environment binding before delegating to Better Auth's admin session handler. A Worker deployed with `SENTINEL_ENABLED = "false"` still accepted admin authentication requests, allowing escalated API calls to succeed if a valid admin session cookie was present.

**Remediation:**  
Added a guard at the top of `sentinel()` that reads `c.env.SENTINEL_ENABLED` and returns `403 Forbidden` if the flag is falsy:

```typescript
// worker/middleware/sentinel.ts
export async function sentinelGuard(c: Context<Env>, next: Next): Promise<Response> {
    if (c.env.SENTINEL_ENABLED !== 'true') {
        return c.json({ error: { code: 'FORBIDDEN', message: 'Sentinel is not enabled.' } }, 403);
    }
    return next();
}
```

---

### AUDIT-02 — `storeSessionInDatabase` Disabled in Production Binding

**Severity:** High  
**Fixed in:** PR #1724  

**Description:**  
The `better-auth` initialisation in `src/auth.ts` included:

```typescript
storeSessionInDatabase: false,  // TODO remove before prod
```

This `TODO` comment survived a release gate. Sessions were being issued as stateless JWTs with a 7-day expiry and no server-side revocation path, meaning logout did not invalidate existing sessions.

**Remediation:**  
`storeSessionInDatabase` was set to `true` and the D1 `sessions` table migration was verified present in all environments. A CI step now asserts `storeSessionInDatabase !== false` in `src/auth.ts` at build time.

---

### AUDIT-03 — API Key Not Propagated to `dash()` and `sentinel()` Handlers

**Severity:** Medium  
**Fixed in:** PR #1726  

**Description:**  
API key authentication (used by CI pipelines and the CLI tool) was validated in the Hono `authMiddleware` but the `authContext` was not forwarded into the `dash()` and `sentinel()` route handlers. Handlers used `c.get('authContext')?.method` but the key was stored under a different context slot, causing the downstream handlers to fall back to cookie-based session lookup and always reject API-key-authenticated calls.

**Remediation:**  
Unified context slot: `c.set('authContext', ...)` is now used consistently. The `dash()` and `sentinel()` handlers read `c.get('authContext')` using the same key that `authMiddleware` writes.

---

### AUDIT-04 — `auditLogs` Plugin Import Removed from `better-auth` Configuration

**Severity:** Low  
**Fixed in:** PR #1728  

**Description:**  
A refactor in a prior sprint removed the `auditLogs` plugin import from the `betterAuth({ plugins: [...] })` configuration while leaving the `auditLogs` table in the D1 schema. Auth events (login, logout, password change, role assignment) were no longer being written to D1.

**Remediation:**  
The `auditLogs` plugin was re-added. The `auditLogs` D1 migration was verified against all deployed environments. A test was added to assert that a successful login results in an `audit_logs` row with `event = 'sign_in'`.

---

### AUDIT-05 — `dash()` Route Missing Better Auth Session Validation

**Severity:** High  
**Fixed in:** PR #1730  

**Description:**  
The admin dashboard route group (`dash()`) was protected only by a custom RBAC middleware that checked a `role` field on the session payload. It did not call `better-auth`'s `validateSession()` before trusting the session payload, meaning a locally-forged session cookie (signed with a compromised secret) could bypass the role check.

**Remediation:**  
`dash()` now invokes `auth.api.getSession({ headers: c.req.raw.headers })` before any RBAC check. If `getSession` returns `null`, the handler returns `401 Unauthorized` immediately.

```typescript
// worker/routes/dash.routes.ts
const session = await auth.api.getSession({ headers: c.req.raw.headers });
if (!session) {
    return c.json({ error: { code: 'UNAUTHORIZED' } }, 401);
}
if (session.user.role !== 'admin') {
    return c.json({ error: { code: 'FORBIDDEN' } }, 403);
}
```

---

### AUDIT-06 — Session Not Rotated After Privilege Escalation

**Severity:** Medium  
**Fixed in:** PR #1733  

**Description:**  
When a user's role was promoted to `admin` via the admin console, the active session was not invalidated or rotated. The elevated privileges were visible in subsequent requests using the existing session only after its natural expiry (up to 7 days). Conversely, a user whose `admin` role was revoked continued to pass admin-gated checks for the same window.

**Remediation:**  
Role changes now call `auth.api.revokeSession({ sessionId })` and issue a new session immediately. Frontend receives a `Set-Cookie` with the new session token in the same response.

---

### AUDIT-07 — Password Minimum Length Below Policy

**Severity:** Medium  
**Fixed in:** PR #1735  

**Description:**  
The `better-auth` password policy was configured with `minPasswordLength: 6`, below the Bloqr security policy minimum of 12 characters. The password-change and password-reset flows accepted 6-character passwords.

**Remediation:**  
Updated to `minPasswordLength: 12` in `src/auth.ts`. A Zod validation guard in the frontend `PasswordChangeFormComponent` enforces the same minimum on the client side for immediate UX feedback.

---

### AUDIT-08 — Session Cookie `Domain` Missing Cross-Subdomain Attribute

**Severity:** Medium  
**Fixed in:** PR #1737  

**Description:**  
The `better-auth` session cookie was issued without an explicit `Domain` attribute. For production deployments where the API runs on `api.bloqr.app` and the SPA on `app.bloqr.app`, the cookie was not shared across subdomains, breaking SSO flows and causing unnecessary re-authentication.

**Remediation:**  
Set `cookieOptions.domain` to `.bloqr.app` (leading dot for cross-subdomain sharing) in `betterAuth({ ... })`. Updated integration tests to assert the `Domain=.bloqr.app` attribute on `Set-Cookie` responses.

---

### AUDIT-09 — Auth Rate Limits Too Permissive

**Severity:** Medium  
**Fixed in:** PR #1740  

**Description:**  
The `rateLimit` plugin was configured with:

```typescript
rateLimit: {
    window:           60,   // seconds
    max:              100,  // requests per window
    customRules: {
        '/api/auth/sign-in': { max: 50 },
    },
}
```

50 sign-in attempts per minute is well above the brute-force threshold for a 12-character alphanumeric password. No progressive backoff or lockout was configured.

**Remediation:**  
Tightened limits and added progressive lockout:

```typescript
rateLimit: {
    window:           60,
    max:              60,
    customRules: {
        '/api/auth/sign-in': {
            max:      5,     // 5 attempts per 60 s
            window:   60,
        },
        '/api/auth/reset-password': {
            max:      3,
            window:   300,   // 3 attempts per 5 min
        },
    },
}
```

Accounts are locked for 15 minutes after 10 failed attempts within 1 hour (tracked in D1).

---

### AUDIT-10 — API Keys Created Without Expiry

**Severity:** Low  
**Fixed in:** PR #1742  

**Description:**  
The API key issuance endpoint (`POST /api/auth/api-key`) did not enforce an expiry date. Keys issued to CI pipelines and third-party integrations had no TTL, surviving indefinitely unless manually revoked.

**Remediation:**  
API keys now require an `expiresAt` field (ISO 8601 string). Keys without an explicit expiry are rejected with `400 Bad Request`. The maximum allowed TTL is 365 days. A background Durable Object alarm checks for expired keys daily and marks them `revoked`.

---

### AUDIT-11 — `trustedOrigins` Included Wildcard Development Entries

**Severity:** High  
**Fixed in:** PR #1744  

**Description:**  
The `better-auth` configuration included:

```typescript
trustedOrigins: [
    'https://app.bloqr.app',
    'http://localhost:4200',     // dev
    'http://localhost:*',        // ← wildcard, non-functional but misleading
    '*',                         // ← CRITICAL: accepts all origins
],
```

The `'*'` entry was added during local development testing and survived into the production configuration. This bypassed CSRF origin checking for all origins.

**Remediation:**  
`trustedOrigins` was reduced to the explicit list of approved origins per environment. Wildcard and localhost entries were removed from the production binding. Environment-specific trusted origins are now injected via Worker bindings (`env.TRUSTED_ORIGINS` as a comma-delimited string) rather than hard-coded:

```typescript
// src/auth.ts
const trustedOrigins = c.env.TRUSTED_ORIGINS
    ? c.env.TRUSTED_ORIGINS.split(',').map(o => o.trim())
    : [];

const auth = betterAuth({
    trustedOrigins,
    // ...
});
```

A CI pipeline assertion verifies that `TRUSTED_ORIGINS` in the production secret store does not contain `*`, `localhost`, or `127.0.0.1`.

---

### AUDIT-12 — Missing `Secure` Flag on Session Cookie in Staging

**Severity:** Low  
**Fixed in:** PR #1746  

**Description:**  
The staging environment served the application over HTTPS but the `better-auth` cookie configuration omitted `secure: true`, meaning the browser would transmit the session cookie over HTTP if the user navigated to an HTTP URL (e.g., from a redirect misconfiguration).

**Remediation:**  
Set `cookieOptions.secure = true` unconditionally in all non-localhost environments. `secure` is now derived from `c.env.ENVIRONMENT !== 'development'` rather than relying on the framework default.

---

### AUDIT-13 — OAuth State Parameter Not Validated on Callback

**Severity:** High  
**Fixed in:** PR #1748  

**Description:**  
The OAuth2 callback handler for Google and GitHub providers did not validate the `state` parameter returned by the provider against the value stored in the session before the redirect. While `better-auth` generates a `state` value and stores it in KV, the callback route read the `state` from the query string but the KV lookup used the wrong TTL key (a refactor had changed the key prefix from `oauth:state:` to `auth:oauth_state:` without updating the lookup).

**Remediation:**  
Updated the KV lookup key prefix to `auth:oauth_state:` in the callback handler. Added an integration test asserting that a callback with a mismatched `state` returns `400 Bad Request` and does not issue a session.

---

## Remediation Summary

| ID | Severity | PR | Status |
|----|---------|----|--------|
| AUDIT-01 | High | #1721 | ✅ Fixed |
| AUDIT-02 | High | #1724 | ✅ Fixed |
| AUDIT-03 | Medium | #1726 | ✅ Fixed |
| AUDIT-04 | Low | #1728 | ✅ Fixed |
| AUDIT-05 | High | #1730 | ✅ Fixed |
| AUDIT-06 | Medium | #1733 | ✅ Fixed |
| AUDIT-07 | Medium | #1735 | ✅ Fixed |
| AUDIT-08 | Medium | #1737 | ✅ Fixed |
| AUDIT-09 | Medium | #1740 | ✅ Fixed |
| AUDIT-10 | Low | #1742 | ✅ Fixed |
| AUDIT-11 | High | #1744 | ✅ Fixed |
| AUDIT-12 | Low | #1746 | ✅ Fixed |
| AUDIT-13 | High | #1748 | ✅ Fixed |

**Finding counts by severity:**  
- High: 5 (AUDIT-01, AUDIT-02, AUDIT-05, AUDIT-11, AUDIT-13)  
- Medium: 5 (AUDIT-03, AUDIT-06, AUDIT-07, AUDIT-08, AUDIT-09)  
- Low: 3 (AUDIT-04, AUDIT-10, AUDIT-12)

---

## Related Documentation

- [SECURITY.md](../../SECURITY.md) — disclosure and response policy
- [CORS Policy](../middleware/cors.md) — `trustedOrigins` complements CORS allowed-origins
- [Turnstile Middleware](../middleware/turnstile.md) — API key bypass using `Authorization: Bearer blq_` prefix
- [Worker Request Lifecycle](../architecture/worker-request-lifecycle.md) — session validation in the request pipeline
