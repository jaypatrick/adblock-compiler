# tools/

Standalone operational diagnostic scripts for the adblock-compiler / Bloqr stack.

| Script | Purpose |
|---|---|
| `auth-healthcheck.py` | End-to-end Better Auth diagnostic — sign-up, sign-in, KV, D1, Neon |

## Setup (one time)

```bash
python3 -m venv tools/.venv
source tools/.venv/bin/activate
pip install requests rich psycopg2-binary
```

## Config

Each script has a corresponding `.env` file:

```bash
cp tools/auth-healthcheck.env.example tools/auth-healthcheck.env
# Fill in NEON_URL and optionally BETTER_AUTH_API_KEY
```

## Run

```bash
source tools/.venv/bin/activate
python tools/auth-healthcheck.py
```

Or use the shell alias (add to `~/.zshrc`):

```bash
alias auth-check='cd /path/to/adblock-compiler && source tools/.venv/bin/activate && python tools/auth-healthcheck.py'
```

See [`docs/tools/`](../docs/tools/README.md) for full documentation.
