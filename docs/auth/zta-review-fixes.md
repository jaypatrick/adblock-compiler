# ZTA Review Fixes (PR #1273 Follow-up)

This document describes the six fix areas addressed as follow-up to [PR #1273](https://github.com/nicholasgriffintn/adblock-compiler/pull/1273), which introduced tighter Hono + Better Auth + Neon + Cloudflare integration. Each fix strengthens Zero Trust Architecture compliance, improves telemetry fidelity, or hardens edge-case behavior identified during code review.

Related issue: [#1275](https://github.com/nicholasgriffintn/adblock-compiler/issues/1275)

---

## 1. Prisma Schema — One-to-One TwoFactor Relationship

**File:** `prisma/schema.prisma`

The `User` model previously declared `twoFactor TwoFactor[]`, allowing multiple two-factor records per user. Since the system supports a single 2FA method per account, the schema was tightened:

- `TwoFactor[]` → `TwoFactor?` on the `User` model (one-to-one optional relation)
- `@@index([userId])` → `@@unique([userId])` on the `TwoFactor` model (database-level uniqueness)

This enforces single-factor semantics at both the Prisma type level and the database constraint level.

---

## 2. Schema Strictness — `.trim()` on 2FA Validation Schemas

**File:** `worker/schemas.ts`

Both `TwoFactorVerifySchema` (TOTP code) and `TwoFactorBackupSchema` (backup code) now apply `.trim()` before other validations. This prevents accidental whitespace from mobile copy-paste causing validation failures, while still enforcing length and format constraints on the trimmed value.

- `TwoFactorVerifySchema.code`: `z.string().trim().length(6).regex(/^\d{6}$/)`
- `TwoFactorBackupSchema.code`: `z.string().trim().min(1)`

---

## 3. Rate Limit — Disabled API Key Semantics

**File:** `worker/middleware/index.ts`

The `checkRateLimitTiered()` function now handles three per-API-key rate-limit states:

| `apiKeyRateLimit` value | Behavior |
|------------------------|----------|
| `null` | No per-key override; use tier default |
| `> 0` | Use `Math.min(tierLimit, apiKeyRateLimit)` |
| `0` | Key is disabled — block immediately without KV lookup |

The guard condition was changed from `> 0` to `>= 0` so that a rate limit of `0` is treated as a valid override (total block) rather than falling through to the tier default. An early return for `maxRequests === 0` avoids unnecessary KV reads.

---

## 4. Auth Telemetry Gaps

**File:** `worker/middleware/auth.ts`

Three telemetry issues were corrected in the auth chain:

1. **`auth_success` events** now emit `authMethod` (e.g., `'api-key'`, `'clerk-jwt'`, `'better-auth'`) instead of the non-standard `reason` field. This aligns with the `SecurityEventData` interface and enables consistent dashboard filtering.

2. **`userId` fallback**: When the primary `userId` is not available (anonymous provider result), the event now falls back to `providerResult.providerUserId` to ensure every auth event is attributable.

3. **`auth_failure` on API-key 401**: The API-key validation path now emits an `auth_failure` security event before returning 401, providing visibility into invalid API-key usage attempts.

---

## 5. Better Auth Provider Telemetry

**File:** `worker/middleware/better-auth-provider.ts`

The auth-failure event in the Better Auth provider was enriched with additional fields:

- `authMethod: 'better-auth'` — identifies the provider that rejected the request
- `path` — the request path that triggered the auth attempt
- `method` — the HTTP method (GET, POST, etc.)
- `clientIpHash` — privacy-preserving hash of the client IP via `AnalyticsService.hashIp()`

These fields enable correlation between auth failures and specific request patterns in security dashboards.

---

## 6. Admin Endpoint Hardening — Session Revocation

**File:** `worker/hono-app.ts`

The `DELETE /admin/users/:id/sessions` handler was refactored from an inline anonymous function to a named exported function (`handleAdminRevokeUserSessions`). The extracted handler adds:

- **Cloudflare Access verification**: `verifyCfAccessJwt()` is called after role-based auth, ensuring the request traverses the Cloudflare Access tunnel. On failure, a `cf_access_denial` security event is emitted before returning 403.
- **Parameterized SQL**: The `DELETE FROM sessions WHERE user_id = $1` query uses positional parameters (no string interpolation).
- **Resource cleanup**: The PostgreSQL pool connection is released in a `finally` block.
- **Consistent error handling**: Database errors return 500 with a generic message; details are not leaked to the client.

This follows the same pattern used by other admin handlers (`handleAdminGetUserUsage`, `handleAdminUserBan`, etc.).

---

## Test Coverage

Twelve new tests were added across three test files:

### Rate Limit Tests (`worker/middleware/index.test.ts`)

| Test | Assertion |
|------|-----------|
| Per-API-key rate limit override | `apiKeyRateLimit: 5` on Free tier → `result.limit === 5` |
| Disabled key blocks immediately | `apiKeyRateLimit: 0` → `result.allowed === false`, KV untouched |
| Null fallback to tier default | `apiKeyRateLimit: null` → `result.limit === tierDefault` |

### Schema Tests (`worker/schemas.test.ts`)

| Test | Assertion |
|------|-----------|
| TwoFactorVerifySchema: valid 6-digit | `"123456"` passes |
| TwoFactorVerifySchema: non-digit rejection | `"abcdef"` fails |
| TwoFactorVerifySchema: wrong length | `"12345"` and `"1234567"` fail |
| TwoFactorVerifySchema: trim whitespace | `" 123456 "` passes, data is `"123456"` |
| TwoFactorBackupSchema: valid code | `"abc123-def456"` passes |
| TwoFactorBackupSchema: empty rejection | `""` fails |
| TwoFactorBackupSchema: whitespace-only | `"   "` fails (trimmed to empty) |
| TwoFactorBackupSchema: trim | `" abc123 "` passes, data is `"abc123"` |

### Admin Endpoint Tests (`worker/hono-app.test.ts`)

| Test | Assertion |
|------|-----------|
| Anonymous → 401 (root prefix) | `DELETE /admin/users/:id/sessions` returns 401 |
| Anonymous → 401 (`/api` prefix) | `DELETE /api/admin/users/:id/sessions` returns 401 |
| Non-admin → 401 | Invalid Bearer token → 401 (auth chain rejects) |
| Route registered | Status is not 404 |
