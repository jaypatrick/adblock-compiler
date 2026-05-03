# Newman CI Workflow

The Newman integration test suite runs the full Postman collection against a live or staging API using [Newman](https://github.com/postmanlabs/newman), Postman's CLI runner. This document covers the workflow definition, required secrets, how to trigger runs manually, how to interpret the HTML report, and the current state of the x402 end-to-end test stub.

> **Changes introduced in:** PRs #1711, #1712, #1713  
> **See also:** [Postman Collection README](../postman/README.md) — collection structure, variable naming, admin routes  
> **See also:** [Postman Testing Guide](./POSTMAN_TESTING.md) — complete testing reference

---

## Overview

The Newman integration test suite validates the Adblock Compiler Worker API end-to-end on every deployment and on demand. It runs the full Postman collection (`docs/postman/postman-collection.json`) against a live environment — either the production Cloudflare Worker or a staging instance — using [Newman](https://github.com/postmanlabs/newman), Postman's command-line collection runner.

The workflow is defined in `.github/workflows/newman.yml`. It is designed to be:

- **Triggered manually** from the GitHub Actions UI or the `gh` CLI.
- **Called automatically** by the deployment pipeline after a successful deploy via `workflow_call`.
- **Self-contained** — all credentials are injected as environment variables from GitHub Actions secrets; no Postman account is required on the local developer machine.

Artifacts — an interactive HTML report and a machine-readable JSON results file — are uploaded with 30-day retention after every run.

---

## Workflow Triggers

The workflow responds to two triggers:

```yaml
on:
  workflow_dispatch:          # Manual trigger from the Actions UI
  workflow_call:              # Called by the deployment pipeline after a successful deploy
    secrets:
      NEWMAN_USER_API_KEY:
        required: true
      NEWMAN_POSTMAN_EMAIL:
        required: true
      NEWMAN_POSTMAN_PASSWORD:
        required: true
```

`workflow_dispatch` accepts an optional `environment` input (`cloudflare` or `local`, defaulting to `cloudflare`) that selects which Postman environment file is loaded. `workflow_call` is used by the deployment pipeline; the calling workflow passes the target environment as the `environment` input, so Newman always runs against the environment that was just deployed rather than a hard-coded default.

---

## Required Secrets

The following secrets must be configured in **Settings → Secrets and variables → Actions** before the workflow can authenticate with either the API under test or the Resend Postman API export endpoint.

| Secret | Where | Description |
|--------|-------|-------------|
| `NEWMAN_USER_API_KEY` | GitHub Actions secrets | A `blq_` API key for a test user; used to authenticate compile/queue endpoints |
| `NEWMAN_POSTMAN_EMAIL` | GitHub Actions secrets | Email address of the Postman account that owns the synced collection |
| `NEWMAN_POSTMAN_PASSWORD` | GitHub Actions secrets | Password for the Postman account (used to export collection via API) |
| `NEWMAN_ADMIN_KEY` | GitHub Actions secrets | Admin-scoped `blq_admin_` key for admin route tests |
| `CF_ACCESS_CLIENT_ID` | GitHub Actions secrets | CF Access service token client ID (admin route tests) |
| `CF_ACCESS_CLIENT_SECRET` | GitHub Actions secrets | CF Access service token client secret (admin route tests) |

> **Note:** The API key in `NEWMAN_USER_API_KEY` must be pre-created. It is **not** provisioned by the workflow itself. Create it via the dashboard or with a session-authenticated request:
>
> ```bash
> curl -X POST https://api.bloqr.dev/api/apikeys \
>   -H "Cookie: better_auth.session_token=<your-session>" \
>   -H "Content-Type: application/json" \
>   -d '{"name": "newman-ci", "prefix": "blq_"}'
> ```

To set secrets from the CLI:

```bash
gh secret set NEWMAN_USER_API_KEY      --body "blq_xxxxxxxxxxxxxxxxxxxx"
gh secret set NEWMAN_POSTMAN_EMAIL     --body "newman@test.bloqr.io"
gh secret set NEWMAN_POSTMAN_PASSWORD  --body "<password>"
gh secret set NEWMAN_ADMIN_KEY         --body "blq_admin_xxxxxxxxxxxx"
gh secret set CF_ACCESS_CLIENT_ID      --body "<cf-access-client-id>"
gh secret set CF_ACCESS_CLIENT_SECRET  --body "<cf-access-client-secret>"
```

`CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` are **optional** — if absent, admin route tests fail with 403 but all other collection folders run normally.

---

## Workflow Steps

The workflow performs the following steps in order:

1. **Checkout** — checks out the repository at the deployment SHA so the collection and environment files match exactly what was deployed.

2. **Install Newman** — installs the Newman runner and the `htmlextra` reporter globally:

   ```bash
   npm install -g newman newman-reporter-htmlextra
   ```

3. **Export Postman collection** — downloads the latest synced collection from the Postman API using `NEWMAN_POSTMAN_EMAIL` and `NEWMAN_POSTMAN_PASSWORD`. This ensures the collection used in CI always matches the latest saved version in Postman Cloud, even if local JSON files are slightly stale.

4. **Run Newman** — executes the full collection against the target environment, injecting secrets as `--env-var` overrides:

   ```bash
   newman run postman-collection.json \
     -e docs/postman/postman-environment-prod.json \
     --env-var "apiKey=$NEWMAN_USER_API_KEY" \
     --env-var "adminKey=$NEWMAN_ADMIN_KEY" \
     --env-var "cfAccessClientId=$CF_ACCESS_CLIENT_ID" \
     --env-var "cfAccessClientSecret=$CF_ACCESS_CLIENT_SECRET" \
     --reporters cli,htmlextra,json \
     --reporter-htmlextra-export newman-report.html \
     --reporter-json-export newman-results.json
   ```

5. **Upload HTML report** — saves `newman-report.html` as the `newman-report` artifact (30-day retention).

6. **Upload JSON results** — saves `newman-results.json` as the `newman-results` artifact for downstream processing or dashboards.

### Calling from another workflow

To call this workflow from a deployment pipeline:

```yaml
jobs:
  integration-tests:
    uses: ./.github/workflows/newman.yml
    with:
      environment: cloudflare
    secrets: inherit
```

`secrets: inherit` forwards all repository secrets automatically, satisfying the `workflow_call` secret requirements.

---

## How to Trigger Manually

### From the GitHub Actions UI

1. Go to **Actions → Newman Integration Tests**.
2. Click **Run workflow** (top right of the workflow list).
3. Select the branch (typically `main`).
4. Set `environment` to `cloudflare` (production) or `local` (requires a locally running Worker on `:8787`).
5. Click the green **Run workflow** button.

### From the CLI

Using the `gh` CLI (requires `gh auth login` first):

```bash
# Run against production on the main branch
gh workflow run newman.yml \
  --ref main \
  -f environment=cloudflare

# Run against production on a feature branch
gh workflow run newman.yml \
  --ref feat/my-feature \
  -f environment=cloudflare
```

To watch the run in real time:

```bash
gh run watch $(gh run list --workflow newman.yml --limit 1 --json databaseId -q '.[0].databaseId')
```

---

## How to Read the HTML Report

The HTML report artifact is uploaded as `newman-report` after every workflow run.

### Download via the CLI

```bash
# Replace <run-id> with the numeric run ID from `gh run list`
gh run download <run-id> --name newman-report --dir /tmp/newman-report
open /tmp/newman-report/newman-report.html
```

To find the latest run ID:

```bash
gh run list --workflow newman.yml --limit 5
```

### What the report shows

The `htmlextra` reporter produces a self-contained HTML file with:

- **Summary bar** — total requests, passed assertions, failed assertions, skipped requests, average response time.
- **Folder-level breakdown** — collapsible sections per Postman folder (e.g., `Auth`, `Compile`, `Admin/Users`, `x402 Contract Tests`) showing pass/fail counts.
- **Per-request detail** — for each request: HTTP method, URL, status code, response time in milliseconds, and the full list of test assertions with pass/fail status.
- **Failed assertion detail** — for any failing assertion: the assertion script, the actual value received, and the expected value. This is the primary debugging surface when a test regresses.
- **Request/response bodies** — expandable panels for request headers, request body, response headers, and response body. Useful for diagnosing auth failures or unexpected response shapes.
- **Timeline** — a Gantt-style view of request execution order and duration.

### Common failure patterns

| Symptom | Likely cause |
|---------|--------------|
| All requests fail with 401 | `NEWMAN_USER_API_KEY` is expired, revoked, or incorrect |
| Admin folder fails with 403 | `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` missing or expired |
| `x402 Contract Tests` fail with 200 | The compile endpoint accepted a request that should have returned 402 |
| Intermittent timeouts | Worker cold-start on first request; re-run the workflow |

---

## Running Newman Locally

Running Newman locally is the fastest way to iterate on collection changes or debug a failing CI test without waiting for a full workflow run.

### Prerequisites

```bash
npm install -g newman newman-reporter-htmlextra
```

### Run the full collection against the local Worker

Start the Worker first (`deno task worker:dev` or `wrangler dev`), then:

```bash
newman run docs/postman/postman-collection.json \
  -e docs/postman/postman-environment-local.json \
  --env-var "apiKey=$NEWMAN_USER_API_KEY" \
  --reporters cli,htmlextra \
  --reporter-htmlextra-export /tmp/newman-report.html
```

Open `/tmp/newman-report.html` in a browser to inspect results.

### Run the full collection against production

```bash
newman run docs/postman/postman-collection.json \
  -e docs/postman/postman-environment-prod.json \
  --env-var "apiKey=$NEWMAN_USER_API_KEY" \
  --reporters cli,htmlextra \
  --reporter-htmlextra-export /tmp/newman-report-prod.html
```

### Run only a specific folder

```bash
# x402 contract tests only
newman run docs/postman/postman-collection.json \
  -e docs/postman/postman-environment-local.json \
  --folder "x402 Contract Tests" \
  --env-var "apiKey=$NEWMAN_USER_API_KEY"
```

```bash
# Admin routes only (requires adminKey + CF Access service token)
newman run docs/postman/postman-collection.json \
  -e docs/postman/postman-environment-prod.json \
  --folder "admin/users" \
  --env-var "adminKey=$NEWMAN_ADMIN_KEY" \
  --env-var "cfAccessClientId=$CF_ACCESS_CLIENT_ID" \
  --env-var "cfAccessClientSecret=$CF_ACCESS_CLIENT_SECRET"
```

### Run with JSON output for scripting

```bash
newman run docs/postman/postman-collection.json \
  -e docs/postman/postman-environment-local.json \
  --env-var "apiKey=$NEWMAN_USER_API_KEY" \
  --reporters json \
  --reporter-json-export /tmp/newman-results.json

# Count failures
jq '.run.stats.assertions.failed' /tmp/newman-results.json
```

---

## Cloudflare Access and Admin Routes

Admin route tests (`/api/admin/*`) require a valid Cloudflare Access service token. Newman injects these via custom headers sourced from CI secrets:

| Secret | Newman `--env-var` | Header sent to API |
|--------|--------------------|--------------------|
| `CF_ACCESS_CLIENT_ID` | `cfAccessClientId` | `CF-Access-Client-Id` |
| `CF_ACCESS_CLIENT_SECRET` | `cfAccessClientSecret` | `CF-Access-Client-Secret` |

These are set in the Postman collection's pre-request script for the `admin/` folder. If the secrets are absent or the service token has expired, the admin folder fails with 403 and the rest of the collection continues unaffected.

To rotate or create a new service token:
1. Go to **Cloudflare Zero Trust → Access → Service Tokens**.
2. Create a new token or rotate the existing `newman-ci` token.
3. Update `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` in GitHub Actions secrets.

---

## x402 E2E Stub and Roadmap

`.github/workflows/x402-e2e.yml` exists in the repository as a stub for a future full end-to-end x402 payment test. It is **not currently active** — the workflow has no trigger that fires automatically and will not run until the prerequisites below are satisfied. It serves as a placeholder and to document what is needed to complete the implementation.

### What the x402 e2e workflow would test (when fully implemented)

1. **402 response shape** — `POST /api/compile` with an exhausted PAYG balance returns a `402 Payment Required` response whose body conforms exactly to the x402 payment-required schema.
2. **Payment acceptance** — a valid `X-Payment` header constructed with a Stripe test-mode payment intent is sent on retry, and the compile proceeds to a `200 OK` response.
3. **Idempotency** — the same payment header cannot be replayed.

### What is needed before the stub can be activated

1. **Stripe test mode keys** — `STRIPE_TEST_SECRET_KEY` and `STRIPE_TEST_PUBLISHABLE_KEY` added to GitHub Actions secrets.
2. **x402 CLI payment listener** — a lightweight process that listens for payment requests on a known port, auto-pays using the Stripe test key, and outputs the resulting `X-Payment` header value.
3. **Two-phase test structure:**
   - Phase 1: verify 402 response shape (already covered by the **x402 Contract Tests** folder in the main Newman workflow — this is already active).
   - Phase 2: send a valid payment header and verify the compile proceeds to 200.
4. **Cleanup step** — cancel or void the Stripe payment intent after the test to avoid accumulating test charges.

Until these prerequisites are in place, x402 contract testing (response shape validation only) is handled by the **x402 Contract Tests** folder in the main Newman workflow (`newman.yml`). This folder runs on every Newman invocation and provides meaningful signal without requiring a live payment stack.

---

## Related Documentation

- [Postman README](../postman/README.md) — collection structure, variable naming, admin routes
- [Postman Testing Guide](./POSTMAN_TESTING.md) — complete testing reference including local setup and assertion authoring
- [Error Passing Architecture](../architecture/error-passing.md) — error logging endpoints tested by Newman
