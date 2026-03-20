## Overview

Implement a full authentication, authorization, and user registration system for adblock-compiler. Based on architectural review of the existing stack (Cloudflare Workers, Angular SSR, D1, KV, R2, Hyperdrive → PlanetScale, Durable Objects, Queues, Workflows, Turnstile), the recommended approach is **Clerk** for user auth/registration + **Cloudflare Access** for admin protection.

> **Do not wait for the PlanetScale backend to be fully built out.** Auth is JWT-based and completely database-agnostic. The D1/PlanetScale backend only stores a `clerk_user_id` FK — the auth flow itself never touches your database.

---

## Technology Decisions

| Layer | Technology | Rationale |
|---|---|---|
| **User auth + registration** | [Clerk](https://clerk.com) | Edge-native JWT, `@clerk/angular` SDK, managed user DB, social OAuth, passwordless, passkeys |
| **Admin access** | [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/) | Zero-code network-layer protection for `/admin` routes, integrates with Google/GitHub/Okta |
| **Bot protection** | Cloudflare Turnstile | Already deployed — covers unauthenticated endpoints |
| **Authorization (roles)** | Clerk custom JWT claims + D1 roles table | Simple FK relationship |
| **API key auth** | Custom — KV + D1 | Hash & store API keys in KV, associate with `clerk_user_id` |

### Why Clerk over Auth0 / WorkOS?
- **Edge-native**: JWT verification uses `crypto.subtle` — no Node.js shim, no roundtrip, works natively in Cloudflare Workers
- **Angular SDK**: `@clerk/angular` ships drop-in `<SignIn>`, `<UserButton>` components and `AuthGuard` for Angular Router
- **No registration system to build**: Clerk handles sign-up, email verification, password reset, social OAuth, magic links, and passkeys out of the box
- **Generous free tier**: 10,000 MAU free
- **Database-agnostic**: Works today with D1, works tomorrow with PlanetScale — zero auth changes required when the DB is swapped

---

## Architecture

```mermaid
flowchart TD
    Frontend["Angular Frontend<br/>(Cloudflare Workers SSR)<br/>@clerk/angular — SignIn / UserButton / AuthGuard"]
    Worker["Cloudflare Worker (worker/worker.ts)<br/>· Verify Clerk JWT via JWKS (crypto.subtle)<br/>· Extract userId, roles from JWT claims<br/>· Gate /compile, /lists, /admin/* routes"]
    D1KV["D1 / KV<br/>(user-linked data)"]
    R2["R2 / PlanetScale<br/>(filter list storage)"]

    Frontend -->|Bearer JWT (Clerk token)| Worker
    Worker --> D1KV
    Worker --> R2
```

---

## User Tiers

| Tier | Registration | What they get |
|---|---|---|
| **Anonymous** | None | Compile up to N lists/hour (rate-limited by Turnstile + IP via `RATE_LIMIT` KV) |
| **Free registered** | Clerk sign-up | Higher rate limits, saved lists in R2, API key access |
| **Pro** | Clerk sign-up + payment (Stripe — future) | Priority queue, batch async jobs, higher storage quota |
| **Admin** | Cloudflare Access | Full dashboard, metrics, user management |

---

## Implementation Tasks

### Phase 1 — Clerk Setup & JWT Middleware
- [ ] Create a Clerk application at [clerk.com](https://clerk.com) and configure allowed origins for the Cloudflare Workers domain
- [ ] Add `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` as Cloudflare secrets (`wrangler secret put`)
- [ ] Add JWT verification middleware to `worker/worker.ts` using Clerk's JWKS endpoint + `crypto.subtle` (no external deps required):
  ```typescript
  import { createRemoteJWKSet, jwtVerify } from 'jose';
  const JWKS = createRemoteJWKSet(new URL('https://<clerk-domain>/.well-known/jwks.json'));
  async function verifyAuth(request: Request): Promise<string | null> {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, JWKS);
      return payload.sub as string; // clerk_user_id
    } catch { return null; }
  }
  ```
- [ ] Gate the following routes with auth middleware: `POST /compile`, `GET/POST/DELETE /lists/*`, `GET /admin/*`
- [ ] Return `401 Unauthorized` for unauthenticated requests to protected routes
- [ ] Return `403 Forbidden` when a valid user lacks the required role/tier

### Phase 2 — User Registration & Post-Registration Provisioning
- [ ] Install `@clerk/angular` in the Angular frontend: `npm install @clerk/angular`
- [ ] Add `ClerkModule` to `AppModule` (or provide via `provideClerk()` for standalone components)
- [ ] Add `<clerk-sign-in>` and `<clerk-sign-up>` components to auth routes (`/sign-in`, `/sign-up`)
- [ ] Add `<clerk-user-button>` to the app nav bar
- [ ] Add `ClerkAuthGuard` to Angular Router for protected routes (`/compiler`, `/lists`, `/admin`)
- [ ] Create a Clerk webhook endpoint in `worker/worker.ts` at `POST /webhooks/clerk`: 
  - Verify the `svix-signature` header using the Clerk webhook signing secret
  - On `user.created` event: `INSERT INTO users (clerk_user_id, email, tier, created_at) VALUES (?, ?, 'free', ?)`
  - On `user.deleted` event: soft-delete or anonymize the user record
- [ ] Create the `users` table migration for D1 (and eventually PlanetScale):
  ```sql
  CREATE TABLE users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    clerk_user_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'free', -- 'free' | 'pro' | 'admin'
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_users_clerk_user_id ON users(clerk_user_id);
  ```

### Phase 3 — Anonymous → Registered Flow
- [ ] On anonymous compilation, store a session token in `RATE_LIMIT` KV keyed by a browser fingerprint / `cf-ray` ID
- [ ] On `user.created` webhook, check if the session token exists in KV and associate any pre-registration compiled lists with the new `clerk_user_id`
- [ ] Display a "Save your work — sign up free" prompt in the Angular UI after anonymous compilations

### Phase 4 — API Key Support (for programmatic access)
- [ ] Add `POST /api-keys` endpoint (auth required): generate a random key, hash it with SHA-256, store in D1 with `clerk_user_id` FK
- [ ] Add API key verification path in `worker/worker.ts`: check `X-API-Key` header, look up hash in D1, extract associated `clerk_user_id`
- [ ] Add `GET /api-keys` and `DELETE /api-keys/:id` endpoints
- [ ] Surface API key management in the Angular admin/profile UI

### Phase 5 — Cloudflare Access for Admin
- [ ] Configure a Cloudflare Access application protecting `https://<domain>/admin*`
- [ ] Set allowed identity providers (Google Workspace / GitHub org membership)
- [ ] Document setup in `docs/deployment/cloudflare-access.md`

### Phase 6 — Documentation
- [ ] Add `docs/auth/README.md` — architecture overview, decision rationale
- [ ] Add `docs/auth/clerk-setup.md` — step-by-step Clerk configuration
- [ ] Add `docs/auth/api-keys.md` — how programmatic API key auth works
- [ ] Add `docs/auth/cloudflare-access.md` — admin access setup
- [ ] Update `docs/reference/ENV_CONFIGURATION.md` with new secrets: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET`

---

## Files to Create / Modify

| File | Change |
|---|---|
| `worker/worker.ts` | Add JWT middleware, webhook handler, API key routes |
| `worker/middleware/auth.ts` | New — extract JWT verification into reusable middleware |
| `worker/routes/webhooks.ts` | New — Clerk webhook handler |
| `worker/routes/api-keys.ts` | New — API key CRUD |
| `frontend/src/app/app.module.ts` | Add `ClerkModule` |
| `frontend/src/app/app.routes.ts` | Add `ClerkAuthGuard` to protected routes |
| `frontend/src/app/auth/` | New — sign-in, sign-up, user-button components |
| `wrangler.toml` | Add `CLERK_SECRET_KEY` secret reference |
| `prisma/schema.prisma` | Add `User` model (ties into #610) |
| `docs/auth/` | New auth documentation directory |

---

## Dependencies (do not wait on)
- ✅ **Does NOT require PlanetScale to be complete** — D1 is sufficient for Phase 1 & 2. Migrate to PlanetScale by updating the Prisma connection string only.
- 🔗 **Related to** #609 (PlanetScale + Hyperdrive) — the `users` table will eventually live there
- 🔗 **Related to** #610 (Prisma Schema) — add `User` model to the schema
- 🔗 **Related to** #587 (Database Architecture) — auth user data fits within the existing data layer plan

---

## Acceptance Criteria
- [ ] Unauthenticated requests to `/compile`, `/lists/*`, and `/admin/*` return `401`
- [ ] Authenticated requests with a valid Clerk JWT succeed and have the correct user context
- [ ] A new user signing up via the Angular UI triggers the `user.created` webhook and creates a `users` row in D1
- [ ] Anonymous compilations can be associated with a newly registered user
- [ ] API keys can be generated, listed, and revoked via the API and Angular UI
- [ ] `/admin/*` routes are protected by both Clerk auth (code) and Cloudflare Access (network layer)
- [ ] All new secrets are documented and loaded via `wrangler secret put`, never committed to the repo
- [ ] Documentation covers setup from scratch for a new contributor