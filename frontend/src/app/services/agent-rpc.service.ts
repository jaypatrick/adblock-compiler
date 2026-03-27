/**
 * @fileoverview AgentRpcService — Angular service for agent management HTTP API and WebSocket connections.
 *
 * This service is the single Angular gateway to:
 * 1. The admin REST API at /admin/agents/* (HTTP via HttpClient)
 * 2. The WebSocket agent transport at wss://<host>/agents/<slug>/<instanceId>
 *
 * ## Authentication
 * HTTP requests are authenticated automatically via the existing AuthInterceptor
 * that attaches the Clerk/Better-Auth Bearer token to every request.
 *
 * WebSocket connections use the Sec-WebSocket-Protocol header to pass the token,
 * which is the only standard mechanism available during the HTTP→WebSocket upgrade
 * handshake. The Cloudflare Agents SDK reads this header server-side.
 * Reference: https://developers.cloudflare.com/agents/configuration/authentication/
 *
 * ## WebSocket Reconnect
 * When a connection drops unexpectedly (not via `disconnect()`) the service
 * will attempt exponential-backoff reconnects up to MAX_RECONNECT_ATTEMPTS times.
 *
 * ## Usage
 * ```typescript
 * const agent = inject(AgentRpcService);
 * const sessions = await firstValueFrom(agent.listSessions());
 * const conn = agent.connect('mcp-agent');
 * conn.send('{"type":"ping"}');
 * ```
 *
 * See docs/frontend/AGENTS_FRONTEND.md for the full API reference and architecture.
 */

import { Injectable, inject, signal, DestroyRef } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import type {
    AgentSessionsResponse,
    AgentSessionDetailResponse,
    AgentAuditResponse,
    AgentConnection,
    AgentConnectionStatus,
    AgentMessage,
    AgentMessageType,
    AgentListItem,
} from '../models/agent.models';
import { KNOWN_AGENTS } from '../models/agent.models';

/** Maximum number of automatic WebSocket reconnect attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 5;

/** Base reconnect delay in milliseconds (doubles each attempt). */
const RECONNECT_BASE_DELAY_MS = 1000;

/**
 * AgentRpcService — manages agent HTTP API calls and WebSocket connections.
 *
 * Provided at the root level so that multiple components sharing the same
 * connection (e.g. AgentsDashboardComponent and AgentSessionConsoleComponent)
 * interact with a single service instance.
 */
@Injectable({ providedIn: 'root' })
export class AgentRpcService {
    /** Angular HttpClient injected via the inject() API (no constructor injection). */
    private readonly http = inject(HttpClient);

    // -------------------------------------------------------------------------
    // HTTP API — admin endpoints
    // -------------------------------------------------------------------------

    /**
     * Derives the list of known agents by merging the hardcoded KNOWN_AGENTS seed
     * with unique agent slugs observed in recent session history.
     *
     * A dedicated /admin/agents/registry endpoint does not yet exist; this method
     * seeds from KNOWN_AGENTS and augments each entry with active session counts
     * from the sessions list. When the backend registry endpoint is added, replace
     * this implementation with a direct HTTP call.
     *
     * @param page - Optional 0-based page index (default: 0).
     * @returns Observable of AgentListItem[] — one entry per known agent.
     */
    listAgents(page = 0): Observable<AgentListItem[]> {
        // Use map() to transform the sessions response into the AgentListItem[] array,
        // composing the observable chain declaratively rather than using a nested subscribe.
        return this.listSessions(page).pipe(
            map(res => {
                // Count active sessions per slug.
                const activeBySlug = new Map<string, number>();
                const lastActiveBySlug = new Map<string, string>();

                for (const session of res.sessions) {
                    if (!session.ended_at) {
                        activeBySlug.set(session.agent_slug, (activeBySlug.get(session.agent_slug) ?? 0) + 1);
                    }
                    // Track most recent started_at per slug.
                    const existing = lastActiveBySlug.get(session.agent_slug);
                    if (!existing || session.started_at > existing) {
                        lastActiveBySlug.set(session.agent_slug, session.started_at);
                    }
                }

                // Merge KNOWN_AGENTS with session-derived slugs.
                const knownSlugs = new Set(KNOWN_AGENTS.map(a => a.slug));
                const sessionSlugs = new Set(res.sessions.map(s => s.agent_slug));

                // Any slug in session history but not in KNOWN_AGENTS gets a stub entry.
                const dynamicAgents: AgentListItem[] = [...sessionSlugs]
                    .filter(slug => !knownSlugs.has(slug))
                    .map(slug => ({
                        bindingKey: slug.toUpperCase().replace(/-/g, '_'),
                        slug,
                        displayName: slug,
                        description: 'Dynamically discovered agent (not in registry seed).',
                        requiredTier: 'admin',
                        requiredScopes: [],
                        enabled: true,
                        transport: 'websocket' as const,
                        activeSessions: activeBySlug.get(slug) ?? 0,
                        lastActiveAt: lastActiveBySlug.get(slug) ?? null,
                    }));

                return [
                    ...KNOWN_AGENTS.map(entry => ({
                        ...entry,
                        activeSessions: activeBySlug.get(entry.slug) ?? 0,
                        lastActiveAt: lastActiveBySlug.get(entry.slug) ?? null,
                    })),
                    ...dynamicAgents,
                ];
            }),
        );
    }

    /**
     * Fetches a paginated list of agent sessions from GET /admin/agents/sessions.
     *
     * @param page - Optional 0-based page index (default: 0).
     * @param limit - Number of records per page (default: 25).
     * @returns Observable of AgentSessionsResponse.
     */
    listSessions(page = 0, limit = 25): Observable<AgentSessionsResponse> {
        const params = new HttpParams()
            .set('limit', limit)
            .set('offset', page * limit);

        return this.http
            .get<AgentSessionsResponse>('/admin/agents/sessions', { params })
            .pipe(catchError(this.handleHttpError));
    }

    /**
     * Fetches a single agent session with its nested invocations.
     * Calls GET /admin/agents/sessions/:id.
     *
     * @param id - The UUID of the session to fetch.
     * @returns Observable of AgentSessionDetailResponse (session + invocations[]).
     */
    getSession(id: string): Observable<AgentSessionDetailResponse> {
        return this.http
            .get<AgentSessionDetailResponse>(`/admin/agents/sessions/${encodeURIComponent(id)}`)
            .pipe(catchError(this.handleHttpError));
    }

    /**
     * Terminates an active agent session via DELETE /admin/agents/sessions/:id.
     * The backend returns 409 Conflict if the session is already ended.
     *
     * @param id - The UUID of the session to terminate.
     * @returns Observable of the raw success/error response.
     */
    terminateSession(id: string): Observable<{ readonly success: boolean; readonly error?: string }> {
        return this.http
            .delete<{ readonly success: boolean; readonly error?: string }>(`/admin/agents/sessions/${encodeURIComponent(id)}`)
            .pipe(catchError(this.handleHttpError));
    }

    /**
     * Fetches a paginated list of agent audit log entries.
     * Calls GET /admin/agents/audit.
     *
     * @param page - Optional 0-based page index (default: 0).
     * @param limit - Number of records per page (default: 25).
     * @returns Observable of AgentAuditResponse.
     */
    listAuditLog(page = 0, limit = 25): Observable<AgentAuditResponse> {
        const params = new HttpParams()
            .set('limit', limit)
            .set('offset', page * limit);

        return this.http
            .get<AgentAuditResponse>('/admin/agents/audit', { params })
            .pipe(catchError(this.handleHttpError));
    }

    // -------------------------------------------------------------------------
    // WebSocket — live agent connections
    // -------------------------------------------------------------------------

    /**
     * Opens a WebSocket connection to an agent Durable Object instance.
     *
     * ## Authentication pattern
     * Because browsers cannot set arbitrary HTTP headers during the WebSocket
     * upgrade handshake (only the `Sec-WebSocket-Protocol` header is available),
     * the auth token is passed as a sub-protocol string with the prefix "bearer.":
     *
     *   Sec-WebSocket-Protocol: bearer.<token>
     *
     * The Cloudflare Agents SDK parses this sub-protocol on the server side and
     * validates the token before upgrading the connection.
     * Reference: https://developers.cloudflare.com/agents/configuration/authentication/
     *
     * ## Reconnect policy
     * When the connection closes unexpectedly (code !== 1000 and not user-initiated),
     * the service will retry with exponential backoff:
     *   attempt 1: 1 s, attempt 2: 2 s, attempt 3: 4 s, attempt 4: 8 s, attempt 5: 16 s
     *
     * @param slug - The kebab-case agent slug (e.g. 'mcp-agent').
     * @param instanceId - The DO instance name (default: 'default').
     * @param token - Optional Bearer token. If omitted, connects without auth
     *                (will receive 401 from the backend on protected agents).
     * @param destroyRef - DestroyRef from the calling component for auto-cleanup.
     * @returns AgentConnection handle with reactive signals and control methods.
     */
    connect(slug: string, instanceId = 'default', token?: string, destroyRef?: DestroyRef): AgentConnection {
        // Signals for reactive state — readable from templates.
        const statusSignal = signal<AgentConnectionStatus>('connecting');
        const messagesSignal = signal<readonly AgentMessage[]>([]);

        // Internal mutable state (not exposed via signals).
        let ws: WebSocket | null = null;
        let reconnectAttempts = 0;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        /** Set to true when the user calls disconnect() — prevents reconnect. */
        let userInitiatedClose = false;

        /** Builds the wss:// URL for the agent DO instance. */
        const buildUrl = (): string => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            return `${protocol}//${window.location.host}/agents/${slug}/${instanceId}`;
        };

        /** Appends a message to the immutable messages signal array. */
        const appendMessage = (msg: AgentMessage): void => {
            messagesSignal.update(prev => [...prev, msg]);
        };

        /** Creates a new AgentMessage with a unique ID and current timestamp. */
        const makeMessage = (content: string, direction: 'in' | 'out', type: AgentMessageType): AgentMessage => ({
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            direction,
            content,
            type,
        });

        /** Opens the WebSocket and attaches lifecycle handlers. */
        const openSocket = (): void => {
            // Build protocol list — auth token is embedded as a sub-protocol.
            // The Cloudflare Agents SDK reads the "bearer.<token>" sub-protocol for auth.
            // See: https://developers.cloudflare.com/agents/configuration/authentication/
            //
            // Security note: The Sec-WebSocket-Protocol header uses comma as a separator.
            // JWT/Bearer tokens from Clerk/Better Auth are Base64url-encoded strings that
            // contain only [A-Za-z0-9._-] — safe to embed directly. Strip any whitespace or
            // commas defensively to prevent header injection if an unexpected token format arrives.
            const safeToken = token?.replace(/[\s,]/g, '') ?? '';
            const protocols: string[] = safeToken ? [`bearer.${safeToken}`] : [];

            ws = new WebSocket(buildUrl(), protocols);
            statusSignal.set('connecting');

            ws.onopen = () => {
                statusSignal.set('connected');
                reconnectAttempts = 0; // Reset on successful connect.
                appendMessage(makeMessage('WebSocket connection established.', 'in', 'system'));
            };

            ws.onmessage = (event: MessageEvent) => {
                // Detect whether the payload is JSON for richer display.
                let type: AgentMessageType = 'text';
                let content = typeof event.data === 'string' ? event.data : String(event.data);

                try {
                    JSON.parse(content);
                    type = 'json';
                } catch {
                    // Not JSON — keep type as 'text'.
                }

                appendMessage(makeMessage(content, 'in', type));
            };

            ws.onerror = () => {
                // The error event fires immediately before onclose; we capture it
                // to distinguish error-close from clean-close.
                statusSignal.set('error');
                appendMessage(makeMessage('WebSocket error occurred.', 'in', 'error'));
            };

            ws.onclose = (event: CloseEvent) => {
                ws = null;

                if (userInitiatedClose || event.code === 1000) {
                    // Clean close — do not reconnect.
                    statusSignal.set('disconnected');
                    appendMessage(makeMessage(`Connection closed (code ${event.code}).`, 'in', 'system'));
                    return;
                }

                // Unexpected close — attempt reconnect with exponential backoff.
                // Pre-calculated delays: [1s, 2s, 4s, 8s, 16s] — avoids Math.pow on hot path.
                const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000] as const;
                if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    const delayMs = RECONNECT_DELAYS_MS[reconnectAttempts] ?? RECONNECT_BASE_DELAY_MS;
                    reconnectAttempts++;
                    statusSignal.set('connecting');
                    appendMessage(
                        makeMessage(
                            `Connection lost. Reconnecting in ${delayMs / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})…`,
                            'in',
                            'system',
                        ),
                    );
                    reconnectTimer = setTimeout(openSocket, delayMs);
                } else {
                    statusSignal.set('error');
                    appendMessage(makeMessage(`Reconnect limit (${MAX_RECONNECT_ATTEMPTS}) reached. Please reconnect manually.`, 'in', 'error'));
                }
            };
        };

        // Open the initial socket — deferred to ensure signals are wired first.
        openSocket();

        /** Tears down the WebSocket and cancels any pending reconnect. */
        const cleanup = (): void => {
            userInitiatedClose = true;
            if (reconnectTimer !== null) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            if (ws !== null) {
                ws.close(1000, 'Component destroyed');
                ws = null;
            }
        };

        // Auto-cleanup when the calling component is destroyed.
        if (destroyRef) {
            destroyRef.onDestroy(cleanup);
        }

        // Return the AgentConnection handle.
        return {
            status: statusSignal.asReadonly(),
            messages: messagesSignal.asReadonly(),

            /** Sends a text message. No-op if the socket is not in OPEN state. */
            send(message: string): void {
                if (ws?.readyState === WebSocket.OPEN) {
                    ws.send(message);
                    appendMessage(makeMessage(message, 'out', 'text'));
                }
            },

            /** Closes the WebSocket and stops reconnect attempts. */
            disconnect(): void {
                cleanup();
                statusSignal.set('disconnected');
            },
        };
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Centralised HTTP error handler.
     * Maps HttpErrorResponse to a user-friendly observable error with a
     * `{ success: false, error: string }` envelope matching the backend shape.
     *
     * Special handling:
     * - 429 Too Many Requests: includes Retry-After value if present.
     * - 409 Conflict: indicates the session was already terminated.
     *
     * @param error - The HttpErrorResponse from Angular's HttpClient.
     * @returns An error Observable carrying the processed error object.
     */
    private handleHttpError(error: HttpErrorResponse): Observable<never> {
        let message = 'An unexpected error occurred.';

        if (error.status === 429) {
            const retryAfter = error.headers.get('Retry-After');
            message = retryAfter
                ? `Rate limited — try again in ${retryAfter} seconds.`
                : 'Rate limited — please wait before retrying.';
        } else if (error.status === 409) {
            message = 'Session is already terminated.';
        } else if (error.status === 403) {
            message = 'Insufficient permissions to perform this action.';
        } else if (error.status === 401) {
            message = 'Authentication required. Please sign in.';
        } else if (error.error && typeof error.error === 'object' && 'error' in error.error) {
            message = String((error.error as { error: unknown }).error);
        }

        return throwError(() => ({ success: false as const, error: message, status: error.status }));
    }
}
