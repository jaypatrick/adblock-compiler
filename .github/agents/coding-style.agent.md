---
description: "MANDATORY style and formatting reference for all AI-generated code in this repository. Read this file before writing any TypeScript, Angular, or CSS code.\n\nThis document encodes exact rules derived from the repo's deno.json, ESLint config, and tsconfig files. These rules are CI-enforced — violations will fail the build."
name: coding-style
---

## Tooling

- `src/`, `worker/`: `deno fmt` + `deno lint` (config: `deno.json`); type-check via `deno task check`
- `frontend/`: ESLint (`frontend/eslint.config.mjs`) + TypeScript (`frontend/tsconfig.json`); lint via `pnpm --filter adblock-frontend run lint`
- No Prettier — `deno fmt` is authoritative for `src/`/`worker/`; ESLint for `frontend/`

## Deno Format Rules (source: `deno.json` `"fmt"` block)

- Indent: 4 spaces (no tabs; `"useTabs": false`, `"indentWidth": 4`)
- Line width: 180 chars max (`"lineWidth": 180`) — do not wrap at 80 or 100
- Semicolons: required on every statement (`"semiColons": true`)
- Quotes: single quotes in `.ts` files (`"singleQuote": true`); template literals for interpolation; JSON uses double quotes
- No trailing whitespace on any line
- No extra blank lines at EOF
- Opening brace on same line (K&R); always use braces on `if`/`else`/`for`/`while` bodies — even single-line
- Trailing comma in multi-line object/array literals

## Deno Lint Rules

- `ban-untagged-todo` active: write `// TODO(tag): …` (tag may be `#1234`, a component name, etc.) — bare `// TODO:` fails lint
- `no-explicit-any` excluded (won't lint-fail, but avoid in public API surface)
- `require-await` excluded
- `no-console` excluded

## TypeScript Strict Flags

The following flags are enabled in `deno.json` and will fail `deno task check`:
- `strict`, `noImplicitAny`, `strictNullChecks`, `noUnusedLocals`, `noUnusedParameters`
Recommended additional flags (may be enabled in CI later): `noImplicitReturns`, `noFallthroughCasesInSwitch`, `strictPropertyInitialization`
- Unused vars/params: remove or prefix with `_` (e.g. `_req`); local variables must be removed, not prefixed
- Annotate return types on all exported functions and class methods
- Use `unknown` + Zod/type guards instead of `any` at trust boundaries

## Frontend Extras (Angular)

Additional flags in `frontend/tsconfig.json`:
- `noImplicitOverride`: use `override` keyword on all overriding methods
- `noPropertyAccessFromIndexSignature`: use bracket notation for index-signature types
- `strictInjectionParameters`, `strictInputAccessModifiers`, `strictTemplates`
- No `$any()` casts in templates
- `experimentalDecorators` enabled
- `no-explicit-any`: warn; `no-unused-vars`: warn with `argsIgnorePattern: '^_'`
- Every interactive element needs ARIA or semantic HTML

## Angular Selectors

- Directives: attribute style, camelCase, prefix `app` → `[appMyDirective]`
- Components: element style, kebab-case, prefix `app` → `app-my-component`

## Naming

- Variables/params/functions/methods: camelCase
- Classes/type aliases/enums: PascalCase
- Interfaces: PascalCase; reserve `I`-prefixed PascalCase (e.g. `ICompiler`) for DI/abstraction interfaces only
- Enum members: UPPER_SNAKE_CASE
- Constants: UPPER_SNAKE_CASE
- Zod schemas: PascalCase + `Schema` suffix (e.g. `CompileRequestSchema`)
- Angular: components `PascalCase` + `Component`; services + `Service`; directives + `Directive`; guards camelCase + `Guard`
- Files (`src/`, `worker/`): `kebab-case.ts`; Angular: `kebab-case.component.ts`
- Tests: same name + `.test.ts`

## Conventions (not CI-enforced)

- One module per directory with `index.ts` barrel
- Tests co-located as `*.test.ts`
- No deep nesting
- Imports: external deps first, then internal `@/` aliases; use `@/` path alias for `src/` imports (e.g. `import { Foo } from '@/foo/foo.ts'`); use mapped specifiers from `deno.json` `"imports"` block
- Comments: single-line `// comment` with one space after `//`; inline comments on their own line above the code; `FIXME`/`HACK`/`NOTE` acceptable without tags

## Top-10 Recurring CI Failures

1. Trailing whitespace — remove all
2. 2-space or tab indent — use 4 spaces
3. Double quotes in `.ts` files — use single quotes
4. Missing semicolons — every statement ends with `;`
5. Lines > 180 chars — break up long imports, exports, signatures
6. Barrel `index.ts` exports exceeding line width — split across lines so each ≤180 chars
7. Malformed TOML — `wrangler.toml` headers must be `[[lowercase]]`; never `[[UPPERCASE}}` or mixed
8. Unused vars/params — remove or prefix with `_`
9. Untagged TODO — use `// TODO(tag): …` (tag may be `#1234`, a component name, etc.)
10. Generated artifact drift — if `src/` schemas change, run `deno task schema:generate` and commit

## Preflight

Run `deno task preflight:full` before every commit:

```sh
deno task fmt:check && deno task lint && deno task check \
  && deno task openapi:validate && deno task schema:generate \
  && deno task check:drift && deno task test && deno task check:slow-types
```

`check:slow-types` runs `deno publish --dry-run` (no `--allow-dirty`) — working tree must be clean.

## TOML / Prisma

- `wrangler.toml` section headers: `[[lowercase]]` only — never `[[UPPERCASE}}` or mixed case
- Prisma generator uses `runtime = "cloudflare"` (not `"deno"`)

## JSR Publish Surface

`worker/`, `frontend/`, `prisma/`, `migrations/` must NOT appear in JSR publish output.

## Generated Artifacts

If `src/` schemas or API definitions change, run `deno task schema:generate` and commit the diff in `docs/api/cloudflare-schema.yaml`, `docs/postman/postman-collection.json`, `docs/postman/postman-environment.json`.

## Cloudflare Deployment — HARD RULE ⛔ No Cloudflare Pages

> **Cloudflare Pages is deprecated and must never be used in this project.**
> This applies to every app type: APIs, SPAs, Angular frontends, documentation sites, preview environments — everything.

**Approved targets (use one of):**

| Need | Use |
|---|---|
| Full-stack / API Worker | Cloudflare Worker (`wrangler.toml`, `main` entry) |
| Worker + static frontend | Cloudflare Workers + [Static Assets](https://developers.cloudflare.com/workers/static-assets/) (`assets = { directory = "dist/" }` in `wrangler.toml`) |
| CI/CD deploy pipeline | [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) (Git-connected, replaces Pages CI) |

**Banned:**
- `pages.dev` subdomains
- `wrangler pages` CLI commands
- `@cloudflare/pages-*` packages
- Any `_routes.json` / `_headers` / `_redirects` Pages-only config files
- `[site]` bucket deployments without a Worker entry point

See `.github/agents/cloudflare-deployment.agent.md` for the full rule, `wrangler.toml` reference template, migration guide, and PR checklist.

---

## Python (tools/)

### Toolchain
- **Package manager**: `uv` only — never `pip install` directly; use `uv sync --directory tools` or `uv run --directory tools <cmd>`
- **Linter + formatter**: `ruff` (config in `tools/pyproject.toml`)
- **Type checker**: `ty` (`uv run --directory tools ty check`)
- **Never use**: `black`, `flake8`, `isort`, `mypy`, `pip`, `python -m venv`

### Preflight (run from the **repository root** before every commit touching `tools/`)

> **Working directory:** All commands below must be run from the **repository root** (the directory
> containing `deno.json`). Running from inside `tools/` will cause `--directory tools` to resolve to
> a non-existent nested path and fail.

```sh
# From repo root:
uv run --directory tools ruff check .
uv run --directory tools ruff format --check .
uv run --directory tools ty check auth-healthcheck.py runbooks/
```

### Ruff rules in effect: `E`, `F`, `I`, `UP`, `B`, `RUF`
- Line length: 120 chars (`line-length = 120` in pyproject.toml)
- Quotes: double (`quote-style = "double"`)
- Indent: spaces (`indent-style = "space"`)
- `E501` (line-too-long) is ignored
- All other E/F/I/UP/B/RUF violations are hard CI failures

### Top recurring Python CI failures

1. **F841 — local variable assigned but never used**
   - Most common in marimo cells: a variable is computed but the cell has a bare `return` instead of returning/displaying the value
   - Fix: ensure every computed display object is included in the cell's return value

2. **B018 — useless expression (discarded `mo.md(...)` result)**
   - Calling `mo.md("...")` as a statement expression discards the result — nothing is displayed
   - Fix: assign to a variable and include it in the cell's return (`mo.vstack`, etc.)

3. **I001 — import sorting**
   - Fix: run `uv run --directory tools ruff check --fix .`

4. **UP — use modern Python syntax** (`UP006`, `UP007`, `UP035`, etc.)
   - Use `list[str]` not `List[str]`, `X | None` not `Optional[X]`, `dict[str, int]` not `Dict[str, int]`

5. **F821 — undefined name in annotation (marimo cell parameters)**
   - Marimo cell parameter annotations are evaluated at import time; a parameter name is not in scope when the function signature is parsed, so annotating one parameter with another parameter's type causes F821
   - Example that fails: `def _cell(Path, all_log_files: dict[str, Path])` — `Path` is another parameter, not a module-level name
   - Fix: use an inline comment instead — `all_log_files,  # dict[str, Path]`
   - Add `from __future__ import annotations` at the **top of the file** to defer module-level annotations (class/function return types). This does **not** fix parameter-referencing-parameter annotations — those still need the comment workaround

### Marimo cell rules (MANDATORY)

Every marimo `@app.cell` function MUST follow these rules:

1. **Return every display object** — if you compute `x = mo.md("…")`, you MUST include `x` in the return. Bare `return` in a cell that computed display objects is always a bug.
2. **Never discard `mo.md(...)` results** — do not call `mo.md(...)` as a statement; capture it: `_header = mo.md("…")` then return it.
3. **`_`-prefix = cell-private** — variables NOT returned by the cell use `_` prefix. Variables that ARE returned by the cell (cross-cell outputs) must NOT use `_` prefix.
4. **Cells that purely render (no cross-cell outputs)** should still return the display object: `return (display_obj,)` or just `return display_obj`.
5. **Exception: cells that intentionally return nothing** (e.g. a header separator cell that only has a `mo.stop()` guard) may have a bare `return` only if they compute no display objects at all.

### Marimo cell template

```python
@app.cell(hide_code=True)
def _my_cell(mo):
    # Good — capture and return display objects
    _header = mo.md("## My Section")
    _content = mo.callout(mo.md("Some content"), kind="info")
    return mo.vstack([_header, _content])


@app.cell(hide_code=True)
def _my_cross_cell_output(mo):
    # Good — cross-cell output (no _ prefix on returned variable)
    dropdown = mo.ui.dropdown(options=["a", "b"], value="a")
    return (dropdown,)
```
