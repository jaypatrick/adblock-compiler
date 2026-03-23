# Workflow Linting with actionlint

This document describes the `actionlint` pre-push hook and CI gate added to prevent workflow configuration errors from reaching CI.

## Background

Broken workflow YAML is a high-impact failure mode: when `.github/workflows/ci.yml` or a related file is misconfigured, **all CI stops** until the error is found and fixed. A 5-hour CI incident prompted the introduction of two complementary safety nets that catch these errors as early as possible in the development cycle.

## Safety Net 1 — Pre-Push Hook (`.pre-commit-config.yaml`)

The repo root contains a [pre-commit](https://pre-commit.com/) configuration that runs `actionlint` as a pre-push hook:

```yaml
repos:
    - repo: https://github.com/rhysd/actionlint
      rev: v1.7.7
      hooks:
          - id: actionlint
```

### Setup

Install the pre-commit framework (once per machine):

```bash
pip install pre-commit
# or
brew install pre-commit
```

Then install the hooks from the repo root:

```bash
pre-commit install
```

The `default_install_hook_types: [pre-push]` key in `.pre-commit-config.yaml` tells pre-commit to install the pre-push hook automatically — no `--hook-type pre-push` flag required. The `stages: [pre-push]` entry on the `actionlint` hook ensures it only fires on `git push`, not on every commit.

To run it manually against all workflow files at any time:

```bash
pre-commit run actionlint --all-files
```

## Safety Net 2 — `lint-workflows` CI Gate (`.github/workflows/lint-workflows.yml`)

A standalone workflow that runs `actionlint` in CI on every push and pull request that touches `.github/workflows/**` or `.github/actions/**`:

```yaml
name: Lint Workflows

on:
    push:
        paths:
            - '.github/workflows/**'
            - '.github/actions/**'
    pull_request:
        paths:
            - '.github/workflows/**'
            - '.github/actions/**'

jobs:
    actionlint:
        runs-on: ubuntu-latest
        timeout-minutes: 5
        permissions:
            contents: read
        steps:
            - uses: actions/checkout@... # v6.0.2
            - uses: rhysd/actionlint@...  # v1.7.7
              with:
                  fail-on-error: true
```

This workflow is registered as a **required status check** in branch protection, meaning any PR that introduces broken workflow YAML will be blocked from merging into `main`.

### Why a Separate Workflow?

`lint-workflows` is intentionally a standalone workflow file rather than a job inside `ci.yml`. This means:

- It runs even when the rest of `ci.yml` is broken (which is precisely the situation it needs to catch)
- It has minimal blast radius — a failure here only blocks workflow-touching PRs, not all PRs
- It completes in under 30 seconds with no external dependencies

## What `actionlint` Catches

`actionlint` performs static analysis on GitHub Actions workflow YAML and detects:

| Category | Examples |
| --- | --- |
| Expression syntax errors | Malformed `${{ }}` expressions, wrong context variables |
| Invalid `needs:` references | Referencing a job that doesn't exist |
| Action version mismatches | Using a `uses:` ref that doesn't resolve |
| Shell script errors | Via `shellcheck` integration on `run:` steps |
| Deprecated runner labels | `ubuntu-18.04`, `windows-2019`, etc. |
| Secret/input name typos | `secrets.CLOUDFLARE_API_TOKEN` vs `secrets.CF_API_TOKEN` |
| Missing required `with:` inputs | Calling an action without its required inputs |

## Versions

Both the pre-push hook and the CI action use `actionlint v1.7.7`:

- `.pre-commit-config.yaml`: `rev: v1.7.7`
- `lint-workflows.yml`: `rhysd/actionlint@03d0035246f3e81f36aed592ffb4bebf33a03106 # v1.7.7`

When upgrading actionlint, update both files together so local and CI behavior stay in sync.

## Related

- [`.pre-commit-config.yaml`](../../.pre-commit-config.yaml) — pre-push hook configuration
- [`.github/workflows/lint-workflows.yml`](../../.github/workflows/lint-workflows.yml) — CI gate workflow
- [`.github/workflows/README.md`](../../.github/workflows/README.md) — workflow inventory table
- [Workflow Improvements](WORKFLOW_IMPROVEMENTS.md) — broader CI parallelization and hardening history
- [actionlint on GitHub](https://github.com/rhysd/actionlint) — upstream tool documentation
