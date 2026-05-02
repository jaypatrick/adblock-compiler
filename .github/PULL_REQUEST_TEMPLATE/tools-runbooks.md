## Tools / Runbooks PR

<!-- Use this template for PRs that add, update, or fix tools in /tools/ and their runbooks in /tools/runbooks/ -->

**Closes** #<!-- issue number -->

---

### What changed?

<!-- Describe what was added, changed, or fixed. One sentence per item is fine. -->

-

---

### Checklist

#### Script (`tools/<tool>.py`)

- [ ] Script is self-contained — config via `tools/<tool>.env` (never shell exports)
- [ ] Script outputs a JSON report to `tools/logs/<tool>/` on every run
- [ ] Script supports `--mode <all|checks|cleanup>` (or interactive menu when run without args)
- [ ] Script has a `--dry-run` flag that prints config and makes no network requests
- [ ] Script added to `KNOWN_TOOLS` registry in `tools/runbooks/shared/__init__.py`

#### Documentation

- [ ] `tools/docs/<tool>/README.md` created or updated (in-depth per-tool reference)
- [ ] `docs/tools/README.md` updated to list the new/changed tool
- [ ] `docs/README.md` still links to `docs/tools/README.md` (no new top-level section needed)

#### Interactive Runbook (`tools/runbooks/<tool>.py`)

- [ ] Marimo runbook created for the tool (or an existing runbook updated)
- [ ] Runbook is entirely self-contained — all docs, env config, execution, and log viewing inside the `.py` file
- [ ] Runbook imports from `tools/runbooks/shared/__init__.py` for common helpers
- [ ] Runbook handles missing dependencies gracefully (shows instructions, doesn't crash)
- [ ] `tools/runbooks/pipeline.py` updated if a new tool was added to `KNOWN_TOOLS`

#### Log directory

- [ ] `tools/logs/<tool>/` directory created with a `.gitkeep` file
- [ ] Logs are written to `tools/logs/<tool>/<tool>-YYYYMMDD-HHMMSS.{json,log}` format
- [ ] `.gitignore` excludes `tools/logs/<tool>/*.json` and `tools/logs/<tool>/*.log`

#### Tests (`tools/tests/test_runbooks.py`)

- [ ] `test_expected_runbooks_exist` parametrize list updated if a new runbook was added
- [ ] New test cases added for any new `shared/__init__.py` helpers
- [ ] All 57+ existing tests still pass: `cd tools && pytest tests/ -v`

#### `deno.json`

- [ ] `runbook:<tool>` task added (e.g., `"runbook:auth-healthcheck": "..."`)
- [ ] Task documented in `tools/runbooks/README.md` quick start

---

### Testing

```bash
# Run all runbook tests
uv run --directory tools pytest tests/ -v

# Smoke-test the runbook locally (opens browser)
uv run --directory tools marimo run tools/runbooks/<tool>.py

# Smoke-test the master pipeline runbook
uv run --directory tools marimo run tools/runbooks/pipeline.py
```

---

### Screenshots / Output

<!-- Paste the JSON report summary or a screenshot of the Marimo runbook UI if applicable. -->

---

### Remote Access (optional — future enhancement)

If this PR adds remote access capabilities (e.g., Cloudflare Tunnel integration):

- [ ] Auth is required (no anonymous access to runbooks)
- [ ] Cloudflare Access policy documented in `docs/tools/README.md`
- [ ] No secrets committed to source

---

### Notes for reviewers

<!-- Anything the reviewer should know that isn't obvious from the diff? -->
