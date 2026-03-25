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
import { agentNameToBindingKey } from '../agent-routing.ts';

// ============================================================================
// Types
// ============================================================================

/**
 * A single registered agent entry describing everything needed to route,
 * authenticate, and document an agent endpoint.
 *
 * ## `bindingKey` ↔ `slug` invariant
 * `bindingKey` MUST equal `agentNameToBindingKey(slug)`.
 * i.e. `'mcp-agent'` → `'MCP_AGENT'`.
 * This invariant is enforced at test time by `validateAgentRegistry()`.
 */
export interface AgentRegistryEntry {
    /**
     * Binding key in Env (UPPER_SNAKE_CASE), e.g. 'MCP_AGENT'. Must match wrangler.toml.
     * Must equal `agentNameToBindingKey(slug)` — validated by `validateAgentRegistry()`.
     */
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
     * - 'sse': Server-Sent Events; backward compatibility with MCP clients
     * - 'dynamic-worker': ephemeral V8 isolate via DYNAMIC_WORKER_LOADER; for stateless tasks
     *
     * @see https://developers.cloudflare.com/dynamic-workers/
     * @see https://github.com/jaypatrick/adblock-compiler/issues/1386
     */
    readonly transport: 'websocket' | 'sse' | 'dynamic-worker';
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
        // API-key callers must hold the 'agents' scope in addition to the Admin
        // tier requirement.  Session-based callers (better-auth) bypass scope
        // checks entirely (requireScope() is a no-op for session auth).
        requiredScopes: ['agents'],
        enabled: true,
        // SSE is used for backward compatibility with existing MCP clients
        // (GitHub Copilot, Claude Desktop, etc.) that connect via /sse.
        // The agents SDK's routeAgentRequest handles both SSE and WebSocket
        // upgrade requests transparently — the transport field here indicates
        // the *preferred* transport for new client connections.
        //
        // TODO(hibernation): Verify that @cloudflare/playwright-mcp's Agent
        // base class calls this.ctx.acceptWebSocket() to enable DO hibernation.
        // If not, a wrapper class extending the SDK Agent base will be needed.
        // Tracked in issue #1377.
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

/**
 * Validates that the `AGENT_REGISTRY` is internally consistent.
 *
 * Checks enforced:
 * - All slugs are unique.
 * - Each `bindingKey` equals `agentNameToBindingKey(slug)` — prevents slug↔binding drift.
 *
 * @returns An array of error messages. Empty array = registry is valid.
 *
 * @example
 * ```typescript
 * const errors = validateAgentRegistry();
 * if (errors.length > 0) throw new Error(errors.join('\n'));
 * ```
 */
export function validateAgentRegistry(): readonly string[] {
    const errors: string[] = [];
    const slugsSeen = new Set<string>();

    for (const entry of AGENT_REGISTRY) {
        // 1. Unique slugs
        if (slugsSeen.has(entry.slug)) {
            errors.push(`Duplicate slug '${entry.slug}' in AGENT_REGISTRY`);
        }
        slugsSeen.add(entry.slug);

        // 2. bindingKey must match agentNameToBindingKey(slug)
        const expected = agentNameToBindingKey(entry.slug);
        if (String(entry.bindingKey) !== expected) {
            errors.push(
                `Registry entry '${entry.slug}': bindingKey '${String(entry.bindingKey)}' ` +
                    `does not match agentNameToBindingKey('${entry.slug}') = '${expected}'. ` +
                    `They must be kept in sync.`,
            );
        }
    }

    return errors;
}
