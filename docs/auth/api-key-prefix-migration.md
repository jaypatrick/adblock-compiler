# API Key Prefix Migration: `abc_` → `blq_`

This document describes the rename of the API key prefix from `abc_` to `blq_`
and explains what action (if any) is required for existing key holders.

## Summary

| | Before | After |
|---|---|---|
| **New key prefix** | `abc_` | `blq_` |
| **Legacy prefix accepted?** | — | ✅ Yes (`abc_` keys still work) |
| **Action required for existing keys** | — | None — existing keys continue to work |

---

## Background

The original `abc_` prefix was a placeholder chosen during early development.
`blq_` is the permanent, product-aligned prefix for adblock-compiler API keys.

---

## What Changed

### Runtime behaviour

- **New keys** generated after this change start with `blq_`.
- **Existing keys** that start with `abc_` are **still accepted** for
  authentication. No expiry or invalidation has been applied.

### Code changes

| File | Change |
|---|---|
| `worker/middleware/api-key-utils.ts` | Added `API_KEY_PREFIX = 'blq_'`, `LEGACY_API_KEY_PREFIXES = ['abc_']`, and `isApiKey()` helper |
| `worker/handlers/api-keys.ts` | Imports `API_KEY_PREFIX` from `api-key-utils.ts`; generates keys with `blq_` prefix |
| `worker/middleware/auth.ts` | `isApiKeyToken()` delegates to `isApiKey()`, accepting both `blq_` and `abc_` prefixes |
| `src/configuration/schemas.ts` | CLI `--api-key` regex updated to accept `blq_` or `abc_` prefix (`/^(blq_|abc_).+$/`) |

### Token disambiguation

The authentication middleware uses the following logic:

```typescript
// Accepts blq_ (current) and abc_ (legacy)
function isApiKeyToken(token: string): boolean {
    return isApiKey(token);
}
```

`isApiKey` returns `true` for any token that starts with `blq_` or any prefix
listed in `LEGACY_API_KEY_PREFIXES`.

---

## Migration Guide for API Key Holders

### Do I need to do anything?

**No action is required.** If you already have an `abc_`-prefixed key it will
continue to work without any changes to your code or configuration.

### Should I rotate to a new `blq_`-prefixed key?

Rotating is **recommended but not required**. New keys provide the clearest
signal that you are on the current platform version. To rotate:

1. Sign in to the web UI.
2. Navigate to **Settings → API Keys**.
3. Click **"Create API Key"** and copy the new `blq_`-prefixed key.
4. Update your environment variable / secrets manager with the new key.
5. Revoke the old `abc_`-prefixed key once traffic has fully migrated.

### CLI users

Update the example value in environment variable exports:

```bash
# Old
export ADBLOCK_API_KEY="abc_Xk9mP2nLqR5tV8wZ..."

# New
export ADBLOCK_API_KEY="blq_Xk9mP2nLqR5tV8wZ..."
```

The Zod validation regex is now `/^(blq_|abc_).+$/`, so both formats are
accepted by the CLI as well.

---

## Legacy Prefix Removal Timeline

Legacy `abc_` support will remain indefinitely until a formal deprecation
notice is issued. Any future removal will be preceded by:

1. A deprecation announcement in `CHANGELOG.md`.
2. A warning in the authentication response headers for `abc_`-prefixed keys.
3. A minimum 90-day migration window before removal.

---

## Further Reading

- [API Authentication Guide](api-authentication.md)
- [CLI Authentication](cli-authentication.md)
- [Auth Chain Reference](auth-chain-reference.md)
