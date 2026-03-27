---
description: "MANDATORY style and formatting reference for all AI-generated code in this repository. Read this file before writing any TypeScript, Angular, or CSS code.\n\nThis document encodes exactly what `deno lint`, `deno fmt --check`, `deno task check`, and `pnpm --filter adblock-frontend run lint` will enforce during CI. Code that violates these rules WILL fail the CI gate and block the PR."
name: coding-style
---

# Coding Style & Formatting Reference

> **This document is mandatory reading for every AI agent before writing any code in this repository.**
> Every rule here maps directly to a CI check that blocks PR merges. Violating these rules costs a full CI cycle to fix — write it correctly the first time.

---

## 1. Tooling Overview

| Area | Formatter / Linter | Config Source | CI Command |
|---|---|---|---|
| `src/`, `worker/` | `deno fmt` + `deno lint` | `deno.json` `fmt` + `lint` blocks | `deno fmt --check` / `deno lint` |
| `src/`, `worker/` | `deno check` (type check) | `deno.json` `compilerOptions` + `tsconfig.json` | `deno task check` |
| `frontend/` | ESLint (Angular) | `frontend/eslint.config.mjs` | `pnpm --filter adblock-frontend run lint` |
| `frontend/` | TypeScript (Angular) | `frontend/tsconfig.json` | `pnpm --filter adblock-frontend run build` |

There is **no Prettier** in this repo. Do not add `.prettierrc` or Prettier-style config. The Deno formatter is the authority for `src/` and `worker/`; ESLint is the authority for `frontend/`.

---

## 2. Deno / `src/` + `worker/` Style Rules

These rules come directly from the `"fmt"` block in `deno.json`. Running `deno fmt` will auto-fix them; running `deno fmt --check` (as CI does) will fail if they are violated.

### 2.1 Indentation & Spacing

- **Indent with 4 spaces.** Never use tabs (`"useTabs": false`, `"indentWidth": 4`).
- Continuation lines (multi-line function args, object literals, arrays) are indented 4 spaces from the opening line.
- No trailing whitespace on any line.
- A single blank line between top-level declarations; no double-blank lines inside a function body.

### 2.2 Line Length

- **Maximum line width: 180 characters** (`"lineWidth": 180`).
- This is intentionally wide. Do NOT break lines at 80 or 100 chars. Only wrap when a line would genuinely exceed 180 characters.

### 2.3 Semicolons

- **Always use semicolons** (`"semiColons": true`). Every statement ends with `;`.

### 2.4 Quotes

- **Always use single quotes** for strings (`"singleQuote": true`).
- Exception: template literals (backticks) are used where interpolation is required.
- Exception: JSON files always use double quotes (that is the JSON spec).
- Do NOT use double quotes in TypeScript source files.

### 2.5 Braces & Blocks

- Opening brace on the **same line** as the statement (K&R / 1TBS style):
  ```typescript
  if (condition) {
      doSomething();
  } else {
      doOther();
  }
  ```
- Always use braces for `if`/`else`/`for`/`while` bodies — even single-line bodies:
  ```typescript
  // ✅ correct
  if (x) {
      return x;
  }

  // ❌ wrong
  if (x) return x;
  ```

### 2.6 Functions & Methods

- Short single-expression arrow functions may stay on one line:
  ```typescript
  const double = (n: number): number => n * 2;
  ```
- Multi-statement arrow functions use a block body:
  ```typescript
  const process = (n: number): number => {
      const result = n * 2;
      return result + 1;
  };
  ```
- Regular function declarations use standard block bodies — never compress multi-step logic onto one line.

### 2.7 Object & Array Literals

- Short object/array literals may be single-line if they fit within 180 chars.
- Multi-line object/array literals: opening `{`/`[` on the same line, each property/element on its own indented line, closing `}`/`]` on its own line:
  ```typescript
  const config = {
      host: 'localhost',
      port: 8080,
      tls: true,
  };
  ```
- Trailing comma after the last element/property in multi-line literals (Deno fmt enforces this).

### 2.8 Imports

- Use the path alias `@/` for imports within `src/` (e.g., `import { Foo } from '@/foo/foo.ts'`).
- All imports from `deno.json` `"imports"` map must use the mapped specifiers (e.g., `'zod'`, `'hono'`, `'@std/assert'`) — never raw npm/jsr URLs in source files.
- Import order: Deno fmt does not enforce order, but group logically — external deps first, then internal `@/` aliases.
- Named imports use the same single-quote rule: `import { foo } from './foo.ts';`

### 2.9 Comments

- Single-line comments: `// comment` with **one space after `//`**.
- Block comments: `/* comment */` or JSDoc `/** ... */`.
- Inline comments go on their **own line above** the relevant code, not at the end of a statement, unless extremely short.
- `TODO` comments **must** be tagged: `// TODO(username): description` — untagged `TODO`s fail `deno lint` (`ban-untagged-todo` rule is enabled).
- `FIXME`/`HACK`/`NOTE` are acceptable without tags but should be rare.

### 2.10 Type Annotations

The following TypeScript compiler options are **enforced** and will cause type-check failures:

| Option | Meaning |
|---|---|
| `strict: true` | Enables all strict mode checks |
| `noImplicitAny: true` | Every variable/parameter must have an explicit or inferable type — never leave implicit `any` |
| `strictNullChecks: true` | `null` and `undefined` are not assignable unless the type allows it |
| `noUnusedLocals: true` | Declared local variables must be used — remove unused variables |
| `noUnusedParameters: true` | Function parameters must be used — prefix intentionally-unused params with `_` (e.g., `_req`) |
| `noImplicitReturns: true` | All code paths in a function must return a value (root `tsconfig.json`) |
| `noFallthroughCasesInSwitch: true` | `switch` cases must `break`, `return`, or `throw` |
| `strictPropertyInitialization: true` | Class properties must be initialized in the constructor or be marked `!` |

**Practical rules:**
- Always annotate function return types explicitly on exported functions and class methods.
- Use `unknown` instead of `any` when the type is truly unknown at a trust boundary, then narrow with Zod or type guards.
- `no-explicit-any` is excluded from deno lint (so `any` in local/internal code won't lint-fail), but avoid it in public API surface exported from `src/index.ts` — `deno publish --dry-run` (`check-slow-types` CI job) will flag slow/unsafe types.

---

## 3. Frontend (`frontend/`) Style Rules

The Angular frontend uses **ESLint** via `frontend/eslint.config.mjs`. CI runs `pnpm --filter adblock-frontend run lint`.

### 3.1 Angular Component Conventions

- **Directive selectors:** attribute style, `camelCase` prefix `app`:
  ```typescript
  // ✅ correct — @angular-eslint/directive-selector
  selector: '[appMyDirective]'
  ```
- **Component selectors:** element style, `kebab-case` prefix `app`:
  ```typescript
  // ✅ correct — @angular-eslint/component-selector
  selector: 'app-my-component'
  ```

### 3.2 TypeScript in Angular Files

The Angular `tsconfig.json` adds these on top of standard strict mode:

| Option | Meaning |
|---|---|
| `noImplicitOverride: true` | Methods that override a base class method must use the `override` keyword |
| `noPropertyAccessFromIndexSignature: true` | Properties with index signature types must use bracket notation |
| `strictInjectionParameters: true` | Angular DI injection parameters must be fully typed |
| `strictInputAccessModifiers: true` | `@Input()` properties must respect access modifiers |
| `strictTemplates: true` | Angular template type checking is fully strict |

**Practical rules:**
- Use `override` on every method that overrides a parent class method.
- Use `inject()` function (Angular 14+ signals/inject pattern) — DI via constructor is also fine, but be consistent within the file.
- Templates are strictly type-checked — every binding expression must typecheck. Do not use `$any()` casts in templates.

### 3.3 Unused Variables in Frontend

`@typescript-eslint/no-unused-vars` is set to `warn` with `argsIgnorePattern: '^_'`. This means:
- Unused variables produce a **warning** (not an error), but keep the codebase clean — remove genuinely unused vars.
- Prefix intentionally-unused parameters with `_` to suppress the warning: `(_event: MouseEvent) => { ... }`

### 3.4 `no-explicit-any` in Frontend

`@typescript-eslint/no-explicit-any` is set to `warn`. Avoid `any` — use `unknown` + type guards, or explicit types. If `any` is truly unavoidable, add a comment explaining why.

### 3.5 HTML Templates

Angular template linting uses `angular-eslint` template rules including accessibility checks. Every interactive element must have appropriate ARIA attributes or semantic HTML. `tabIndex`, `role`, and `aria-*` attributes must be used correctly.

---

## 4. Naming Conventions

These are not enforced by a linter but are consistent throughout the codebase and must be followed:

| Construct | Convention | Example |
|---|---|---|
| Variables & parameters | `camelCase` | `const hostList`, `function parseRule(ruleText)` |
| Functions | `camelCase` | `function compileHostlist()` |
| Classes | `PascalCase` | `class CompilerService` |
| Interfaces | `PascalCase` | `interface CompileOptions` |
| Type aliases | `PascalCase` | `type RuleResult` |
| Enums | `PascalCase` members `SCREAMING_SNAKE_CASE` | `enum Syntax { ADGUARD_HOME = 'adguard_home' }` |
| Zod schemas | `PascalCase` + `Schema` suffix | `const CompileRequestSchema = z.object(...)` |
| Angular components | `PascalCase` + `Component` suffix | `class CompilerFormComponent` |
| Angular services | `PascalCase` + `Service` suffix | `class ApiKeyService` |
| Angular directives | `PascalCase` + `Directive` suffix | `class HighlightDirective` |
| Angular guards | `camelCase` + `Guard` suffix | `const authGuard: CanActivateFn` |
| File names (`src/`, `worker/`) | `kebab-case.ts` | `compile-options.ts`, `hostlist-compiler.ts` |
| File names (Angular) | `kebab-case.component.ts` | `compiler-form.component.ts` |
| Test files | Same name + `.test.ts` | `hostlist-compiler.test.ts` |

---

## 5. What NOT to Do (Common Failure Modes)

These are the exact issues that have caused CI failures in this repo. Do not repeat them:

```typescript
// ❌ FAILS deno fmt: wrong indent (2 spaces)
function foo() {
  const x = 1;
}

// ✅ correct
function foo() {
    const x = 1;
}

// ❌ FAILS deno fmt: double quotes
const msg = "hello";

// ✅ correct
const msg = 'hello';

// ❌ FAILS deno fmt: missing semicolon
const x = 1

// ✅ correct
const x = 1;

// ❌ FAILS deno lint: untagged TODO
// TODO: fix this later

// ✅ correct
// TODO(jaypatrick): fix this later

// ❌ FAILS tsc (noUnusedLocals): declared but never read
function foo() {
    const unused = computeSomething();
    return 42;
}

// ✅ correct: remove it, or if intentionally unused, prefix with _
// (parameters only — local variables must actually be removed)

// ❌ FAILS tsc (noUnusedParameters): parameter never used
function handler(req: Request, ctx: Context): Response {
    return new Response('ok');
}

// ✅ correct
function handler(_req: Request, _ctx: Context): Response {
    return new Response('ok');
}

// ❌ FAILS tsc (noImplicitAny): implicit any
function parse(data) {
    return data.value;
}

// ✅ correct
function parse(data: unknown): string {
    return (data as { value: string }).value;
}

// ❌ FAILS tsc (strictNullChecks): possible undefined not handled
function getName(user: User | undefined): string {
    return user.name; // user could be undefined
}

// ✅ correct
function getName(user: User | undefined): string {
    return user?.name ?? 'anonymous';
}

// ❌ FAILS Angular ESLint: wrong component selector prefix/style
@Component({ selector: 'MyComponent' })   // not kebab-case, no 'app' prefix

// ✅ correct
@Component({ selector: 'app-my-component' })

// ❌ FAILS Angular tsc (noImplicitOverride): missing override keyword
class Child extends Base {
    ngOnInit() { ... }
}

// ✅ correct
class Child extends Base {
    override ngOnInit(): void { ... }
}
```

---

## 6. Pre-Commit / Pre-Push Checklist

Before submitting code in a PR, mentally verify (or run locally):

```bash
# Deno: format check
deno fmt --check

# Deno: lint
deno lint

# Deno: type check
deno task check

# Frontend: lint
pnpm --filter adblock-frontend run lint

# Full preflight (combines all of the above + more)
deno task preflight
```

If `deno task preflight` passes clean, the CI `lint-format`, `typecheck`, and `frontend-lint-test` jobs will pass.

---

## 7. Scope of This Document

This document covers **style and formatting only**. For:
- Security requirements (ZTA, auth, Zod boundaries) → see `copilot-instructions.md`
- Architecture decisions → see `copilot-instructions.md`
- Dependency management → see `DEPENDENCIES.md`
- Changelog / versioning → see `CONTRIBUTING.md`