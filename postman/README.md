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
    ├── adblock-compiler.environment.yaml         # Cloudflare (production)
    └── adblock-compiler-local.environment.yaml   # Local dev
```

## Authentication

All requests use `X-API-Key` header. Turnstile is automatically bypassed for API key requests.

Get an API key:

```bash
# 1. Sign in to get a session token
curl -s -X POST "https://api.bloqr.dev/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}' | jq .token

# 2. Create an API key using the session token
curl -s -X POST "https://api.bloqr.dev/keys" \
  -H "Authorization: Bearer <session-token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Key"}' | jq .key
```

Set the `apiKey` environment variable to the returned `blq_…` key.

## Running Tests with Newman

### Prerequisites

```bash
npm install -g newman newman-reporter-htmlextra
```

### Run against Cloudflare (production)

```bash
newman run postman/collections/API\ -\ Cloudflare \
  --environment postman/environments/adblock-compiler.environment.yaml \
  --env-var "apiKey=blq_yourkey" \
  --reporters cli,htmlextra \
  --reporter-htmlextra-export newman-report.html
```

### Run against local dev server

```bash
# Start the worker first
deno task wrangler:dev

newman run postman/collections/API\ -\ Cloudflare \
  --environment postman/environments/adblock-compiler-local.environment.yaml \
  --env-var "apiKey=blq_yourkey" \
  --reporters cli
```

### CI (GitHub Actions)

The [Newman workflow](../.github/workflows/newman.yml) runs the full collection via
`workflow_dispatch` (manual trigger) or `workflow_call` (called from other workflows).

Required secrets:
- `NEWMAN_API_KEY` — A valid `blq_…` API key
- `NEWMAN_TURNSTILE_TOKEN` — (optional) Turnstile bypass token; defaults to `NEWMAN-BYPASS-TOKEN`

## Admin Storage Endpoints

The `admin/storage/` endpoints are protected by Cloudflare Access. When run externally
(without a CF Access service token), they return `401` or `403`. The request files in
`postman/collections/API - Cloudflare/admin/storage/` include test assertions that
expect these status codes.

## Environment Variables

| Variable | Description | Example |
|---|---|---|
| `baseUrl` | API base URL | `https://api.bloqr.dev` |
| `apiKey` | API key for authentication | `blq_2086750d…` |
| `bearerToken` | Session token (for key management) | `eyJhbGc…` |
| `adminKey` | Admin key (for admin endpoints) | — |
| `turnstileToken` | Turnstile bypass token | `NEWMAN-BYPASS-TOKEN` |
