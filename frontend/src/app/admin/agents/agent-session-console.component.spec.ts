/**
 * @fileoverview Unit tests for AgentSessionConsoleComponent.
 *
 * Testing approach:
 * - Uses Vitest + @angular/core/testing with provideZonelessChangeDetection().
 * - AgentRpcService is mocked using vi.fn() so no real WebSocket is opened.
 * - AuthFacadeService.getToken() is stubbed to return a fake token.
 * - ActivatedRoute is provided with a fake paramMap to simulate route params.
 * - Tests verify: signal state (connection status, message list), sendMessage(),
 *   reconnect(), disconnectManually(), and route-param-driven reconnection.
 *
 * Note: Tests that need an active connection use fixture.detectChanges() +
 * await fixture.whenStable() instead of calling openConnection() directly.
 * detectChanges() fires afterNextRender() → _isClient.set(true) → effect →
 * openConnection(). Subsequent detectChanges() calls do NOT re-fire afterNextRender
 * (it fires only once), so the connection established by the effect is stable.
 * Tests that check the null initial state simply omit detectChanges().
 *
 * See docs/frontend/AGENTS_FRONTEND.md#testing for the full testing guide.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter, ActivatedRoute, convertToParamMap } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { AgentSessionConsoleComponent } from './agent-session-console.component';
import { AgentRpcService } from '../../services/agent-rpc.service';
import { AuthFacadeService } from '../../services/auth-facade.service';
import type { AgentConnection, AgentConnectionStatus, AgentMessage } from '../../models/agent.models';

// ---------------------------------------------------------------------------
// Mock WebSocket connection
// ---------------------------------------------------------------------------

/** Extended mock connection type that exposes internal test handles. */
type MockConnection = AgentConnection & {
    _statusSignal: ReturnType<typeof signal<AgentConnectionStatus>>;
    _messagesSignal: ReturnType<typeof signal<AgentMessage[]>>;
    sendSpy: ReturnType<typeof vi.fn>;
    disconnectSpy: ReturnType<typeof vi.fn>;
};

/**
 * Builds a minimal AgentConnection mock that satisfies the AgentConnection
 * interface. Uses signals so that the component's computed values update.
 */
function buildMockConnection(initialStatus: AgentConnectionStatus = 'connecting'): MockConnection {
    const _statusSignal = signal<AgentConnectionStatus>(initialStatus);
    const _messagesSignal = signal<AgentMessage[]>([]);
    const sendSpy = vi.fn();
    const disconnectSpy = vi.fn();

    return {
        status: _statusSignal.asReadonly(),
        messages: _messagesSignal.asReadonly(),
        send: sendSpy,
        disconnect: disconnectSpy,
        _statusSignal,
        _messagesSignal,
        sendSpy,
        disconnectSpy,
    };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AgentSessionConsoleComponent', () => {
    let fixture: ComponentFixture<AgentSessionConsoleComponent>;
    let component: AgentSessionConsoleComponent;
    let mockAgentRpc: {
        connect: ReturnType<typeof vi.fn>;
    };

    /**
     * Creates TestBed with stubbed AgentRpcService and AuthFacadeService.
     * ActivatedRoute is provided with a fixed paramMap for mcp-agent/default.
     */
    beforeEach(async () => {
        // Reset the mock connection factory per test.
        mockAgentRpc = {
            connect: vi.fn(() => buildMockConnection()),
        };

        await TestBed.configureTestingModule({
            imports: [AgentSessionConsoleComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideRouter([]),
                {
                    provide: ActivatedRoute,
                    useValue: {
                        paramMap: of(convertToParamMap({ slug: 'mcp-agent', instanceId: 'default' })),
                    },
                },
                { provide: AgentRpcService, useValue: mockAgentRpc },
                {
                    provide: AuthFacadeService,
                    useValue: {
                        getToken: vi.fn(() => Promise.resolve('fake-token')),
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(AgentSessionConsoleComponent);
        component = fixture.componentInstance;
        // Do NOT call fixture.detectChanges() here — it fires afterNextRender(),
        // setting _isClient=true and opening a WebSocket before the test body runs,
        // which breaks assertions that check the null initial-connection state.
    });

    afterEach(() => {
        TestBed.resetTestingModule();
    });

    // -----------------------------------------------------------------------
    // Creation
    // -----------------------------------------------------------------------

    /** Component should instantiate without errors. */
    it('should create the component', () => {
        expect(component).toBeTruthy();
    });

    /** Route params should be correctly read from ActivatedRoute. */
    it('should read slug and instanceId from route params', () => {
        expect(component.slug()).toBe('mcp-agent');
        expect(component.instanceId()).toBe('default');
    });

    // -----------------------------------------------------------------------
    // Connection state
    // -----------------------------------------------------------------------

    /**
     * When no connection has been opened yet, the connection signal is null
     * and statusLabel should show 'Disconnected'.
     */
    it('should show Disconnected when connection signal is null', () => {
        // detectChanges() is NOT called in this test, so afterNextRender has
        // not fired. _isClient is still false, so the effect does not open a
        // connection. connection() remains null.
        expect(component.connection()).toBeNull();
        expect(component.statusLabel()).toBe('Disconnected');
    });

    /**
     * After the first render cycle (detectChanges fires afterNextRender →
     * _isClient=true → _routeConnectionEffect → openConnection()), the
     * connection signal should be populated with the mock AgentConnection.
     */
    it('should populate connection signal after first render', async () => {
        fixture.detectChanges();
        await fixture.whenStable();

        expect(component.connection()).not.toBeNull();
        expect(mockAgentRpc.connect).toHaveBeenCalledWith('mcp-agent', 'default', 'fake-token', expect.anything());
    });

    /**
     * statusLabel should reflect the connection status signal value.
     */
    it('should compute statusLabel from connection status', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const conn = component.connection()! as MockConnection;

        // The mock starts in 'connecting'.
        expect(component.statusLabel()).toBe('Connecting…');

        // Simulate transition to connected.
        conn._statusSignal.set('connected');
        fixture.detectChanges();
        expect(component.statusLabel()).toBe('Connected');

        // Simulate error state.
        conn._statusSignal.set('error');
        fixture.detectChanges();
        expect(component.statusLabel()).toBe('Error');
    });

    // -----------------------------------------------------------------------
    // sendMessage()
    // -----------------------------------------------------------------------

    /**
     * sendMessage() should be a no-op when the connection is not connected.
     */
    it('should not send a message when connection is not connected', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const conn = component.connection()! as MockConnection;

        // Status is 'connecting' — send should be ignored.
        component.messageInput = 'hello';
        component.sendMessage();

        expect(conn.sendSpy).not.toHaveBeenCalled();
    });

    /**
     * sendMessage() should call connection.send() with the message text
     * and clear the input when status is 'connected'.
     */
    it('should send message and clear input when connected', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const conn = component.connection()! as MockConnection;
        conn._statusSignal.set('connected');
        fixture.detectChanges();

        component.messageInput = 'hello world';
        component.sendMessage();

        expect(conn.sendSpy).toHaveBeenCalledWith('hello world');
        expect(component.messageInput).toBe('');
    });

    /** sendMessage() should be a no-op when the input is blank (even when connected). */
    it('should not send an empty message', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const conn = component.connection()! as MockConnection;
        conn._statusSignal.set('connected');
        fixture.detectChanges();

        component.messageInput = '   ';
        component.sendMessage();

        expect(conn.sendSpy).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // reconnect() / disconnectManually()
    // -----------------------------------------------------------------------

    /**
     * reconnect() should disconnect the existing connection, clear connection
     * signal, and open a new connection.
     */
    it('should disconnect existing connection and reconnect', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const firstConn = component.connection()! as MockConnection;

        // Set up a fresh mock for the reconnect call.
        const secondConn = buildMockConnection('connecting');
        mockAgentRpc.connect.mockReturnValueOnce(secondConn);

        component.reconnect();
        // Wait for async token fetch.
        await fixture.whenStable();
        fixture.detectChanges();

        expect(firstConn.disconnectSpy).toHaveBeenCalled();
        expect(mockAgentRpc.connect).toHaveBeenCalledTimes(2);
    });

    /**
     * disconnectManually() should call disconnect() on the active connection.
     */
    it('should call disconnect when disconnectManually() is invoked', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const conn = component.connection()! as MockConnection;

        component.disconnectManually();

        expect(conn.disconnectSpy).toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Route-param change triggers reconnection
    // -----------------------------------------------------------------------

    /**
     * When afterNextRender fires (simulated by detectChanges()), _isClient
     * becomes true, the _routeConnectionEffect fires, and a connection is
     * opened for the current slug/instanceId route params.
     */
    it('should open connection when _isClient becomes true', async () => {
        // detectChanges() fires afterNextRender() → _isClient.set(true) →
        // _routeConnectionEffect runs → openConnection(); whenStable() awaits
        // the async token fetch so connect() is called before the assertion.
        fixture.detectChanges();
        await fixture.whenStable();

        expect(mockAgentRpc.connect).toHaveBeenCalled();
    });
});
