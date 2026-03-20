# Environment Variable Overrides

`ConfigurationManager` automatically reads `ADBLOCK_CONFIG_*` environment
variables and merges them as a layer above any file or object source.  This
allows CI/CD pipelines and Docker deployments to override scalar fields without
modifying config files.

> **Note:** Only scalar fields are overridable via environment variables.
> Array fields (`sources`, `transformations`, `exclusions`, …) must be set via
> config files or the `--override` flag.

---

## Variable reference

| Variable | Maps to field | Example value |
|----------|---------------|---------------|
| `ADBLOCK_CONFIG_NAME` | `name` | `"Nightly Block List"` |
| `ADBLOCK_CONFIG_DESCRIPTION` | `description` | `"Auto-built from CI"` |
| `ADBLOCK_CONFIG_HOMEPAGE` | `homepage` | `"https://example.com/lists"` |
| `ADBLOCK_CONFIG_LICENSE` | `license` | `"MIT"` |
| `ADBLOCK_CONFIG_VERSION` | `version` | `"1.2.3"` |

---

## Precedence

Env overrides are applied **after** file/object sources but **before** any
explicit `--override` / `OverrideConfigurationSource`:

```
file / object  →  ADBLOCK_CONFIG_*  →  --override  →  Zod validation
```

---

## Opting out

### CLI

```bash
adblock-compiler --config ./blocklist.json --no-env-overrides
```

### Programmatic

```ts
const mgr = ConfigurationManager.fromFile('./blocklist.json', undefined, {
    applyEnvOverrides: false,
});
```

---

## Docker / CI example

```dockerfile
ENV ADBLOCK_CONFIG_NAME="My Custom List"
ENV ADBLOCK_CONFIG_VERSION="2.0.0"
```

```yaml
# GitHub Actions
env:
  ADBLOCK_CONFIG_NAME: "Nightly CI Build"
  ADBLOCK_CONFIG_VERSION: ${{ github.run_number }}
```
