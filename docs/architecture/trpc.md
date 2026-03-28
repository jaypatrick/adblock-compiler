# tRPC API Layer

## Overview

The adblock-compiler Worker exposes a typed tRPC v11 API alongside the existing REST endpoints.
All tRPC procedures are available at `/api/trpc/*`.

## Versioning

Procedures are namespaced by version: `v1.*`. The `v1` namespace is stable.
Breaking changes (removed procedures, changed input shapes) will be introduced under `v2`
without removing `v1`.

## Procedure catalogue

### v1.health.get (query, public)

Returns the same payload as `GET /api/health`.

### v1.compile.json (mutation, authenticated)

Accepts a `CompileRequestSchema` body. Returns the compiled ruleset JSON.

### v1.version.get (query, public)

Returns `{ version, apiVersion }`.

## Angular client

```typescript
import { createTrpcClient } from '@worker/trpc/client.ts';

const client = createTrpcClient(environment.apiBaseUrl, () => authService.getToken());
const result = await client.v1.compile.json.mutate({ urls: ['...'] });
```

## Adding a new procedure

1. Create (or extend) a router file in `worker/trpc/routers/v1/`.
2. Add it to `worker/trpc/routers/v1/index.ts`.
3. No changes to `hono-app.ts` required — the tRPC handler is already mounted.

## Mount point

The tRPC handler is mounted directly on the top-level `app` (not the `routes` sub-app)
so that the `compress` and `logger` middleware scoped to business routes do not wrap
tRPC responses. See [`hono-routing.md`](./hono-routing.md#trpc-endpoint) for details.

```mermaid
flowchart TD
    R[Incoming Request] --> M1[Global middleware\ntiming · metadata · auth · CORS]
    M1 --> TRPC{path starts with\n/api/trpc?}
    TRPC -->|yes| TH[handleTrpcRequest\nfetchRequestHandler]
    TH --> PROC{procedure auth?}
    PROC -->|publicProcedure| HANDLER[Execute handler]
    PROC -->|protectedProcedure| AUTH_CHECK{userId non-null?}
    AUTH_CHECK -->|no| UNAUTH[TRPCError UNAUTHORIZED\n+ security telemetry]
    AUTH_CHECK -->|yes| HANDLER
    PROC -->|adminProcedure| ADMIN_CHECK{role === admin?}
    ADMIN_CHECK -->|no| FORB[TRPCError FORBIDDEN\n+ security telemetry]
    ADMIN_CHECK -->|yes| HANDLER
    HANDLER --> RESP[Response]
    TRPC -->|no| REST[REST routes sub-app]
```

## ZTA notes

- `protectedProcedure` enforces non-anonymous auth (returns `UNAUTHORIZED` if
  `authContext.userId` is null).
- `adminProcedure` additionally enforces `role === 'admin'` (returns `FORBIDDEN`).
- Auth failures emit `AnalyticsService.trackSecurityEvent()` via the `onError` hook
  in `worker/trpc/handler.ts`.
- The global rate-limit middleware runs before all tRPC requests (shared with REST
  endpoints).
- CORS is inherited from the global `cors()` middleware already in place on `app`.
