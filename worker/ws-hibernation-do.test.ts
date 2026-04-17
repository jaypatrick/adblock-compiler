/**
 * Tests for the WsHibernationDO Durable Object.
 *
 * Covers request handling plus WebSocket message and lifecycle behavior that is
 * explicitly asserted in this file.
 */

import { assertEquals, assertExists } from '@std/assert';
import { WsHibernationDO } from './ws-hibernation-do.ts';
import type { SessionMeta } from './ws-hibernation-do.ts';

// ============================================================================
// Mock helpers
// ============================================================================

interface MockWebSocket {
    sent: unknown[];
    closedWith: { code: number; reason: string } | null;
    send(msg: string): void;
    close(code?: number, reason?: string): void;
}

function createMockWebSocket(): MockWebSocket {
    return {
        sent: [],
        closedWith: null,
        send(msg: string) {
            this.sent.push(JSON.parse(msg));
        },
        close(code = 1000, reason = '') {
            this.closedWith = { code, reason };
        },
    };
}

function createMockState(initialStore: Record<string, unknown> = {}): DurableObjectState {
    const store = new Map<string, unknown>(Object.entries(initialStore));

    // Map from tag to mock WebSocket for getWebSockets support
    const wsByTag = new Map<string, MockWebSocket[]>();
    const wsTags = new Map<MockWebSocket, string[]>();

    const storage = {
        get: async <T>(key: string): Promise<T | undefined> => store.get(key) as T | undefined,
        put: async (keyOrEntries: string | Record<string, unknown>, value?: unknown) => {
            if (typeof keyOrEntries === 'string') {
                store.set(keyOrEntries, value);
            } else {
                for (const [k, v] of Object.entries(keyOrEntries)) {
                    store.set(k, v);
                }
            }
        },
        delete: async (key: string) => store.delete(key),
        deleteAll: async () => store.clear(),
        list: async <T>(opts?: { prefix?: string }) => {
            const result = new Map<string, T>();
            for (const [k, v] of store.entries()) {
                if (!opts?.prefix || k.startsWith(opts.prefix)) {
                    result.set(k, v as T);
                }
            }
            return result;
        },
        getAlarm: async () => null,
        setAlarm: async () => {},
        deleteAlarm: async () => {},
        sync: async () => {},
        transaction: () => {},
        transactionAsync: async (fn: () => Promise<unknown>) => await fn(),
        getCurrentTags: () => [],
        setCurrentTags: () => {},
    } as unknown as DurableObjectStorage;

    return {
        id: { toString: () => 'ws-hibernation-test-id', equals: () => false, name: 'ws-hibernation-test' },
        storage,
        props: {},
        blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => await fn(),
        waitUntil: () => {},
        acceptWebSocket: (ws: MockWebSocket, tags: string[] = []) => {
            wsTags.set(ws, tags);
            for (const tag of tags) {
                const list = wsByTag.get(tag) ?? [];
                list.push(ws);
                wsByTag.set(tag, list);
            }
        },
        getWebSockets: (tag?: string) => {
            if (tag) return wsByTag.get(tag) ?? [];
            const all: MockWebSocket[] = [];
            for (const socks of wsByTag.values()) all.push(...socks);
            return all;
        },
        getTags: (ws: MockWebSocket) => wsTags.get(ws) ?? [],
        setWebSocketAutoResponse: () => {},
        getWebSocketAutoResponse: () => null,
        getWebSocketAutoResponseTimestamp: () => null,
        setHibernatableWebSocketEventTimeout: () => {},
        getHibernatableWebSocketEventTimeout: () => null,
        abort: () => {},
        facets: {
            get: (): never => {
                throw new Error('facets.get not implemented');
            },
            abort: (_name: string) => {},
            delete: (_name: string) => {},
        } as unknown as DurableObjectFacets,
    } as unknown as DurableObjectState;
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('WsHibernationDO - non-WS request to /ws returns 426', async () => {
    const state = createMockState();
    const do_ = new WsHibernationDO(state, {});

    const res = await do_.fetch(new Request('https://do/ws'));
    assertEquals(res.status, 426);
});

Deno.test('WsHibernationDO - /sessions returns empty list initially', async () => {
    const state = createMockState();
    const do_ = new WsHibernationDO(state, {});

    const res = await do_.fetch(new Request('https://do/sessions'));
    assertEquals(res.status, 200);

    const data = await res.json() as { sessions: SessionMeta[]; total: number };
    assertEquals(data.sessions, []);
    assertEquals(data.total, 0);
});

Deno.test('WsHibernationDO - /sessions returns stored sessions', async () => {
    const session: SessionMeta = {
        tag: 'test-tag-1',
        connectedAt: Date.now(),
        lastActivity: Date.now(),
        userId: 'user_001',
    };
    const state = createMockState({ 'session:test-tag-1': session });
    const do_ = new WsHibernationDO(state, {});

    const res = await do_.fetch(new Request('https://do/sessions'));
    const data = await res.json() as { sessions: SessionMeta[]; total: number };
    assertEquals(data.total, 1);
    assertEquals(data.sessions[0].tag, 'test-tag-1');
    assertEquals(data.sessions[0].userId, 'user_001');
});

Deno.test('WsHibernationDO - /broadcast returns sent count of 0 when no sockets', async () => {
    const state = createMockState();
    const do_ = new WsHibernationDO(state, {});

    const res = await do_.fetch(
        new Request('https://do/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: { type: 'test' } }),
        }),
    );
    assertEquals(res.status, 200);

    const data = await res.json() as { success: boolean; sent: number };
    assertEquals(data.success, true);
    assertEquals(data.sent, 0);
});

Deno.test('WsHibernationDO - /broadcast with invalid body returns 400', async () => {
    const state = createMockState();
    const do_ = new WsHibernationDO(state, {});

    // tag must be a string; passing a number should fail Zod validation
    const res = await do_.fetch(
        new Request('https://do/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'hello', tag: 12345 }), // tag must be string
        }),
    );
    assertEquals(res.status, 400);
});

Deno.test('WsHibernationDO - /disconnect with unknown tag returns success', async () => {
    const state = createMockState();
    const do_ = new WsHibernationDO(state, {});

    const res = await do_.fetch(
        new Request('https://do/disconnect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag: 'nonexistent-tag' }),
        }),
    );
    assertEquals(res.status, 200);

    const data = await res.json() as { success: boolean; closed: number };
    assertEquals(data.success, true);
    assertEquals(data.closed, 0);
});

Deno.test('WsHibernationDO - webSocketMessage: ping returns pong', async () => {
    const state = createMockState();
    const do_ = new WsHibernationDO(state, {});
    const ws = createMockWebSocket();

    await do_.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'ping' }));

    assertEquals(ws.sent.length, 1);
    const response = ws.sent[0] as { type: string };
    assertEquals(response.type, 'pong');
    assertExists((ws.sent[0] as { timestamp: string }).timestamp);
});

Deno.test('WsHibernationDO - webSocketMessage: message returns ack', async () => {
    const state = createMockState();
    const do_ = new WsHibernationDO(state, {});
    const ws = createMockWebSocket();

    await do_.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'message', data: { hello: 'world' } }));

    assertEquals(ws.sent.length, 1);
    const response = ws.sent[0] as { type: string; data: unknown };
    assertEquals(response.type, 'message:ack');
    assertEquals(response.data, { hello: 'world' });
});

Deno.test('WsHibernationDO - webSocketMessage: invalid JSON returns error', async () => {
    const state = createMockState();
    const do_ = new WsHibernationDO(state, {});
    const ws = createMockWebSocket();

    await do_.webSocketMessage(ws as unknown as WebSocket, 'not valid json');

    assertEquals(ws.sent.length, 1);
    const response = ws.sent[0] as { type: string; error: string };
    assertEquals(response.type, 'error');
    assertExists(response.error);
});

Deno.test('WsHibernationDO - webSocketMessage: unknown message type returns error', async () => {
    const state = createMockState();
    const do_ = new WsHibernationDO(state, {});
    const ws = createMockWebSocket();

    await do_.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'unknown-type' }));

    assertEquals(ws.sent.length, 1);
    const response = ws.sent[0] as { type: string };
    assertEquals(response.type, 'error');
});

Deno.test('WsHibernationDO - webSocketClose removes session from storage', async () => {
    const session: SessionMeta = {
        tag: 'close-test-tag',
        connectedAt: Date.now(),
        lastActivity: Date.now(),
    };
    const state = createMockState({ 'session:close-test-tag': session });
    const do_ = new WsHibernationDO(state, {});

    // Mock: state.getTags returns the session tag for the WS
    const mockWs = { sent: [], closedWith: null } as unknown as WebSocket;
    // Override getTags for this specific WebSocket
    const originalGetTags = (state as unknown as { getTags: (ws: unknown) => string[] }).getTags;
    (state as unknown as { getTags: (ws: unknown) => string[] }).getTags = (ws: unknown) => {
        if (ws === mockWs) return ['close-test-tag'];
        return originalGetTags(ws);
    };

    await do_.webSocketClose(mockWs, 1000, 'Normal', true);

    // Session should be removed from storage
    const statusRes = await do_.fetch(new Request('https://do/sessions'));
    const data = await statusRes.json() as { sessions: SessionMeta[]; total: number };
    assertEquals(data.total, 0);
});

Deno.test('WsHibernationDO - webSocketError removes session and closes socket', async () => {
    const session: SessionMeta = {
        tag: 'error-test-tag',
        connectedAt: Date.now(),
        lastActivity: Date.now(),
    };
    const state = createMockState({ 'session:error-test-tag': session });
    const do_ = new WsHibernationDO(state, {});
    const ws = createMockWebSocket();

    // Override getTags for this WebSocket
    (state as unknown as { getTags: (ws: unknown) => string[] }).getTags = (w: unknown) => {
        if (w === ws) return ['error-test-tag'];
        return [];
    };

    await do_.webSocketError(ws as unknown as WebSocket, new Error('test error'));

    // Should have attempted to close the socket
    assertEquals(ws.closedWith?.code, 1011);

    // Session should be removed
    const statusRes = await do_.fetch(new Request('https://do/sessions'));
    const data = await statusRes.json() as { sessions: SessionMeta[]; total: number };
    assertEquals(data.total, 0);
});

Deno.test('WsHibernationDO - unknown path returns 404', async () => {
    const state = createMockState();
    const do_ = new WsHibernationDO(state, {});

    const res = await do_.fetch(new Request('https://do/unknown-path'));
    assertEquals(res.status, 404);
});

Deno.test('WsHibernationDO - /broadcast with malformed JSON returns 400', async () => {
    const state = createMockState();
    const do_ = new WsHibernationDO(state, {});

    const res = await do_.fetch(
        new Request('https://do/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'not-json',
        }),
    );
    assertEquals(res.status, 400);

    const data = await res.json() as { success: boolean; error: string };
    assertEquals(data.success, false);
    assertExists(data.error);
});

Deno.test('WsHibernationDO - /disconnect with malformed JSON returns 400', async () => {
    const state = createMockState();
    const do_ = new WsHibernationDO(state, {});

    const res = await do_.fetch(
        new Request('https://do/disconnect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{bad json',
        }),
    );
    assertEquals(res.status, 400);

    const data = await res.json() as { success: boolean; error: string };
    assertEquals(data.success, false);
    assertExists(data.error);
});

Deno.test('WsHibernationDO - webSocketMessage: presence returns session list', async () => {
    const session: SessionMeta = {
        tag: 'presence-tag',
        connectedAt: Date.now(),
        lastActivity: Date.now(),
        userId: 'user_presence',
    };
    const state = createMockState({ 'session:presence-tag': session });
    const do_ = new WsHibernationDO(state, {});
    const ws = createMockWebSocket();

    // Override getTags so updateLastActivity can resolve the tag.
    (state as unknown as { getTags: (ws: unknown) => string[] }).getTags = () => ['presence-tag'];

    await do_.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'presence' }));

    assertEquals(ws.sent.length, 1);
    const response = ws.sent[0] as { type: string; sessions: SessionMeta[] };
    assertEquals(response.type, 'presence:update');
    assertEquals(response.sessions.length, 1);
    assertEquals(response.sessions[0].userId, 'user_presence');
});
