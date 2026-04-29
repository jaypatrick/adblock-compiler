# Auth Bootstrap Runbook

Step-by-step guide to bootstrap the admin user, run a smoke test, and create a Postman API
key from scratch in a fresh production environment. All steps use shell variables so values
captured in one step flow into the next automatically.

---

## Prerequisites

- `curl` and `jq` installed
- `psql` CLI with access to the Neon production database

Set these once before starting:

```bash
export API_BASE="https://api.bloqr.dev/api"
export NEON_CONN="postgresql://neondb_owner:<password>@<host>.neon.tech/neondb?sslmode=require"
export ADMIN_EMAIL="you@example.com"
export ADMIN_PASSWORD="a-very-strong-password"
```

> Replace `<password>`, `<host>`, and the database name with the values from your Neon
> project's connection details page.

---

## Step 1 — Sign Up

Create the initial user account. Better Auth creates it with `tier: free` and `role: user`
by default — promotion happens in Step 2.

```bash
SIGNUP_RESPONSE=$(curl -s -X POST "$API_BASE/auth/sign-up/email" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Admin User\",
    \"email\": \"$ADMIN_EMAIL\",
    \"password\": \"$ADMIN_PASSWORD\"
  }")

echo "$SIGNUP_RESPONSE" | jq .

export USER_ID=$(echo "$SIGNUP_RESPONSE" | jq -r '.user.id')
echo "User ID: $USER_ID"
```

**Expected response (`200 OK`):**

```json
{
  "user": {
    "id": "01965f3a-...",
    "name": "Admin User",
    "email": "you@example.com",
    "tier": "free",
    "role": "user"
  },
  "session": {
    "id": "01965f3b-...",
    "token": "sess_...",
    "expiresAt": "2026-05-06T00:00:00.000Z"
  }
}
```

---

## Step 2 — Promote to Admin in Neon

Better Auth cannot self-promote the first admin — there is no existing admin to authorise
the `set-role` call. Promote directly via SQL using the `neondb_owner` role.

```bash
psql "$NEON_CONN" <<SQL
UPDATE users
SET    role = 'admin',
       tier = 'admin'
WHERE  id = '$USER_ID';
SQL
```

Verify the update:

```bash
psql "$NEON_CONN" -c "SELECT id, email, role, tier FROM users WHERE id = '$USER_ID';"
```

Expected output:

```
 id                                   | email            | role  | tier
--------------------------------------+------------------+-------+-------
 01965f3a-...                         | you@example.com  | admin | admin
(1 row)
```

---

## Step 3 — Sign In and Capture the Bearer Token

Sign in to obtain a fresh session token. The token is returned in the response body
and is also set as the `bloqr.session_token` cookie.

```bash
SIGNIN_RESPONSE=$(curl -s -X POST "$API_BASE/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$ADMIN_EMAIL\",
    \"password\": \"$ADMIN_PASSWORD\"
  }")

echo "$SIGNIN_RESPONSE" | jq .

export BEARER_TOKEN=$(echo "$SIGNIN_RESPONSE" | jq -r '.session.token')
echo "Bearer token: $BEARER_TOKEN"
```

**Expected response (`200 OK`):**

```json
{
  "user": {
    "id": "01965f3a-...",
    "email": "you@example.com",
    "tier": "admin",
    "role": "admin"
  },
  "session": {
    "id": "01965f3b-...",
    "token": "sess_...",
    "expiresAt": "2026-05-06T00:00:00.000Z"
  }
}
```

Verify that `tier` and `role` are both `admin` — confirming the promotion from Step 2.

---

## Step 4 — Smoke Test the Auth Endpoints

### Sign-out (requires an explicit empty JSON body)

`POST /api/auth/sign-out` **must** include `Content-Type: application/json` **and**
`-d '{}'`. Omitting the body causes a request error; the worker currently responds with
`400 Bad Request` for an invalid JSON body.

```bash
curl -s -X POST "$API_BASE/auth/sign-out" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BEARER_TOKEN" \
  -d '{}' | jq .
```

**Expected response (`200 OK`):**

```json
{ "success": true }
```

### Re-sign in to get a fresh token for the next steps

```bash
SIGNIN_RESPONSE=$(curl -s -X POST "$API_BASE/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$ADMIN_EMAIL\",
    \"password\": \"$ADMIN_PASSWORD\"
  }")

export BEARER_TOKEN=$(echo "$SIGNIN_RESPONSE" | jq -r '.session.token')
echo "Fresh bearer token: $BEARER_TOKEN"
```

### List your API keys

```bash
curl -s "$API_BASE/keys" \
  -H "Authorization: Bearer $BEARER_TOKEN" | jq .
```

**Expected response (`200 OK`):**

```json
{
  "success": true,
  "keys": [],
  "total": 0
}
```

---

## Step 5 — Create a Postman API Key

Use `POST /api/keys` with the Better Auth Bearer token. No `X-Admin-Key` is needed for
self-service key creation.

> **Note**: `scopes` defaults to `["compile"]` if omitted. This example includes
> `"scopes": ["compile"]` explicitly for clarity.

```bash
KEY_RESPONSE=$(curl -s -X POST "$API_BASE/keys" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $BEARER_TOKEN" \
  -d '{
    "name": "Postman Testing",
    "scopes": ["compile"],
    "expiresInDays": 90
  }')

echo "$KEY_RESPONSE" | jq .

export API_KEY=$(echo "$KEY_RESPONSE" | jq -r '.key')
echo "API key: $API_KEY"
```

**Expected response (`201 Created`):**

```json
{
  "success": true,
  "id": "...",
  "key": "abc_Xk9mP2...",
  "keyPrefix": "abc_Xk9m",
  "name": "Postman Testing",
  "scopes": ["compile"],
  "rateLimitPerMinute": 60,
  "expiresAt": "2026-07-29T00:00:00.000Z",
  "createdAt": "2026-04-29T00:00:00.000Z"
}
```

> **Copy the `key` value immediately** — it is only returned once and cannot be
> retrieved again.

---

## Step 6 — Postman Setup

Use the variables captured above to configure Postman for ongoing testing.

### Create the Postman environment

1. Open Postman → **Environments** → **+**
2. Name it `bloqr-prod`
3. Add the following variables:

| Variable   | Type    | Value                                      |
|------------|---------|--------------------------------------------|
| `baseUrl`  | default | `https://api.bloqr.dev`                    |
| `apiBase`  | default | `https://api.bloqr.dev/api`                |
| `apiKey`   | secret  | _(paste the `key` value from Step 5)_      |
| `bearerToken` | secret | _(paste `$BEARER_TOKEN` from Step 3/4)_ |

4. Click **Save** and select `bloqr-prod` as the active environment.

### Collection-level authorisation

1. Create a new collection named `bloqr-prod`
2. Open the collection → **Authorization** tab
3. Set **Type** to `Bearer Token` and **Token** to `{{apiKey}}`
4. Click **Save**

All requests in the collection will inherit `{{apiKey}}` automatically. Override
per-request as needed (e.g., to use `{{bearerToken}}` for key-management calls).

### Quick verification request

```
GET https://api.bloqr.dev/api/version
```

No auth required. Expected response:

```json
{ "version": "0.x.x", "environment": "production" }
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `POST /api/auth/sign-out` → `400` | Missing `Content-Type` or empty body | Add `-H "Content-Type: application/json" -d '{}'` |
| Sign-in response shows `tier: free` / `role: user` after promotion | Neon promotion query didn't commit | Re-run the `UPDATE` in Step 2; verify with the `SELECT` below it |
| `POST /api/keys` → `403 Forbidden` | Request used a non-interactive auth method (for example, API key-on-API-key) or failed the interactive-session guard | Sign in normally to obtain a fresh interactive Bearer token, then retry `POST /api/keys` with that token instead of an API key or other non-interactive credential |
| `POST /api/keys` → key with empty `scopes` | `scopes` field omitted from request body | Pass `"scopes": ["compile"]` explicitly — the default is `["compile"]` but explicit is safer |
| `401 Unauthorized` in Postman | Expired Bearer token | Re-run Step 3/4 and update `{{bearerToken}}` in the environment |

---

## Related Documentation

- [Better Auth Admin Guide](better-auth-admin-guide.md) — User management, banning, role promotion via the API
- [Better Auth User Guide](better-auth-user-guide.md) — Full sign-up / sign-in / session reference
- [API Authentication](api-authentication.md) — API key scopes, limits, and usage
- [Postman Testing](postman-testing.md) — Postman collection setup and request examples
- [Cloudflare Access](cloudflare-access.md) — Protecting `/admin/*` with Cloudflare Zero Trust
