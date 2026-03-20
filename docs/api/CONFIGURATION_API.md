# Configuration API

Three endpoints are available under `/api/configuration/`. They manage compilation configuration defaults, validation, and layer resolution.

---

## GET /api/configuration/defaults

Returns the system defaults and hard limits for all compilations. No authentication required (anonymous tier).

**Request**

```http
GET /api/configuration/defaults
```

**Response**

```json
{
  "success": true,
  "defaults": {
    "compilation": { ... },
    "validation": { ... }
  },
  "limits": {
    "maxSources": 20,
    "maxExclusions": 1000
  },
  "supportedSourceTypes": ["adblock", "hosts"]
}
```

| Status | Meaning |
|--------|---------|
| 200 | Defaults returned successfully |
| 429 | Rate limit exceeded (anonymous tier) |

---

## POST /api/configuration/validate

Validates a configuration object against the Zod `ConfigurationSchema`. Requires a Cloudflare Turnstile token when `TURNSTILE_SECRET_KEY` is configured.

**Request**

```http
POST /api/configuration/validate
Content-Type: application/json

{
  "configuration": {
    "name": "My Filter List",
    "sources": [
      { "source": "https://example.com/filters.txt" }
    ]
  },
  "turnstileToken": "<optional-turnstile-token>"
}
```

**Response — valid config**

```json
{
  "success": true,
  "valid": true,
  "configuration": { ... }
}
```

**Response — invalid config**

```json
{
  "success": false,
  "valid": false,
  "errors": [
    { "path": "sources.0.source", "message": "Invalid URL" }
  ]
}
```

| Status | Meaning |
|--------|---------|
| 200 | Validation complete (check `valid` field) |
| 400 | Malformed request body |
| 403 | Turnstile verification failed |
| 429 | Rate limit exceeded |

---

## POST /api/configuration/resolve

Merges one or more configuration layers and returns the effective `IConfiguration`. Useful for previewing the result of a config + environment overlay before submitting a compile job.

**Request**

```http
POST /api/configuration/resolve
Content-Type: application/json

{
  "config": {
    "name": "Base Config",
    "sources": [
      { "source": "https://example.com/filters.txt" }
    ]
  },
  "override": {
    "transformations": ["Deduplicate", "RemoveEmptyLines"]
  },
  "applyEnvOverrides": true,
  "turnstileToken": "<optional-turnstile-token>"
}
```

**Response**

```json
{
  "success": true,
  "resolved": {
    "name": "Base Config",
    "sources": [...],
    "transformations": ["Deduplicate", "RemoveEmptyLines"],
    ...
  }
}
```

| Status | Meaning |
|--------|---------|
| 200 | Resolved configuration returned |
| 400 | Malformed or invalid configuration |
| 403 | Turnstile verification failed |
| 429 | Rate limit exceeded |

---

## Related Documentation

- [Zod Validation](ZOD_VALIDATION.md) — Runtime schema validation for all inputs
- [OpenAPI Specification](openapi.yaml) — Complete API schema
- [Quick Reference](QUICK_REFERENCE.md) — Common commands at a glance
