# Adblock Compiler — Operations & Troubleshooting KB

This directory contains the Knowledge Base (KB) troubleshooting series for the `adblock-compiler` Cloudflare Worker and its supporting services.

Each article follows a consistent structure: symptom, diagnostic commands, root cause decision tree, and resolution summary.

---

## Table of Contents

| Article | Title | Status |
|---|---|---|
| [KB-001](./KB-001-api-not-available.md) | "Getting API is not available" on the main page | ✅ Active |
| [KB-002](./KB-002-hyperdrive-database-down.md) | Hyperdrive binding connected but `database` service reports `down` | ✅ Active |
| [KB-003](./KB-003-neon-hyperdrive-live-session-2026-03-25.md) | Database Down After Deploy — Live Debugging Session (2026-03-25) | ✅ Active |
| [KB-004](./KB-004-prisma-wasm-cloudflare.md) | Prisma 7 + Cloudflare Workers: `WebAssembly.Module()` disallowed by embedder | ✅ Active |
| [KB-005](./KB-005-better-auth-cloudflare-ip-timeout.md) | Better Auth + Cloudflare: Hanging Worker and Rate Limiting Skipped | ✅ Active |

---

## Contributing

If you encounter a new failure mode not covered by an existing article, please open an issue tagged `troubleshooting` and `documentation` in `jaypatrick/adblock-compiler`. Include:

- The symptom observed
- Any diagnostic output (curl responses, wrangler tail logs, etc.)
- The root cause if identified
- The fix applied

New KB articles should be named `KB-NNN-short-description.md` and added to the table above.
