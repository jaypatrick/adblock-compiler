# Admin Neon Reporting Endpoints

> **Audience:** Platform administrators  
> **Auth:** Admin tier + `admin` role (enforced by route-permission catch-all **and** per-handler `checkRoutePermission()`)  
> **Base path:** `/admin/neon`

## Overview

These endpoints expose the Neon platform management API through the worker's
admin interface. They wrap [`NeonApiService`](./neon-api-service.md) to provide
project, branch, endpoint, database, and SQL query capabilities without
requiring direct Neon console access.

All endpoints accept an optional `?projectId=` query parameter to override the
default `NEON_PROJECT_ID` environment variable.

## Environment Variables

| Variable          | Required | Description                                                      |
| ----------------- | -------- | ---------------------------------------------------------------- |
| `NEON_API_KEY`    | Yes      | Neon API key (secret). Set via `wrangler secret put NEON_API_KEY`. |
| `NEON_PROJECT_ID` | No       | Default project ID. Can be overridden per-request via `?projectId=`. |

## Endpoints

### `GET /admin/neon/project`

Retrieve the Neon project overview (name, region, creation time, etc.).

**Query params:**
| Param       | Type   | Default         | Description          |
| ----------- | ------ | --------------- | -------------------- |
| `projectId` | string | `NEON_PROJECT_ID` | Neon project ID    |

**Response:**
```json
{
  "success": true,
  "project": {
    "id": "twilight-river-73901472",
    "name": "my-project",
    "region_id": "aws-us-east-2",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-06-15T12:30:00Z"
  }
}
```

---

### `GET /admin/neon/branches`

List all branches for the project.

**Query params:** same `projectId` override as above.

**Response:**
```json
{
  "success": true,
  "branches": [
    {
      "id": "br-aged-fire-a5gq6r",
      "name": "main",
      "project_id": "twilight-river-73901472",
      "parent_id": null,
      "current_state": "ready",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-06-15T12:30:00Z"
    }
  ]
}
```

---

### `GET /admin/neon/branches/:branchId`

Get details for a single branch.

**Path params:**
| Param      | Type   | Description        |
| ---------- | ------ | ------------------ |
| `branchId` | string | Neon branch ID     |

---

### `POST /admin/neon/branches`

Create a new branch in the project.

**Request body (JSON):**
```json
{
  "name": "feature-experiment",
  "parent_id": "br-aged-fire-a5gq6r"
}
```

All fields are optional. When omitted, Neon uses defaults (auto-generated name,
primary branch as parent).

**Response (201):**
```json
{
  "success": true,
  "branch": { "id": "br-new-123", "name": "feature-experiment", "..." : "..." },
  "operations": [{ "id": "op-1", "status": "running", "..." : "..." }]
}
```

---

### `DELETE /admin/neon/branches/:branchId`

Delete a branch.

**Path params:**
| Param      | Type   | Description        |
| ---------- | ------ | ------------------ |
| `branchId` | string | Neon branch ID     |

**Response:**
```json
{
  "success": true,
  "branch": { "id": "br-aged-fire-a5gq6r", "..." : "..." },
  "operations": []
}
```

---

### `GET /admin/neon/endpoints`

List compute endpoints for the project.

**Response:**
```json
{
  "success": true,
  "endpoints": [
    {
      "id": "ep-cool-river-123",
      "host": "ep-cool-river-123.us-east-2.aws.neon.tech",
      "branch_id": "br-aged-fire-a5gq6r",
      "type": "read_write",
      "current_state": "active",
      "..." : "..."
    }
  ]
}
```

---

### `GET /admin/neon/databases/:branchId`

List databases within a specific branch.

**Path params:**
| Param      | Type   | Description        |
| ---------- | ------ | ------------------ |
| `branchId` | string | Neon branch ID     |

**Response:**
```json
{
  "success": true,
  "databases": [
    { "id": 1, "branch_id": "br-aged-fire-a5gq6r", "name": "neondb", "owner_name": "neondb_owner" }
  ]
}
```

---

### `POST /admin/neon/query`

Execute a SQL query via the Neon serverless driver.

> ⚠️ **Caution:** This endpoint accepts a full `connectionString`. Use with
> care — it grants full database access at the credential level of the
> connection string.

**Request body (JSON):**
```json
{
  "connectionString": "postgres://user:pass@host/db?sslmode=require",
  "sql": "SELECT id, email FROM users LIMIT 10",
  "params": []
}
```

| Field              | Type     | Required | Description                           |
| ------------------ | -------- | -------- | ------------------------------------- |
| `connectionString` | string   | Yes      | Full `postgres://…` URI               |
| `sql`              | string   | Yes      | SQL statement (parameterised via `$1`, `$2`, …) |
| `params`           | unknown[]| No       | Positional parameter values           |

**Response:**
```json
{
  "success": true,
  "rows": [
    { "id": "abc-123", "email": "admin@example.com" }
  ],
  "rowCount": 1
}
```

## Error Responses

All error responses follow the standard envelope:

```json
{ "success": false, "error": "Human-readable message" }
```

| Status | Cause                                |
| ------ | ------------------------------------ |
| 400    | Missing `projectId` or invalid body  |
| 403    | Insufficient permissions             |
| 404    | Project/branch not found (from Neon) |
| 503    | `NEON_API_KEY` not configured        |

## Files

| File                                          | Purpose                                 |
| --------------------------------------------- | --------------------------------------- |
| `worker/handlers/admin-neon.ts`               | Handler functions                       |
| `worker/handlers/admin-neon.test.ts`          | Unit tests                              |
| `worker/schemas.ts`                           | Zod request schemas                     |
| `worker/types.ts`                             | `Env` interface (NEON_API_KEY, NEON_PROJECT_ID) |
| `worker/hono-app.ts`                          | Route declarations                      |
| `worker/utils/route-permissions.ts`           | Permission registry entries             |
| `src/services/neonApiService.ts`              | Underlying service (not modified)       |
