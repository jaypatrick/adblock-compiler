# auth-healthcheck.py

**Script:** `tools/auth-healthcheck.py`  
**Config:** `tools/auth-healthcheck.env` (copy from `tools/auth-healthcheck.env.example`)  
**Report:** `auth-healthcheck-YYYYMMDD-HHMMSS.json` (repo root, gitignored)

End-to-end production auth diagnostic for the Better Auth / Bloqr stack. Validates the full authentication chain from sign-up through session validation, then checks every backing store (KV, D1, Neon) and captures wrangler tail logs in the background.

---

## What It Checks

| Step | Check | What it verifies |
|---|---|---|
| 1 | API health | `GET /api/version` responds, `/api/auth/providers` lists providers |
| 2 | Sign-up | `POST /api/auth/sign-up/email` creates a new test user |
| 3 | Sign-in + token | `POST /api/auth/sign-in/email` returns `session.token`, `session.id`, `user` object |
| 4 | Session validation | `GET /api/auth/get-session` with Bearer token returns the correct user |
| 5 | Email verification | `user.emailVerified` flag checked; warns if false |
| 6 | Better Auth KV | `wrangler kv key list` — verifies KV is accessible and shows key prefix distribution |
| 7 | D1 databases | Both `DB` (adblock-compiler-d1-database) and `ADMIN_DB` (adblock-compiler-admin-d1) — table list + row counts |
| 8 | Neon / PostgreSQL | Direct connection via `psycopg2` — table row counts, test user row, session row |
| 9 | Admin API | `GET /api/auth/admin/list-users` with API key (optional) |
| 10 | Tail log summary | Worker exceptions and auth-related log events captured during the run |

---

## Prerequisites

```bash
# One-time venv setup (from repo root)
python3 -m venv tools/.venv
source tools/.venv/bin/activate
pip install requests rich psycopg2-binary
```

> `psycopg2-binary` is a self-contained PostgreSQL client — no Homebrew Postgres install required.

---

## Configuration

```bash
cp tools/auth-healthcheck.env.example tools/auth-healthcheck.env
# Edit tools/auth-healthcheck.env
```

### Key variables

| Variable | Required | Description |
|---|---|---|
| `NEON_URL` | ✅ Yes | Direct Neon connection string. Get from Neon Console → Branch → "Direct connection" |
| `BETTER_AUTH_API_KEY` | Optional | Enables admin API check (`list-users`). Leave blank to skip |
| `TEST_EMAIL` | Optional | Fixed test email. Leave blank to auto-generate a unique email each run |
| `API_BASE` | Optional | Defaults to `https://api.bloqr.dev/api` |
| `KV_BINDING` | Optional | Defaults to `BETTER_AUTH_KV` |
| `D1_BINDING` | Optional | Defaults to `DB` |
| `D1_ADMIN_BINDING` | Optional | Defaults to `ADMIN_DB` |
| `ENABLE_TAIL` | Optional | Set to `false` to skip wrangler tail. Defaults to `true` |

---

## Running

```bash
# Using the shell alias (recommended)
auth-check

# Or directly
source tools/.venv/bin/activate
python tools/auth-healthcheck.py
```

The script will:
1. Start `wrangler tail` in the background
2. Run all checks sequentially
3. Wait a few seconds for tail to flush
4. Print a rich summary table to the terminal
5. Write a JSON report to the repo root

---

## Interpreting Results

### All green ✅
Auth is fully working. Sign-up, sign-in, session validation, KV writes, and Neon rows all succeeded.

### `session.token present` ❌
The most critical failure. Means sign-in returned HTTP 200 but no token in the response body. Common causes:
- `storeSessionInDatabase` conflict with KV binding (fixed in PR #1725)
- Prisma field mapping error — `displayName` / `name` mismatch
- Better Auth plugin (sentinel) crashing on init (fixed in PR #1724)

### `POST /auth/sign-in/email` → HTTP 500 ❌
Worker is crashing during sign-in. Check tail logs section of the report for the exception.

### `emailVerified` ⚠️
Normal for new sign-ups if `requireEmailVerification=false`. If sign-in is being blocked, this means `requireEmailVerification=true` is set and Resend is not delivering the verification email.

### `Session in Neon` ⚠️ (not in Postgres)
Expected behaviour when `storeSessionInDatabase=false` (the default when KV is bound). Sessions live in KV only. This is correct and not a bug.

### `KV accessible` ❌ or `D1 execute` ❌
Wrangler binding is not resolving. Check `wrangler.toml` binding names match the `KV_BINDING` / `D1_BINDING` values in your env file.

---

## JSON Report

The report is written to `auth-healthcheck-YYYYMMDD-HHMMSS.json` at the repo root. Structure:

```json
{
  "timestamp": "2026-05-02T10:00:00",
  "api_base": "https://api.bloqr.dev/api",
  "results": {
    "POST /auth/sign-in/email": {
      "status": "PASS",
      "detail": "HTTP 200 OK",
      "data": {}
    }
  },
  "errors": [
    { "check": "session.token present", "detail": "missing — response keys: ['user']" }
  ],
  "summary": {
    "passed": 14,
    "failed": 1,
    "warnings": 2
  }
}
```

Paste the contents of this file into a Copilot chat for instant root-cause analysis.

---

## Wrangler Tail Logs

The script starts `wrangler tail --format json` in a background process and writes output to `wrangler-tail.log` (gitignored). The final section of the terminal output summarises:

- Worker exceptions (unhandled errors)
- Error-level log lines
- Auth-related log events (sign-in, sign-up, session, Prisma, Better Auth)

To watch the tail live in a separate terminal while the script runs:

```bash
tail -f wrangler-tail.log | jq '.logs[].parts[]'
```

---

## Relation to Other Docs

- [Better Auth + Prisma](../auth/better-auth-prisma.md) — auth configuration reference
- [Auth Chain Reference](../auth/auth-chain-reference.md) — how requests flow through the auth stack
- [Neon Setup](../database-setup/neon-setup.md) — how to get your `NEON_URL`
- [Postman Testing](../auth/postman-testing.md) — manual auth testing via Newman
- [KB-001: API Not Available](../troubleshooting/KB-001-api-not-available.md) — if the script can't reach the API at all
