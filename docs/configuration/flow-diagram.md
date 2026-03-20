# Configuration Load Flow

The diagram below shows how `ConfigurationManager.load()` processes sources
from lowest to highest priority.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ConfigurationManager.load()                      │
│                                                                         │
│   Sources (in constructor order)                                        │
│   ┌─────────────────────────────┐                                       │
│   │  1. FileConfigurationSource │  ← --config path.json                │
│   │     (or ObjectSource, etc.) │                                       │
│   └──────────────┬──────────────┘                                       │
│                  │  Partial<IConfiguration>                             │
│                  ▼                                                       │
│   ┌─────────────────────────────┐                                       │
│   │  2. EnvConfigurationSource  │  ← ADBLOCK_CONFIG_* env vars         │
│   │     (auto-appended unless   │     (skipped if --no-env-overrides)  │
│   │      applyEnvOverrides=false│                                       │
│   └──────────────┬──────────────┘                                       │
│                  │  Partial<IConfiguration>                             │
│                  ▼                                                       │
│   ┌─────────────────────────────┐                                       │
│   │ 3. OverrideConfigurationSrc │  ← --override '{"name":"..."}'       │
│   │    (optional, highest prio) │     (added by CLI / caller)          │
│   └──────────────┬──────────────┘                                       │
│                  │                                                       │
│                  ▼                                                       │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │  ConfigurationManager.deepMerge(partials)                       │  │
│   │  · Scalars: last-defined wins                                   │  │
│   │  · Arrays:  last-defined fully replaces (no append)             │  │
│   │  · undefined values do NOT override defined values              │  │
│   └──────────────────────────────┬──────────────────────────────────┘  │
│                                  │  merged Partial<IConfiguration>      │
│                                  ▼                                       │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │  Limit enforcement                                              │  │
│   │  · sources.length > MAX_SOURCES(100) → truncate                 │  │
│   │  · exclusions.length > MAX_EXCLUSIONS(10 000) → truncate        │  │
│   └──────────────────────────────┬──────────────────────────────────┘  │
│                                  │                                       │
│                                  ▼                                       │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │  ConfigurationSchema.safeParse(merged)                          │  │
│   │  · success → return IConfiguration  ✓                          │  │
│   │  · failure → throw ConfigurationValidationError  ✗              │  │
│   └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Worker API flow

```
Client  →  POST /api/configuration/resolve
               │
               ▼
        verifyTurnstile()
               │
               ▼
        ConfigurationManager.resolveObject(base, override, options)
               │ (same pipeline as above, minus EnvConfigurationSource)
               ▼
        { config: IConfiguration }  →  200 OK
```

---

## Source interface

```ts
interface IConfigurationSource {
    readonly sourceType: string;
    load(): Promise<Partial<IConfiguration>>;
}
```

Any class implementing `IConfigurationSource` can be inserted into the
pipeline, making it straightforward to add Terraform, remote API, or
database-backed sources in the future.
