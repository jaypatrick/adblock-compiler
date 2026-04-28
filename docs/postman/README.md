# Postman Collection

Postman collection and environment files for testing the Adblock Compiler API.

> **Auto-generated** — do not edit these files directly.
> Run `deno task postman:collection` to regenerate from `docs/api/openapi.yaml`.

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
4. For **production**: import `postman-environment-prod.json` and select **Adblock Compiler API - Prod** (see [Prod Environment & Credentials](#prod-environment--credentials) below)
5. Start the local server: `deno task dev`
6. Run requests individually or as a collection

## Prod Environment & Credentials

The `postman-environment-prod.json` environment sets `baseUrl` to `https://api.bloqr.dev/api` and includes three secret variables (`bearerToken`, `userApiKey`, `adminKey`) whose **Initial Values are always empty** — they must be populated at runtime and are never committed to git.

### Desktop: Postman Vault

[Postman Vault](https://learning.postman.com/docs/sending-requests/postman-vault/postman-vault-secrets/) stores secrets in your OS keychain. They are never synced to Postman Cloud.

1. In Postman Desktop: click the **Vault** icon (lock icon, bottom-left) or go to **Settings → Vault**
2. Add three entries:
   - `POSTMAN_BEARER_TOKEN`
   - `POSTMAN_USER_API_KEY`
   - `POSTMAN_ADMIN_KEY`
3. In the **Prod** environment editor, set each secret variable's **Current Value** to the matching vault reference:
   - `bearerToken` → `{{vault:POSTMAN_BEARER_TOKEN}}`
   - `userApiKey` → `{{vault:POSTMAN_USER_API_KEY}}`
   - `adminKey` → `{{vault:POSTMAN_ADMIN_KEY}}`
4. Current Values are local-only and are never synced or committed

### Newman / CI

Pass credentials at runtime via `--env-var` (sourced from GitHub Actions secrets or your shell):

```bash
newman run docs/postman/postman-collection.json \
  -e docs/postman/postman-environment-prod.json \
  --env-var "bearerToken=$POSTMAN_BEARER_TOKEN" \
  --env-var "userApiKey=$POSTMAN_USER_API_KEY" \
  --env-var "adminKey=$POSTMAN_ADMIN_KEY"
```

The committed `postman-environment-prod.json` keeps empty values — credentials are injected only at run time.

### Obtaining a Postman API key

Use the admin API to create a dedicated, scoped, revocable key — do **not** reuse your personal Clerk JWT:

```bash
curl -X POST https://api.bloqr.dev/api/admin/auth/api-keys \
  -H "X-Admin-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Postman testing", "scopes": ["read", "write"]}'
```

Store the returned key in Postman Vault as `POSTMAN_USER_API_KEY`.

## Related

- [Postman Testing Guide](../testing/POSTMAN_TESTING.md) - Complete guide with Newman CLI, CI/CD integration, and advanced testing
- [API Documentation](../api/README.md) - REST API reference
- [OpenAPI Tooling](../api/OPENAPI_TOOLING.md) - API specification validation
