# Pitch Summary: bloqr-backend Agent Platform

*Prepared for business partner presentation — March 2026*

---

## Executive Summary

**bloqr-backend** is a cloud-native content filtering platform built on Cloudflare's global edge network. It compiles, validates, and distributes adblock filter lists at web scale — but the platform has evolved into something far more significant: a foundation for deploying autonomous, persistent AI agents directly at the network edge.

The timing is strategic. On **March 24, 2026** — the same day our agent backend shipped — Cloudflare announced that **Dynamic Workers** entered open beta. This is not a coincidence; it is a reflection of how closely our architecture tracks the cutting edge of serverless infrastructure. We are building with the platform as it is being built.

---

## Technology Stack

### Cloudflare Workers + Durable Objects
**The compute layer.** Cloudflare Workers run JavaScript/TypeScript at the edge — 300+ data centres globally, sub-millisecond cold starts, zero server management. Durable Objects provide the missing piece: persistent, stateful compute with strong consistency guarantees. Every agent session runs as a Durable Object instance — isolated, durable, and globally addressable.

### Cloudflare Agents SDK
**The orchestration layer.** Cloudflare's official SDK for building persistent AI and automation agents on top of Durable Objects. It handles WebSocket session management, hibernation, reconnection, and the MCP (Model Context Protocol) transport layer. Our typed `AGENT_REGISTRY` extends this SDK with enterprise-grade auth enforcement and session tracking.

### Cloudflare Dynamic Workers *(Open Beta — March 24, 2026)*
**The future layer.** Dynamic Workers allow a Worker to spawn other Workers at runtime — in single-digit milliseconds. This is 100× faster than container cold starts. Key capabilities:
- Spawn per-user sandboxed Workers on demand (no shared state between users)
- `@cloudflare/codemode` — LLMs write TypeScript against APIs directly, potentially cutting token usage ~80%
- `@cloudflare/worker-bundler` — bundle npm dependencies dynamically at runtime
- `@cloudflare/shell` — virtual file system + persistent storage for Dynamic Workers

Our `AGENT_REGISTRY` extensibility model is exactly right for onboarding Dynamic Worker-backed agents: one registry entry = full UI + auth + session tracking.

### Model Context Protocol (MCP)
**The AI tool interface standard.** MCP is the emerging industry standard for AI agent tool calling, developed by Anthropic and rapidly adopted across the ecosystem. Our Playwright MCP Agent exposes browser automation capabilities via the MCP transport — meaning any MCP-compatible AI client (Claude, custom LLMs, etc.) can invoke browser actions through our edge infrastructure.

### Playwright + Cloudflare Browser Rendering
**The automation layer.** Playwright drives headless Chromium instances managed by Cloudflare's Browser Rendering service. Tasks like web scraping, PDF generation, visual regression testing, and content verification run at the edge with no infrastructure to manage.

### Angular 21 + Angular Material
**The frontend layer.** A modern, signal-based reactive frontend built on Angular 21's zoneless change detection. The admin UI surfaces agent management, live WebSocket session consoles, and audit logs — all behind admin-only authentication. Signals replace traditional observables for state management, delivering a smaller, faster, more maintainable frontend.

### Hono + Zero Trust Authentication
**The API layer.** Every request — HTTP or WebSocket — is verified before reaching business logic. The ZTA auth chain: `requireAuth → requireTier(Admin) → requireScope('agents') → checkRateLimitTiered`. No exceptions. Authentication failures emit security telemetry to Cloudflare Analytics Engine for real-time monitoring.

### D1 + Neon/Prisma
**The data layer.** Dual-database architecture: Cloudflare D1 (edge SQLite) for low-latency session state close to the compute, and Neon (serverless Postgres with branching) for relational analytics and history. All queries are parameterized via Prisma — no raw SQL interpolation.

---

## What Was Built: Milestone Narrative

### Phase 1 — Foundation *(prior work)*
Core compiler API, filter list validation engine, auth system (Better Auth), admin dashboard with 13+ management panels, user/role/tier/scope management, feature flags, observability, and audit trail. CI/CD pipeline, Cloudflare Pages deployment, D1 + Neon migrations.

### Phase 2 — Agent Backend *(PR #1382, merged March 24, 2026)*
The production-grade backend for the Cloudflare Agents SDK integration:
- **Typed `AGENT_REGISTRY`** — single source of truth for all agent metadata (slug, transport, tier requirements, scopes)
- **ZTA auth gate** — `agent-auth.ts` enforces the full auth chain *before* the Durable Object is invoked (critical security fix: auth now runs before DO, not after)
- **`agent_sessions` schema** — D1 and Neon models for session lifecycle tracking with indexes for active-session queries
- **`AuthScope.Agents`** — new scope seeded into admin DB; required for API-key callers
- **Admin API** — `GET /admin/agents/sessions`, `GET /admin/agents/audit`, `DELETE /admin/agents/sessions/:id`
- **Security telemetry** — every connection attempt emits a structured event to Analytics Engine
- **39 passing unit tests** — registry integrity, auth chain coverage, admin handler paths (403, 400, 404, 409, 200, 503)
- **CI green**

### Phase 3 — Agent Frontend *(this PR, issue #1383)*
The Angular admin UI for managing agents:
- **`AgentsDashboardComponent`** — agent registry cards, active sessions table, terminate action
- **`AgentSessionConsoleComponent`** — live WebSocket terminal with CDK Virtual Scroll, reconnect/disconnect controls, live connection duration counter
- **`AgentAuditLogComponent`** — paginated audit log with event-type filter chips
- **`AgentRpcService`** — HTTP + WebSocket client, exponential-backoff reconnect, signal-based state
- **Route + nav wiring** — lazy-loaded child routes, "Agents" nav group with `smart_toy` icon
- **Vitest tests** — service and component specs, zoneless, signal-based mocks
- **Documentation** — `docs/frontend/AGENTS_FRONTEND.md`, `docs/PITCH_SUMMARY.md`

### Phase 4 — Cloudflare Page Shield Integration *(PR #1651)*
Full client-side security layer powered by Cloudflare Page Shield:
- **Path-scoped CSP middleware** — strict policy (no `'unsafe-inline'`) on all SPA/API routes; relaxed policy scoped only to `/api/swagger*`; `report-uri` wires every browser into the violation pipeline
- **`POST /api/csp-report`** — unauthenticated ingestion endpoint with `bodySizeMiddleware` + `rateLimitMiddleware` + Zod field validation; 204 on success, 400 on invalid/missing required fields, 503 on D1 write failure
- **`csp_violations` D1 table** — indexed on `timestamp` and `violated_directive` for operational queries
- **`deno task pageshield:sync`** — fetches Page Shield script inventory via `CloudflareApiService`, partitions by `malicious_score`, deduplicates by hostname, writes `data/pageshield-{blocklist,allowlist}.txt` in ABP format
- **Shared `pageshield-rules.ts` utility** — `toBlockRule()`, `toAllowRule()`, and threshold constants as a single source of truth for both the Worker cron and the CLI sync script
- **ZTA-compliant** — Anonymous tier in `ROUTE_PERMISSION_REGISTRY`, parameterized D1 inserts, no raw SQL
- **19 unit tests** for rule utilities; **9 route-level tests** for the CSP endpoint
- **Full documentation** — `docs/security/PAGE_SHIELD_INTEGRATION.md`

---

## Why This Is Bleeding Edge

**Dynamic Workers entered open beta the same day our backend shipped.** We are not catching up to the platform — we are building alongside it.

| Claim | Evidence |
|-------|----------|
| First-class MCP support | Our agent routes the Model Context Protocol standard, giving any MCP-compatible AI client access to edge browser automation |
| ZTA applied to AI agents | Every agent connection — human or machine — passes a 6-step auth chain before touching a Durable Object. This is enterprise security applied to an area most platforms treat as an afterthought |
| Extension model is future-proof | `AGENT_REGISTRY` + `KNOWN_AGENTS` means any new agent (Dynamic Worker-backed, LLM-driven, per-user sandbox) is one registry entry away from full UI + auth + session tracking |
| Edge-native by design | Agents run as Durable Objects — persistent, globally addressable, hibernating when idle, instant to wake. No servers, no containers, no ops burden |

---

## Demo Scenario *(for live pitch)*

**Setup:** Two browser tabs — one admin, one non-admin.

1. **Log in as admin** — navigate to the Admin panel.
2. **Navigate to Agent Management** (`/admin/agents`) — see the registered Playwright MCP Agent card with transport badge (WS), enabled chip, required tier (admin), and required scope (agents).
3. **Click "Connect"** — navigates to `/admin/agents/mcp-agent/default`. Watch the connection status dot turn green ("Connected"). The console shows the system message "WebSocket connection established."
4. **Send a ping** — type `{"type":"ping"}` in the message input and press Enter. Watch the outbound message appear in the feed, and the agent's response appear as an inbound message.
5. **View the session** — navigate to Agent Audit Log (`/admin/agents/audit`). See a `session_start` event with timestamp and IP address.
6. **Terminate the session** — go back to Agent Management, find the active session in the table, click the stop button. Watch the inline spinner, then the snackbar confirmation "Session abc12345… terminated."
7. **Switch to the non-admin tab** — navigate to `/admin/agents`. The admin guard redirects to `/sign-in`. The agent panel is completely invisible.

---

## Forward-Looking Roadmap

### Dynamic Worker-backed agents *(Q2 2026)*
Spawn per-user Worker sandboxes on demand using `@cloudflare/codemode`. Each user gets isolated compute — no shared state, no cross-user interference. The `AGENT_REGISTRY` already supports this: add a binding, add an entry.

### Multi-agent orchestration *(Q3 2026)*
Agents that spawn and coordinate other agents. A "director" Durable Object receives a high-level task, spawns specialised agents (browser, search, code execution), collects results, and streams back a synthesised response.

### Tiered access expansion *(Q2 2026)*
Pro users get read-only agent status visibility — they can see active agents and their session status without being able to connect or terminate. The tier/scope model is already in place; this is a UI gating change.

### `@cloudflare/codemode` integration *(Q3 2026)*
LLMs write TypeScript functions against our APIs directly ("Code Mode") — potentially cutting token usage ~80% compared to tool-calling patterns. Combined with Dynamic Workers, this enables fully autonomous code execution at the edge.

---

## Security Posture

> "Zero Trust is not a product. It is a philosophy applied to every layer of the stack."

- **Every endpoint verified** — no handler executes business logic without auth
- **No token in localStorage** — WebSocket auth via `Sec-WebSocket-Protocol` header (Cloudflare Agents SDK standard)
- **All inputs Zod-validated** — no raw data crosses trust boundaries
- **All queries parameterized** — Prisma `.prepare().bind()` throughout
- **Security events emitted** — every auth failure, rate limit hit, and termination goes to Analytics Engine
- **Admin-only gating** — agent panel invisible to non-admin users at the route level
- **Passive client-side threat detection** — every browser session reports CSP violations to D1 in real time; Page Shield script scoring auto-generates adblock rules that harden the filter pipeline

This is not retrofitted security. Zero Trust Architecture was baked in from the first commit.

---

### Page Shield: Passive Script Threat Detection *(landing page blurb)*

> **Your users' browsers are now your security sensors.**
>
> bloqr-backend ships with deep Cloudflare Page Shield integration. Every browser that loads your application automatically reports Content Security Policy violations to a dedicated endpoint — no JavaScript agents, no SDK, no sampling. Supply-chain compromises, injected trackers, and typosquatted CDN scripts are captured, Zod-validated, and persisted to Cloudflare D1 in real time. Combine this with Page Shield's AI-scored script inventory to automatically generate adblock block and allow rules, continuously hardening your compiled filter lists against the latest client-side threats. Enterprise-grade client-side security, built in from day one.

---

*bloqr-backend — Edge-native. AI-ready. Enterprise-secure.*
