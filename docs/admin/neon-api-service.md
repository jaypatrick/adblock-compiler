# NeonApiService

Typed wrapper around the [Neon REST API v2](https://api-docs.neon.tech/reference/getting-started) for admin reporting, monitoring, and branch management.

## Architecture

```mermaid
flowchart LR
    A["Admin Dashboard"] --> B["NeonApiService"]
    B -->|REST API v2| C["Neon Console API"]
    B -->|Serverless Driver| D["Neon PostgreSQL"]
    C --> E["Projects / Branches / Endpoints"]
    D --> F["SQL Query Results"]

    style A fill:#4f46e5,color:#fff
    style B fill:#0ea5e9,color:#fff
    style C fill:#10b981,color:#fff
    style D fill:#10b981,color:#fff
```

## Configuration

The service is created via a factory function that validates configuration with Zod:

```typescript
import { createNeonApiService } from '@/services/neonApiService.ts';

const neon = createNeonApiService({
  apiKey: env.NEON_API_KEY,       // Required — Neon API key
  baseUrl: 'https://...',         // Optional — defaults to https://console.neon.tech/api/v2
});
```

| Parameter | Type     | Required | Default                                  | Description              |
|-----------|----------|----------|------------------------------------------|--------------------------|
| `apiKey`  | `string` | ✅       | —                                        | Neon API key             |
| `baseUrl` | `string` | ❌       | `https://console.neon.tech/api/v2`       | Neon REST API base URL   |

An optional `IBasicLogger` can be passed as the second argument to enable request logging:

```typescript
const neon = createNeonApiService({ apiKey }, consoleLogger);
```

## API Reference

### `getProject(projectId: string): Promise<NeonProject>`

Fetch details of a single Neon project.

```typescript
const project = await neon.getProject('twilight-river-73901472');
// → { id, name, region_id, created_at, updated_at, pg_version? }
```

### `listBranches(projectId: string): Promise<NeonBranch[]>`

List all branches for a project.

```typescript
const branches = await neon.listBranches('twilight-river-73901472');
```

### `getBranch(projectId: string, branchId: string): Promise<NeonBranch>`

Get details of a specific branch.

```typescript
const branch = await neon.getBranch('twilight-river-73901472', 'br-cool-night-abc123');
// → { id, name, project_id, parent_id, current_state, created_at, updated_at }
```

### `createBranch(projectId: string, opts?: CreateBranchOptions): Promise<{ branch, operations }>`

Create a new branch. Optionally specify a name and parent branch.

```typescript
const result = await neon.createBranch('twilight-river-73901472', {
  name: 'feature/admin-dashboard',
  parent_id: 'br-cool-night-abc123',
});
console.log(result.branch.id);           // new branch ID
console.log(result.operations[0].status); // 'finished' | 'running'
```

### `deleteBranch(projectId: string, branchId: string): Promise<{ branch, operations }>`

Delete a branch. Returns the deleted branch metadata and any triggered operations.

```typescript
const result = await neon.deleteBranch('twilight-river-73901472', 'br-old-branch');
```

### `listEndpoints(projectId: string): Promise<NeonEndpoint[]>`

List compute endpoints for a project.

```typescript
const endpoints = await neon.listEndpoints('twilight-river-73901472');
// → [{ id, host, branch_id, type: 'read_write' | 'read_only', current_state, ... }]
```

### `listDatabases(projectId: string, branchId: string): Promise<NeonDatabase[]>`

List databases within a specific branch.

```typescript
const dbs = await neon.listDatabases('twilight-river-73901472', 'br-cool-night-abc123');
// → [{ id, name: 'neondb', branch_id, owner_name, ... }]
```

### `getConnectionUri(projectId: string, branchId: string, opts?): Promise<string>`

Retrieve a connection URI for a branch. Useful for generating one-off connection strings.

```typescript
const uri = await neon.getConnectionUri('twilight-river-73901472', 'br-cool-night-abc123', {
  database_name: 'neondb',
  role_name: 'neondb_owner',
});
// → 'postgres://neondb_owner:***@ep-winter-term-a8rxh2a9.eastus2.azure.neon.tech/neondb'
```

### `querySQL<T>(connectionString: string, sql: string, params?): Promise<T[]>`

Execute a SQL query via the `@neondatabase/serverless` driver. Accepts a full `postgres://` connection string.

```typescript
const rows = await neon.querySQL<{ count: number }>(
  'postgres://user:pass@host/db',
  'SELECT COUNT(*) as count FROM users WHERE created_at > $1',
  ['2025-01-01'],
);
console.log(rows[0].count);
```

## Error Handling

All REST API errors throw a `NeonApiError` with:

| Property  | Type      | Description                                |
|-----------|-----------|--------------------------------------------|
| `message` | `string`  | Human-readable description                 |
| `status`  | `number`  | HTTP status code (e.g. `404`, `403`, `500`) |
| `body`    | `unknown` | Parsed JSON body from Neon (if available)  |

```typescript
import { NeonApiError } from '@/services/neonApiService.ts';

try {
  await neon.getProject('nonexistent');
} catch (err) {
  if (err instanceof NeonApiError) {
    console.error(`Neon API error ${err.status}:`, err.body);
  }
}
```

## Zod Schemas

All API responses are validated at runtime using Zod schemas:

| Schema                     | Validates           |
|----------------------------|---------------------|
| `NeonApiServiceConfigSchema` | Service config    |
| `NeonProjectSchema`        | Project objects     |
| `NeonBranchSchema`         | Branch objects      |
| `NeonEndpointSchema`       | Endpoint objects    |
| `NeonDatabaseSchema`       | Database objects    |
| `NeonOperationSchema`      | Operation objects   |
| `NeonConnectionUriSchema`  | Connection URI      |

## Sequence: Admin Branch Management

```mermaid
sequenceDiagram
    participant Admin as Admin Dashboard
    participant Svc as NeonApiService
    participant API as Neon REST API
    participant PG as Neon PostgreSQL

    Admin->>Svc: createBranch(projectId, { name })
    Svc->>API: POST /projects/{id}/branches
    API-->>Svc: { branch, operations }
    Svc-->>Admin: Parsed result

    Admin->>Svc: getConnectionUri(projectId, branchId)
    Svc->>API: GET /projects/{id}/connection_uri
    API-->>Svc: { uri }
    Svc-->>Admin: Connection string

    Admin->>Svc: querySQL(uri, "SELECT ...")
    Svc->>PG: @neondatabase/serverless
    PG-->>Svc: Row[]
    Svc-->>Admin: Typed results
```

## Related

- [Neon API Reference](https://api-docs.neon.tech/reference/getting-started)
- [`@neondatabase/serverless` docs](https://neon.tech/docs/serverless/serverless-driver)
- [`src/services/cloudflareApiService.ts`](../../src/services/cloudflareApiService.ts) — similar service pattern
