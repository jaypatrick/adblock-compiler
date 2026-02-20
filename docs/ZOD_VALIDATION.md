# Zod Schema Validation

The adblock-compiler uses [Zod](https://zod.dev) for runtime validation of configuration objects and API request bodies. Zod provides type-safe validation with automatic TypeScript type inference and descriptive error messages.

## Overview

Validation is applied at two levels:

1. **Configuration validation** — `ConfigurationValidator` validates `IConfiguration` objects before compilation starts, using the `ConfigurationSchema`.
2. **API request validation** — Worker handlers validate incoming request bodies using `CompileRequestSchema`, `BatchRequestSyncSchema`, and `BatchRequestAsyncSchema`.

All schemas are defined in `src/configuration/schemas.ts`.

## Schemas

### ConfigurationSchema

Validates the top-level compilation configuration:

```typescript
{
    name: string,              // required, non-empty
    description?: string,
    homepage?: string,
    license?: string,
    version?: string,
    sources: SourceSchema[],   // required, non-empty array
    transformations?: TransformationType[],
    exclusions?: string[],
    exclusions_sources?: string[],
    inclusions?: string[],
    inclusions_sources?: string[],
}
```

Strict mode is enabled — unknown properties are rejected.

### SourceSchema

Validates individual source entries within `sources`:

```typescript
{
    source: string,            // required, non-empty
    name?: string,             // non-empty if present
    type?: 'adblock' | 'hosts',
    transformations?: TransformationType[],
    exclusions?: string[],
    exclusions_sources?: string[],
    inclusions?: string[],
    inclusions_sources?: string[],
}
```

### CompileRequestSchema

Validates API `/compile` request bodies:

```typescript
{
    configuration: ConfigurationSchema,
    preFetchedContent?: Record<string, string>,
    benchmark?: boolean,
    priority?: 'standard' | 'high',
    turnstileToken?: string,
}
```

### BatchRequestSchema

Validates batch compilation requests. Enforces unique `id` values across requests.

- **Sync** (`BatchRequestSyncSchema`): Maximum 10 requests.
- **Async** (`BatchRequestAsyncSchema`): Maximum 100 requests.

## Using ConfigurationValidator

The `ConfigurationValidator` class wraps the Zod schema with formatted error output:

```typescript
import { ConfigurationValidator } from '@jk-com/adblock-compiler';

const validator = new ConfigurationValidator();

// Check validity
const result = validator.validate(config);
if (!result.valid) {
    console.error(result.errorsText);
    // /name: name is required and must be a non-empty string
    // /sources: sources is required and must be a non-empty array
}

// Validate and return typed object (throws on failure)
const typedConfig = validator.validateAndGet(config);
```

## Error Messages

Zod validation errors are formatted as `path: message` lines. Examples:

```
/name: name is required and must be a non-empty string
/sources: sources is required and must be a non-empty array
/sources/0/source: source is required and must be a non-empty string
/sources/0/type: type must be one of: adblock, hosts
/unknownField: unknown property: unknownField
```

## Extending Schemas

To add custom validation rules, extend the existing schemas:

```typescript
import { ConfigurationSchema } from '@jk-com/adblock-compiler';
import { z } from 'zod';

const StrictConfigSchema = ConfigurationSchema.refine(
    (data) => data.sources.length <= 50,
    { message: 'Too many sources (max 50)', path: ['sources'] },
);
```

## Related Documentation

- [Troubleshooting](TROUBLESHOOTING.md) — Common issues and solutions
- [Validation Errors](VALIDATION_ERRORS.md) — Rule validation error tracking
- [API Documentation](api/README.md) — REST API reference
