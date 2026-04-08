# Configuration Management

The `ConfigurationManager` provides a single, unified entry-point for loading,
merging, and validating compiler configurations.  It replaces the previous
pattern of manually chaining `ConfigurationLoader`, `ConfigurationValidator`,
and ad-hoc environment variable checks.

## Quick Start

### From a JSON file (CLI)

```ts
import { ConfigurationManager } from '../src/configuration/index.ts';

const cfg = await ConfigurationManager.fromFile('./blocklist.json').load();
console.log(cfg.name); // "My Block List"
```

### From a plain object (programmatic / tests)

```ts
const cfg = await ConfigurationManager.fromObject({
    name: 'Test List',
    sources: [{ source: 'https://example.com/hosts.txt', type: 'hosts' }],
}, { applyEnvOverrides: false }).load();
```

### Multi-layer: file + inline override

```ts
import {
    ConfigurationManager,
    FileConfigurationSource,
    OverrideConfigurationSource,
} from '../src/configuration/index.ts';

const cfg = await ConfigurationManager.fromSources([
    new FileConfigurationSource('./base.json'),
    new OverrideConfigurationSource('{"name":"CI Build"}'),
], { applyEnvOverrides: false }).load();
```

---

## Layered Precedence (lowest → highest)

| # | Layer | Description |
|---|-------|-------------|
| 1 | **Base sources** | Supplied in constructor/factory order |
| 2 | **Env overrides** | `ADBLOCK_CONFIG_*` env vars (opt-out via `applyEnvOverrides: false`) |
| 3 | **Inline override** | `--override '{"name":"..."}'` / `OverrideConfigurationSource` |

Scalar values: **last-defined wins**.
Arrays (`sources`, `transformations`, `exclusions`, …): **last-defined fully replaces** (no append).

---

## CLI Flags

The following flags control configuration management at the CLI level:

| Flag | Type | Description |
|------|------|-------------|
| `--config <path>` | `string` | Path to JSON configuration file |
| `--no-env-overrides` | `boolean` | Disable `ADBLOCK_CONFIG_*` environment variable overrides |
| `--override <json>` | `string` | Inline JSON overlay applied at highest precedence |
| `--dump-config` | `boolean` | Print fully resolved configuration as JSON and exit |

### Examples

```bash
# Compile with a config file; disable env overrides
adblock-compiler --config ./blocklist.json --no-env-overrides

# Override a single field inline
adblock-compiler --config ./base.json --override '{"name":"Nightly Build"}'

# Inspect the effective config without compiling
adblock-compiler --config ./base.json --dump-config
```

---

## API Endpoints

Three new REST endpoints are available on the Worker API:

### `GET /api/configuration/defaults`

Returns system defaults and enforced limits.  No authentication required.

```bash
curl https://your-worker.example.com/api/configuration/defaults
```

```json
{
    "success": true,
    "defaults": {
        "compilation": { "... compilation defaults ..." },
        "validation": { "MAX_SOURCES": 100, "MAX_EXCLUSIONS": 10000, "..." }
    },
    "limits": { "maxSources": 100, "maxExclusions": 10000 },
    "supportedSourceTypes": ["adblock", "hosts"]
}
```

### `POST /api/configuration/validate`

Validates a configuration object against the schema.  Returns field-level
errors when invalid.  Requires Free tier auth + Turnstile token.

```bash
curl -X POST https://your-worker.example.com/api/configuration/validate \
    -H 'Content-Type: application/json' \
    -d '{ "config": { "name": "Test", "sources": [{ "source": "https://example.com/hosts.txt", "type": "hosts" }] }, "turnstileToken": "..." }'
```

On success: `{ "success": true, "valid": true }`

On validation failure: `{ "success": true, "valid": false, "errors": [{ "path": "sources", "message": "Required", "code": "invalid_type" }] }`

### `POST /api/configuration/resolve`

Merges multiple configuration layers and returns the effective configuration.
Requires Free tier auth + Turnstile token.

```bash
curl -X POST https://your-worker.example.com/api/configuration/resolve \
    -H 'Content-Type: application/json' \
    -d '{
        "config": { "name": "Base", "sources": [{ "source": "https://example.com/hosts.txt", "type": "hosts" }] },
        "override": { "name": "Final" },
        "applyEnvOverrides": false,
        "turnstileToken": "..."
    }'
```

`override` is an **object** (not a JSON string) and is applied as the highest-priority layer.
`applyEnvOverrides` defaults to `true`; pass `false` to skip `ADBLOCK_CONFIG_*` env vars.

On success: `{ "success": true, "config": { "name": "Final", "sources": [...], ... } }`

---

## Further Reading

- [Config Builder](./config-builder.md) — browser-based GUI for creating configurations without writing JSON/YAML
- [Schema Reference](./schema-reference.md) — all configuration fields and constraints
- [Environment Overrides](./env-overrides.md) — `ADBLOCK_CONFIG_*` variable reference
- [Config Flow](./flow-diagram.md) — ASCII diagram of the load pipeline
- [Terraform Extensibility](./terraform-extensibility.md) — notes for future IaC integration
