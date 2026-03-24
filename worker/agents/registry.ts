/**
 * Agent Registry — single source of truth for all Cloudflare Agents in this Worker.
 *
 * To add a new agent:
 *   1. Add a `[[durable_objects.bindings]]` entry in `wrangler.toml` with the DO
 *      class name and a binding name (UPPER_SNAKE_CASE).
 *   2. Add the corresponding binding key (same UPPER_SNAKE_CASE) to the `Env`
 *      interface in `worker/types.ts`.
 *   3. Export the agent class from `worker/worker.ts`.
 *   4. Add one entry to `AGENT_REGISTRY` below — all routing, auth, and permission
 *      wiring is derived automatically from this entry.
 *
 * @see https://developers.cloudflare.com/agents/getting-started/add-to-existing-project/
 * @see https://developers.cloudflare.com/agents/configuration/authentication/
 */

import type { Env } from '../types.ts';
import { UserTier } from '../types.ts';

// ============================================================================
// Types
// ============================================================================

/**
 * A single registered agent entry describing everything needed to route,
 * authenticate, and document an agent endpoint.
 */
export interface AgentRegistryEntry {
    /** Binding key in Env (UPPER_SNAKE_CASE), e.g. 'MCP_AGENT'. Must match wrangler.toml. */
    readonly bindingKey: keyof Env;
    /** URL slug used in /agents/{slug}/{instanceId}. Must be kebab-case. */
    readonly slug: string;
    /** Human-readable name for admin UI and audit logs. */
    readonly displayName: string;
    /** Description shown in admin panel and OpenAPI docs. */
    readonly description: string;
    /** Minimum tier required to connect — currently always UserTier.Admin. */
    readonly requiredTier: UserTier;
    /**
     * Additional scopes required beyond tier gating.
     * Empty array = tier check only.
     * Only applies to API-key authenticated requests; session users bypass scope checks.
     */
    readonly requiredScopes: readonly string[];
    /** Whether this agent is currently enabled and accepting connections. */
    readonly enabled: boolean;
    /**
     * Transport protocol.
     * - 'websocket': recommended for new agents; supports DO hibernation
     * - 'sse': Server-Sent Events; supported for backward compatibility with MCP clients
     * All new agents MUST use 'websocket'.
     */
    readonly transport: 'websocket' | 'sse';
}

// ============================================================================
// Registry
// ============================================================================

/**
 * The canonical list of all agents deployed in this Worker.
 *
 * This is the **only** place agent metadata should live. Routing, auth
 * middleware, and the route-permission registry all derive their behaviour
 * from this list — never from hardcoded string arrays.
 */
export const AGENT_REGISTRY: readonly AgentRegistryEntry[] = [
    {
        bindingKey: 'MCP_AGENT',
        slug: 'mcp-agent',
        displayName: 'Playwright MCP Agent',
        description: 'Browser automation agent via Cloudflare Browser Rendering + Model Context Protocol',
        requiredTier: UserTier.Admin,
        requiredScopes: [],
        enabled: true,
        // TODO(hibernation): upgrade to 'websocket' once @cloudflare/playwright-mcp
        // exposes an Agent base-class that supports ctx.acceptWebSocket().
        // Tracked in issue #1377.  SSE is kept for backward compatibility with
        // existing MCP clients (GitHub Copilot, Claude Desktop, etc.).
        transport: 'websocket',
    },
    // ── Add new agents here ─────────────────────────────────────────────────
    // Each entry = full routing + auth + permission wiring.
    // Steps: see JSDoc at top of this file.
] as const;

// ============================================================================
// Utilities
// ============================================================================

/**
 * Look up a registered, enabled agent by its URL slug.
 *
 * O(n) over the registry — acceptable for small agent counts.
 *
 * @returns The matching entry, or `undefined` if not found or disabled.
 */
export function getAgentBySlug(slug: string): AgentRegistryEntry | undefined {
    return AGENT_REGISTRY.find((a) => a.slug === slug && a.enabled);
}

/**
 * Returns all currently enabled agent entries.
 * Useful for generating admin UI tables and OpenAPI documentation.
 */
export function getEnabledAgents(): readonly AgentRegistryEntry[] {
    return AGENT_REGISTRY.filter((a) => a.enabled);
}
