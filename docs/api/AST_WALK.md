# AST Walk

The `/ast/walk` endpoint and its CLI counterpart perform a **deep, structure-aware traversal** of the AGTree abstract syntax tree (AST) built from a filter list. Unlike the shallow `/ast/parse` endpoint — which returns only top-level rule nodes — `/ast/walk` descends into every structurally meaningful sub-node (modifier lists, domain lists, rule bodies, scriptlet parameter lists, preprocessor expression trees, etc.) and returns a flat list of every node visited.

This feature was introduced in [PR #1632](https://github.com/jaypatrick/adblock-compiler/pull/1632) and satisfies the AGTree adapter layer requirements from issue #1131.

---

## HTTP API

### `POST /api/ast/walk`

**Auth required:** Free+  
**Middleware:** `bodySizeMiddleware`, `rateLimitMiddleware`, `turnstileMiddleware`

#### Request Body

Exactly **one** of `rules` or `text` must be provided. Supplying both returns `422`.

```json
{
  "rules": ["||example.org^$third-party", "@@||safe.example.com^"],
  "text": "||example.org^\n! A comment",
  "nodeTypes": ["NetworkRule", "Modifier"],
  "maxDepth": 10,
  "includeContext": true,
  "turnstileToken": "<optional>"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `rules` | `string[]` | One of `rules`/`text` | Array of raw rule strings. Max 5,000 items. Each rule ≤ 4,096 chars. |
| `text` | `string` | One of `rules`/`text` | Full filter list as a single newline-separated string. Max 1 MiB. |
| `nodeTypes` | `string[]` | No | Restrict results to specific AGTree node types (see [Node Types](#node-types)). Max 30. |
| `maxDepth` | `integer` | No | Maximum traversal depth (0–50, inclusive). Default: `50`. Nodes deeper than this are silently skipped. |
| `includeContext` | `boolean` | No | When `true`, each result node includes `key` and `index` context fields. Default: `false`. |
| `turnstileToken` | `string` | No | Optional Cloudflare Turnstile token. |

#### Response — 200 OK

```json
{
  "success": true,
  "nodes": [
    {
      "type": "FilterList",
      "depth": 0,
      "node": { "type": "FilterList", "children": [ ... ] }
    },
    {
      "type": "NetworkRule",
      "depth": 1,
      "key": "children",
      "index": 0,
      "node": { "type": "NetworkRule", "pattern": { ... }, "modifiers": { ... } }
    },
    {
      "type": "Modifier",
      "depth": 3,
      "key": "children",
      "index": 0,
      "node": { "type": "Modifier", "name": { ... }, "value": { ... } }
    }
  ],
  "summary": {
    "FilterList": 1,
    "NetworkRule": 2,
    "Modifier": 3,
    "total": 6
  },
  "duration": "4ms"
}
```

| Field | Type | Description |
|---|---|---|
| `success` | `boolean` | Always `true` on 200. |
| `nodes` | `WalkResultNode[]` | Flat list of every visited node in pre-order. |
| `nodes[].type` | `string` | AGTree node type discriminant (e.g. `NetworkRule`). |
| `nodes[].depth` | `integer` | Traversal depth — `0` is the `FilterList` root, rule children start at `1`. |
| `nodes[].key` | `string\|null` | *(Only when `includeContext: true`)* Property name on parent (e.g. `"children"`, `"modifiers"`). |
| `nodes[].index` | `integer\|null` | *(Only when `includeContext: true`)* Zero-based array index within the parent collection, or `null` for non-array properties. |
| `nodes[].node` | `object` | Full AGTree AST node object. |
| `summary` | `Record<string, number>` | Per-type node counts plus `total`. |
| `duration` | `string` | Server-side processing time (e.g. `"4ms"`). |

#### Error Responses

| Status | Condition |
|---|---|
| `400` | Malformed JSON body. |
| `422` | Validation failure — missing `rules`/`text`, both provided (XOR violation), values out of range, or invalid `nodeTypes` enum value. |
| `500` | Internal server error (walker threw unexpectedly). |

#### Examples

**Walk a list and collect all modifiers:**

```bash
curl -X POST https://bloqr-backend.jk-com.workers.dev/api/ast/walk \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "rules": [
      "||example.org^$third-party,domain=example.net",
      "@@||safe.example.com^$important"
    ],
    "nodeTypes": ["Modifier"]
  }'
```

**Walk with full context, capped at depth 3:**

```bash
curl -X POST https://bloqr-backend.jk-com.workers.dev/api/ast/walk \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "||example.org^\nexample.com##.banner",
    "maxDepth": 3,
    "includeContext": true
  }'
```

---

## CLI

Three flags are added to the CLI in AST Walk mode. When `--ast-walk` is present, the compiler **skips the normal compilation pipeline** and instead parses the input, walks the AST, and outputs a JSON result to stdout.

> **Note:** All log and debug output is redirected to **stderr** in this mode so that the JSON written to stdout is clean and pipeable.

### Flags

| Flag | Type | Description |
|---|---|---|
| `--ast-walk` | boolean | Activate AST walk mode. Reads from `--input <file>` or stdin. Outputs `{ nodes, summary }` JSON to stdout. |
| `--ast-walk-types <type>` | string (repeatable) | Restrict results to specific node types. May be repeated. See [Node Types](#node-types). |
| `--ast-walk-depth <n>` | number | Maximum traversal depth (default: 50). |

### Examples

**Walk all nodes from stdin:**

```bash
echo '||example.org^$domain=foo.com' | deno run ... src/cli/CliApp.deno.ts --ast-walk
```

**Filter to specific node types:**

```bash
echo '||example.org^$domain=foo.com' | deno run ... src/cli/CliApp.deno.ts \
  --ast-walk \
  --ast-walk-types NetworkRule \
  --ast-walk-types Modifier
```

**Read from a file, cap traversal depth:**

```bash
deno run ... src/cli/CliApp.deno.ts \
  --ast-walk \
  --input rules.txt \
  --ast-walk-depth 3
```

**Pipe JSON output to `jq`:**

```bash
cat my-filter-list.txt | deno run ... src/cli/CliApp.deno.ts --ast-walk | jq '.summary'
```

### Output Shape

```json
{
  "nodes": [
    { "type": "FilterList", "depth": 0, "key": null, "index": null, "node": { ... } },
    { "type": "NetworkRule", "depth": 1, "key": "children", "index": 0, "node": { ... } }
  ],
  "summary": {
    "FilterList": 1,
    "NetworkRule": 1,
    "total": 2
  }
}
```

---

## TypeScript / Library API

The walker is exposed via two entry-points in `src/utils/`:

### `walkAGTree(root, visitor)`

The free function. Accepts a single `Node` or an array of nodes.

```typescript
import { walkAGTree } from '../utils/AGTreeParser.ts';

// Generic callback — visits every node in pre-order
walkAGTree(filterList, (node, ctx) => {
    console.log(ctx.depth, node.type);
});

// Halt traversal early by returning false
let firstNetworkRule: Node | undefined;
walkAGTree(filterList, (node) => {
    if (node.type === 'NetworkRule') {
        firstNetworkRule = node;
        return false; // stop
    }
});
```

### `AGTreeParser.walkDeep(root, visitor)`

A convenience static wrapper around `walkAGTree` for discoverability. Identical in behaviour.

```typescript
import { AGTreeParser } from '../utils/AGTreeParser.ts';

// Typed visitor map — only specified handlers are invoked
const excludedDomains: string[] = [];
AGTreeParser.walkDeep(filterList, {
    Domain(d) {
        if (d.exception) excludedDomains.push(d.value);
    },
});

// Catch-all handler for any unspecified node types
AGTreeParser.walkDeep(filterList, {
    Modifier(m) { /* ... */ },
    '*'(node) { /* all other types */ },
});
```

### `WalkContext`

Every visitor callback receives a `WalkContext` as its second argument:

```typescript
export interface WalkContext {
    /** The parent node, or null if this is the root. */
    parent: Node | null;
    /** The property name on the parent holding this node (e.g. 'children', 'body', 'modifiers'). */
    key: string | null;
    /** Zero-based index within the parent array property; null for non-array properties. */
    index: number | null;
    /** Zero-based traversal depth (root node = 0). */
    depth: number;
}
```

### `AGTreeTypedVisitor`

Pass a typed visitor map to invoke handlers only for nodes of specific types:

```typescript
AGTreeParser.walkDeep(filterList, {
    NetworkRule(node, ctx)             { /* ... */ },
    HostRule(node, ctx)                { /* ... */ },
    Modifier(node, ctx)                { /* ... */ },
    Domain(node, ctx)                  { /* ... */ },
    ElementHidingRule(node, ctx)       { /* ... */ },
    ScriptletInjectionRule(node, ctx)  { /* ... */ },
    CommentRule(node, ctx)             { /* ... */ },
    PreProcessorCommentRule(node, ctx) { /* ... */ },
    // ... etc.
    '*'(node, ctx)                     { /* catch-all */ },
});
```

Return `false` from any handler to immediately halt the entire traversal.

---

## Node Types

The following AGTree node type strings are recognised by the `nodeTypes` filter and the `AGTreeTypedVisitor` map:

| Category | Node Types |
|---|---|
| **Root** | `FilterList` |
| **Network rules** | `NetworkRule`, `HostRule`, `ModifierList`, `Modifier`, `HostnameList` |
| **Cosmetic rules** | `ElementHidingRule`, `ElementHidingRuleBody`, `CssInjectionRule`, `CssInjectionRuleBody`, `ScriptletInjectionRule`, `ScriptletInjectionRuleBody`, `HtmlFilteringRule`, `JsInjectionRule`, `DomainList`, `Domain` |
| **Comment rules** | `CommentRule`, `MetadataCommentRule`, `HintCommentRule`, `ConfigCommentRule`, `ConfigNode`, `AgentCommentRule`, `PreProcessorCommentRule`, `EmptyRule` |
| **Structural / low-level** | `Value`, `ParameterList`, `Hint`, `Agent` |
| **Preprocessor expressions** | `Operator`, `Parenthesis`, `Variable` |
| **Other** | `App`, `Method`, `StealthOption`, `InvalidRule` |

---

## Adapter Interfaces (issue #1131)

The walker is part of a broader adapter layer that insulates the codebase from direct `@adguard/agtree` dependency. Four formal TypeScript interfaces are defined in `src/utils/IAGTreeAdapter.ts`:

| Interface | Responsibility | Key Methods |
|---|---|---|
| `IFilterRuleParser` | Parsing | `parse()`, `parseFilterList()`, `detectSyntax()` |
| `IFilterRuleConverter` | Syntax conversion | `convertRuleText()`, `convertFilterListToAdg()` |
| `IFilterRuleGenerator` | Serialization | `serialize()`, `serializeAll()` |
| `IAGTreeWalker` | Deep AST traversal | `walkDeep()` |

`AGTreeParser` is the **sole concrete implementation** of all four interfaces. All internal code must use `AGTreeParser` (or the free functions exported from `src/utils/index.ts`) — never import from `@adguard/agtree` directly.

See [`docs/api/AGTREE_INTEGRATION.md`](AGTREE_INTEGRATION.md) for the full AGTree integration overview.

---

## Further Reading

- [AGTree Integration](AGTREE_INTEGRATION.md) — Overview of the `@adguard/agtree` integration
- [CLI Reference](../usage/CLI.md) — Full CLI flag reference
- [API Reference](../api-reference.md) — All REST API endpoints
- [Zod Validation](ZOD_VALIDATION.md) — How request validation works
