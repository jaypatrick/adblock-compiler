# Postman / Newman

## Overview

API test collection for the Bloqr adblock compiler API. Covers all REST endpoints.

## Structure

```
postman/
├── collections/
│   └── API - Cloudflare/     # Main collection (use this for testing)
│       ├── agents/
│       ├── api/
│       │   ├── auth/
│       │   ├── browser/
│       │   ├── deployments/
│       │   ├── turnstile-config/
│       │   └── version/
│       ├── ast/
│       ├── compile/
│       ├── configuration/
│       ├── health/
│       ├── metrics/
│       ├── notify/
│       ├── payg/
│       ├── queue/
│       ├── rules/
│       ├── stripe/
│       ├── validate-rule/
│       ├── workflow/
│       ├── ws/
│       ├── admin/
│       └── keys/
└── environments/
    ├── bloqr-backend.environment.yaml         # Cloudflare (production)
    └── bloqr-backend-local.environment.yaml   # Local dev
```

## Authentication

The collection uses `Authorization: Bearer <token>` for all protected endpoints.

- Most protected API requests use `Authorization: Bearer {{apiKey}}` — pass a `blq_…` API key. Turnstile verification is automatically skipped for API-key (`blq_…`) requests.
- Session-scoped management endpoints (`/keys/*`, `/api/auth/sign-out`, `/configuration/saved/*`) use `Authorization: Bearer {{bearerToken}}` (session token obtained after sign-in, not an API key) because they require an interactive Better Auth user session.
- Public endpoints (e.g. `/stripe/webhook`, `/api/auth/sign-in`, `/api/auth/sign-up`) have no auth header.

Get an API key:

```bash
# 1. Sign in to get a session token
curl -s -X POST "https://api.bloqr.dev/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}' | jq .token

# 2. Create an API key using the session token
curl -s -X POST "https://api.bloqr.dev/api/keys" \
  -H "Authorization: Bearer <session-token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Key"}' | jq .key
```

Set the API key in the appropriate variable depending on how you run the collection:

- **Postman desktop (YAML collection in `postman/collections/`):** Set `apiKey` to the returned `blq_…` key.
- **Newman CLI (generated JSON collection in `docs/postman/`):** Inject the key as `--env-var "bearerToken=blq_..."` — the generated JSON collection uses collection-level bearer auth with `{{bearerToken}}`.

## Running Tests with Newman

### Prerequisites

```bash
npm install -g newman newman-reporter-htmlextra
```

### Run against Cloudflare (production)

```bash
newman run docs/postman/postman-collection.json \
  --environment docs/postman/postman-environment-prod.json \
  --env-var "bearerToken=blq_yourkey" \
  --reporters cli,htmlextra \
  --reporter-htmlextra-export newman-report.html
```

### Run against local dev server

```bash
# Start the worker first
deno task wrangler:dev

newman run docs/postman/postman-collection.json \
  --environment docs/postman/postman-environment-local.json \
  --env-var "bearerToken=blq_yourkey" \
  --reporters cli
```

### CI (GitHub Actions)

The [Newman workflow](../.github/workflows/newman.yml) runs the full collection via
`workflow_dispatch` (manual trigger) or `workflow_call` (called from other workflows).

Required secrets:
- `NEWMAN_USER_API_KEY` — A valid `blq_…` API key
- `NEWMAN_POSTMAN_EMAIL` — Email for auto-sign-in (for session-scoped requests)
- `NEWMAN_POSTMAN_PASSWORD` — Password for auto-sign-in

## Admin Storage Endpoints

The `admin/storage/` endpoints are protected by Cloudflare Access. When run externally
(without a CF Access service token), they return `401` or `403`. The request files in
`postman/collections/API - Cloudflare/admin/storage/` include test assertions that
expect these status codes.

## Environment Variables

| Variable | Description | Example |
|---|---|---|
| `baseUrl` | API base URL (includes `/api` prefix) | `https://api.bloqr.dev/api` |
| `originUrl` | Origin URL without `/api` prefix (used for `/agents/*` routes) | `https://api.bloqr.dev` |
| `apiKey` | API key for `Authorization: Bearer` auth | `blq_2086750d…` |
| `bearerToken` | Session token (for `/keys/*`, `/api/auth/sign-out`, `/configuration/saved/*`) | `eyJhbGc…` |
| `adminKey` | Admin key (for admin endpoints) | — |
| `turnstileToken` | Turnstile bypass token | `NEWMAN-BYPASS-TOKEN` |
| `paygSession` | PAYG session token from `POST /payg/session/create` | — |
