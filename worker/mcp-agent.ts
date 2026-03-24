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

interface IBrowserEnv {
    readonly BROWSER?: BrowserWorker;
}

const browserEnv = env as unknown as IBrowserEnv;
const browserBinding = browserEnv.BROWSER;

if (!browserBinding) {
    throw new Error(
        'Cloudflare Browser Rendering binding "BROWSER" is not configured. ' +
            'Ensure the `BROWSER` binding is defined in your Wrangler configuration for this Worker.',
    );
}

export const PlaywrightMcpAgent = createMcpAgent(browserBinding);
export default PlaywrightMcpAgent;
