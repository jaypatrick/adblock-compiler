# Zero Trust Architecture

The adblock-compiler implements Zero Trust Architecture (ZTA) across every layer of the stack — from the Cloudflare edge to the Angular frontend. This document describes the threat model, architecture, and implementation details.

## Core Principle

**Never trust, always verify.** Every request is verified at every layer regardless of origin — including internal service-to-service calls, queue messages, webhook payloads, and admin operations.

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Unauthorized API access | Clerk JWT + API key authentication on all write endpoints |
| Privilege escalation | 4-tier authorization (Anonymous → Free → Pro → Admin) with least-privilege |
| CSRF / cross-origin attacks | CORS origin allowlist on write/authenticated endpoints |
| Bot abuse | Cloudflare Turnstile human verification on compile endpoints |
| Admin impersonation | Dual-layer: X-Admin-Key + Cloudflare Access JWT |
| SQL injection | 100% parameterized D1 queries via `.prepare().bind()` |
| SSRF via proxy | RFC 1918 / localhost / metadata IP blocking on `/proxy/fetch` |
| XSS via API responses | Zod schema validation on all frontend API consumption |
| Credential theft | Clerk SDK for auth state — no tokens in `localStorage` |
| Rate abuse | 5-tier rate limiting keyed by authenticated user or IP |
| Secret leakage | Worker Secrets only; CI lint checks for secrets in `[vars]` |
| **BOLA / IDOR** | **Resource queries scoped to `authContext.userId`; validated by API Shield Vulnerability Scanner** |
| **Client-side script injection / supply-chain compromise** | **CSP enforcement via `contentSecurityPolicyMiddleware()`; violations reported to `POST /api/csp-report` and persisted to D1; Page Shield script-inventory sync generates ABP block/allow rules — see [Page Shield Integration](PAGE_SHIELD_INTEGRATION.md)** |

## Architecture Layers

### Layer 1: Cloudflare Edge

Before the Worker executes, Cloudflare provides:

- **Turnstile**: Human verification on write endpoints (`/compile*`, `/validate`, `/workflow/*`)
- **Cloudflare Access**: JWT verification on `/admin/*` and management routes
- **WAF**: API Shield schema validation and bot score thresholds
- **Rate Limiting**: Edge-level rate limiting before Worker invocation
- **API Shield Vulnerability Scanner**: Stateful BOLA/logic-flaw detection using AI call graphs (beta) — see [API Shield Vulnerability Scanner](API_SHIELD_VULNERABILITY_SCANNER.md)

### Layer 2: Worker Request Handling

Every request entering `worker/worker.ts` follows this flow:

```
Request → CORS preflight check → Authentication → Authorization → Rate Limit → Handler
```

1. **CORS**: `handleCorsPreflight()` for OPTIONS; `getCorsHeaders()` on all responses
2. **Auth**: `authenticateRequestUnified()` produces `IAuthContext` with user, tier, scopes
3. **Auth gate**: `requireAuth(authContext)` blocks anonymous access on protected routes
4. **Rate limit**: `checkRateLimitTiered()` enforces per-tier limits
5. **Security telemetry**: `AnalyticsService.trackSecurityEvent()` on all failures

### Layer 3: Data Validation

All trust boundaries use Zod runtime validation:

| Boundary | Schema |
|----------|--------|
| Clerk webhook payloads | `ClerkWebhookEventSchema` |
| Clerk JWT claims | `ClerkJWTClaimsSchema` |
| API key creation requests | `CreateApiKeyRequestSchema` |
| API key DB rows | `ApiKeyRowSchema` |
| User tier DB rows | `UserTierRowSchema` |

### Layer 4: Data Storage

- **D1 (SQLite)**: All queries use `.prepare().bind()` — never string interpolation
- **KV**: Scoped Worker bindings — no global credentials
- **R2**: User-scoped key prefixes (`clerk_user_id/...`) prevent cross-user access

### Layer 5: Angular Frontend

- **Auth state**: Managed via Clerk Angular SDK — never `localStorage`
- **Route guards**: Functional `CanActivateFn` guards enforce auth requirements
- **HTTP interceptor**: Automatically attaches Bearer token to all authenticated requests
- **Response validation**: Zod schemas validate all API responses before consumption

## CORS Policy

| Endpoint Pattern | Policy | Rationale |
|-----------------|--------|-----------|
| `/api/version`, `/health`, `/metrics`, config endpoints | `*` (public) | Read-only, no auth |
| `/compile*`, `/workflow/*`, `/queue/*` | **Origin allowlist** | Authenticated write |
| `/rules`, `/api-keys` (CRUD) | **Origin allowlist** | Authenticated data |
| `/admin/*` | **Origin allowlist** | Admin-only |

The allowlist is centralized in `worker/utils/cors.ts` and configurable via the `CORS_ALLOWED_ORIGINS` environment variable.

## Auth Tiers

| Tier | Rate Limit | Access |
|------|-----------|--------|
| Anonymous | Lowest | Public read-only endpoints |
| Free | Standard | Compile, validate, basic API |
| Pro | Elevated | All features, higher limits |
| Admin | Highest | Admin endpoints, management |

## Security Telemetry

All security events are emitted to Cloudflare Analytics Engine:

- `auth_failure` — JWT/API key verification failed
- `rate_limit` — Rate limit exceeded
- `turnstile_rejection` — Turnstile human verification failed
- `cors_rejection` — Origin not in allowlist
- `cf_access_denial` — CF Access JWT invalid
- `size_limit` — Request body size exceeded

## CI Enforcement

The `zta-lint.yml` workflow runs on every PR and checks for:

1. Wildcard CORS (`Access-Control-Allow-Origin: *`) outside `cors.ts`
2. Unparameterized D1 queries (string interpolation in `.prepare()`)
3. Secrets in `wrangler.toml [vars]`
4. Auth tokens in `localStorage`

The `api-shield-scan.yml` workflow runs on every PR touching the OpenAPI spec and checks for:

1. `operationId` coverage on all operations (required for scanner call graphs)
2. `security:` annotations on resource endpoints
3. `cloudflare-schema.yaml` drift from `openapi.yaml`
4. Clean spec validation

## Related Documentation

- [ZTA Developer Guide](ZTA_DEVELOPER_GUIDE.md) — practical guide for contributors
- [API Shield Vulnerability Scanner](API_SHIELD_VULNERABILITY_SCANNER.md) — BOLA detection and scanner setup
- [Security Policy](../../SECURITY.md) — vulnerability reporting
- [Auth Configuration](../auth/configuration.md) — Clerk integration setup
