#!/usr/bin/env python3
"""
auth-healthcheck.py — Better Auth / adblock-compiler production auth diagnostic

Checks:
  1.  API reachability + version
  2.  Better Auth sign-up
  3.  Better Auth sign-in + token extraction
  4.  Session validation via Bearer token
  5.  Email verification state
  6.  Better Auth KV (wrangler kv key list)
  7.  D1 databases (wrangler d1 execute)
  8.  Neon / PostgreSQL table row counts + user/session presence
  9.  Better Auth admin API (optional)
  10. Wrangler tail log summary (background process)

Config (no exports needed):
  cp tools/auth-healthcheck.env.example tools/auth-healthcheck.env
  # Fill in NEON_URL at minimum

Requirements:
  python3 -m venv tools/.venv
  source tools/.venv/bin/activate
  pip install requests rich psycopg2-binary
"""

import json
import os
import subprocess
import sys
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

console = Console()


# ============================================================================
# Config loader
# ============================================================================

def _find_repo_root() -> Path:
    """Walk up from this script's directory until wrangler.toml is found."""
    here = Path(__file__).resolve().parent
    for candidate in [here, *here.parents]:
        if (candidate / "wrangler.toml").exists():
            return candidate
    # Fallback: use CWD-based search
    cwd = Path.cwd()
    for candidate in [cwd, *cwd.parents]:
        if (candidate / "wrangler.toml").exists():
            return candidate
    return here  # last resort


def _load_env_file(path: Path) -> dict[str, str]:
    """Parse KEY=VALUE env file; skip blanks and # comments."""
    result: dict[str, str] = {}
    if not path.exists():
        return result
    with open(path) as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip()
                # Strip optional surrounding quotes (single or double)
                if len(val) >= 2 and val[0] in ('"', "'") and val[-1] == val[0]:
                    val = val[1:-1]
                result[key] = val
    return result


def _load_config() -> dict:
    repo_root = _find_repo_root()
    env_file  = repo_root / "tools" / "auth-healthcheck.env"
    file_env  = _load_env_file(env_file)

    if env_file.exists():
        loaded_keys = [k for k, v in file_env.items() if v and "<" not in v]
        console.print(f"[dim]📄 Config: {env_file}  ({len(loaded_keys)} key(s) set)[/dim]")
    else:
        console.print(
            f"[yellow]⚠️  Config file not found: {env_file}[/yellow]\n"
            f"   Run: cp tools/auth-healthcheck.env.example tools/auth-healthcheck.env"
        )

    def get(key: str, default: str = "") -> str:
        """
        Priority order:
          1. tools/auth-healthcheck.env  (file_env)
          2. Shell environment           (os.environ)
          3. Hardcoded default
        Values containing placeholder brackets like <user> are treated as unset.
        """
        for source in (file_env.get(key, ""), os.environ.get(key, "")):
            if source and "<" not in source:
                return source
        return default

    raw_email  = get("TEST_EMAIL", "")
    test_email = raw_email if raw_email else f"healthcheck-{uuid.uuid4().hex[:8]}@bloqr.dev"

    neon_url = get("NEON_URL", "")

    # Debug: show what NEON_URL resolved to (masked)
    if neon_url:
        masked = neon_url[:30] + "..." if len(neon_url) > 30 else neon_url
        console.print(f"[dim]🔗 NEON_URL: {masked}[/dim]")
    else:
        # Surface exactly why it's missing
        raw_file = file_env.get("NEON_URL", "")
        raw_env  = os.environ.get("NEON_URL", "")
        if raw_file and "<" in raw_file:
            console.print("[yellow]⚠️  NEON_URL in env file still contains placeholder — replace <user>/<pass>/<host>/<db>[/yellow]")
        elif raw_env and "<" in raw_env:
            console.print("[yellow]⚠️  NEON_URL shell var contains placeholder text[/yellow]")
        elif not raw_file and not raw_env:
            console.print("[yellow]⚠️  NEON_URL not found in env file or shell environment[/yellow]")

    return {
        "repo_root":           repo_root,
        "api_base":            get("API_BASE",            "https://api.bloqr.dev/api"),
        "test_email":          test_email,
        "test_password":       get("TEST_PASSWORD",       "HealthCheck1234!!@@"),
        "test_name":           get("TEST_NAME",           "Auth Healthcheck Bot"),
        "neon_url":            neon_url,
        "better_auth_api_key": get("BETTER_AUTH_API_KEY", ""),
        "kv_binding":          get("KV_BINDING",          "BETTER_AUTH_KV"),
        "d1_binding":          get("D1_BINDING",          "DB"),
        "d1_admin_binding":    get("D1_ADMIN_BINDING",    "ADMIN_DB"),
        "wrangler_env":        get("WRANGLER_ENV",        ""),
        "enable_tail":         get("ENABLE_TAIL",         "true").lower() == "true",
        "tail_wait_sec":       int(get("TAIL_WAIT_SEC",   "4")),
        "tail_log_file":       str(repo_root / "wrangler-tail.log"),
        "report_file":         str(repo_root / f"auth-healthcheck-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"),
    }


# ============================================================================
# State (populated in main)
# ============================================================================

CONFIG: dict = {}
report: dict = {
    "timestamp": datetime.now().isoformat(),
    "results":   {},
    "errors":    [],
    "summary":   {"passed": 0, "failed": 0, "warnings": 0},
}
_tail_proc: subprocess.Popen | None = None


# ============================================================================
# Helpers
# ============================================================================

def _record(name: str, status: str, detail: str, data: dict | None = None) -> None:
    icons  = {"PASS": "✅", "FAIL": "❌", "WARN": "⚠️ "}
    colors = {"PASS": "green", "FAIL": "red", "WARN": "yellow"}
    console.print(f"  {icons.get(status,'•')} [{colors.get(status,'white')}]{name}[/{colors.get(status,'white')}]: {detail}")
    report["results"][name] = {"status": status, "detail": detail, "data": data or {}}
    report["summary"][{"PASS": "passed", "FAIL": "failed", "WARN": "warnings"}[status]] += 1


def ok(name: str, detail: str = "", data: dict | None = None)   -> None: _record(name, "PASS", detail, data)
def fail(name: str, detail: str = "", data: dict | None = None) -> None:
    _record(name, "FAIL", detail, data)
    report["errors"].append({"check": name, "detail": detail})
def warn(name: str, detail: str = "", data: dict | None = None) -> None: _record(name, "WARN", detail, data)


def section(title: str) -> None:
    console.print()
    console.rule(f"[bold cyan]{title}[/bold cyan]")


def wrangler(*args: str, timeout: int = 30) -> tuple[bool, str]:
    cmd = ["wrangler", *args]
    if CONFIG.get("wrangler_env"):
        cmd += ["--env", CONFIG["wrangler_env"]]
    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=timeout, cwd=str(CONFIG["repo_root"]),
        )
        return r.returncode == 0, (r.stdout + r.stderr).strip()
    except subprocess.TimeoutExpired:
        return False, f"timeout after {timeout}s"
    except FileNotFoundError:
        return False, "wrangler not found — is it installed and on PATH?"


# ============================================================================
# Tail log
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
            cwd=str(CONFIG["repo_root"]),
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
    for method, path, label in [
        ("GET", "/version",        "GET /version"),
        ("GET", "/auth/providers", "GET /auth/providers"),
    ]:
        try:
            r = requests.request(method, f"{CONFIG['api_base']}{path}", timeout=10)
            d = r.json() if "application/json" in r.headers.get("content-type", "") else {}
            if r.ok:
                extra = f"version={d.get('version','?')}" if "version" in d else f"HTTP {r.status_code}"
                ok(label, extra, d)
            else:
                fail(label, f"HTTP {r.status_code}: {r.text[:120]}")
        except Exception as e:
            fail(label, str(e))


def check_signup() -> dict | None:
    section("2 · Sign-Up")
    try:
        r = requests.post(
            f"{CONFIG['api_base']}/auth/sign-up/email",
            json={"name": CONFIG["test_name"], "email": CONFIG["test_email"], "password": CONFIG["test_password"]},
            timeout=20,
        )
        d = r.json() if "application/json" in r.headers.get("content-type", "") else {}
        if r.status_code in (200, 201):
            ok("POST /auth/sign-up/email", f"HTTP {r.status_code} — user_id={(d.get('user') or {}).get('id','?')}", d)
            return d
        elif r.status_code == 422 and "already" in r.text.lower():
            warn("POST /auth/sign-up/email", "User already exists — attempting sign-in")
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

        (ok if token   else fail)("session.token present",
            f"{token[:24]}…" if token else f"missing — keys: {list(d.keys())}", d)
        (ok if user.get("id") else fail)("user object",
            f"id={user.get('id')}  email={user.get('email')}  tier={user.get('tier','?')}  role={user.get('role','?')}" if user.get("id") else f"no user.id — keys: {list(user.keys())}", d)
        (ok if session.get("id") else fail)("session object",
            f"id={str(session.get('id',''))[:20]}…  expires={session.get('expiresAt','?')}" if session.get("id") else f"no session.id — keys: {list(session.keys())}", d)
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
    verified = (signin_data.get("user") or {}).get("emailVerified")
    if verified:
        ok("emailVerified", str(verified))
    else:
        warn("emailVerified", "false — blocked if requireEmailVerification=true. Check Resend or verify manually in DB.")


def check_kv() -> None:
    section("6 · Better Auth KV")
    success, out = wrangler("kv", "key", "list", "--binding", CONFIG["kv_binding"])
    if not success:
        fail("KV list", out[:300])
        return
    lines = [l for l in out.splitlines() if l.strip()]
    raw   = lines[-1] if lines else "[]"
    try:
        keys = json.loads(raw)
    except json.JSONDecodeError:
        warn("KV list", f"Could not parse output — raw: {raw[:200]}")
        return
    if not isinstance(keys, list):
        warn("KV list", f"Unexpected type: {type(keys)}")
        return
    ok("KV accessible", f"{len(keys)} key(s)")
    if not keys:
        warn("KV key distribution", "0 keys — normal on fresh deploy")
        return
    prefixes: dict[str, int] = {}
    for k in keys:
        name = k.get("name", "") if isinstance(k, dict) else str(k)
        p = name.split(":")[0] if ":" in name else "other"
        prefixes[p] = prefixes.get(p, 0) + 1
    ok("KV key distribution", "  ".join(f"{p}={c}" for p, c in sorted(prefixes.items())), prefixes)


def check_d1(binding: str, label: str) -> None:
    section(f"7 · D1 — {label}  (binding={binding})")
    success, out = wrangler("d1", "execute", binding, "--command",
                            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
    if not success:
        fail(f"D1 {label} execute", out[:300])
        return
    ok(f"D1 {label} accessible", "query succeeded")
    tables = []
    for line in out.splitlines():
        if "│" in line:
            parts = [p.strip() for p in line.split("│") if p.strip()]
            if parts and parts[0] not in ("name", ""):
                tables.append(parts[0])
    if tables:
        ok(f"D1 {label} tables", f"{len(tables)}: {', '.join(tables)}", {"tables": tables})
    else:
        warn(f"D1 {label} tables", f"None parsed — raw:\n{out[:400]}")
    for tbl in [t for t in ["user", "session", "api_key", "verification", "account"] if t in tables]:
        s2, o2 = wrangler("d1", "execute", binding, "--command", f"SELECT COUNT(*) as c FROM {tbl};")
        if s2:
            for ln in o2.splitlines():
                if "│" in ln:
                    ps = [p.strip() for p in ln.split("│") if p.strip()]
                    if ps and ps[0].isdigit():
                        ok(f"D1 {label} · {tbl} rows", ps[0])
                        break


def check_neon(signin_data: dict | None) -> None:
    section("8 · Neon / PostgreSQL")
    neon_url = CONFIG["neon_url"]
    if not neon_url:
        warn("Neon connection", "NEON_URL not configured — set it in tools/auth-healthcheck.env")
        return
    try:
        conn = psycopg2.connect(neon_url, connect_timeout=10)
        conn.autocommit = True
        cur = conn.cursor()
        ok("Neon TCP connection", "connected")
    except Exception as e:
        fail("Neon TCP connection", str(e))
        return

    counts: dict[str, int | str] = {}
    for tbl in ["user", "session", "account", "verification"]:
        try:
            cur.execute(f'SELECT COUNT(*) FROM "{tbl}"')
            counts[tbl] = cur.fetchone()[0]  # type: ignore[index]
        except Exception as e:
            counts[tbl] = f"ERROR: {e}"
    has_err = any(str(v).startswith("ERROR") for v in counts.values())
    (fail if has_err else ok)("Neon table counts", "  ".join(f"{t}={c}" for t, c in counts.items()), counts)

    try:
        cur.execute(
            'SELECT id, email, "displayName", "emailVerified", tier FROM "user" WHERE email = %s',
            (CONFIG["test_email"],),
        )
        row = cur.fetchone()
        if row:
            ok("Test user in Neon", f"id={row[0]}  displayName={row[2]}  tier={row[4]}  verified={row[3]}")
        else:
            fail("Test user in Neon", f"{CONFIG['test_email']} not found")
    except Exception as e:
        fail("Test user in Neon", str(e))

    if signin_data:
        session_id = (signin_data.get("session") or {}).get("id")
        if session_id:
            try:
                cur.execute('SELECT id, "userId", "expiresAt" FROM session WHERE id = %s', (session_id,))
                sess = cur.fetchone()
                if sess:
                    ok("Session in Neon", f"id={str(sess[0])[:20]}…  expires={sess[2]}")
                else:
                    warn("Session in Neon", "Not in Postgres — stored in KV only (expected when KV is bound).")
            except Exception as e:
                fail("Session in Neon", str(e))
    cur.close()
    conn.close()


def check_admin_api() -> None:
    section("9 · Better Auth Admin API (optional)")
    api_key = CONFIG["better_auth_api_key"]
    if not api_key:
        warn("Admin API", "BETTER_AUTH_API_KEY not set — skipping")
        return
    try:
        r = requests.get(
            f"{CONFIG['api_base']}/auth/admin/list-users?limit=5",
            headers={"x-api-key": api_key},
            timeout=10,
        )
        d = r.json() if "application/json" in r.headers.get("content-type", "") else {}
        if r.ok:
            ok("Admin list-users", f"HTTP {r.status_code} — {len(d.get('users',[]))} user(s)", d)
        else:
            fail("Admin list-users", f"HTTP {r.status_code}: {r.text[:200]}", d)
    except Exception as e:
        fail("Admin list-users", str(e))


def summarise_tail() -> None:
    section("10 · Wrangler Tail Summary")
    if not CONFIG["enable_tail"]:
        warn("Tail logs", "disabled (ENABLE_TAIL=false)")
        return
    log_path = Path(CONFIG["tail_log_file"])
    if not log_path.exists() or log_path.stat().st_size == 0:
        warn("Tail log", f"{log_path} is empty")
        return
    exceptions, error_logs, auth_logs = [], [], []
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
    (ok if not exceptions else fail)("Worker exceptions",
        f"{len(exceptions)} exception(s)" if exceptions else "none", {"exceptions": exceptions[:10]})
    (ok if not error_logs else warn)("Worker error logs",
        f"{len(error_logs)} line(s)" if error_logs else "none", {"errors": error_logs[:10]})
    (ok if auth_logs else warn)("Auth log events",
        f"{len(auth_logs)} line(s)" if auth_logs else "none captured", {"events": auth_logs[:20]})


def write_report() -> None:
    path = Path(CONFIG["report_file"])
    with open(path, "w") as f:
        json.dump(report, f, indent=2, default=str)
    s = report["summary"]
    console.print()
    console.print(Panel(
        f"[green]✅ Passed:   {s['passed']}[/green]\n"
        f"[yellow]⚠️  Warnings: {s['warnings']}[/yellow]\n"
        f"[red]❌ Failed:   {s['failed']}[/red]\n"
        f"   Total:    {s['passed'] + s['failed'] + s['warnings']}\n\n"
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
    global CONFIG
    CONFIG = _load_config()
    report["api_base"] = CONFIG["api_base"]

    console.print(Panel(
        f"[bold cyan]Better Auth Production Healthcheck[/bold cyan]\n"
        f"API base : {CONFIG['api_base']}\n"
        f"Test user: {CONFIG['test_email']}\n"
        f"Repo root: {CONFIG['repo_root']}\n"
        f"Time     : {datetime.now().isoformat()}",
        title="adblock-compiler · bloqr.dev",
    ))

    start_tail()
    time.sleep(1)

    try:
        check_api()
        check_signup()
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
