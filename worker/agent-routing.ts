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
 * The `agentNameToBindingKey` utility function is preserved here for
 * backwards compatibility and is still used by tests and the registry
 * integrity validator.
 *
 * @see https://developers.cloudflare.com/agents/getting-started/add-to-existing-project/
 */

import type { Env } from './types.ts';
import { getOrCreateUserAgent } from './dynamic-workers/index.ts';

// ---------------------------------------------------------------------------
// SDK lazy-loader
// ---------------------------------------------------------------------------

/** Signature of the `routeAgentRequest` function exported by the `agents` SDK. */
type SdkRouteAgentRequest = (request: Request, env: unknown) => Promise<Response | null>;

/** Cached import promise — populated on the first /agents/* request. */
let sdkImportPromise: Promise<SdkRouteAgentRequest> | null = null;

/**
 * Returns the SDK's `routeAgentRequest` function, lazy-loaded on first use.
 * The `agents` package uses cloudflare: scheme imports that are only available
 * inside the Workers runtime — lazy loading avoids crashes in Deno test runs.
 *
 * On import failure the cached promise is cleared so subsequent requests can
 * retry (rather than caching a permanent rejection).
 */
function getSdkRouteAgentRequest(): Promise<SdkRouteAgentRequest> {
    if (sdkImportPromise === null) {
        sdkImportPromise = import('agents').then((m) => {
            if (typeof m.routeAgentRequest !== 'function') {
                throw new Error('agents SDK: routeAgentRequest is not a function');
            }
            return m.routeAgentRequest as SdkRouteAgentRequest;
        }).catch((err) => {
            // Clear the cache so the next request retries the import rather than
            // receiving a permanently-rejected promise.
            sdkImportPromise = null;
            throw err;
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
 * Dynamic Workers fast-path: if `env.LOADER` is bound and the request carries
 * an authenticated `X-User-Id` header, the request is first offered to a
 * per-user Dynamic Worker via `getOrCreateUserAgent()`. Falls back to the
 * agents SDK when the LOADER binding is absent or the Dynamic Worker returns null.
 *
 * Delegates to the official `agents` SDK (`routeAgentRequest`).
 *
 * If the SDK import fails (e.g. misconfigured runtime, missing binding), returns
 * a structured 503 JSON response so failures degrade predictably rather than
 * surfacing as unhandled 500 errors.
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

    // ── Dynamic Workers fast-path (per-user isolate) ─────────────────────────
    // Only attempted when LOADER is bound and a verified user ID is present.
    const userId = request.headers.get('X-User-Id');
    if (userId && env.LOADER) {
        try {
            const dynamicResponse = await getOrCreateUserAgent(env, userId, request);
            if (dynamicResponse) return dynamicResponse;
        } catch (err) {
            // deno-lint-ignore no-console
            console.warn(
                '[agent-routing] Dynamic Worker fast-path failed, falling back to SDK:',
                err instanceof Error ? err.message : String(err),
            );
        }
    }

    // ── Standard SDK path ────────────────────────────────────────────────────
    try {
        const sdkFn = await getSdkRouteAgentRequest();
        return await sdkFn(request, env as unknown);
    } catch (err) {
        // deno-lint-ignore no-console
        console.error('[agent-routing] agents SDK call failed:', err instanceof Error ? err.message : String(err));
        return new Response(
            JSON.stringify({ success: false, error: 'Agent SDK unavailable — please retry' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
    }
}
