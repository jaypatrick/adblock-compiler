# Auth Provider Selection: Local JWT Bridge vs. Clerk

> **TL;DR** — The auth provider (local JWT or Clerk) is determined entirely by environment
> variables. No code changes are required to switch between them.

## Overview

The system has two fully operational auth providers that coexist in the codebase:

| Provider | Active when | Used by |
|---|---|---|
| `LocalJwtAuthProvider` | `CLERK_JWKS_URL` is **absent** | Worker (back-end) |
| `ClerkAuthProvider` | `CLERK_JWKS_URL` is **set** | Worker (back-end) |
| Local auth form (`LocalAuthService`) | `CLERK_PUBLISHABLE_KEY` returns **null** from `/api/clerk-config` | Angular frontend |
| Clerk hosted UI (`ClerkService`) | `CLERK_PUBLISHABLE_KEY` returns a **real key** from `/api/clerk-config` | Angular frontend |

Both halves (Worker + frontend) switch independently based on their respective env vars, but they
should always be set or unset together for a consistent experience.

---

## How Provider Selection Works

### Worker (back-end)

In `worker/worker.ts`, the provider is selected once per request before the auth middleware runs:

```typescript
const authProvider = env.CLERK_JWKS_URL
    ? new ClerkAuthProvider(env)      // ← production: verifies Clerk JWTs via JWKS
    : new LocalJwtAuthProvider(env);  // ← bridge: verifies HS256 JWTs from /auth/login
```

`CLERK_JWKS_URL` is checked — not `CLERK_PUBLISHABLE_KEY`. Setting only one of the two will
produce a mismatched state (see [Troubleshooting](#troubleshooting)).

### Frontend (Angular)

`app.config.ts` fetches `/api/clerk-config` during app initialization:

```typescript
const clerkConfig = await firstValueFrom(
    http.get<{ publishableKey: string | null }>(`${apiBaseUrl}/clerk-config`)
        .pipe(timeout(5000)),
);
await clerkService.initialize(clerkConfig.publishableKey ?? '');
```

The Worker endpoint (`/api/clerk-config`) returns:

```json
{ "publishableKey": "pk_live_..." }   // Clerk active
{ "publishableKey": null }            // local auth active
```

`ClerkService.initialize()` sets `_isAvailable` to `true` **only** when a non-empty publishable
key is provided and the Clerk SDK loads successfully. When the key is empty or missing,
`isAvailable()` stays `false` and `isLoaded()` is set to `true` so the UI doesn't spin forever.

`AuthFacadeService` exposes a single computed signal that all components use:

```typescript
readonly useClerk = computed(() => this.clerk.isAvailable());
```

### Sign-up / Sign-in page behavior

`SignUpComponent` (and `SignInComponent`) branch on this signal:

```html
@if (auth.useClerk()) {
    <!-- Clerk branch: mounts the hosted Clerk sign-up widget -->
    <div #signUpContainer class="clerk-container"></div>
} @else {
    <!-- Local auth branch: reactive registration form hitting POST /auth/signup -->
    <div class="local-auth-card">...</div>
}
```

**If `/sign-up` is showing the Clerk widget**, it means `CLERK_PUBLISHABLE_KEY` is set in the
Worker environment and `/api/clerk-config` is returning a real key. This is correct, expected
behavior — not a bug.

---

## Switching Between Providers

### Use local auth (bridge mode) — Clerk is not yet configured

Ensure **both** variables are absent or empty:

```toml
# wrangler.toml [vars]
# CLERK_PUBLISHABLE_KEY =   ← omit entirely, or set to empty string
# CLERK_JWKS_URL =          ← omit entirely
```

For local development, ensure `.dev.vars` does **not** contain these keys (or sets them to empty):

```ini
# .dev.vars
CLERK_PUBLISHABLE_KEY=
# CLERK_JWKS_URL not set
```

Result:
- `/api/clerk-config` → `{ "publishableKey": null }`
- Frontend: `useClerk()` = `false` → local auth form shown at `/sign-in` and `/sign-up`
- Worker: `LocalJwtAuthProvider` used → verifies HS256 JWTs from `POST /auth/login`

### Use Clerk (production mode)

Set **both** variables:

```toml
# wrangler.toml [vars]
CLERK_PUBLISHABLE_KEY = "pk_live_..."
CLERK_JWKS_URL        = "https://your-instance.clerk.accounts.dev/.well-known/jwks.json"
```

Result:
- `/api/clerk-config` → `{ "publishableKey": "pk_live_..." }`
- Frontend: `useClerk()` = `true` → Clerk hosted widget shown at `/sign-in` and `/sign-up`
- Worker: `ClerkAuthProvider` used → verifies Clerk JWTs via JWKS

---

## Diagnosing the Active Provider

Hit the config endpoint directly to see what the deployed Worker is serving:

```bash
curl https://adblock-compiler.jayson-knight.workers.dev/api/clerk-config
```

| Response | Meaning |
|---|---|
| `{ "publishableKey": "pk_live_..." }` | **Clerk is active.** Frontend will show Clerk UI. Worker will use `ClerkAuthProvider`. |
| `{ "publishableKey": null }` | **Local auth is active.** Frontend will show the local form. Worker will use `LocalJwtAuthProvider`. |

---

## Troubleshooting

### `/sign-up` shows the Clerk widget but I expected the local form

`CLERK_PUBLISHABLE_KEY` is set in the Worker environment. The system is working correctly —
Clerk has been activated. To revert to local auth, remove `CLERK_PUBLISHABLE_KEY` from
`wrangler.toml [vars]` (and `CLERK_JWKS_URL`) and redeploy.

### Sign-in works but API calls fail with 401

The frontend provider and the Worker provider are mismatched:

- **Frontend on Clerk, Worker on local** — `CLERK_PUBLISHABLE_KEY` is set but `CLERK_JWKS_URL`
  is not. The frontend issues Clerk JWTs but the Worker tries to verify them as HS256 local
  tokens. Fix: add `CLERK_JWKS_URL` to `wrangler.toml [vars]`.

- **Frontend on local, Worker on Clerk** — `CLERK_JWKS_URL` is set but `CLERK_PUBLISHABLE_KEY`
  is not (or is empty). The Worker expects Clerk JWTs but the frontend issues local HS256 tokens.
  Fix: add `CLERK_PUBLISHABLE_KEY` to `wrangler.toml [vars]`.

### The sign-up page shows a spinner and never loads

`/api/clerk-config` failed to respond within the 5-second timeout (network issue). The catch
block in `app.config.ts` calls `clerkService.markConfigLoadFailed()` and then
`clerkService.initialize('')`, which sets `isLoaded=true` and `isAvailable=false`. The local
auth form will be shown. Check Worker logs with `wrangler tail` for errors.

### `ClerkService.configLoadFailed()` is `true` in the browser

The `/api/clerk-config` fetch timed out or returned a non-2xx response. This is a transient
network error, not a misconfiguration. Refreshing the page retries the fetch.

---

## Key Files

| File | Role |
|---|---|
| `worker/worker.ts` | Provider selection (`ClerkAuthProvider` vs `LocalJwtAuthProvider`) |
| `worker/middleware/local-jwt-auth-provider.ts` | Local HS256 JWT verification |
| `worker/middleware/clerk-auth-provider.ts` | Clerk JWKS JWT verification |
| `frontend/src/app/app.config.ts` | Fetches `/api/clerk-config`, initializes `ClerkService` |
| `frontend/src/app/services/clerk.service.ts` | Wraps Clerk SDK; exposes `isAvailable()` signal |
| `frontend/src/app/services/local-auth.service.ts` | Local JWT storage and `/auth/*` calls |
| `frontend/src/app/services/auth-facade.service.ts` | Single `useClerk()` signal consumed by all components |
| `frontend/src/app/auth/sign-up/sign-up.component.ts` | Branches on `auth.useClerk()` |
| `frontend/src/app/auth/sign-in/sign-in.component.ts` | Branches on `auth.useClerk()` |
| `docs/auth/local-jwt-bridge.md` | Full local auth bridge documentation |
| `docs/auth/clerk-setup.md` | Clerk dashboard setup guide |
| `docs/auth/configuration.md` | Complete environment variable reference |

---

## Related Documentation

- [Local JWT Bridge](local-jwt-bridge.md) — Details on the temporary auth bridge
- [Configuration Guide](configuration.md) — Full environment variable reference
- [Clerk + Cloudflare Integration](clerk-cloudflare-integration.md) — Production Clerk setup
- [Clerk Dashboard Setup](clerk-setup.md) — Step-by-step Clerk configuration