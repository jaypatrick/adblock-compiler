# Postman Collection

Postman collection and environment files for testing the Adblock Compiler API.

> **Auto-generated** — do not edit these files directly.
> Run `deno task postman:collection` to regenerate from `docs/api/openapi.yaml`.

> **Better Auth augmentation**: The collection includes `/auth/sign-up/email`, `/auth/sign-in/email`, `/auth/get-session`, and `/auth/sign-out` requests that are **not** in `openapi.yaml`. Better Auth serves these routes at runtime without an OpenAPI route definition, so the generator injects them manually into the `Authentication` folder. If these routes change, update `betterAuthItems` in `scripts/generate-postman-collection.ts` and regenerate.

## Files

- `postman-collection.json` — Postman collection with all API endpoints and tests (auto-generated)
- `postman-environment-local.json` — Local dev environment (`http://localhost:8787/api`, no auth vars) (auto-generated)
- `postman-environment-prod.json` — Production environment (`https://api.bloqr.dev/api`, secret vars empty) (auto-generated)
- `postman-environment.json` — Legacy alias for the local environment; kept for CI/Newman backward compatibility (auto-generated)

## Regenerating

All files are generated automatically from the canonical OpenAPI spec:

```bash
deno task postman:collection
```

The CI pipeline (`validate-postman-collection` job) enforces that these files stay in sync with `docs/api/openapi.yaml`. If you modify the spec, run the task above and commit the updated files — CI will fail otherwise.

## Schema hierarchy

```
docs/api/openapi.yaml                        ← canonical source of truth (edit this)
docs/api/cloudflare-schema.yaml              ← auto-generated (deno task schema:cloudflare)
docs/postman/postman-collection.json         ← auto-generated (deno task postman:collection)
docs/postman/postman-environment-local.json  ← auto-generated (deno task postman:collection)
docs/postman/postman-environment-prod.json   ← auto-generated (deno task postman:collection)
docs/postman/postman-environment.json        ← auto-generated legacy alias → local
```

## Quick Start

1. Open Postman and click **Import**
2. Import `postman-collection.json` to add all API requests
3. For **local dev**: import `postman-environment-local.json` and select **Adblock Compiler API - Local**
4. For **production**: import `postman-environment-prod.json` and select **Adblock Compiler API - Prod**
5. Set `postmanEmail` and `postmanPassword` in the environment's **Current Value** only (never Initial Value / Shared Value)
6. Start the local server: `deno task dev` (local only)
7. Run requests — the collection pre-request script auto-refreshes `bearerToken` when needed; no manual token management required

> **No manual token management**: The collection-level pre-request script auto-calls `/auth/sign-in/email` whenever `bearerToken` is missing or expired, and stores the refreshed token back in `bearerToken`. Just set `postmanEmail` + `postmanPassword` and start sending requests.

## Variables Reference

| Variable | Set by | Description |
|---|---|---|
| `baseUrl` | Environment / collection default | API base URL (e.g. `https://api.bloqr.dev/api`) |
| `prodUrl` | Collection default | Production URL reference |
| `bearerToken` | Auto-set by Sign In / pre-request script | Better Auth session token; refreshed automatically |
| `bearerTokenExpiry` | Auto-set by pre-request script | Unix timestamp (ms) when `bearerToken` expires |
| `postmanEmail` | **Manual — Current Value only** | Email of the Postman test user |
| `postmanPassword` | **Manual — Current Value only** | Password of the Postman test user |
| `userApiKey` | Auto-set by Create API key | User-scoped API key (`abc_...`) |
| `apiKeyPrefix` | Auto-set by Create API key | Prefix of the last created API key |
| `keyId` | Auto-set by Create API key | ID of the last created API key; used by Update/Revoke API Key requests |
| `lastCreatedKeyId` | Auto-set by Create API key | Alias for `keyId` — both are set simultaneously |
| `userId` | Auto-set by Sign Up / Get Session | Authenticated user ID |
| `adminKey` | Manual | Admin API key for `X-Admin-Key` protected endpoints |
| `requestId` | Manual / auto | Request ID for async queue operations |

`postmanEmail` and `postmanPassword` must be set as **Current Value** only — never as Initial Value or Shared Value — so they are never synced to Postman Cloud or committed to git.

## Prod Environment & Credentials

The `postman-environment-prod.json` environment sets `baseUrl` to `https://api.bloqr.dev/api`. Secret variables (`bearerToken`, `userApiKey`, `adminKey`, `postmanPassword`) have empty Initial Values and must be populated at runtime.

### Desktop: Postman Vault

[Postman Vault](https://learning.postman.com/docs/sending-requests/postman-vault/postman-vault-secrets/) stores secrets in your OS keychain. They are never synced to Postman Cloud.

1. In Postman Desktop: click the **Vault** icon (lock icon, bottom-left) or go to **Settings → Vault**
2. Add entries:
   - `POSTMAN_EMAIL`
   - `POSTMAN_PASSWORD`
   - `POSTMAN_USER_API_KEY`
   - `POSTMAN_ADMIN_KEY`
3. In the **Prod** environment editor, set each variable's **Current Value** to the matching vault reference:
   - `postmanEmail` → `{{vault:POSTMAN_EMAIL}}`
   - `postmanPassword` → `{{vault:POSTMAN_PASSWORD}}`
   - `userApiKey` → `{{vault:POSTMAN_USER_API_KEY}}`
   - `adminKey` → `{{vault:POSTMAN_ADMIN_KEY}}`
4. Current Values are local-only and are never synced or committed

### Newman / CI

```bash
newman run docs/postman/postman-collection.json \
  -e docs/postman/postman-environment-prod.json \
  --env-var "postmanEmail=$POSTMAN_EMAIL" \
  --env-var "postmanPassword=$POSTMAN_PASSWORD" \
  --env-var "userApiKey=$POSTMAN_USER_API_KEY" \
  --env-var "adminKey=$POSTMAN_ADMIN_KEY"
```

The committed `postman-environment-prod.json` keeps empty values — credentials are injected only at run time.

### Obtaining a user API key

Sign in first, then create a scoped, revocable key via the API:

```bash
export API_BASE="https://api.bloqr.dev/api"

# Sign in
export BEARER=$(curl -s -X POST "$API_BASE/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d '{"email": "your@email.com", "password": "yourpassword"}' \
  | jq -r '.token')

# Create API key
curl -s -X POST "$API_BASE/keys" \
  -H "Authorization: Bearer $BEARER" \
  -H "Content-Type: application/json" \
  -d '{"name": "postman-testing", "scopes": ["compile"]}' | jq .
```

Store the returned `key` value in Postman Vault as `POSTMAN_USER_API_KEY`.

## Related

- [Postman Testing Guide](../testing/POSTMAN_TESTING.md) - Complete guide with Newman CLI, CI/CD integration, and advanced testing
- [API Documentation](../api/README.md) - REST API reference
- [OpenAPI Tooling](../api/OPENAPI_TOOLING.md) - API specification validation
