# Terraform / IaC Extensibility

The `IConfigurationSource` interface is designed to be extended without
modifying `ConfigurationManager` itself.  This page describes the pattern
for adding remote configuration sources such as Terraform outputs, Vault
secrets, or remote APIs.

---

## Adding a custom source

Implement `IConfigurationSource`:

```ts
import type { IConfigurationSource } from '../src/configuration/sources/index.ts';
import type { IConfiguration } from '../src/types/index.ts';

/**
 * Loads a configuration from a Terraform output JSON file.
 *
 * Usage: terraform output -json > tf-config.json
 */
export class TerraformConfigurationSource implements IConfigurationSource {
    readonly sourceType = 'terraform';

    constructor(private readonly tfOutputPath: string) {}

    async load(): Promise<Partial<IConfiguration>> {
        const raw = JSON.parse(await Deno.readTextFile(this.tfOutputPath));

        // Terraform outputs have the shape: { "key": { "value": ..., "type": ... } }
        return {
            name: raw.list_name?.value,
            version: raw.list_version?.value,
            sources: raw.sources?.value,
        };
    }
}
```

Then wire it into the manager:

```ts
import { ConfigurationManager, FileConfigurationSource } from '../src/configuration/index.ts';

const cfg = await ConfigurationManager.fromSources([
    new TerraformConfigurationSource('./tf-config.json'),
    new FileConfigurationSource('./override.json'),
]).load();
```

---

## Precedence note

Custom sources follow the same merge order as built-in sources.  Place
higher-priority sources later in the array passed to `fromSources()`.

---

## Remote / async sources

Because `load()` is `async`, sources can fetch from remote APIs:

```ts
export class RemoteConfigSource implements IConfigurationSource {
    readonly sourceType = 'remote';

    constructor(private readonly url: string, private readonly token: string) {}

    async load(): Promise<Partial<IConfiguration>> {
        const res = await fetch(this.url, {
            headers: { Authorization: `Bearer ${this.token}` },
        });
        if (!res.ok) throw new Error(`Remote config fetch failed: ${res.status}`);
        return res.json();
    }
}
```
