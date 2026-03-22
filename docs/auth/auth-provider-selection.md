# Auth Provider Selection: Better Auth vs. Clerk

> **TL;DR** — The auth provider (Better Auth or Clerk) is determined entirely by environment
> variables. No code changes are required to switch between them.

## Overview

The system has two fully operational auth providers that coexist in the codebase:

| Provider | Active when | Used by |
|---|---|---|
| `BetterAuthProvider` | `CLERK_JWKS_URL` is **absent** and `BETTER_AUTH_SECRET` is **set** | Worker (back-end) |
| `ClerkAuthProvider` | `CLERK_JWKS_URL` is **set** | Worker (back-end) |
| Better Auth form (`BetterAuthService`) | `CLERK_PUBLISHABLE_KEY` returns **null** from `/api/clerk-config` | Angular frontend |
| Clerk hosted UI (`ClerkService`) | `CLERK_PUBLISHABLE_KEY` returns a **real key** from `/api/clerk-config` | Angular frontend |

Both halves (Worker + frontend) switch independently based on their respective env vars, but they
should always be set or unset together for a consistent experience.

---

## How Provider Selection Works

### Worker (back-end)

In `worker/hono-app.ts`, the provider is selected once per request before the auth middleware runs:

```typescript
const authProvider = c.env.CLERK_JWKS_URL
    ? new ClerkAuthProvider(c.env)      // ← production: verifies Clerk JWTs via JWKS
    : new BetterAuthProvider(c.env);    // ← Better Auth: verifies sessions via D1
```

Clerk takes priority when `CLERK_JWKS_URL` is set. Otherwise, Better Auth is used (requires
`BETTER_AUTH_SECRET` and a D1 database binding `DB`).

Better Auth also registers a catch-all route handler at `/api/auth/*` that handles sign-up,
sign-in, sign-out, and session management endpoints. This route is mounted **before** the unified
auth middleware so that Better Auth can manage its own session/cookie flow.

### Frontend (Angular)

`app.config.ts` fetches `/api/clerk-config` during app initialization:

```typescript
const clerkConfig = await firstValueFrom(
    http.get<{ publishableKey: string | null }>(`${apiBaseUrl}/clerk-config`)
        .pipe(timeout(5000)),
);
await clerkService.initialize(clerkConfig.publishableKey ?? '');
```

When Clerk is not available, `AuthFacadeService` delegates to `BetterAuthService`, which
communicates with the Better Auth endpoints at `/api/auth/*` using cookies and bearer tokens.

`AuthFacadeService` exposes computed signals that all components use:

```typescript
readonly useClerk = computed(() => this.clerk.isAvailable());
readonly useBetterAuth = computed(() => this.clerk.isLoaded() && !this.clerk.isAvailable());
```

### Sign-up / Sign-in page behavior

`SignUpComponent` (and `SignInComponent`) branch on the `useClerk()` signal:

```html
@if (auth.useClerk()) {
    <!-- Clerk branch: mounts the hosted Clerk sign-up widget -->
    <div #signUpContainer class="clerk-container"></div>
} @else {
    <!-- Better Auth branch: reactive registration form hitting POST /api/auth/sign-up/email -->
    <div class="local-auth-card">...</div>
}
```

---

## Switching Between Providers

### Use Better Auth — Clerk is not configured

Ensure Clerk variables are absent or empty, and Better Auth secret is set:

```ini
# .dev.vars
BETTER_AUTH_SECRET=your-secret-at-least-32-characters-long
# CLERK_PUBLISHABLE_KEY not set
# CLERK_JWKS_URL not set
```

Result:
- `/api/clerk-config` → `{ "publishableKey": null }`
- Frontend: `useClerk()` = `false`, `useBetterAuth()` = `true` → Better Auth form shown
- Worker: `BetterAuthProvider` used → verifies sessions via D1
- Better Auth endpoints active: `/api/auth/sign-up/email`, `/api/auth/sign-in/email`, etc.

### Use Clerk (production mode)

Set **both** Clerk variables:

```toml
# wrangler.toml [vars]
CLERK_PUBLISHABLE_KEY = "pk_live_..."
CLERK_JWKS_URL        = "https://your-instance.clerk.accounts.dev/.well-known/jwks.json"
```

Result:
- `/api/clerk-config` → `{ "publishableKey": "pk_live_..." }`
- Frontend: `useClerk()` = `true` → Clerk hosted widget shown
- Worker: `ClerkAuthProvider` used → verifies Clerk JWTs via JWKS
- Better Auth endpoints return 404

---

## Diagnosing the Active Provider

Hit the config endpoint directly to see what the deployed Worker is serving:

```bash
curl https://adblock-compiler.jayson-knight.workers.dev/api/clerk-config
```

| Response | Meaning |
|---|---|
| `{ "publishableKey": "pk_live_..." }` | **Clerk is active.** Frontend shows Clerk UI. Worker uses `ClerkAuthProvider`. |
| `{ "publishableKey": null }` | **Better Auth is active.** Frontend shows the Better Auth form. Worker uses `BetterAuthProvider`. |

For admin-level diagnostics, authenticated admins can hit:

```bash
curl -H "Authorization: Bearer <token>" https://adblock-compiler.jayson-knight.workers.dev/api/admin/auth/config
```

This returns the active provider, tier configuration, and route permissions.

---

## Troubleshooting

### Sign-in works but API calls fail with 401

The frontend provider and the Worker provider are mismatched:

- **Frontend on Clerk, Worker on Better Auth** — `CLERK_PUBLISHABLE_KEY` is set but `CLERK_JWKS_URL`
  is not. The frontend issues Clerk JWTs but the Worker tries to verify them as Better Auth sessions.
  Fix: add `CLERK_JWKS_URL` to `wrangler.toml [vars]`.

- **Frontend on Better Auth, Worker on Clerk** — `CLERK_JWKS_URL` is set but `CLERK_PUBLISHABLE_KEY`
  is not. The Worker expects Clerk JWTs but the frontend issues Better Auth session cookies.
  Fix: add `CLERK_PUBLISHABLE_KEY` to `wrangler.toml [vars]`.

### The sign-up page shows a spinner and never loads

`/api/clerk-config` failed to respond within the 5-second timeout (network issue). The catch
block in `app.config.ts` calls `clerkService.markConfigLoadFailed()` and then
`clerkService.initialize('')`, which sets `isLoaded=true` and `isAvailable=false`. The Better Auth
form will be shown. Check Worker logs with `wrangler tail` for errors.

### Better Auth returns "BETTER_AUTH_SECRET not configured"

The `BETTER_AUTH_SECRET` environment variable is missing. Add it to `.dev.vars` for local
development or set it as a Cloudflare secret:

```bash
# Local development
echo 'BETTER_AUTH_SECRET=your-secret-at-least-32-characters-long' >> .dev.vars

# Production
wrangler secret put BETTER_AUTH_SECRET
```

---

## Key Files

| File | Role |
|---|---|
| `worker/hono-app.ts` | Provider selection (`ClerkAuthProvider` vs `BetterAuthProvider`) |
| `worker/lib/auth.ts` | Better Auth factory (D1, bearer plugin, additionalFields) |
| `worker/middleware/better-auth-provider.ts` | Better Auth session verification |
| `worker/middleware/clerk-auth-provider.ts` | Clerk JWKS JWT verification |
| `frontend/src/app/app.config.ts` | Fetches `/api/clerk-config`, initializes `ClerkService` |
| `frontend/src/app/services/clerk.service.ts` | Wraps Clerk SDK; exposes `isAvailable()` signal |
| `frontend/src/app/services/better-auth.service.ts` | Better Auth session management |
| `frontend/src/app/services/auth-facade.service.ts` | Single `useClerk()`/`useBetterAuth()` signals consumed by all components |
| `frontend/src/app/auth/sign-up/sign-up.component.ts` | Branches on `auth.useClerk()` |
| `frontend/src/app/auth/sign-in/sign-in.component.ts` | Branches on `auth.useClerk()` |
| `docs/auth/clerk-setup.md` | Clerk dashboard setup guide |
| `docs/auth/configuration.md` | Complete environment variable reference |

---

## Related Documentation

- [Configuration Guide](configuration.md) — Full environment variable reference
- [Clerk + Cloudflare Integration](clerk-cloudflare-integration.md) — Production Clerk setup
- [Clerk Dashboard Setup](clerk-setup.md) — Step-by-step Clerk configuration
