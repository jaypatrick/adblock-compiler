---
description: "MANDATORY style and formatting reference for all AI-generated code in this repository. Read this file before writing any TypeScript, Angular, or CSS code.\n\nThis document encodes exactly what `deno lint`, `deno fmt --check`, `deno task check`, and `pnpm --filter adblock-frontend run lint` will enforce during CI. Code that violates these rules WILL fail the CI gate and block the PR."
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

All enabled — violations fail `deno task check`:
- `strict`, `noImplicitAny`, `strictNullChecks`, `noUnusedLocals`, `noUnusedParameters`
- `noImplicitReturns`, `noFallthroughCasesInSwitch`, `strictPropertyInitialization`
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

## File Organization

- One module per directory with `index.ts` barrel
- Tests co-located as `*.test.ts`
- No deep nesting

## Top-10 Recurring CI Failures

1. Trailing whitespace — remove all
2. 2-space or tab indent — use 4 spaces
3. Double quotes in `.ts` files — use single quotes
4. Missing semicolons — every statement ends with `;`
5. Lines > 180 chars — break up long imports, exports, signatures
6. Barrel `index.ts` exports exceeding line width — split across lines so each ≤180 chars
7. Malformed TOML — `wrangler.toml` headers must be `[[lowercase]]`; never `[[UPPERCASE}}` or mixed
8. Unused vars/params — remove or prefix with `_`
9. Untagged TODO — use `// TODO(#N): …`
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