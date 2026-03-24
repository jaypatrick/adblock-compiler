/**
 * Durable Object agent request router.
 *
 * Routes `/agents/{name}/{instanceId}[/…]` requests to the appropriate DO
 * binding in `env` using the official `@cloudflare/agents` SDK
 * (`routeAgentRequest` from the `agents` npm package).
 *
 * The custom shim that was previously used as a fallback during bundler
 * compatibility testing has been retired now that the agents SDK is confirmed
 * to bundle cleanly under wrangler v4 + `nodejs_compat` (validated in PR #1378
 * and confirmed working via `wrangler dev` in issue #1377).
 *
 * The SDK is imported lazily (on the first `/agents/*` request) to avoid
 * cloudflare-scheme module loading errors in non-Worker runtimes (e.g. Deno
 * test runner).  The import result is cached so subsequent requests pay no
 * additional cost.
 *
 * The `agentNameToBindingKey` utility function is preserved here as it is
 * still used by tests and the agent registry.
 *
 * @see worker/agents/registry.ts — AGENT_REGISTRY (single source of truth for agents)
 * @see worker/agents/agent-auth.ts — ZTA authentication middleware (auth runs BEFORE DO)
 * @see https://github.com/jaypatrick/adblock-compiler/issues/1377
 */

import type { Env } from './types.ts';

// ---------------------------------------------------------------------------
// SDK lazy import — cached after first /agents/* request
// ---------------------------------------------------------------------------

/** Signature of the `routeAgentRequest` function exported by the `agents` SDK. */
type SdkRouteAgentRequest = (request: Request, env: Record<string, unknown>) => Promise<Response | null>;

/** Cached import promise — populated on the first /agents/* request. */
let sdkImportPromise: Promise<SdkRouteAgentRequest> | null = null;

/**
 * Returns the SDK's `routeAgentRequest` function, lazy-loaded on first use.
 * The `agents` package uses cloudflare: scheme imports that are only available
 * inside the Workers runtime — lazy loading avoids crashes in Deno test runs.
 */
function getSdkRouteAgentRequest(): Promise<SdkRouteAgentRequest> {
    if (sdkImportPromise === null) {
        sdkImportPromise = import('agents').then((m) => {
            if (typeof m.routeAgentRequest !== 'function') {
                throw new Error('agents SDK: routeAgentRequest is not a function');
            }
            return m.routeAgentRequest as SdkRouteAgentRequest;
        });
    }
    return sdkImportPromise;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Matches `/agents/<agentName>/<instanceId>[/rest]` */
const AGENT_PATH_RE = /^\/agents\/([^/]+)\/([^/]+)(\/.*)?$/;

/**
 * Converts a kebab-case agent name (from the URL segment) to the
 * UPPER_SNAKE_CASE Env binding key.
 *
 * @example `agentNameToBindingKey('mcp-agent')` → `'MCP_AGENT'`
 */
export function agentNameToBindingKey(name: string): string {
    return name.replace(/-/g, '_').toUpperCase();
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * Routes incoming requests to the appropriate Durable Object agent and returns
 * the agent's Response, or `null` when the URL does not match an agents path.
 *
 * Delegates to the official `agents` SDK (`routeAgentRequest`).
 *
 * **Authentication note:** This function does NOT perform any authentication.
 * All agent routes must be authenticated before calling this function.
 * Use `handleAgentRequest` from `worker/agents/agent-auth.ts` which enforces
 * ZTA authentication before forwarding to the DO.
 *
 * URL pattern: `/agents/{binding-kebab-case}/{agentId}[/*]`
 * Example SSE endpoint: `GET /agents/mcp-agent/default/sse`
 */
export async function routeAgentRequest(request: Request, env: Env): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.match(AGENT_PATH_RE)) return null;
    const sdkFn = await getSdkRouteAgentRequest();
    return sdkFn(request, env as unknown as Record<string, unknown>);
}

