# CI Decomposition — Migration Notes

## Overview

`ci.yml` was decomposed from a 783-line monolith into a smaller orchestrator (609 lines, −22%) backed by four focused composite actions in `.github/actions/`.

**No jobs were removed.** All job names, `needs:` dependencies, `if:` conditions, permissions, and branch-protection status-check references are preserved exactly.

---

## What Changed

### New Composite Actions

Four new composite actions were added to `.github/actions/`:

| Action | File | Extracted from |
|---|---|---|
| `setup-pnpm-node` | `.github/actions/setup-pnpm-node/action.yml` | `frontend-lint-test`, `frontend-build` jobs (4 repeated steps → 1 call) |
| `zta-checks` | `.github/actions/zta-checks/action.yml` | `zta-lint` job (4 large inline `run:` scripts → 1 call) |
| `validate-wrangler-toml` | `.github/actions/validate-wrangler-toml/action.yml` | `verify-deploy` job step, also added to `deploy` job |
| `deploy-worker` | `.github/actions/deploy-worker/action.yml` | `deploy` job (8 inline steps → 1 call) |

### `ci.yml` Changes by Job

| Job | Before | After |
|---|---|---|
| `frontend-lint-test` | 4 inline pnpm/node setup steps | `uses: ./.github/actions/setup-pnpm-node` |
| `frontend-build` | 4 inline pnpm/node setup steps | `uses: ./.github/actions/setup-pnpm-node` |
| `zta-lint` | 4 large inline `run:` bash scripts | `uses: ./.github/actions/zta-checks` |
| `verify-deploy` | 1 inline wrangler.toml validation step | `uses: ./.github/actions/validate-wrangler-toml` |
| `deploy` | 8 inline deploy steps (migrations → record) | `uses: ./.github/actions/validate-wrangler-toml` + `uses: ./.github/actions/deploy-worker` |
| All others | Unchanged | Unchanged |

### What Was Not Changed

- `deploy-frontend` — its pnpm setup (2 steps, no explicit store cache) differs from the 4-step pattern used by build/lint jobs; kept inline
- `changes`, `lint-format`, `typecheck`, `test`, `security`, `validate-artifacts`, `check-slow-types`, `audit-public-surface`, `validate-migrations`, `ci-gate`, `publish` — all unchanged
- All job names, `needs:`, `if:`, `permissions:`, `timeout-minutes:`, `concurrency:` — preserved exactly
- All SHA-pinned action references — preserved exactly

---

## Rationale

### Why composite actions, not reusable workflows?

Reusable workflows (`workflow_call`) were considered but rejected because:

1. **Branch protection compatibility** — branch protections reference specific job names in `ci.yml`. Reusable workflows nest job names (`workflow / job`) which would break existing checks.
2. **`ci-gate` fan-in** — the `ci-gate` job aggregates results from all upstream jobs. With reusable workflows, it could only see the outer "call" job result, losing per-job granularity.
3. **Artifact sharing** — the `frontend-dist` artifact is shared between `frontend-build`, `verify-deploy`, `deploy`, and `deploy-frontend`. Keeping all of these in one workflow avoids cross-workflow artifact handling.

Composite actions give the same step-level reusability without any of these drawbacks.

### Why extract `validate-wrangler-toml` for the `deploy` job too?

Previously, `wrangler.toml` placeholder validation only ran in `verify-deploy` (PR-only). A direct push to `main` bypasses `verify-deploy`, so the `deploy` job had no guard. The `validate-wrangler-toml` action is now called in both jobs, making the guard consistent regardless of how changes reach `main`.

---

## Impact on Branch Protections

No branch protection status checks need to be updated. All job names are identical to before.

If you check the `ci-gate` status check (the recommended single required check), it aggregates all other jobs — no change required there either.

---

## Adding New Checks

### Add a new compiler check

Add a new job to `ci.yml` with `needs: [changes]` and `if: needs.changes.outputs.compiler == 'true'`, then add the job name to `ci-gate`'s `needs:` list.

### Add a new ZTA lint check

Add a new step to `.github/actions/zta-checks/action.yml`. It will automatically run as part of the `zta-lint` job.

### Add a new deploy step

Add a new step to `.github/actions/deploy-worker/action.yml`. It will automatically run as part of the `deploy` job. Remember to add `shell: bash` to any `run:` step.

### Update pnpm or Node.js version

Update `.github/actions/setup-pnpm-node/action.yml` once. All frontend jobs pick up the change automatically.
