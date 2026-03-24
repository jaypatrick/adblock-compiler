/**
 * Durable Object agent request router.
 *
 * The fallback shim (below) is dependency-free and routes requests matching
 * `/agents/{name}/{instanceId}[/…]` to the corresponding DO binding in `env`
 * with no Node.js built-in dependencies.
 *
 * SDK COMPATIBILITY TEST: On the first matching `/agents/…` request, this
 * module attempts a lazy import of `routeAgentRequest` from the `agents` SDK
 * (formerly `@cloudflare/agents`, then `agents-sdk`; import specifier is now
 * simply `agents`). If the import succeeds, the SDK version is used; otherwise
 * the dependency-free shim handles the request. The SDK import result is cached
 * so subsequent requests pay no additional cost.
 *
 * Bundling compatibility must be validated via `wrangler dev` or
 * `wrangler deploy` — a successful build confirms the SDK bundles cleanly
 * under wrangler v4 + `nodejs_compat`. If the build fails on `async_hooks`
 * or `path`, the shim remains the only active path.
 *
 * If `wrangler dev` and `wrangler deploy` succeed without bundler errors,
 * the custom shim in this file can be retired in a follow-up PR.
 *
 * @see https://github.com/jaypatrick/adblock-compiler/issues/1377
 */

import type { Env } from './types.ts';

// ---------------------------------------------------------------------------
// SDK compatibility probe — lazy-loaded on the first /agents/* request
// ---------------------------------------------------------------------------

type SdkRouteAgentRequest = (request: Request, env: unknown) => Promise<Response | null>;

// Cached Promise so the import runs at most once across all requests.
let sdkImportPromise: Promise<SdkRouteAgentRequest | null> | null = null;

/**
 * Returns the SDK's `routeAgentRequest` function if the `agents` package
 * imports successfully at runtime, or `null` otherwise.
 *
 * This is a runtime availability probe — it does NOT catch build-time bundler
 * failures. Bundler compatibility is validated by `wrangler dev`/`deploy`
 * completing without errors.
 */
function getSdkRouteAgentRequest(): Promise<SdkRouteAgentRequest | null> {
    if (sdkImportPromise === null) {
        sdkImportPromise = import('agents')
            .then((m) => (typeof m.routeAgentRequest === 'function' ? m.routeAgentRequest as SdkRouteAgentRequest : null))
            .catch(() => null);
    }
    return sdkImportPromise;
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
 * Delegates to the official `agents` SDK when available (lazy-loaded on first
 * `/agents/…` request), otherwise falls back to the custom shim.
 *
 * URL pattern: `/agents/{binding-kebab-case}/{agentId}[/*]`
 * Example SSE endpoint: `GET /agents/mcp-agent/default/sse`
 */
export async function routeAgentRequest(request: Request, env: Env): Promise<Response | null> {
    const url = new URL(request.url);
    // Only attempt SDK import for /agents/* paths — avoids any cost on normal API traffic.
    if (!url.pathname.startsWith('/agents/')) return customRouteAgentRequest(request, env);

    const sdkFn = await getSdkRouteAgentRequest();
    if (sdkFn) return sdkFn(request, env);
    return customRouteAgentRequest(request, env);
}

/**
 * Indicates whether a lazy SDK import has been triggered by an `/agents/…`
 * request. Returns `false` until the first such request is processed.
 *
 * Note: `true` means the import was *attempted* — not that it succeeded.
 * The import may have resolved to `null` if the `agents` package was
 * unavailable, in which case the fallback shim handles requests.
 * Exported for diagnostics only.
 */
export function isSdkRouteAvailable(): boolean {
    // Returns true once the import has been triggered (i.e., after first /agents/ request),
    // regardless of whether it resolved successfully.
    return sdkImportPromise !== null;
}
