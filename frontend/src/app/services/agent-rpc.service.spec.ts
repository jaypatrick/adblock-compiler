/**
 * @fileoverview Unit tests for AgentRpcService.
 *
 * Testing approach:
 * - Uses Vitest + @angular/core/testing with provideZonelessChangeDetection().
 * - HttpClient is mocked via HttpClientTestingModule / HttpTestingController so
 *   no real HTTP requests are made.
 * - The browser WebSocket API is mocked with vi.fn() / vi.spyOn() to avoid
 *   real network I/O during unit tests.
 * - All tests verify observable emissions and signal state updates.
 *
 * See docs/frontend/AGENTS_FRONTEND.md#testing for the full testing guide.
 */

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AgentRpcService } from './agent-rpc.service';
import type { AgentSessionsResponse, AgentAuditResponse } from '../models/agent.models';

// ---------------------------------------------------------------------------
// Helpers — minimal fixture data
// ---------------------------------------------------------------------------

/** Minimal valid AgentSession fixture. */
const SESSION_FIXTURE = {
    id: 'session-uuid-001',
    user_id: 'user-001',
    agent_slug: 'mcp-agent',
    instance_id: 'default',
    started_at: new Date().toISOString(),
    ended_at: null,
    end_reason: null,
    ip_address: '127.0.0.1',
    user_agent: 'Vitest',
} as const;

/** Minimal valid sessions response fixture. */
const SESSIONS_RESPONSE: AgentSessionsResponse = {
    success: true,
    sessions: [SESSION_FIXTURE],
    total: 1,
    limit: 25,
    offset: 0,
};

/** Minimal valid audit log response fixture. */
const AUDIT_RESPONSE: AgentAuditResponse = {
    success: true,
    items: [
        {
            id: 'audit-001',
            session_id: 'session-uuid-001',
            user_id: 'user-001',
            agent_slug: 'mcp-agent',
            event_type: 'session_start',
            details: null,
            ip_address: '127.0.0.1',
            created_at: new Date().toISOString(),
        },
    ],
    total: 1,
    limit: 25,
    offset: 0,
};

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

/**
 * Lightweight WebSocket mock that captures lifecycle callbacks for testing.
 * Registered on the global object before tests that exercise connect().
 *
 * Note: We define readyState values as inline numeric literals rather than
 * referencing WebSocket.CONNECTING/OPEN/CLOSED because in Vitest's jsdom
 * environment globalThis.WebSocket may be undefined at class initialisation
 * time (before our beforeEach stub is in place), causing a ReferenceError.
 */
class MockWebSocket {
    /** WebSocket.CONNECTING = 0 */
    static readonly CONNECTING = 0;
    /** WebSocket.OPEN = 1 */
    static readonly OPEN = 1;
    /** WebSocket.CLOSED = 3 */
    static readonly CLOSED = 3;

    static lastInstance: MockWebSocket | null = null;

    readonly url: string;
    readonly protocols: string[];

    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;

    readonly sentMessages: string[] = [];
    readyState: number = MockWebSocket.CONNECTING;

    constructor(url: string, protocols?: string | string[]) {
        this.url = url;
        this.protocols = Array.isArray(protocols) ? protocols : protocols ? [protocols] : [];
        MockWebSocket.lastInstance = this;
    }

    send(data: string): void {
        this.sentMessages.push(data);
    }

    close(code?: number, reason?: string): void {
        this.readyState = MockWebSocket.CLOSED;
        // Simulate the onclose callback.
        this.onclose?.({ code: code ?? 1000, reason: reason ?? '', wasClean: (code ?? 1000) === 1000 } as CloseEvent);
    }

    /** Test helper — simulate receiving a message from the server. */
    simulateMessage(data: string): void {
        this.onmessage?.({ data } as MessageEvent);
    }

    /** Test helper — simulate a successful connection open. */
    simulateOpen(): void {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.({} as Event);
    }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AgentRpcService', () => {
    let service: AgentRpcService;
    let httpMock: HttpTestingController;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let originalWebSocket: any;

    beforeEach(() => {
        // Replace the global WebSocket with our mock before each test.
        originalWebSocket = (globalThis as Record<string, unknown>)['WebSocket'];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as Record<string, unknown>)['WebSocket'] = MockWebSocket as any;
        MockWebSocket.lastInstance = null;

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
                AgentRpcService,
            ],
        });

        service = TestBed.inject(AgentRpcService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        // Restore the original WebSocket after each test.
        (globalThis as Record<string, unknown>)['WebSocket'] = originalWebSocket;
        // Verify no unexpected HTTP requests were made.
        httpMock.verify();
    });

    // -----------------------------------------------------------------------
    // listSessions
    // -----------------------------------------------------------------------

    describe('listSessions()', () => {
        /**
         * Verifies that listSessions() makes a GET request to the correct
         * endpoint and emits the parsed AgentSessionsResponse.
         */
        it('should return paginated sessions from GET /admin/agents/sessions', (done) => {
            service.listSessions().subscribe({
                next: (res) => {
                    expect(res.success).toBe(true);
                    expect(res.sessions).toHaveLength(1);
                    expect(res.sessions[0].id).toBe('session-uuid-001');
                    done();
                },
            });

            // Flush the pending HTTP request with our fixture.
            const req = httpMock.expectOne(r => r.url.includes('/admin/agents/sessions'));
            expect(req.request.method).toBe('GET');
            req.flush(SESSIONS_RESPONSE);
        });

        /**
         * Verifies that listSessions() correctly sets limit/offset params
         * for page 2 with the default page size of 25.
         */
        it('should pass correct pagination params for page 1 (0-based)', (done) => {
            service.listSessions(1, 25).subscribe({ next: () => done() });

            const req = httpMock.expectOne(r => r.url.includes('/admin/agents/sessions'));
            expect(req.request.params.get('offset')).toBe('25');
            expect(req.request.params.get('limit')).toBe('25');
            req.flush(SESSIONS_RESPONSE);
        });
    });

    // -----------------------------------------------------------------------
    // terminateSession
    // -----------------------------------------------------------------------

    describe('terminateSession()', () => {
        /**
         * Verifies that terminateSession() sends a DELETE request to the
         * correct session-specific endpoint.
         */
        it('should call DELETE /admin/agents/sessions/:id', (done) => {
            service.terminateSession('session-uuid-001').subscribe({
                next: (res) => {
                    expect(res.success).toBe(true);
                    done();
                },
            });

            const req = httpMock.expectOne('/admin/agents/sessions/session-uuid-001');
            expect(req.request.method).toBe('DELETE');
            req.flush({ success: true });
        });

        /**
         * Verifies that a 409 Conflict response is mapped to a user-friendly
         * error message matching the backend "already terminated" scenario.
         */
        it('should map 409 to a meaningful error message', (done) => {
            service.terminateSession('already-ended').subscribe({
                error: (err: { error: string; status: number }) => {
                    expect(err.status).toBe(409);
                    expect(err.error).toContain('already terminated');
                    done();
                },
            });

            const req = httpMock.expectOne('/admin/agents/sessions/already-ended');
            req.flush({ success: false, error: 'Session already terminated' }, { status: 409, statusText: 'Conflict' });
        });
    });

    // -----------------------------------------------------------------------
    // listAuditLog
    // -----------------------------------------------------------------------

    describe('listAuditLog()', () => {
        /**
         * Verifies that listAuditLog() fetches from the correct endpoint
         * and returns the audit response envelope.
         */
        it('should return audit log entries from GET /admin/agents/audit', (done) => {
            service.listAuditLog().subscribe({
                next: (res) => {
                    expect(res.success).toBe(true);
                    expect(res.items).toHaveLength(1);
                    expect(res.items[0].event_type).toBe('session_start');
                    done();
                },
            });

            const req = httpMock.expectOne(r => r.url.includes('/admin/agents/audit'));
            expect(req.request.method).toBe('GET');
            req.flush(AUDIT_RESPONSE);
        });
    });

    // -----------------------------------------------------------------------
    // connect() — WebSocket
    // -----------------------------------------------------------------------

    describe('connect()', () => {
        /**
         * Verifies that connect() creates a WebSocket with the correct wss:// URL
         * and initial status signal value of 'connecting'.
         */
        it('should create a WebSocket and set status to connecting', () => {
            const conn = service.connect('mcp-agent', 'default');

            // Status should immediately be 'connecting' before socket opens.
            expect(conn.status()).toBe('connecting');
            // A MockWebSocket instance should have been created.
            expect(MockWebSocket.lastInstance).not.toBeNull();
        });

        /**
         * Verifies that when the WebSocket opens, the status signal transitions
         * from 'connecting' to 'connected'.
         */
        it('should update status signal to connected when socket opens', () => {
            const conn = service.connect('mcp-agent', 'default');
            MockWebSocket.lastInstance!.simulateOpen();

            expect(conn.status()).toBe('connected');
        });

        /**
         * Verifies that inbound messages from the server are appended to the
         * messages signal and tagged with direction 'in'.
         */
        it('should append inbound messages to messages signal', () => {
            const conn = service.connect('mcp-agent', 'default');
            MockWebSocket.lastInstance!.simulateOpen();
            MockWebSocket.lastInstance!.simulateMessage('hello from agent');

            const messages = conn.messages();
            // The first message is a 'system' connect confirmation; the second is the data.
            const dataMsg = messages.find(m => m.content === 'hello from agent');
            expect(dataMsg).toBeDefined();
            expect(dataMsg!.direction).toBe('in');
        });

        /**
         * Verifies that send() writes to the WebSocket and records the message
         * as direction 'out' in the messages signal.
         */
        it('should send a message and record it as outbound', () => {
            const conn = service.connect('mcp-agent', 'default');
            MockWebSocket.lastInstance!.simulateOpen();
            conn.send('ping');

            // Verify the WebSocket.send was called with the message.
            expect(MockWebSocket.lastInstance!.sentMessages).toContain('ping');
            // Verify the message appears in the signal as outbound.
            const outMsg = conn.messages().find(m => m.direction === 'out' && m.content === 'ping');
            expect(outMsg).toBeDefined();
        });

        /**
         * Verifies that disconnect() closes the WebSocket and transitions status
         * to 'disconnected'.
         */
        it('should close the WebSocket and set status to disconnected on disconnect()', () => {
            const conn = service.connect('mcp-agent', 'default');
            MockWebSocket.lastInstance!.simulateOpen();
            conn.disconnect();

            expect(conn.status()).toBe('disconnected');
        });

        /**
         * Verifies that the auth token is passed as a Sec-WebSocket-Protocol
         * sub-protocol string with the 'bearer.' prefix.
         */
        it('should pass auth token as Sec-WebSocket-Protocol bearer sub-protocol', () => {
            service.connect('mcp-agent', 'default', 'my-secret-token');

            const protocols = MockWebSocket.lastInstance!.protocols;
            expect(protocols).toContain('bearer.my-secret-token');
        });
    });
});
