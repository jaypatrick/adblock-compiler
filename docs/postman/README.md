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
| `userApiKey` | Auto-set by Create API key | User-scoped API key (`blq_...` or legacy `abc_...`) |
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

## Collection Structure

The collection is organised into **folders** that map to API subsystems. New folders added in PRs #1711–1713:

### Standard Route Folders

| Folder | Requests | Description |
|--------|----------|-------------|
| Authentication | 4 | Sign-up, sign-in, get-session, sign-out (Better Auth, injected manually) |
| API Keys | 5 | Create, list, get, update, revoke API keys |
| Compile | 4 | `POST /api/compile`, batch, validate, AST parse |
| Queue | 3 | Queue submit, status, cancel |
| Workflow | 3 | Workflow run, status, list |
| Configuration | 4 | CRUD for compilation configs |
| x402 Contract Tests | 3 | 402-response shape verification (see below) |

### Admin Route Folders (PR #1712)

| Folder | Auth required | Description |
|--------|---------------|-------------|
| admin/agents | `adminKey` + CF Access | Cloudflare Agents management |
| admin/auth/config | `adminKey` + CF Access | Better Auth plugin configuration |
| admin/email | `adminKey` + CF Access | Resend email ops |
| admin/neon | `adminKey` + CF Access | Neon database management |
| admin/security | `adminKey` + CF Access | ZTA security ops |
| admin/users | `adminKey` + CF Access | User management |
| admin/usage | `adminKey` + CF Access | Usage and quota ops |

---

## `adminKey` vs `apiKey` vs `bearerToken`

PR #1711 fixed a bug where admin endpoint requests were incorrectly using `userApiKey` instead of `adminKey`. The correct usage is:

| Variable | Header / mechanism | Used for |
|----------|--------------------|----------|
| `bearerToken` | `Authorization: Bearer <token>` | User-scoped Better Auth session requests |
| `apiKey` (`userApiKey`) | `Authorization: Bearer blq_...` | User-scoped API key requests (compile, queue, etc.) |
| `adminKey` | `Authorization: Bearer blq_admin_...` | Admin-only endpoints (`/api/admin/*`) |

**Rule:** If the request goes to `/api/admin/*`, use `{{adminKey}}`. Never use `{{userApiKey}}` on admin endpoints — it will fail with 403.

Admin keys are provisioned separately from user keys and require the `admin` scope. Store the admin key in Postman Vault as `POSTMAN_ADMIN_KEY` (see **Prod Environment & Credentials** above).

---

## x402 Contract Tests

The **x402 Contract Tests** folder verifies that payment-required endpoints return the correct `402 Payment Required` response shape (as defined by the x402 protocol).

### What is tested

1. `POST /api/compile` without a PAYG session returns `402` with a valid x402 response body.
2. The `402` response body contains `accepts`, `network`, `scheme`, `paymentInfo`, and `x402Version` fields.
3. `POST /api/compile/batch` has the same contract.

### Running x402 contract tests only

```bash
newman run docs/postman/postman-collection.json \
  -e docs/postman/postman-environment-local.json \
  --folder "x402 Contract Tests"
```

### x402 E2E Stub

A workflow file `.github/workflows/x402-e2e.yml` is checked in as a stub for future full end-to-end payment tests. It is not yet active. See [Newman CI](../testing/newman-ci.md) for implementation requirements.

---

## CI / GitHub Actions Integration

The Newman test suite is run automatically via `.github/workflows/newman.yml`.

| Trigger | When |
|---------|------|
| `workflow_dispatch` | Manually from the Actions UI |
| `workflow_call` | Called by deployment pipeline |

Required CI secrets: `NEWMAN_USER_API_KEY`, `NEWMAN_POSTMAN_EMAIL`, `NEWMAN_POSTMAN_PASSWORD`. Admin tests additionally require `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`.

See [Newman CI](../testing/newman-ci.md) for the full workflow reference, artifact download instructions, and x402 e2e stub roadmap.

---

## Cloudflare Access and Newman (Admin Tests)

Admin route tests require Cloudflare Access service token headers in addition to the `adminKey`:

```bash
newman run docs/postman/postman-collection.json \
  -e docs/postman/postman-environment-prod.json \
  --folder "admin/users" \
  --env-var "adminKey=$ADMIN_KEY" \
  --env-var "cfAccessClientId=$CF_ACCESS_CLIENT_ID" \
  --env-var "cfAccessClientSecret=$CF_ACCESS_CLIENT_SECRET"
```

Without CF Access headers, admin route requests will return `403` regardless of the `adminKey` value.

---

## Related

- [Newman CI Workflow](../testing/newman-ci.md) — CI workflow, secrets, artifacts, x402 stub
- [Postman Testing Guide](../testing/POSTMAN_TESTING.md) - Complete guide with Newman CLI, CI/CD integration, and advanced testing
- [API Documentation](../api/README.md) - REST API reference
- [OpenAPI Tooling](../api/OPENAPI_TOOLING.md) - API specification validation
