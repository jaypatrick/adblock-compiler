/**
 * Playwright MCP Agent using Cloudflare Browser Rendering.
 *
 * Exposes a Model Context Protocol (MCP) server over SSE and WebSocket,
 * enabling AI tools such as GitHub Copilot to control a real browser via the
 * Cloudflare Browser Rendering service — no local browser installation required.
 *
 * When running locally with `wrangler dev`, the endpoint is available at:
 *   http://localhost:8787/agents/mcp-agent/default/sse   (SSE — legacy MCP clients)
 *   http://localhost:8787/agents/mcp-agent/default       (WebSocket — new clients)
 *
 * When deployed to production:
 *   https://adblock-compiler.jayson-knight.workers.dev/agents/mcp-agent/default/sse
 *   https://adblock-compiler.jayson-knight.workers.dev/agents/mcp-agent/default
 *
 * The URL segment `mcp-agent` is derived automatically from the `MCP_AGENT` binding
 * name by the agents SDK (UPPER_SNAKE_CASE → kebab-case).
 *
 * ## WebSocket / DO hibernation
 * `@cloudflare/playwright-mcp` uses `createMcpAgent()` to produce a Durable Object
 * class.  Whether WebSocket hibernation is available depends on the internals of that
 * package.  The agents SDK (`routeAgentRequest`) automatically negotiates the
 * WebSocket upgrade when the client sends an `Upgrade: websocket` header, so both
 * SSE and WebSocket clients are supported transparently.
 *
 * TODO(hibernation): Verify that `@cloudflare/playwright-mcp`'s Agent base class
 * calls `this.ctx.acceptWebSocket()` to enable DO hibernation.  If not, a wrapper
 * class that extends the SDK `Agent` base and delegates to the playwright-mcp agent
 * will be required.  Tracked in issue #1377.
 *
 * @see https://developers.cloudflare.com/browser-rendering/
 * @see https://github.com/cloudflare/playwright-mcp
 * @see https://developers.cloudflare.com/agents/
 * @see worker/agents/registry.ts — AGENT_REGISTRY entry for this agent
 */

import { env } from 'cloudflare:workers';
import type { BrowserWorker } from './cloudflare-workers-shim.ts';
// @deno-types="./cloudflare-playwright-mcp-types.d.ts"
import { createMcpAgent } from '@cloudflare/playwright-mcp';
import { resolveBrowserBinding } from './lib/browser-env.ts';

// ── Agent initialisation ──────────────────────────────────────────────────────
//
// `createMcpAgent(binding)` runs at module evaluation time.  If the BROWSER
// binding is absent (e.g. `wrangler dev` without `--remote`), we catch that
// specific, operator-actionable error and export a stub Durable Object class
// so the Worker can still start and serve non-browser routes.  The stub returns
// HTTP 503 with the actionable fix message when the agent endpoint is hit.
//
// Any OTHER initialization failure (SDK bug, import error, unexpected runtime
// issue) is rethrown immediately so it surfaces in logs and the error queue
// rather than being silently swallowed by the stub.

/** Sentinel prefix produced by resolveBrowserBinding() for a missing binding. */
const BROWSER_BINDING_MISSING_PREFIX = 'Cloudflare Browser Rendering binding "BROWSER" is not configured.';

// deno-lint-ignore no-explicit-any
let _PlaywrightMcpAgent: new (ctx: any, env: any) => any;
try {
    _PlaywrightMcpAgent = createMcpAgent(
        resolveBrowserBinding(env as unknown as { readonly BROWSER?: BrowserWorker }),
    );
} catch (err) {
    // Only degrade gracefully for the known missing-binding error.
    // All other errors (SDK bugs, import failures, etc.) are rethrown.
    const message = err instanceof Error ? err.message : String(err);
    if (!message.startsWith(BROWSER_BINDING_MISSING_PREFIX)) {
        throw err;
    }
    _PlaywrightMcpAgent = class BrowserBindingMissingAgent {
        // deno-lint-ignore no-explicit-any
        constructor(_ctx: any, _env: any) {}
        fetch(_request: Request): Response {
            return new Response(message, {
                status: 503,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
        }
    };
}

export const PlaywrightMcpAgent = _PlaywrightMcpAgent;
export default PlaywrightMcpAgent;
