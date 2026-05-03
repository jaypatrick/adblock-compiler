# Newman CI Workflow

This document describes the Newman-based API test workflow, the required secrets, how to trigger it, how to read the results, and the x402 end-to-end test stub.

> **Changes introduced in:** PRs #1711, #1712, #1713  
> **See also:** [Postman Collection README](../../docs/postman/README.md) for collection structure and variable reference.

---

## Overview

The `.github/workflows/newman.yml` workflow runs the Postman collection against either the production Cloudflare Worker or a locally-started Worker instance. It generates an HTML report artifact and posts a GitHub Actions summary.

---

## Workflow File

**Location:** `.github/workflows/newman.yml`

**Triggers:**

| Trigger | When |
|---------|------|
| `workflow_dispatch` | Manually from the GitHub Actions UI |
| `workflow_call` | Called by other workflows (e.g., a deployment pipeline) |

**Inputs (for `workflow_dispatch` and `workflow_call`):**

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `environment` | choice | `cloudflare` | `cloudflare` (production) or `local` (localhost:8787) |

---

## Required Secrets

The following GitHub repository secrets must be configured before the workflow can authenticate:

| Secret name | Description |
|-------------|-------------|
| `NEWMAN_USER_API_KEY` | A `blq_` API key for the test user. Used in the `userApiKey` Postman variable. |
| `NEWMAN_POSTMAN_EMAIL` | Email address for Better Auth sign-in during the test run. |
| `NEWMAN_POSTMAN_PASSWORD` | Password for Better Auth sign-in during the test run. |

**Setting secrets:**

```bash
gh secret set NEWMAN_USER_API_KEY    --body "blq_test_xxxxxxxxxxxx"
gh secret set NEWMAN_POSTMAN_EMAIL   --body "newman@test.bloqr.io"
gh secret set NEWMAN_POSTMAN_PASSWORD --body "..."
```

---

## How to Trigger

### Manually via GitHub UI

1. Navigate to **Actions** → **Newman API Tests**.
2. Click **Run workflow**.
3. Select `environment`: `cloudflare` (production) or `local`.
4. Click **Run workflow**.

### Via `gh` CLI

```bash
# Run against production
gh workflow run newman.yml -f environment=cloudflare

# Run against local Worker (must have Worker running on :8787)
gh workflow run newman.yml -f environment=local
```

### Calling from another workflow

```yaml
jobs:
  api-tests:
    uses: ./.github/workflows/newman.yml
    with:
      environment: cloudflare
    secrets: inherit
```

---

## Environment Files

| `environment` input | Environment file used |
|---------------------|-----------------------|
| `local` | `docs/postman/postman-environment-local.json` |
| `cloudflare` (default) | `docs/postman/postman-environment-prod.json` |

The environment file sets `baseUrl`, `adminKey`, and other collection-level variables that Newman overrides with the CI secrets.

---

## Artifacts

After each run, two artifacts are uploaded with **30-day retention**:

| Artifact name | Format | Description |
|---------------|--------|-------------|
| `newman-report` | HTML (htmlextra reporter) | Interactive test report with request/response details, assertion failures, and timeline |
| `newman-results` | JSON | Machine-readable results for downstream processing |

### Reading the HTML report

1. Open the **Newman API Tests** workflow run in GitHub Actions.
2. Scroll to the **Artifacts** section.
3. Download `newman-report`.
4. Open `newman-report.html` in a browser.

The report includes:
- Total requests, passed/failed assertions.
- Per-folder and per-request breakdowns.
- Full request and response bodies for failed assertions.
- A timeline view of the run.

---

## GitHub Actions Summary

The workflow generates a Markdown summary posted to the Actions run page via a Python script. The summary includes:

- A table of test pass/fail counts per collection folder.
- A list of failing assertion messages with request names.

---

## x402 End-to-End Test Stub

**Location:** `.github/workflows/x402-e2e.yml`

This workflow is a **stub** — it is defined but not yet implemented. It is intended to run end-to-end tests for the x402 payment protocol used by `POST /api/compile` and related routes.

### What the stub tests (when implemented)

- A `402 Payment Required` response is returned when a PAYG session is absent or exhausted.
- The `x402` response body conforms to the payment-required schema.
- A valid payment intent is accepted and the request succeeds on retry.

### What's needed to implement it

| Requirement | Notes |
|-------------|-------|
| Stripe test-mode API keys | `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_PUBLISHABLE_KEY` |
| CLI payment listener | A local x402 CLI that can respond to payment challenges |
| Test Postman environment | `postman-environment-x402-test.json` with payment test fixtures |

Until these prerequisites are in place, the workflow file serves as documentation of intent and a placeholder for CI integration.

---

## Cloudflare Access and Newman

Admin route tests (`/api/admin/*`) require a valid Cloudflare Access service token in addition to the admin API key. Newman passes this via the `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers, sourced from CI secrets:

| Secret | Header |
|--------|--------|
| `CF_ACCESS_CLIENT_ID` | `CF-Access-Client-Id` |
| `CF_ACCESS_CLIENT_SECRET` | `CF-Access-Client-Secret` |

These secrets are optional — if absent, the admin route tests in Newman will fail with 403, but the rest of the collection will run.

---

## Related Documentation

- [Postman Collection README](../../docs/postman/README.md) — collection structure, variable reference, admin folders
- [Postman Testing Guide](./POSTMAN_TESTING.md) — local collection testing, assertions, credentials
