/// <reference types="@cloudflare/workers-types" />

/**
 * WsHibernationDO — Durable Object for hibernatable WebSocket connections.
 *
 * Implements the Cloudflare Hibernatable WebSocket API so long-lived
 * connections survive Worker isolate teardown between messages.  Between
 * client messages the DO hibernates (no memory, no billing), but the TCP/TLS
 * connection is kept open by the Cloudflare edge.  When the next message
 * arrives Cloudflare wakes the DO and calls `webSocketMessage()`.
 *
 * Additionally, this DO tracks **session presence**: every connected client
 * is recorded in DO Storage keyed by its WebSocket tag, so the Worker can
 * query how many (and which) clients are currently connected.
 *
 * **Key differences from the plain websocket.ts handler**:
 * | Feature               | websocket.ts (`ws.accept()`)    | WsHibernationDO                  |
 * |-----------------------|---------------------------------|----------------------------------|
 * | Idle cost             | Worker instance stays alive     | DO hibernates, zero cost         |
 * | Connection limit      | Bounded by Worker memory        | Cloudflare manages connections   |
 * | State on wake-up      | Lost (new isolate)              | Restored from DO Storage         |
 * | Session presence API  | None                            | `/sessions` endpoint             |
 *
 * **Architecture**:
 * - One DO instance per logical "room" or compilation session.  Use
 *   `idFromName(roomId)` to route all sockets for the same room to the same DO.
 * - Each `acceptWebSocket(ws, [tag])` call registers the WS with the
 *   Cloudflare hibernation runtime.  The DO class becomes the event target
 *   via `webSocketMessage` / `webSocketClose` / `webSocketError` methods.
 * - Session metadata (`{ tag, connectedAt, lastActivity, userId? }`) is stored
 *   in DO Storage so it survives hibernation and can be queried by admin tooling.
 *
 * **Hono routing** (internal HTTP — not exposed to end-users directly):
 * ```
 * GET  /ws               → WebSocket upgrade (hibernatable)
 * GET  /sessions         → list active sessions
 * POST /broadcast        → push message to all (or tagged) sockets
 * POST /disconnect       → force-close a tagged socket
 * ```
 *
 * **Usage from Worker**:
 * ```ts
 * // In a Hono route handler
 * const roomId = 'global'; // or c.get('authContext').userId
 * const id = env.WS_HIBERNATION_DO.idFromName(roomId);
 * const stub = env.WS_HIBERNATION_DO.get(id);
 * return stub.fetch(c.req.raw); // forwards Upgrade: websocket request
 * ```
 *
 * @see https://developers.cloudflare.com/durable-objects/best-practices/websockets/
 * @see docs/architecture/durable-objects.md
 */

import { Hono } from 'hono';
import { z } from 'zod';

// ============================================================================
// Schemas
// ============================================================================

/** Persisted metadata for a single WebSocket session. */
export const SessionMetaSchema = z.object({
    tag: z.string(),
    connectedAt: z.number(),
    lastActivity: z.number(),
    userId: z.string().optional(),
});

export type SessionMeta = z.infer<typeof SessionMetaSchema>;

export const BroadcastRequestSchema = z.object({
    /** Message payload (JSON-serialisable). */
    message: z.unknown(),
    /** If provided, only sockets whose tag matches receive the message. */
    tag: z.string().optional(),
});

export const DisconnectRequestSchema = z.object({
    tag: z.string(),
    code: z.number().int().min(1000).max(4999).optional().default(1000),
    reason: z.string().max(123).optional().default('Disconnected by server'),
});

/** WebSocket message payload — sent by clients to the server. */
export const WsClientMessageSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('ping') }),
    // `presence` signals the client is active; userId comes from the authenticated
    // session established at connection time — clients cannot set it themselves.
    z.object({ type: z.literal('presence') }),
    z.object({
        type: z.literal('message'),
        data: z.unknown(),
    }),
]);

export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;

// ============================================================================
// Storage key helpers
// ============================================================================

const sessionKey = (tag: string): string => `session:${tag}`;

// ============================================================================
// Durable Object
// ============================================================================

/**
 * Durable Object that provides hibernatable WebSocket connections with
 * session-presence tracking.
 */
export class WsHibernationDO implements DurableObject {
    private readonly state: DurableObjectState;
    private readonly app: Hono;

    constructor(state: DurableObjectState, _env: unknown) {
        this.state = state;
        this.app = new Hono();
        this.setupRoutes();
    }

    // --------------------------------------------------------------------------
    // HTTP routes (internal management API)
    // --------------------------------------------------------------------------

    private setupRoutes(): void {
        /**
         * GET /ws
         * WebSocket upgrade endpoint.  Clients connect here; the DO accepts
         * the socket via the hibernatable API.
         *
         * Query params:
         *   tag      - optional session tag (defaults to a random ID)
         *   userId   - optional authenticated user ID for presence tracking
         */
        this.app.get('/ws', async (c) => {
            const upgradeHeader = c.req.header('Upgrade');
            if (upgradeHeader !== 'websocket') {
                return c.text('Expected WebSocket upgrade', 426);
            }

            // Use crypto.randomUUID() for unpredictable session tags. Client-supplied
            // tags are ignored to prevent session impersonation.
            const tag = `ws-${crypto.randomUUID()}`;
            // userId comes from the X-User-Id header set by the authenticated Worker route —
            // never from the client-supplied query string (would allow impersonation).
            const userId = c.req.header('X-User-Id') ?? undefined;

            // Create WebSocket pair
            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);

            // Accept via hibernatable API — DO becomes the event target.
            this.state.acceptWebSocket(server, [tag]);

            // Persist session metadata so it survives hibernation.
            const meta: SessionMeta = {
                tag,
                connectedAt: Date.now(),
                lastActivity: Date.now(),
                userId,
            };
            await this.state.storage.put(sessionKey(tag), meta);

            // Send welcome frame — client knows the session tag.
            server.send(JSON.stringify({ type: 'welcome', tag, connectedAt: meta.connectedAt }));

            return new Response(
                null,
                {
                    status: 101,
                    webSocket: client,
                } as ResponseInit & { webSocket: WebSocket },
            );
        });

        /**
         * GET /sessions
         * Returns all active session metadata stored in DO Storage.
         * Includes sessions whose WebSocket may currently be hibernated.
         */
        this.app.get('/sessions', async (c) => {
            const sessions = await this.loadAllSessions();
            return c.json({ sessions, total: sessions.length });
        });

        /**
         * POST /broadcast
         * Push a message to all connected (or tag-filtered) WebSockets.
         */
        this.app.post('/broadcast', async (c) => {
            const parsed = BroadcastRequestSchema.safeParse(await c.req.json());
            if (!parsed.success) {
                return c.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' }, 400);
            }
            const { message, tag } = parsed.data;
            const sockets = tag ? this.state.getWebSockets(tag) : this.state.getWebSockets();
            const payload = JSON.stringify(message);
            let sent = 0;
            for (const ws of sockets) {
                try {
                    ws.send(payload);
                    sent++;
                } catch {
                    // Socket may have been closed between getWebSockets() and send().
                }
            }
            return c.json({ success: true, sent });
        });

        /**
         * POST /disconnect
         * Force-close a specific tagged WebSocket.
         */
        this.app.post('/disconnect', async (c) => {
            const parsed = DisconnectRequestSchema.safeParse(await c.req.json());
            if (!parsed.success) {
                return c.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' }, 400);
            }
            const { tag, code, reason } = parsed.data;
            const sockets = this.state.getWebSockets(tag);
            for (const ws of sockets) {
                try {
                    ws.close(code, reason);
                } catch {
                    // Already closed.
                }
            }
            await this.state.storage.delete(sessionKey(tag));
            return c.json({ success: true, closed: sockets.length });
        });
    }

    // --------------------------------------------------------------------------
    // Hibernatable WebSocket event handlers
    // --------------------------------------------------------------------------

    /**
     * Called by Cloudflare when a hibernated (or active) WebSocket receives a
     * message.  The DO is woken up if it was hibernating.
     */
    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
        // Retrieve the tag(s) for this socket so we can update session metadata.
        const tags = this.state.getTags(ws);
        const tag = tags[0];

        if (tag) {
            await this.updateLastActivity(tag);
        }

        const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);

        let parsed: WsClientMessage | null = null;
        try {
            const json = JSON.parse(raw);
            const result = WsClientMessageSchema.safeParse(json);
            parsed = result.success ? result.data : null;
        } catch {
            // Non-JSON messages are treated as raw text.
        }

        if (parsed === null) {
            ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
            return;
        }

        switch (parsed.type) {
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
                break;

            case 'presence': {
                // The session's userId is set from the authenticated X-User-Id header
                // at connection time. Clients cannot override it via presence messages.
                const sessions = await this.loadAllSessions();
                ws.send(JSON.stringify({ type: 'presence:update', sessions }));
                break;
            }

            case 'message':
                // Echo the message back (can be extended to broadcast or process).
                ws.send(JSON.stringify({ type: 'message:ack', data: parsed.data, timestamp: new Date().toISOString() }));
                break;
        }
    }

    /**
     * Called when a WebSocket is closed (either by client or server).
     */
    async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
        const tags = this.state.getTags(ws);
        const tag = tags[0];
        if (tag) {
            await this.state.storage.delete(sessionKey(tag));
        }
    }

    /**
     * Called when a WebSocket error occurs.
     */
    async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
        const tags = this.state.getTags(ws);
        const tag = tags[0];
        if (tag) {
            await this.state.storage.delete(sessionKey(tag));
        }
        try {
            ws.close(1011, 'Internal error');
        } catch {
            // Already closed.
        }
    }

    // --------------------------------------------------------------------------
    // Storage helpers
    // --------------------------------------------------------------------------

    private async loadAllSessions(): Promise<SessionMeta[]> {
        const entries = await this.state.storage.list<SessionMeta>({ prefix: 'session:' });
        const results: SessionMeta[] = [];
        for (const [, value] of entries) {
            const parsed = SessionMetaSchema.safeParse(value);
            if (parsed.success) {
                results.push(parsed.data);
            }
        }
        return results;
    }

    private async updateLastActivity(tag: string): Promise<void> {
        const key = sessionKey(tag);
        const existing = await this.state.storage.get<SessionMeta>(key);
        if (existing) {
            await this.state.storage.put(key, { ...existing, lastActivity: Date.now() });
        }
    }

    // --------------------------------------------------------------------------
    // Durable Object interface
    // --------------------------------------------------------------------------

    fetch(request: Request): Promise<Response> {
        return Promise.resolve(this.app.fetch(request));
    }
}
