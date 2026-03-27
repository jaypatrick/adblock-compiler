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
 * Note: afterNextRender() does not fire in unit tests — _isClient is set
 * manually (or _routeConnectionEffect is triggered directly) to test connection
 * behaviour without needing a real browser render cycle.
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

/** Type-cast helper to call the private openConnection() method in tests. */
type ConsoleWithPrivate = AgentSessionConsoleComponent & {
    openConnection(): Promise<void>;
    _isClient: ReturnType<typeof signal<boolean>>;
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
        fixture.detectChanges();
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
        // connection is null until afterNextRender (which doesn't fire in tests).
        expect(component.connection()).toBeNull();
        expect(component.statusLabel()).toBe('Disconnected');
    });

    /**
     * After openConnection() is called, the connection signal should be
     * populated with the mock AgentConnection returned by AgentRpcService.connect().
     */
    it('should populate connection signal after openConnection()', async () => {
        await (component as unknown as ConsoleWithPrivate).openConnection();
        fixture.detectChanges();

        expect(component.connection()).not.toBeNull();
        expect(mockAgentRpc.connect).toHaveBeenCalledWith('mcp-agent', 'default', 'fake-token', expect.anything());
    });

    /**
     * statusLabel should reflect the connection status signal value.
     */
    it('should compute statusLabel from connection status', async () => {
        await (component as unknown as ConsoleWithPrivate).openConnection();
        const conn = component.connection()!;
        fixture.detectChanges();

        // The mock starts in 'connecting'.
        expect(component.statusLabel()).toBe('Connecting…');

        // Simulate transition to connected.
        (conn as MockConnection)._statusSignal.set('connected');
        fixture.detectChanges();
        expect(component.statusLabel()).toBe('Connected');

        // Simulate error state.
        (conn as MockConnection)._statusSignal.set('error');
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
        await (component as unknown as ConsoleWithPrivate).openConnection();
        const conn = component.connection()!;
        fixture.detectChanges();

        // Status is 'connecting' — send should be ignored.
        component.messageInput = 'hello';
        component.sendMessage();

        expect((conn as MockConnection).sendSpy).not.toHaveBeenCalled();
    });

    /**
     * sendMessage() should call connection.send() with the message text
     * and clear the input when status is 'connected'.
     */
    it('should send message and clear input when connected', async () => {
        await (component as unknown as ConsoleWithPrivate).openConnection();
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
        await (component as unknown as ConsoleWithPrivate).openConnection();
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
        await (component as unknown as ConsoleWithPrivate).openConnection();
        const firstConn = component.connection()! as MockConnection;
        fixture.detectChanges();

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
        await (component as unknown as ConsoleWithPrivate).openConnection();
        const conn = component.connection()! as MockConnection;
        fixture.detectChanges();

        component.disconnectManually();

        expect(conn.disconnectSpy).toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // Route-param change triggers reconnection
    // -----------------------------------------------------------------------

    /**
     * When _isClient is set to true, the _routeConnectionEffect fires and opens
     * a connection for the current slug/instanceId. This simulates what happens
     * after afterNextRender() marks the component as in a browser context.
     */
    it('should open connection when _isClient becomes true', async () => {
        // At this point afterNextRender has NOT fired so _isClient is false.
        // Simulate the browser render by setting _isClient directly.
        (component as unknown as ConsoleWithPrivate)._isClient.set(true);
        // Allow the effect to run.
        await fixture.whenStable();
        fixture.detectChanges();

        expect(mockAgentRpc.connect).toHaveBeenCalled();
    });
});
