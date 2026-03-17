# Adblock Compiler — Operations & Troubleshooting KB

This directory contains the Knowledge Base (KB) troubleshooting series for the `adblock-compiler` Cloudflare Worker and its supporting services.

Each article follows a consistent structure: symptom, diagnostic commands, root cause decision tree, and resolution summary.

---

## Table of Contents

| Article | Title | Status |
|---|---|---|
| [KB-001](./KB-001-api-not-available.md) | "Getting API is not available" on the main page | ✅ Active |
| KB-002 | Clerk JWT auth degraded / local JWT fallback | 🗓 Planned |
| KB-003 | Cloudflare Queue consumer not processing messages | 🗓 Planned |
| KB-004 | Angular SPA serves stale build after worker deploy | 🗓 Planned |

---

## Contributing

If you encounter a new failure mode not covered by an existing article, please open an issue tagged `troubleshooting` and `documentation` in `jaypatrick/adblock-compiler`. Include:

- The symptom observed
- Any diagnostic output (curl responses, wrangler tail logs, etc.)
- The root cause if identified
- The fix applied

New KB articles should be named `KB-NNN-short-description.md` and added to the table above.
