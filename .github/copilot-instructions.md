Refer to `.github/agents/coding-style.agent.md` for all formatting, linting, and TypeScript style rules.

## ZTA — Mandatory

Privacy tool. Zero Trust at every layer — every handler, middleware, component, transformation. Never trust, always verify. Applies to internal calls, queue messages, webhook payloads, and admin ops.

ZTA by layer:
- Edge: write endpoints (`/compile*`, `/validate`, `/ast/parse`, `/ws/compile`, `/workflow/*`, `/queue/*`) require Turnstile or Clerk JWT/API key; `/admin/*`, `/workflow/*`, `/queue/cancel/*` require CF Access + `verifyCfAccessJwt()`; WAF/API Shield in sync with OpenAPI spec; CORS explicit allowlist only
- Worker: auth chain (`verifyAdminAuth`/Clerk JWT/API key/Turnstile) before any business logic; auth tier (anonymous→free→pro→admin) at handler top; `checkRateLimitTiered` on every public endpoint; secrets (`ADMIN_KEY`, `TURNSTILE_SECRET_KEY`, `CLERK_SECRET_KEY`, `JWT_SECRET`, `CF_ACCESS_AUD`) in Worker Secrets only; SSRF protection on `/proxy/fetch` (block RFC 1918, localhost, `169.254.169.254`)
- Zod: all trust boundaries (webhook payloads, JWT claims, API bodies, DB rows) parsed with Zod; use `ClerkWebhookEventSchema`, `ClerkJWTClaimsSchema`, `CreateApiKeyRequestSchema`, `ApiKeyRowSchema`, `UserTierRowSchema`; `ZodError` → `400 Bad Request`
- Storage: KV/D1/R2 via scoped Worker bindings only; D1 queries use `.prepare().bind()` only; R2 keys prefixed with authenticated `clerk_user_id`
- Angular: Zod-validate all API responses before use; Clerk Angular SDK for auth state; `CanActivateFn` guards on all protected routes; HTTP interceptor attaches JWT Bearer token

ZTA telemetry: every auth failure, rate-limit hit, Turnstile rejection, CF Access denial → `AnalyticsService.trackSecurityEvent()`

ZTA PR checklist (worker/ or frontend/):
- Handler verifies auth before business logic
- CORS origin allowlist enforced (not `*`)
- Secrets via Worker Secret bindings (not `[vars]`)
- All external inputs Zod-validated
- All DB queries parameterized
- Security events emitted on auth failures
- Angular route has functional auth guard

## Security Rules

- No `new Function()` or `eval()` — use safe parsers
- Zod at all trust boundaries
- Trivy in CI for dependency scanning
- CORS: explicit allowlist on all write/authenticated endpoints, never `*`; pre-fetch content server-side in Worker to avoid client-side CORS issues
- ZTA by default — every new handler/middleware/component/service

## Cloudflare SDK — Mandatory

All Cloudflare REST API calls go through `src/services/cloudflareApiService.ts` (wraps `cloudflare@^5.2.0` SDK). Never raw `fetch('https://api.cloudflare.com/...')`. Extend `CloudflareApiService` if a resource is missing.

SDK PR checklist (scripts/ or worker/):
- Uses `CloudflareApiService` / `createCloudflareApiService`, not raw fetch
- New CF resources added as typed methods on `CloudflareApiService`
- Tests use mock clients, not real API calls

## ZTA Don'ts

Worker:
- No handler without auth verification at top
- No `Access-Control-Allow-Origin: *` on write/authenticated endpoints
- No secrets in `wrangler.toml [vars]`
- No unvalidated data across trust boundaries
- No string-interpolated D1 queries
- No skipping ZTA checklist on worker/ or frontend/ PRs

Frontend:
- No JWTs/tokens in `localStorage` or component signals
- No protected routes without `CanActivateFn` guard
- No manual token attachment in component code
- No unvalidated API responses

## Diagrams

All diagrams use Mermaid fenced code blocks (flowchart, sequenceDiagram, erDiagram, classDiagram, stateDiagram-v2, gitGraph, C4Context). Never ASCII art. Applies to all .md files.

## CI

Every Copilot PR must be CI-green before declaring done. Preflight: `deno task preflight:full`. Done = green CI + fmt-clean files + accurate PR description.

## Python Tooling (tools/)

All Python in this repo uses the Astral stack:
- **uv** for package management and virtual environments (`uv sync --directory tools`)
- **ruff** for linting and formatting (`uv run --directory tools ruff check/format`)
- **ty** for type checking (`uv run --directory tools ty check`)
- **marimo** for interactive runbooks

Never use `pip install` directly. Always use `uv sync` or `uv run`.
Never use `black`, `flake8`, `isort`, or `mypy` — ruff and ty replace all of them.

## Monorepo Structure

See `MONOREPO.md` for the full workspace layout, toolchain per package, and instructions for adding new packages.

When adding a new package:
1. TypeScript/Node → add to `pnpm-workspace.yaml`
2. Deno → add to `deno.json` `workspace` array
3. Python → add under `tools/` with uv
4. Always add CI path filters and update `MONOREPO.md`
