# Better Auth — Prisma Adapter (Neon PostgreSQL via Hyperdrive)

> **TL;DR** — Better Auth now uses the Prisma adapter backed by Neon
> PostgreSQL. Hyperdrive sits between Workers and Neon, providing
> connection pooling and edge caching. The D1/Kysely adapter is removed.

---

## Architecture

```
┌──────────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Cloudflare Worker │───▶│  Hyperdrive  │───▶│  Neon Proxy  │───▶│  PostgreSQL  │
│  (Better Auth)   │    │  (pool/edge) │    │  (TCP/WS)    │    │  (database)  │
└──────────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
        │
        ├── createPrismaClient(env.HYPERDRIVE.connectionString)
        ├── prismaAdapter(prisma, { provider: 'postgresql' })
        └── betterAuth({ database: ... })
```

### Request lifecycle

1. Worker receives a request and enters the `fetch` handler.
2. `BetterAuthProvider` (middleware) calls `createAuth(env, baseURL)`.
3. `createAuth` calls `createPrismaClient(env.HYPERDRIVE.connectionString)`.
4. A PrismaClient is instantiated with the `@prisma/adapter-pg` driver
   adapter, connecting to the **local** Hyperdrive proxy socket.
5. The client is passed to `prismaAdapter(prisma, { provider: 'postgresql' })`.
6. Better Auth uses the adapter for all database operations.

## Key files

| File | Purpose |
|------|---------|
| `worker/lib/auth.ts` | Better Auth factory — creates a per-request instance |
| `worker/lib/prisma.ts` | PrismaClient factory — validates connection string, creates adapter |
| `worker/types.ts` | `Env` interface — `HYPERDRIVE: HyperdriveBinding` (required) |
| `worker/middleware/better-auth-provider.ts` | `IAuthProvider` implementation — guards on `env.HYPERDRIVE` |
| `worker/middleware/prisma-middleware.ts` | Hono middleware — stores request-scoped PrismaClient in context |
| `worker/schemas.ts` | Zod schemas for Better Auth session/user responses |
| `prisma/schema.prisma` | Prisma schema — User, Session, Account, Verification models |

## Configuration

### wrangler.toml

```toml
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "800f7e2edc86488ab24e8621982e9ad7"
```

### Local development (`.dev.vars`)

```env
WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://user:password@localhost:5432/adblock_compiler
BETTER_AUTH_SECRET=your-secret-at-least-32-characters-long
```

## Prisma adapter configuration

```typescript
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { createPrismaClient } from './prisma.ts';

const prisma = createPrismaClient(env.HYPERDRIVE.connectionString);

betterAuth({
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    // ...
});
```

### PrismaConfig options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `provider` | `string` | — | Database provider (`'postgresql'`) |
| `usePlural` | `boolean` | `false` | Use plural model names |
| `transaction` | `boolean` | `true` | Wrap multi-step operations in transactions |
| `debugLogs` | `object` | — | Debug logging options |

## Prisma middleware (request-scoped sharing)

The `prismaMiddleware()` creates a single PrismaClient per request and
stores it in the Hono context:

```typescript
import { prismaMiddleware } from './middleware/prisma-middleware.ts';

app.use('/api/*', prismaMiddleware());

app.get('/api/users', async (c) => {
    const prisma = c.get('prisma');
    const users = await prisma.user.findMany();
    return c.json(users);
});
```

This avoids creating multiple PrismaClient instances when both Better
Auth and your route handlers need database access in the same request.

## Env interface changes

The `HYPERDRIVE` binding is now **required** in the `Env` interface:

```typescript
// Before (Phase 1)
HYPERDRIVE?: HyperdriveBinding;

// After (Phase 2)
HYPERDRIVE: HyperdriveBinding;
```

This ensures TypeScript catches missing Hyperdrive configuration at
compile time instead of runtime.

## Response schemas (Zod)

The project provides Zod schemas for Better Auth session responses:

```typescript
import {
    BetterAuthSessionResponseSchema,
    BetterAuthUserSchema,
    type BetterAuthSessionResponse,
    type BetterAuthUser,
} from '../schemas.ts';
```

### Session response shape

```json
{
    "session": {
        "id": "abc123",
        "userId": "user456",
        "token": "...",
        "expiresAt": "2025-01-01T00:00:00Z",
        "createdAt": "2024-12-25T00:00:00Z",
        "updatedAt": "2024-12-25T00:00:00Z"
    },
    "user": {
        "id": "user456",
        "email": "user@example.com",
        "emailVerified": true,
        "tier": "free",
        "role": "user",
        "createdAt": "2024-12-25T00:00:00Z",
        "updatedAt": "2024-12-25T00:00:00Z"
    }
}
```

## Migration from D1/Kysely

| Aspect | Before (D1/Kysely) | After (Prisma/Neon) |
|--------|--------------------|--------------------|
| Database | Cloudflare D1 (SQLite) | Neon PostgreSQL |
| Adapter | Native D1 (`database: env.DB`) | `prismaAdapter(prisma, ...)` |
| Connection | D1 binding (`env.DB`) | Hyperdrive binding (`env.HYPERDRIVE`) |
| Schema | D1 migrations | Prisma schema + migrations |
| Guard check | `if (!env.DB)` | `if (!env.HYPERDRIVE)` |
| Pooling | Built-in D1 | Hyperdrive (edge connection pooling) |

## Troubleshooting

### "Hyperdrive binding not configured"

Ensure `wrangler.toml` has the `[[hyperdrive]]` section and for local
dev, set `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` in
`.dev.vars`.

### "Invalid connection string"

The PrismaClient factory validates the connection string via Zod. It
must start with `postgresql://` or `postgres://`.

### "Prisma Client could not locate the Query Engine"

Run `npx prisma generate` to regenerate the Prisma Client. The
generated client lives at `prisma/generated/client.ts`.
