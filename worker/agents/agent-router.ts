/**
 * Agent Router — dedicated Hono sub-app for all `/agents/*` routes.
 *
 * This sub-app isolates agent routing from the main `hono-app.ts` and handles
 * authentication internally via `agent-auth.ts` **before** forwarding requests
 * to the Durable Object.
 *
 * ## Route pattern
 * - `GET  /agents/:slug/:instanceId/*`  — WebSocket upgrade + SDK routing
 * - `POST /agents/:slug/:instanceId/*`  — HTTP POST for MCP protocol
 * - All other methods return 405 Method Not Allowed
 *
 * ## Static assets note
 * The `ASSETS` binding in `wrangler.toml` serves the Angular SPA from the
 * Cloudflare CDN.  Asset paths are matched against the `frontend/dist/` build
 * output, which contains no `/agents/*` paths — so agent routes are **never**
 * captured by the assets handler.  This is confirmed by the wrangler asset
 * binding configuration (`directory = "frontend/dist/bloqr-backend/browser"`).
 *
 * @see worker/agents/agent-auth.ts — ZTA authentication middleware
 * @see worker/agents/registry.ts — AGENT_REGISTRY entries
 * @see https://developers.cloudflare.com/agents/getting-started/add-to-existing-project/
 */

import { Hono } from 'hono';
import type { Env } from '../types.ts';
import { handleAgentRequest } from './agent-auth.ts';

// ============================================================================
// Sub-app
// ============================================================================

/**
 * Hono sub-app that handles all `/agents/*` routes with ZTA authentication.
 *
 * Mounted in `hono-app.ts` before the unified auth middleware, because this
 * router manages its own auth chain via `handleAgentRequest`.
 */
export const agentRouter = new Hono<{ Bindings: Env }>();

// ── Allowed methods for agent routes ─────────────────────────────────────────
// GET: WebSocket upgrade (agents SDK negotiates the upgrade) + SSE
// POST: MCP protocol HTTP transport (some clients POST tool calls)
const ALLOWED_METHODS = new Set(['GET', 'POST']);

// ── Agent route handler ───────────────────────────────────────────────────────
// The pattern captures: slug, instanceId, and any trailing sub-path.
// Auth is handled inside handleAgentRequest before the DO is invoked.
agentRouter.all('/agents/:slug/:instanceId/*', async (c) => {
    if (!ALLOWED_METHODS.has(c.req.method)) {
        return c.json(
            { success: false, error: `Method ${c.req.method} not allowed on agent endpoints` },
            405,
            { Allow: 'GET, POST' },
        );
    }
    // handleAgentRequest always returns a Response for /agents/* paths —
    // the null branch is structurally unreachable from these matched routes.
    return await handleAgentRequest(c.req.raw, c.env) as Response;
});

// Also handle the base /:slug/:instanceId path (without trailing slash/sub-path)
agentRouter.all('/agents/:slug/:instanceId', async (c) => {
    if (!ALLOWED_METHODS.has(c.req.method)) {
        return c.json(
            { success: false, error: `Method ${c.req.method} not allowed on agent endpoints` },
            405,
            { Allow: 'GET, POST' },
        );
    }
    return await handleAgentRequest(c.req.raw, c.env) as Response;
});
