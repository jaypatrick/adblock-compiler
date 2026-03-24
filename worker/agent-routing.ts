/**
 * Minimal, dependency-free Durable Object agent request router.
 *
 * Routes requests matching `/agents/{name}/{instanceId}[/…]` to the
 * corresponding Durable Object binding in `env`, with no Node.js built-in
 * dependencies (avoids `async_hooks`, `path`, etc. that the `agents` SDK
 * pulls in and that break wrangler's esbuild bundler).
 *
 * SDK COMPATIBILITY TEST: We now attempt to import `routeAgentRequest` from
 * `@cloudflare/agents` to verify that wrangler v4 + `nodejs_compat` resolves
 * the historical bundler incompatibility. If the SDK import is available and
 * bundles cleanly, `sdkRouteAgentRequest` will be non-null and the SDK version
 * is used. Otherwise, the custom implementation below is used as a fallback.
 *
 * If `wrangler dev` and `wrangler deploy` succeed without bundler errors after
 * this change, the custom shim in this file can be retired in a follow-up PR.
 *
 * @see https://github.com/jaypatrick/adblock-compiler/issues/1377
 */

import type { Env } from './types.ts';

// ---------------------------------------------------------------------------
// SDK compatibility probe
// ---------------------------------------------------------------------------

/**
 * Attempt to import routeAgentRequest from the official @cloudflare/agents SDK.
 * This import is the canary: if esbuild/wrangler fails here due to async_hooks
 * or path, the bundler error will surface in `wrangler dev` output.
 */
type SdkRouteAgentRequest = (request: Request, env: unknown) => Promise<Response | null>;

let sdkRouteAgentRequest: SdkRouteAgentRequest | null = null;

try {
    // Dynamic import so that a bundler error here is isolated and observable.
    const agentsSdk = await import('@cloudflare/agents');
    if (typeof agentsSdk.routeAgentRequest === 'function') {
        sdkRouteAgentRequest = agentsSdk.routeAgentRequest as SdkRouteAgentRequest;
    }
} catch {
    // SDK not available or bundler cannot resolve it — fall back to custom shim below.
    sdkRouteAgentRequest = null;
}

// ---------------------------------------------------------------------------
// Custom shim (preserved as fallback — do not remove until SDK test passes)
// ---------------------------------------------------------------------------

/** Matches `/agents/<agentName>/<instanceId>[/rest]` */
const AGENT_PATH_RE = /^\/agents\/([^/]+)\/([^/]+)(\/.*)?$/;

/**
 * Converts a kebab-case agent name (from the URL segment) to the
 * UPPER_SNAKE_CASE Env binding key.
 * e.g. `mcp-agent` → `MCP_AGENT`
 */
export function agentNameToBindingKey(name: string): string {
    return name.replace(/-/g, '_').toUpperCase();
}

/**
 * Custom shim implementation. Used when the SDK is not available.
 */
async function customRouteAgentRequest(request: Request, env: Env): Promise<Response | null> {
    const url = new URL(request.url);
    const match = url.pathname.match(AGENT_PATH_RE);
    if (!match) return null;

    const [, agentName, instanceId] = match;
    const bindingKey = agentNameToBindingKey(agentName) as keyof Env;
    const ns = env[bindingKey] as DurableObjectNamespace | undefined;
    if (!ns || typeof ns.idFromName !== 'function') return null;

    const stub = ns.get(ns.idFromName(instanceId));
    return stub.fetch(request);
}

/**
 * Routes incoming requests to the appropriate Durable Object agent and returns
 * the agent's Response, or `null` when the URL does not match an agents path.
 *
 * Delegates to the official `@cloudflare/agents` SDK when available (SDK
 * compatibility test), otherwise falls back to the custom shim.
 *
 * URL pattern: `/agents/{binding-kebab-case}/{agentId}[/*]`
 * Example SSE endpoint: `GET /agents/mcp-agent/default/sse`
 */
export async function routeAgentRequest(request: Request, env: Env): Promise<Response | null> {
    if (sdkRouteAgentRequest) {
        return sdkRouteAgentRequest(request, env);
    }
    return customRouteAgentRequest(request, env);
}

/**
 * Indicates whether the @cloudflare/agents SDK was successfully imported.
 * Exported for use in tests and diagnostics.
 */
export const SDK_ROUTE_AVAILABLE = sdkRouteAgentRequest !== null;
