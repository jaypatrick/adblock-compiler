# Lessons Learned

## Prisma ORM is incompatible with D1 test mocks

The test suite mocks D1 by intercepting raw `.prepare().bind()` calls and matching on lowercase SQL substrings (e.g. `lower.includes('select') && lower.includes('from local_auth_users')`). Prisma generates PascalCase table names and camelCase column names internally, so its queries never match the mocks — every handler returns 500. **Do not use Prisma (or any ORM) for D1 in this repo.** Use raw parameterised D1 queries throughout.

## ZTA Lint: `.prepare()` line-level interpolation check

`zta-lint.yml` scans every non-test `worker/**/*.ts` file for two patterns on the same line:
1. `` prepare(` `` followed by `${` — catches template literal interpolation inside the call
2. `prepare(.*+` — catches string concatenation

Static backtick strings (`` prepare(`SELECT * FROM foo WHERE id = ?`) ``) are fine. To build SQL dynamically (e.g. a variable-column UPDATE), build the SQL string in a separate `const` variable first, then pass the variable to `.prepare()`:

```ts
// ✅ passes ZTA Lint — interpolation is not on the .prepare() line
const sql = `UPDATE foo SET ${cols.join(', ')} WHERE id = ?`;
env.DB.prepare(sql).bind(...binds).run();

// ❌ flagged by ZTA Lint
env.DB.prepare(`UPDATE foo SET ${cols.join(', ')} WHERE id = ?`).bind(...binds).run();
```

## D1 test mock bound-value ordering is positional and strict

`createMockDb()` in `*.test.ts` files reads bound values by index (`bound[0]`, `bound[1]`, …). The SQL string a handler produces must bind parameters in the exact order the mock expects. For the admin UPDATE handler the order is `[role, tier, api_disabled, userId]`. Mismatching the order silently produces wrong test values — always read the mock's `vIdx` counter pattern before writing a new query.

## D1 `run()` does not return the inserted/updated row

After an `INSERT` or `UPDATE`, `run()` only returns `{ meta: { changes, last_row_id, … } }`. To return the created or updated row, either build it in-memory from the known input values (for INSERT) or issue a follow-up `SELECT … WHERE id = ?` (for UPDATE).

## 404 detection uses `meta.changes`, not Prisma error codes

Prisma throws `P2025` when a record is not found. Raw D1 `run()` sets `result.meta.changes === 0` when no rows were affected. Always check `meta.changes` for UPDATE and DELETE 404 detection.

## `deno fmt` violations block CI immediately

The `Lint & Format Check` CI job runs `deno fmt --check` and fails fast. Always run `deno fmt` locally before pushing — or at minimum run `deno fmt --check worker/ frontend/` to catch violations before they hit CI.

## Unused imports fail CI under strict TS settings

`deno.json` sets `noUnusedLocals` and `noUnusedParameters` to `true`. Removing a dependency (like Prisma) must be accompanied by removing every import that was only used by that dependency. The compiler will reject the file even if the runtime would ignore the unused symbol.
