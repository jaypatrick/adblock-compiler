## Summary

This PR reverts the tRPC v1 API integration (originally introduced in PR #1444), removing all tRPC-related code, dependencies, documentation, and tests.

### Changes

#### `worker/hono-app.ts`
- Removed tRPC handler mount (`app.all('/api/trpc/*', ...)`)
- Removed tRPC-specific rate-limiting and ZTA access-gate middleware
- Removed `X-API-Version: v1` response header middleware
- Removed import of `handleTrpcRequest` and `rateLimitMiddleware`

#### `worker/trpc/` (all files deleted)
- `client.ts` — typed tRPC client factory
- `context.ts` — tRPC context factory
- `handler.ts` — Hono adapter for tRPC
- `init.ts` — tRPC base instance with `publicProcedure`, `protectedProcedure`, `adminProcedure`
- `router.ts` — top-level versioned tRPC app router
- `routers/v1/compile.router.ts` — `v1.compile.json` mutation
- `routers/v1/health.router.ts` — `v1.health.get` query
- `routers/v1/version.router.ts` — `v1.version.get` query
- `routers/v1/index.ts` — v1 router barrel
- `trpc.test.ts` — unit tests for all v1 procedures

#### `worker/utils/synthetic-request.ts` (deleted)
- Utility used by tRPC compile router to build synthetic POST requests

#### `package.json` + `pnpm-lock.yaml` + `deno.lock`
- Removed `@trpc/client` and `@trpc/server` dependencies
- Cleaned up related lock file entries

#### `deno.json`
- Removed `trpc:types` and `check:trpc` tasks
- Fixed emoji encoding in `check:drift` and `setup` task strings

#### `docs/architecture/trpc.md` (deleted)
- Full tRPC architecture documentation removed

#### `docs/architecture/hono-routing.md`
- Removed tRPC endpoint section