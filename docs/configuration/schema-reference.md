# Schema Reference

This page documents every field recognised by `ConfigurationSchema`.  The schema
is defined in `src/configuration/schemas.ts` and validated via Zod at runtime.

---

## Top-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` (min 1) | **Yes** | Human-readable filter list name |
| `description` | `string` | No | Description of the list's purpose |
| `homepage` | `string (url)` | No | Homepage URL for the list |
| `license` | `string` | No | SPDX license identifier (e.g. `GPL-3.0`, `MIT`) |
| `version` | `string` | No | Semver version string (e.g. `1.0.0`) |
| `sources` | `Source[]` | **Yes** | Non-empty array of input source definitions |
| `transformations` | `TransformationType[]` | No | Ordered list of transformation steps |
| `exclusions` | `string[]` | No | Rules to exclude from the compiled output |
| `exclusions_sources` | `string[]` | No | File paths / URLs containing exclusion rules |
| `inclusions` | `string[]` | No | Rules to always include regardless of exclusions |
| `inclusions_sources` | `string[]` | No | File paths / URLs containing inclusion rules |

---

## Source object

Each entry in `sources` must be an object:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | `string` | **Yes** | URL or file path of the input rule list |
| `type` | `"hosts"` \| `"adblock"` | No | Format of the source (optional; defaults inferred at compile time) |
| `name` | `string` | No | Display name for this source |
| `homepage` | `string (url)` | No | Homepage URL for this source |

---

## TransformationType enum

| Value | Description |
|-------|-------------|
| `RemoveComments` | Strip comment lines |
| `Compress` | Remove redundant rules subsumed by wider rules |
| `RemoveModifiers` | Strip cosmetic / option modifiers from rules |
| `Validate` | Drop rules failing format validation |
| `ValidateAllowIp` | Validate rules, allowing IP addresses |
| `Deduplicate` | Remove duplicate rules |
| `InvertAllow` | Invert allowlist rules to blocklist rules |
| `RemoveEmptyLines` | Remove empty lines |
| `TrimLines` | Trim whitespace from each rule line |
| `InsertFinalNewLine` | Ensure file ends with a newline |
| `ConvertToAscii` | Convert non-ASCII domain names to Punycode (ASCII) |
| `ConflictDetection` | Report conflicting allow/block rules |
| `RuleOptimizer` | Merge and simplify rules for smaller output |

> **Note:** Combine transformations as an ordered array; each step is applied in sequence.

---

## System limits

These limits are enforced by `ConfigurationManager` regardless of schema validity:

| Limit | Default | Config key |
|-------|---------|------------|
| Maximum sources | `100` | `VALIDATION_DEFAULTS.MAX_SOURCES` |
| Maximum exclusion rules | `10,000` | `VALIDATION_DEFAULTS.MAX_EXCLUSIONS` |

Arrays exceeding these limits are silently truncated before Zod validation.
Set `enforceSourceLimit: false` / `enforceExclusionLimit: false` in manager
options to opt out (not recommended for production).
