# Edge Cache Architecture

> How the adblock-compiler project uses a multi-tier storage hierarchy to
> serve compiled filter lists at the edge with low latency and strong
> consistency.

## Overview

The storage architecture is organised in **four tiers** (L0–L3). Each tier
trades off latency, capacity, and durability differently. By layering them
together we can serve the vast majority of reads from edge caches while
keeping a durable, strongly consistent source of truth in PostgreSQL.

| Tier | Technology | Role | Latency | Capacity |
|------|-----------|------|---------|----------|
| **L0** | Cloudflare KV | Edge key-value cache | &lt; 1 ms | 25 MiB / value |
| **L1** | Cloudflare D1 (SQLite) | Edge relational read-replica | ~ 1 ms | 10 GB |
| **L2** | Hyperdrive → Neon PostgreSQL | Source of truth | ~ 10–50 ms | Unlimited |
| **L3** | Cloudflare R2 | Blob / artifact storage | ~ 10 ms | 10 TiB+ |

## Data Flow

### Write Path (Write-Through)

When a new compilation or record is created the write follows this path:

```mermaid
flowchart LR
    A[Write Request] --> B[Neon PostgreSQL — L2]
    B --> C{Write-Through Sync}
    C --> D[D1 Edge Replica — L1]
    D --> E[KV Edge Cache — L0]
    C -.->|Large blobs| F[R2 Object Store — L3]
```

1. The **write request** is always applied to **Neon (L2)** first — it is the
   single source of truth.
2. On success the **D1 cache sync** utility (`d1-cache-sync.ts`) performs a
   write-through upsert to **D1 (L1)**.
3. The KV layer (**L0**) is populated either eagerly or on the next read.
4. Large compiled artefacts (full filter lists) are stored in **R2 (L3)**.

### Read Path (Cache-Miss Waterfall)

Reads cascade through the tiers until a fresh value is found:

```mermaid
sequenceDiagram
    participant Client
    participant KV as KV (L0)
    participant D1 as D1 (L1)
    participant Neon as Neon (L2)

    Client->>KV: GET key
    alt KV hit & fresh
        KV-->>Client: Return cached value
    else KV miss or stale
        Client->>D1: SELECT … WHERE id = ?
        alt D1 hit & fresh
            D1-->>Client: Return row
            Client->>KV: PUT (populate L0)
        else D1 miss or stale
            Client->>Neon: SELECT … WHERE id = ?
            Neon-->>Client: Return row
            Client->>D1: UPSERT (populate L1)
            Client->>KV: PUT (populate L0)
        end
    end
```

## Cache Sync Configuration

The `D1CacheSyncConfigSchema` (defined in `src/storage/d1-cache-sync.ts`)
controls how records are synchronised from Neon to D1:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `syncTables` | `SyncTable[]` | `['filterCache', 'compilationMetadata', 'user']` | Prisma model names to sync. |
| `maxAge` | `number` (seconds) | `300` (5 min) | Maximum age before a D1 record is considered stale. |
| `strategy` | `'write-through' \| 'lazy'` | `'write-through'` | When syncing happens relative to writes. |

### Strategy: Write-Through

With **write-through** (the default), every successful write to Neon is
immediately followed by an upsert to D1.  This keeps the edge replica warm
and avoids cold-read latency for subsequent requests.

**Pros:** Consistently low read latency; readers never trigger a sync.
**Cons:** Slightly higher write latency; unnecessary syncs if the data is
rarely read.

### Strategy: Lazy

With **lazy** sync, D1 is only populated when a read observes a cache miss
or a stale record (checked via `isCacheStale()`).  The read then fetches
from Neon and writes-through to D1 before returning.

**Pros:** No wasted syncs for infrequently accessed data.
**Cons:** First read after expiry pays the full Neon round-trip cost.

## Cache Invalidation

Invalidation follows two complementary strategies:

### TTL-Based Expiry

Each cached record carries a **maxAge** (default 300 s).  The helper
`isCacheStale(table, id, d1Prisma, maxAge)` compares `updatedAt` (or
`createdAt`) against `Date.now()` and returns `true` when the record has
expired.

### Explicit Invalidation

When a record is deleted or materially changed in Neon, the writer calls
`invalidateRecord(table, id, d1Prisma)` which removes the D1 row.  The
next read will refill it from the source of truth.

KV entries are invalidated by setting a short TTL or by issuing an explicit
`KV.delete(key)` after the D1 invalidation completes.

```mermaid
flowchart TD
    A[Record updated in Neon] --> B{Invalidation type}
    B -->|TTL expiry| C[isCacheStale returns true on next read]
    B -->|Explicit| D[invalidateRecord removes D1 row]
    C --> E[Read-through refill from Neon]
    D --> E
    E --> F[D1 repopulated]
    F --> G[KV repopulated]
```

## Sync Utilities API

All functions live in `src/storage/d1-cache-sync.ts`.

| Function | Purpose |
|----------|---------|
| `syncRecord(table, id, data, d1Prisma, logger?)` | Upsert a single record to D1. |
| `invalidateRecord(table, id, d1Prisma, logger?)` | Delete a record from D1 (idempotent). |
| `isCacheStale(table, id, d1Prisma, maxAge, logger?)` | Check if a cached record is expired. |
| `syncBatch(table, records, d1Prisma, logger?)` | Batch upsert using a Prisma transaction, with individual-upsert fallback. |

All functions accept an optional logger that conforms to the
`ICacheSyncLogger` interface (methods: `debug`, `info`, `warn`, `error` —
all optional).

## Error Handling Philosophy

Cache operations are **never fatal**.  A failed D1 write or read simply
means the next request will fall through to Neon.  This ensures edge
availability is not gated on the health of the D1 replica:

- `syncRecord` / `syncBatch` return a result object with `success: false` and an `error` string.
- `invalidateRecord` treats a missing record as success (idempotent delete).
- `isCacheStale` returns `true` on any error — safe fallback to L2.

## File Map

| File | Description |
|------|-------------|
| `src/storage/d1-cache-sync.ts` | Core sync utilities |
| `src/storage/d1-cache-sync.test.ts` | Deno tests with mock Prisma clients |
| `src/storage/D1StorageAdapter.ts` | Full D1 storage adapter (Prisma + raw D1) |
| `src/storage/HyperdriveStorageAdapter.ts` | Neon PostgreSQL adapter via Hyperdrive |
| `worker/lib/prisma-d1.ts` | Factory for D1-backed Prisma client |
| `prisma/schema.d1.prisma` | D1 Prisma schema (SQLite) |
| `prisma/schema.prisma` | Neon Prisma schema (PostgreSQL) |
