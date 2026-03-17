# Admin Access Guide

How admin endpoints are protected and how to configure admin access.

## Current Admin Authentication

Admin routes use **Bearer JWT authentication** as the primary layer, with optional Cloudflare Access as defense-in-depth. The `/admin/*` Angular panel and all backing API endpoints are fully protected.

### Layer 1: Bearer JWT (Primary)

Admin requests require a valid JWT with `role === 'admin'`. The Angular admin panel attaches this automatically via the HTTP interceptor. For API access:

```bash
# Obtain a session token, then:
curl -X GET https://adblock-compiler.jayson-knight.workers.dev/admin/local-users \
  -H "Authorization: Bearer <your-jwt>"
```

### Layer 2: Cloudflare Access (Defense-in-Depth)

When configured, admin routes also require a valid Cloudflare Access JWT:

1. User authenticates via Cloudflare Access (SSO, email OTP, etc.)
2. CF Access sets a `CF-Access-JWT-Assertion` header
3. Worker verifies the JWT against CF Access JWKS
4. If CF Access is not configured (`CF_ACCESS_TEAM_DOMAIN` not set), this layer is skipped

**Configuration:**
```bash
wrangler secret put CF_ACCESS_TEAM_DOMAIN  # e.g., "mycompany"
wrangler secret put CF_ACCESS_AUD          # Application audience tag
```

## Local Auth Admin Access

### Current State

| Feature | Status |
|---------|--------|
| CF Access verification | ✅ Active (when configured) |
| Bearer JWT `requireAuth()` on admin routes | ✅ Active |
| `role === 'admin'` check on admin routes | ✅ Active |
| Audit logging for all write/mutation operations | ✅ Active |

### How to Become an Admin (Local Auth)

1. **Sign up** — Create an account via `/sign-up`
2. **Set `INITIAL_ADMIN_EMAIL`** in `.dev.vars`:
   ```
   INITIAL_ADMIN_EMAIL=you@youremail.com
   ```
3. **Bootstrap** — While signed in, call:
   ```bash
   curl -X POST /api/auth/bootstrap-admin \
     -H "Authorization: Bearer <your-jwt>"
   ```
   The Worker promotes your account to `admin` role and returns a new JWT.
4. **Sign out and sign back in** — The new JWT includes `role: "admin"`.

### Bootstrap Problem: First Admin

When setting up a fresh installation with no existing admins:

1. **Option A (Recommended)**: Use the `POST /auth/bootstrap-admin` endpoint (email-gated by `INITIAL_ADMIN_EMAIL`).

2. **Option B**: Directly update the D1 database via `wrangler d1 execute`:
   ```bash
   wrangler d1 execute adblock-compiler-d1-database --command "UPDATE local_auth_users SET role='admin' WHERE identifier='you@example.com'"
   ```

## Admin Endpoints Reference

The admin system exposes API endpoints across several resource groups. See the [Admin API Reference](../admin/api-reference.md) for the full list with request/response schemas.

**Resource groups:**

| Group | Base Path | Description |
|-------|-----------|-------------|
| Local Users | `/admin/local-users` | User management, tier editing, role assignment |
| Storage | `/admin/storage/*` | Storage tools (stats, export, query) |
| API Keys | `/admin/auth/api-keys` | Cross-user key management + revocation |
| Auth Config | `/admin/auth/config` | Auth configuration inspector |
| Usage | `/admin/usage/*` | Per-user API usage statistics |

### Example: List Users

```bash
curl -X GET https://your-worker.workers.dev/admin/local-users \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIs..."
```

## Cloudflare Access Setup (Recommended)

For production admin routes, configure Cloudflare Access as a defense-in-depth layer:

### 1. Create a Cloudflare Access Application

1. Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com) → Access → Applications
2. Click **"Add an application"** → **Self-hosted**
3. Configure:
   - **Application name**: `Adblock Compiler Admin`
   - **Application domain**: `your-worker.workers.dev`
   - **Path**: `/admin/*`
4. Add an access policy:
   - **Policy name**: `Admin Users`
   - **Action**: Allow
   - **Include**: Emails matching your admin list

### 2. Get the AUD Tag

1. After creating the application, go to its settings
2. Copy the **Application Audience (AUD) Tag**
3. Store it:
   ```bash
   wrangler secret put CF_ACCESS_AUD
   ```

### 3. Set the Team Domain

```bash
wrangler secret put CF_ACCESS_TEAM_DOMAIN
# Enter your team name (e.g., "mycompany")
# This corresponds to: https://mycompany.cloudflareaccess.com
```

### How CF Access Works with the Worker

1. User navigates to `/admin/storage/stats`
2. Cloudflare Access intercepts → shows login page (email OTP, SSO, etc.)
3. After authentication, CF Access sets `CF-Access-JWT-Assertion` header
4. Worker verifies the JWT against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`
5. If valid, request proceeds to the admin handler
6. If invalid (or not configured), request is rejected with 403

## Security Recommendations

1. **Always configure CF Access** for production admin routes — it provides an additional authentication layer independent of your application code
2. **Limit admin users** — only grant `role: admin` to users who need it
3. **Monitor admin access** — check Worker logs for admin endpoint usage
4. **Use `INITIAL_ADMIN_EMAIL`** — set this env var to gate bootstrap to a specific email address

