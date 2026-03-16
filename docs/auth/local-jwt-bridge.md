# Local JWT Auth Bridge

> **Temporary bridge** — self-contained auth system active until Clerk is production-ready.
> When Clerk goes live, set one environment variable and the system auto-switches with zero code changes.

## What this is

A drop-in `IAuthProvider` implementation that mirrors Clerk's authentication model exactly:

| Concept | Clerk | Local bridge |
|---|---|---|
| Primary identifier | `email_addresses[0]` | email or phone (E.164) |
| User ID | Clerk user ID string | UUID v4 |
| JWT issuer | `https://*.clerk.accounts.dev` | `adblock-compiler-local` |
| Session ID | `sid` claim | `sid` claim (UUID per login) |
| Role | `publicMetadata.role` | `metadata.role` in JWT |
| Tier | `publicMetadata.tier` | `metadata.tier` in JWT |
| Password hashing | Clerk-managed | PBKDF2-SHA256 (100k iterations) |

JWT claim structure is **identical** to Clerk's — the same `ClerkAuthProvider` tier/role resolution logic runs for both providers.

## Roles

Two roles are available. To add more, add one entry to `worker/utils/local-auth-roles.ts`:

| Role | Tier | Self-register | Description |
|---|---|---|---|
| `guest` | `free` | ✅ Yes | Authenticated user — full feature access |
| `admin` | `admin` | ❌ No | Unrestricted access + admin endpoints |

**Unauthenticated requests are read-only** — existing `requireAuth()` guards on write endpoints enforce this automatically.

Admin users must be created directly via D1 (Cloudflare dashboard or `wrangler d1 execute`):

```sql
-- Grant admin role to an existing user
UPDATE local_auth_users
SET role = 'admin', tier = 'admin', updated_at = datetime('now')
WHERE identifier = 'your@email.com';
```

## Configuration

### Local development

Add to **`.dev.vars`** (never `.env.local` — that's for non-Worker app vars):

```ini
# Local dev JWT signing secret — use any random string of 32+ characters
JWT_SECRET=replace-with-a-long-random-string-at-least-32-chars
```

Generate a strong secret:

```sh
openssl rand -base64 32
```

### Production

```sh
wrangler secret put JWT_SECRET
```

`JWT_SECRET` is a Worker Secret — never committed to source or set in `wrangler.toml [vars]`.

## API endpoints

All four endpoints live under `/api/auth/*` (the Angular app uses `API_BASE_URL = '/api'`).

### `POST /auth/signup`

Register a new account. All self-registered users receive the `guest` role.

**Request**
```json
{ "identifier": "user@example.com", "password": "min8chars" }
```

Identifier accepts **email addresses** (`user@example.com`) or **E.164 phone numbers** (`+12025551234`).
No verification email or SMS is sent — format validation only.

**Response `201`**
```json
{
  "success": true,
  "token": "<HS256 JWT>",
  "user": { "id": "<uuid>", "identifier": "user@example.com", "identifierType": "email", "tier": "free", "role": "guest" }
}
```

**Errors**: `400` invalid body · `409` identifier taken · `503` JWT_SECRET/DB not configured

---

### `POST /auth/login`

Authenticate and receive a JWT. Timing-safe: always runs full PBKDF2 even when the user is not found.

**Request**
```json
{ "identifier": "user@example.com", "password": "yourpassword" }
```

**Response `200`**
```json
{
  "success": true,
  "token": "<HS256 JWT>",
  "user": { "id": "<uuid>", "identifier": "user@example.com", "identifierType": "email", "tier": "free", "role": "guest" }
}
```

**Errors**: `400` invalid body · `401` invalid credentials (generic — no user enumeration) · `503` not configured

---

### `GET /auth/me`

Return the current user's profile. Requires `Authorization: Bearer <token>`.

**Response `200`**
```json
{
  "success": true,
  "user": { "id": "<uuid>", "identifier": "user@example.com", "identifierType": "email", "tier": "free", "role": "guest", "createdAt": "2026-01-01T00:00:00.000Z" }
}
```

**Errors**: `401` no/invalid token · `404` user not found

---

### `POST /auth/change-password`

Change the authenticated user's password. Requires `Authorization: Bearer <token>`.

**Request**
```json
{ "currentPassword": "oldpassword", "newPassword": "newmin8chars" }
```

**Response `200`**
```json
{ "success": true, "message": "Password updated successfully" }
```

**Errors**: `400` invalid body · `401` wrong current password or not authenticated

---

## Using the JWT

Include the token in the `Authorization` header on every authenticated request:

```http
Authorization: Bearer eyJhbGci...
```

Tokens expire after **24 hours**. Re-authenticate via `POST /auth/login` to get a new token.

## Migration to Clerk

When Clerk is production-ready:

**Step 1 — Set `CLERK_JWKS_URL`** (the only required change)

```ini
# wrangler.toml [vars]  (or .dev.vars locally)
CLERK_JWKS_URL = "https://your-instance.clerk.accounts.dev/.well-known/jwks.json"
```

The provider selection in `worker/worker.ts` auto-switches:
```typescript
// This logic already exists in worker.ts — nothing to change
const authProvider = env.CLERK_JWKS_URL
    ? new ClerkAuthProvider(env)   // ← activates when CLERK_JWKS_URL is set
    : new LocalJwtAuthProvider(env);
```

**Step 2 — Migrate users** (can be done gradually)

For each user in `local_auth_users`, create the corresponding Clerk user:
- `identifier` (email) → Clerk `email_addresses`
- `identifier` (phone) → Clerk `phone_numbers`
- `role` → Clerk `publicMetadata.role`
- `tier` → Clerk `publicMetadata.tier`

Clerk's JWT claims use the **same `metadata.tier` / `metadata.role` structure** — no downstream code changes needed.

**Step 3 — Clean up** (after migration confirmed)

```bash
# Remove the local auth bridge files
# worker/middleware/local-jwt-auth-provider.ts
# worker/utils/local-jwt.ts
# worker/utils/local-auth-roles.ts
# worker/handlers/local-auth.ts
# migrations/0005_local_auth_users.sql (drop the table via a new migration)
```

Remove the `JWT_SECRET` secret:
```sh
wrangler secret delete JWT_SECRET
```

## Security properties

- **Password hashing**: PBKDF2-SHA256, 100,000 iterations, 16-byte random salt per password
- **JWT algorithm**: HS256 (HMAC-SHA256) — symmetric, verified in Workers runtime without network calls
- **JWT expiry**: 24 hours; `clockTolerance` 5 s matches Clerk verifier
- **Timing safety**: login always runs full PBKDF2 derivation even for unknown identifiers
- **No user enumeration**: `401 Invalid credentials` for both wrong password and unknown identifier
- **Rate limiting**: `checkRateLimitTiered` applied to all write endpoints
- **Parameterised queries**: all D1 queries use `.prepare().bind()` — no SQL injection surface
- **ZTA telemetry**: all auth failures emit `trackSecurityEvent()` to Analytics Engine
