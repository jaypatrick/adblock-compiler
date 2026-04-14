/**
 * @fileoverview Agent domain model types.
 *
 * Mirrors the backend AgentRegistryEntry, AgentSession, AgentInvocation, and
 * AgentAuditLog shapes defined in worker/agents/registry.ts and the D1/Neon
 * schema from migrations/0008_agent_sessions.sql.
 *
 * See docs/cloudflare/AGENTS.md for the full backend contract.
 */

/** Connection status of an active WebSocket session. */
export type AgentConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/** Content kind of a message shown in the session console (text, structured JSON, error, or system event). */
export type AgentMessageType = 'text' | 'json' | 'error' | 'system';

/** Primary transport mechanism for an agent. */
export type AgentTransport = 'websocket' | 'sse';

/**
 * Mirrors the backend AgentRegistryEntry shape from worker/agents/registry.ts.
 * This is the single source of truth for agent metadata on the backend; the
 * frontend uses a read-only projection of this for display.
 */
export interface AgentRegistryEntry {
    /** UPPER_SNAKE_CASE Durable Object binding key from wrangler.toml. */
    readonly bindingKey: string;
    /** kebab-case URL slug — maps to /agents/<slug>/<instanceId>. */
    readonly slug: string;
    /** Human-readable display name shown in the admin UI. */
    readonly displayName: string;
    /** One-line description of what the agent does. */
    readonly description: string;
    /** Minimum user tier required to connect (e.g. "admin"). */
    readonly requiredTier: string;
    /** OAuth/API-key scopes required for non-session callers. */
    readonly requiredScopes: readonly string[];
    /** When false, the agent route is disabled in the registry. */
    readonly enabled: boolean;
    /** Primary transport: WebSocket (default) or Server-Sent Events. */
    readonly transport: AgentTransport;
}

/**
 * A single agent session row from agent_sessions (D1/Neon).
 * Returned by GET /admin/agents/sessions and GET /admin/agents/sessions/:id.
 */
export interface AgentSession {
    /** UUID primary key. */
    readonly id: string;
    /** Better Auth user ID of the session owner. */
    readonly user_id: string;
    /** kebab-case agent slug (e.g. 'mcp-agent'). */
    readonly agent_slug: string;
    /** Durable Object instance name (e.g. 'default'). */
    readonly instance_id: string;
    /** ISO 8601 timestamp when the session was created. */
    readonly started_at: string;
    /** ISO 8601 timestamp when the session ended; null if still active. */
    readonly ended_at: string | null;
    /** Human-readable reason for session end (e.g. 'admin_terminated'). */
    readonly end_reason: string | null;
    /** Client IP address captured at session start. */
    readonly ip_address: string | null;
    /** HTTP User-Agent captured at session start. */
    readonly user_agent: string | null;
}

/**
 * A single tool/function invocation within an AgentSession.
 * Nested inside GET /admin/agents/sessions/:id responses.
 */
export interface AgentInvocation {
    /** UUID primary key. */
    readonly id: string;
    /** Foreign key to agent_sessions.id. */
    readonly session_id: string;
    /** MCP tool name or function identifier. */
    readonly tool_name: string;
    /** JSON-serialised input parameters. */
    readonly input_params: string | null;
    /** JSON-serialised output result. */
    readonly output_result: string | null;
    /** ISO 8601 start timestamp. */
    readonly started_at: string;
    /** ISO 8601 end timestamp; null if still running. */
    readonly ended_at: string | null;
    /** True when the invocation completed successfully. */
    readonly success: boolean;
    /** Error message if success is false. */
    readonly error_message: string | null;
}

/**
 * An entry in the agent_audit_log table.
 * Returned by GET /admin/agents/audit.
 */
export interface AgentAuditLogEntry {
    /** UUID primary key. */
    readonly id: string;
    /** Foreign key to agent_sessions.id; may be null for non-session events. */
    readonly session_id: string | null;
    /** Better Auth user ID. */
    readonly user_id: string;
    /** kebab-case agent slug. */
    readonly agent_slug: string;
    /** Type of event (e.g. 'session_start', 'session_end', 'auth_failure'). */
    readonly event_type: string;
    /** JSON-serialised event details. */
    readonly details: string | null;
    /** Client IP address. */
    readonly ip_address: string | null;
    /** ISO 8601 timestamp. */
    readonly created_at: string;
}

/**
 * A single message in the WebSocket session console.
 * Used by AgentConnection.messages signal and rendered by AgentSessionConsoleComponent.
 */
export interface AgentMessage {
    /** Client-generated UUID (crypto.randomUUID()). */
    readonly id: string;
    /** ISO 8601 timestamp when the message was created/received. */
    readonly timestamp: string;
    /** 'in' = received from the agent; 'out' = sent by the user. */
    readonly direction: 'in' | 'out';
    /** Raw message payload (text or stringified JSON). */
    readonly content: string;
    /** Structural type of the message content. */
    readonly type: AgentMessageType;
}

/**
 * Handle returned by AgentRpcService.connect().
 * Provides reactive signals for connection state and message history,
 * plus imperative send/disconnect controls.
 */
export interface AgentConnection {
    /** Reactive signal reflecting the current WebSocket lifecycle state. */
    readonly status: import('@angular/core').Signal<AgentConnectionStatus>;
    /** Reactive signal holding the ordered list of messages received and sent. */
    readonly messages: import('@angular/core').Signal<readonly AgentMessage[]>;
    /** Send a text message over the open WebSocket. No-op when not connected. */
    send(message: string): void;
    /** Close the WebSocket and stop any pending reconnect timer. */
    disconnect(): void;
}

/**
 * UI-friendly view model derived from AgentRegistryEntry for use in
 * AgentsDashboardComponent agent cards. Augments the registry entry with
 * session-count data loaded asynchronously.
 */
export interface AgentListItem extends AgentRegistryEntry {
    /** Number of currently active (ended_at IS NULL) sessions. */
    readonly activeSessions: number;
    /** ISO 8601 timestamp of the most recent session start; null if no sessions. */
    readonly lastActiveAt: string | null;
}

/**
 * Paginated response envelope from GET /admin/agents/sessions.
 */
export interface AgentSessionsResponse {
    readonly success: boolean;
    readonly sessions: readonly AgentSession[];
    readonly total: number;
    readonly limit: number;
    readonly offset: number;
}

/**
 * Paginated response envelope from GET /admin/agents/audit.
 */
export interface AgentAuditResponse {
    readonly success: boolean;
    readonly items: readonly AgentAuditLogEntry[];
    readonly total: number;
    readonly limit: number;
    readonly offset: number;
}

/**
 * Response from GET /admin/agents/sessions/:id — includes nested invocations.
 */
export interface AgentSessionDetailResponse {
    readonly success: boolean;
    readonly session: AgentSession;
    readonly invocations: readonly AgentInvocation[];
}

/**
 * Hardcoded seed registry for known agents.
 * This is used by AgentRpcService to seed the agent list since a dedicated
 * /admin/agents/registry endpoint does not yet exist on the backend.
 * When that endpoint is added, this list should be replaced with an API call.
 */
export const KNOWN_AGENTS: readonly AgentRegistryEntry[] = [
    {
        bindingKey: 'MCP_AGENT',
        slug: 'mcp-agent',
        displayName: 'Playwright MCP Agent',
        description: 'Headless browser automation agent using Model Context Protocol (MCP) and Playwright for Cloudflare Browser Rendering.',
        requiredTier: 'admin',
        requiredScopes: ['agents'],
        enabled: true,
        transport: 'websocket',
    },
] as const;
