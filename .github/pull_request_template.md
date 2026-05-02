## Description

<!-- Brief description of what this PR does. Link related issues with "Closes #NNN". -->

## Changes

<!-- List the key changes made in this PR. -->

-

## Affected Packages

<!-- Check all packages modified by this PR -->

- [ ] `src/` — Core compiler library
- [ ] `worker/` — Cloudflare Worker API
- [ ] `frontend/` — Angular 21 SPA
- [ ] `tools/` — Python operational tooling
- [ ] `examples/` — Usage examples
- [ ] `prisma/` — Database schema/migrations
- [ ] Root config — `deno.json`, `pnpm-workspace.yaml`, `MONOREPO.md`, CI workflows

## Testing

<!-- How were these changes tested? -->

- [ ] Unit tests added/updated
- [ ] Manual testing performed
- [ ] CI passes

## Zero Trust Architecture Checklist

> **Required for every PR touching `worker/` or `frontend/`.**
> Check each item that applies. If an item doesn't apply, check it and note "N/A".

### Worker / Backend

- [ ] Every handler verifies auth before executing business logic
- [ ] CORS origin allowlist enforced (not `*`) on write/authenticated endpoints
- [ ] All secrets accessed via Worker Secret bindings (not `[vars]`)
- [ ] All external inputs Zod-validated before use
- [ ] All D1 queries use parameterized `.prepare().bind()` (no string interpolation)
- [ ] Security events emitted to Analytics Engine on auth failures

### Frontend / Angular

- [ ] Protected routes have functional `CanActivateFn` auth guards
- [ ] Auth tokens managed via Clerk SDK (not `localStorage`)
- [ ] HTTP interceptor attaches Bearer token (no manual token passing)
- [ ] API responses validated with Zod schemas before consumption

### API Shield / Vulnerability Scanner

> **Required for every PR touching `docs/api/openapi.yaml`, `worker/routes/`, or resource endpoint handlers.**

- [ ] New/changed endpoints have a unique `operationId` in `openapi.yaml`
- [ ] Resource endpoints (those with `/{id}` path parameters) include a `security:` annotation
- [ ] Resource queries are scoped to the authenticated user (`WHERE user_id = ?`) — not just by ID
- [ ] Missing/unauthorized resources return `404` (not `403`) to avoid leaking resource existence
- [ ] `cloudflare-schema.yaml` regenerated if `openapi.yaml` changed (`deno task schema:cloudflare`)

---

_If this PR does not touch `worker/` or `frontend/`, the ZTA checklist is not required._
_If this PR does not touch `openapi.yaml` or resource handlers, the API Shield checklist is not required._
