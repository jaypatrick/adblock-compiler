#!/usr/bin/env python3
"""
auth-healthcheck.py — Better Auth / adblock-compiler production auth diagnostic

Checks:
  1. API reachability + version
  2. Better Auth sign-up
  3. Better Auth sign-in + token extraction
  4. Session validation via Bearer token
  5. Email verification state
  6. Better Auth KV (wrangler kv key list)
  7. D1 databases (wrangler d1 execute)
  8. Neon / PostgreSQL table row counts + user/session presence
  9. Wrangler tail log summary (background thread)

Usage:
    export NEON_URL="postgresql://user:pass@host.neon.tech/dbname?sslmode=require"
    export BETTER_AUTH_API_KEY="your-key"   # optional
    python tools/auth-healthcheck.py

Requirements:
    pip install requests rich psycopg2-binary
"""

import json
import os
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

# ── dependency check ────────────────────────────────────────────────────────
missing = []
for pkg in ("requests", "rich", "psycopg2"):
    try:
        __import__(pkg)
    except ImportError:
        missing.append(pkg if pkg != "psycopg2" else "psycopg2-binary")
if missing:
    print(f"Missing packages: {', '.join(missing)}")
    print(f"Run: pip install {' '.join(missing)}")
    sys.exit(1)

import requests
import psycopg2
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

# ============================================================================
# CONFIG — edit these values before running
# ============================================================================

CONFIG = {
    # Production API
    "api_base": "https://api.bloqr.dev/api",

    # Test user — a unique email is generated each run so we never collide
    # with an existing account. Change to a fixed email to reuse across runs.
    "test_email": f"healthcheck-{uuid.uuid4().hex[:8]}@bloqr.dev",
    "test_password": "HealthCheck1234!!@@",
    "test_name": "Auth Healthcheck Bot",

    # Wrangler binding names (must match wrangler.toml binding = "..." entries)
    "kv_binding":        "BETTER_AUTH_KV",
    "d1_binding":        "DB",           # adblock-compiler-d1-database
    "d1_admin_binding":  "ADMIN_DB",     # adblock-compiler-admin-d1

    # Neon connection string — set via env var (see usage above)
    "neon_url": os.environ.get("NEON_URL", ""),

    # Better Auth admin API key (optional — enables /api/admin/* checks)
    "better_auth_api_key": os.environ.get("BETTER_AUTH_API_KEY", ""),

    # Wrangler environment name — leave empty for production default
    "wrangler_env": "",

    # Tail log settings
    "enable_tail":   True,
    "tail_log_file": "wrangler-tail.log",
    "tail_wait_sec": 4,   # seconds to wait after checks for tail to flush

    # Output report file
    "report_file": f"auth-healthcheck-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json",
}

# ============================================================================
# State
# ============================================================================

console = Console()
report: dict = {
    "timestamp": datetime.now().isoformat(),
    "api_base":  CONFIG["api_base"],
    "results":   {},
    "errors":    [],
    "summary":   {"passed": 0, "failed": 0, "warnings": 0},
}
_tail_proc: subprocess.Popen | None = None


# ============================================================================
# Helpers
# ============================================================================

def _record(name: str, status: str, detail: str, data: dict | None = None) -> None:
    """Record a check result and print it."""
    icons = {"PASS": "✅", "FAIL": "❌", "WARN": "⚠️ "}
    colors = {"PASS": "green", "FAIL": "red", "WARN": "yellow"}
    icon  = icons.get(status, "•")
    color = colors.get(status, "white")
    console.print(f"  {icon} [{color}]{name}[/{color}]: {detail}")
    report["results"][name] = {"status": status, "detail": detail, "data": data or {}}
    key = {"PASS": "passed", "FAIL": "failed", "WARN": "warnings"}[status]
    report["summary"][key] += 1


def ok(name: str, detail: str = "", data: dict | None = None) -> None:
    _record(name, "PASS", detail, data)


def fail(name: str, detail: str = "", data: dict | None = None) -> None:
    _record(name, "FAIL", detail, data)
    report["errors"].append({"check": name, "detail": detail})


def warn(name: str, detail: str = "", data: dict | None = None) -> None:
    _record(name, "WARN", detail, data)


def section(title: str) -> None:
    console.print()
    console.rule(f"[bold cyan]{title}[/bold cyan]")


def wrangler(*args: str, timeout: int = 30) -> tuple[bool, str]:
    """Run a wrangler command; returns (success, combined_output)."""
    cmd = ["wrangler", *args]
    if CONFIG["wrangler_env"]:
        cmd += ["--env", CONFIG["wrangler_env"]]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode == 0, (r.stdout + r.stderr).strip()
    except subprocess.TimeoutExpired:
        return False, f"timeout after {timeout}s"
    except FileNotFoundError:
        return False, "wrangler not found — is it installed?"


# ============================================================================
# Tail log (background)
# ============================================================================

def start_tail() -> None:
    global _tail_proc
    if not CONFIG["enable_tail"]:
        return
    try:
        _tail_proc = subprocess.Popen(
            ["wrangler", "tail", "--format", "json"],
            stdout=open(CONFIG["tail_log_file"], "w"),
            stderr=subprocess.STDOUT,
        )
        console.print(f"[dim]📡 wrangler tail → {CONFIG['tail_log_file']}  (PID {_tail_proc.pid})[/dim]")
    except Exception as e:
        console.print(f"[yellow]⚠️  Could not start wrangler tail: {e}[/yellow]")


def stop_tail() -> None:
    global _tail_proc
    if _tail_proc:
        _tail_proc.terminate()
        _tail_proc = None


# ============================================================================
# Checks
# ============================================================================

def check_api() -> None:
    section("1 · API Health")
    try:
        r = requests.get(f"{CONFIG['api_base']}/version", timeout=10)
        if r.ok:
            d = r.json()
            ok("API /version", f"HTTP {r.status_code} — version={d.get('version','?')}", d)
        else:
            fail("API /version", f"HTTP {r.status_code}: {r.text[:120]}")
    except Exception as e:
        fail("API /version", str(e))

    try:
        r = requests.get(f"{CONFIG['api_base']}/auth/providers", timeout=10)
        if r.ok:
            ok("GET /auth/providers", f"HTTP {r.status_code}", r.json())
        else:
            fail("GET /auth/providers", f"HTTP {r.status_code}: {r.text[:120]}")
    except Exception as e:
        fail("GET /auth/providers", str(e))


def check_signup() -> dict | None:
    section("2 · Sign-Up")
    try:
        r = requests.post(
            f"{CONFIG['api_base']}/auth/sign-up/email",
            json={
                "name":     CONFIG["test_name"],
                "email":    CONFIG["test_email"],
                "password": CONFIG["test_password"],
            },
            timeout=20,
        )
        d = r.json() if "application/json" in r.headers.get("content-type", "") else {}
        if r.status_code in (200, 201):
            uid = (d.get("user") or {}).get("id", "?")
            ok("POST /auth/sign-up/email", f"HTTP {r.status_code} — user_id={uid}", d)
            return d
        elif r.status_code == 422 and "already" in r.text.lower():
            warn("POST /auth/sign-up/email", "User already exists — will attempt sign-in anyway")
            return None
        else:
            fail("POST /auth/sign-up/email", f"HTTP {r.status_code}: {r.text[:300]}", d)
            return None
    except Exception as e:
        fail("POST /auth/sign-up/email", str(e))
        return None


def check_signin() -> dict | None:
    section("3 · Sign-In + Token")
    try:
        r = requests.post(
            f"{CONFIG['api_base']}/auth/sign-in/email",
            json={"email": CONFIG["test_email"], "password": CONFIG["test_password"]},
            timeout=20,
        )
        d = r.json() if "application/json" in r.headers.get("content-type", "") else {}

        if r.status_code != 200:
            fail("POST /auth/sign-in/email", f"HTTP {r.status_code}: {r.text[:400]}", d)
            return None

        ok("POST /auth/sign-in/email", "HTTP 200 OK")

        token   = (d.get("session") or {}).get("token") or d.get("token")
        session = d.get("session") or {}
        user    = d.get("user")    or {}

        if token:
            ok("session.token present", f"{token[:24]}…")
        else:
            fail("session.token present", f"missing — response keys: {list(d.keys())}", d)

        if user.get("id"):
            ok("user object", f"id={user['id']}  email={user.get('email')}  tier={user.get('tier','?')}  role={user.get('role','?')}")
        else:
            fail("user object", f"no user.id — keys: {list(user.keys())}", d)

        if session.get("id"):
            ok("session object", f"id={session['id'][:20]}…  expires={session.get('expiresAt','?')}")
        else:
            fail("session object", f"no session.id — keys: {list(session.keys())}", d)

        return d

    except Exception as e:
        fail("POST /auth/sign-in/email", str(e))
        return None


def check_session_validation(signin_data: dict) -> None:
    section("4 · Session Validation (Bearer token)")
    token = (signin_data.get("session") or {}).get("token")
    if not token:
        warn("GET /auth/get-session", "Skipped — no token from sign-in")
        return
    try:
        r = requests.get(
            f"{CONFIG['api_base']}/auth/get-session",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        d = r.json() if "application/json" in r.headers.get("content-type", "") else {}
        if r.ok and d.get("user"):
            ok("GET /auth/get-session", f"valid — email={d['user'].get('email')}", d)
        else:
            fail("GET /auth/get-session", f"HTTP {r.status_code}: {r.text[:200]}", d)
    except Exception as e:
        fail("GET /auth/get-session", str(e))


def check_email_verification(signin_data: dict) -> None:
    section("5 · Email Verification")
    user = signin_data.get("user") or {}
    verified = user.get("emailVerified")
    if verified:
        ok("emailVerified", str(verified))
    else:
        warn(
            "emailVerified",
            "false — sign-in will be blocked if requireEmailVerification=true. "
            "Check Resend delivery (RESEND_API_KEY) or manually verify in DB.",
        )


def check_kv() -> None:
    section("6 · Better Auth KV")
    success, out = wrangler("kv", "key", "list", "--binding", CONFIG["kv_binding"])
    if not success:
        fail("KV list", out[:300])
        return

    # wrangler outputs JSON on the last non-empty line
    lines = [l for l in out.splitlines() if l.strip()]
    raw = lines[-1] if lines else "[]"
    try:
        keys = json.loads(raw)
    except json.JSONDecodeError:
        warn("KV list", f"Could not parse output — raw: {raw[:200]}")
        return

    if not isinstance(keys, list):
        warn("KV list", f"Unexpected type: {type(keys)} — {raw[:200]}")
        return

    ok("KV accessible", f"{len(keys)} key(s) found")

    if not keys:
        warn("KV key distribution", "0 keys — normal on fresh deploy; expect session keys after sign-in")
        return

    prefixes: dict[str, int] = {}
    for k in keys:
        name   = k.get("name", "") if isinstance(k, dict) else str(k)
        prefix = name.split(":")[0] if ":" in name else "other"
        prefixes[prefix] = prefixes.get(prefix, 0) + 1

    ok("KV key distribution", "  ".join(f"{p}={c}" for p, c in sorted(prefixes.items())), prefixes)


def check_d1(binding: str, label: str) -> None:
    section(f"7 · D1 — {label} (binding={binding})")

    # ── table list ──────────────────────────────────────────────────────────
    success, out = wrangler(
        "d1", "execute", binding,
        "--command", "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;",
    )
    if not success:
        fail(f"D1 {label} execute", out[:300])
        return
    ok(f"D1 {label} accessible", "query succeeded")

    # Parse table names from wrangler table output
    tables = []
    for line in out.splitlines():
        if "│" in line:
            parts = [p.strip() for p in line.split("│") if p.strip()]
            if parts and parts[0] not in ("name", ""):
                tables.append(parts[0])

    if tables:
        ok(f"D1 {label} tables", f"{len(tables)}: {', '.join(tables)}", {"tables": tables})
    else:
        warn(f"D1 {label} tables", f"No tables parsed — raw output below:\n{out[:400]}")

    # ── row counts for known tables ─────────────────────────────────────────
    known = ["user", "session", "api_key", "verification", "account"]
    for tbl in [t for t in known if t in tables]:
        s2, o2 = wrangler("d1", "execute", binding, "--command", f"SELECT COUNT(*) as c FROM {tbl};")
        if s2:
            for ln in o2.splitlines():
                if "│" in ln:
                    ps = [p.strip() for p in ln.split("│") if p.strip()]
                    if ps and ps[0].isdigit():
                        ok(f"D1 {label} {tbl} rows", ps[0])
                        break


def check_neon(signin_data: dict | None) -> None:
    section("8 · Neon / PostgreSQL")
    neon_url = CONFIG["neon_url"]
    if not neon_url:
        warn(
            "Neon connection",
            "NEON_URL not set — export NEON_URL='postgresql://...' to enable this check",
        )
        return

    try:
        conn = psycopg2.connect(neon_url, connect_timeout=10)
        conn.autocommit = True
        cur = conn.cursor()
        ok("Neon TCP connection", "connected")
    except Exception as e:
        fail("Neon TCP connection", str(e))
        return

    # Table counts
    ba_tables = ["user", "session", "account", "verification"]
    counts: dict[str, int | str] = {}
    for tbl in ba_tables:
        try:
            cur.execute(f'SELECT COUNT(*) FROM "{tbl}"')
            counts[tbl] = cur.fetchone()[0]  # type: ignore[index]
        except Exception as e:
            counts[tbl] = f"ERROR: {e}"

    has_err = any(str(v).startswith("ERROR") for v in counts.values())
    summary = "  ".join(f"{t}={c}" for t, c in counts.items())
    (fail if has_err else ok)("Neon Better Auth table counts", summary, counts)

    # Test user row
    try:
        cur.execute(
            'SELECT id, email, "displayName", "emailVerified", tier, "createdAt" FROM "user" WHERE email = %s',
            (CONFIG["test_email"],),
        )
        row = cur.fetchone()
        if row:
            ok("Test user in Neon", f"id={row[0]}  displayName={row[2]}  tier={row[4]}  verified={row[3]}")
        else:
            fail("Test user in Neon", f"{CONFIG['test_email']} not found — sign-up may have failed")
    except Exception as e:
        fail("Test user in Neon", str(e))

    # Session row
    if signin_data:
        session_id = (signin_data.get("session") or {}).get("id")
        if session_id:
            try:
                cur.execute('SELECT id, "userId", "expiresAt" FROM session WHERE id = %s', (session_id,))
                sess = cur.fetchone()
                if sess:
                    ok("Session in Neon", f"id={str(sess[0])[:20]}…  expires={sess[2]}")
                else:
                    warn(
                        "Session in Neon",
                        f"Session {session_id[:20]}… not in Postgres — stored in KV only. "
                        "Expected when storeSessionInDatabase=false (default with KV bound).",
                    )
            except Exception as e:
                fail("Session in Neon", str(e))

    cur.close()
    conn.close()


def check_admin_api() -> None:
    section("9 · Better Auth Admin API (optional)")
    api_key = CONFIG["better_auth_api_key"]
    if not api_key:
        warn("Admin API", "BETTER_AUTH_API_KEY not set — skipping admin API checks")
        return

    headers = {"x-api-key": api_key}
    endpoints = [
        ("GET", "/auth/admin/list-users?limit=1", "list-users"),
    ]
    for method, path, label in endpoints:
        try:
            r = requests.request(method, f"{CONFIG['api_base']}{path}", headers=headers, timeout=10)
            d = r.json() if "application/json" in r.headers.get("content-type", "") else {}
            if r.ok:
                ok(f"Admin API {label}", f"HTTP {r.status_code}", d)
            else:
                fail(f"Admin API {label}", f"HTTP {r.status_code}: {r.text[:200]}", d)
        except Exception as e:
            fail(f"Admin API {label}", str(e))


def summarise_tail() -> None:
    section("10 · Wrangler Tail Log Summary")
    if not CONFIG["enable_tail"]:
        warn("Tail logs", "disabled in CONFIG")
        return

    log_path = Path(CONFIG["tail_log_file"])
    if not log_path.exists() or log_path.stat().st_size == 0:
        warn("Tail log file", f"{log_path} is empty or missing")
        return

    exceptions: list[str] = []
    error_logs: list[str] = []
    auth_logs:  list[str] = []

    with open(log_path) as f:
        for raw in f:
            raw = raw.strip()
            if not raw:
                continue
            try:
                entry = json.loads(raw)
            except json.JSONDecodeError:
                continue

            for exc in entry.get("exceptions", []):
                exceptions.append(exc.get("message", str(exc)))

            for log in entry.get("logs", []):
                msg = " ".join(str(p) for p in log.get("parts", []))
                lower = msg.lower()
                if "error" in lower or "500" in lower or "exception" in lower:
                    error_logs.append(msg)
                if any(kw in lower for kw in ("auth", "sign-in", "sign-up", "session", "prisma", "better-auth")):
                    auth_logs.append(msg)

    (ok if not exceptions else fail)(
        "Worker exceptions",
        f"{len(exceptions)} exception(s)" if exceptions else "none",
        {"exceptions": exceptions[:10]},
    )
    (ok if not error_logs else warn)(
        "Worker error logs",
        f"{len(error_logs)} error log line(s)" if error_logs else "none",
        {"errors": error_logs[:10]},
    )
    if auth_logs:
        ok("Auth-related log events", f"{len(auth_logs)} line(s)", {"events": auth_logs[:20]})
    else:
        warn("Auth-related log events", "none captured — tail may not have caught the requests")


def write_report() -> None:
    path = Path(CONFIG["report_file"])
    with open(path, "w") as f:
        json.dump(report, f, indent=2, default=str)

    s = report["summary"]
    total = s["passed"] + s["failed"] + s["warnings"]
    console.print()
    console.print(Panel(
        f"[green]✅ Passed:   {s['passed']}[/green]\n"
        f"[yellow]⚠️  Warnings: {s['warnings']}[/yellow]\n"
        f"[red]❌ Failed:   {s['failed']}[/red]\n"
        f"   Total:    {total}\n\n"
        f"Report → [bold]{path}[/bold]",
        title="[bold]Auth Healthcheck Complete[/bold]",
    ))

    if report["errors"]:
        console.print("\n[bold red]Failed checks:[/bold red]")
        for e in report["errors"]:
            console.print(f"  ❌ {e['check']}: {e['detail']}")


# ============================================================================
# Entry point
# ============================================================================

def main() -> None:
    console.print(Panel(
        f"[bold cyan]Better Auth Production Healthcheck[/bold cyan]\n"
        f"API base : {CONFIG['api_base']}\n"
        f"Test user: {CONFIG['test_email']}\n"
        f"Time     : {datetime.now().isoformat()}",
        title="adblock-compiler · bloqr.dev",
    ))

    if not CONFIG["neon_url"]:
        console.print(
            "\n[yellow]⚠️  NEON_URL not set. Neon checks will be skipped.[/yellow]\n"
            "   export NEON_URL='postgresql://user:pass@host.neon.tech/db?sslmode=require'\n"
        )

    start_tail()
    time.sleep(1)  # give tail a moment to attach

    try:
        check_api()
        signup_data = check_signup()
        signin_data = check_signin()

        if signin_data:
            check_session_validation(signin_data)
            check_email_verification(signin_data)
        else:
            warn("Session + email checks", "Skipped — sign-in failed")

        check_kv()
        check_d1(CONFIG["d1_binding"],       "adblock-compiler-d1-database")
        check_d1(CONFIG["d1_admin_binding"],  "adblock-compiler-admin-d1")
        check_neon(signin_data)
        check_admin_api()

        if CONFIG["enable_tail"]:
            console.print(f"\n[dim]Waiting {CONFIG['tail_wait_sec']}s for tail to flush…[/dim]")
            time.sleep(CONFIG["tail_wait_sec"])

        summarise_tail()

    finally:
        stop_tail()
        write_report()


if __name__ == "__main__":
    main()