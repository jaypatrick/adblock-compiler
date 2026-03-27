/**
 * @fileoverview Unit tests for AgentsDashboardComponent.
 *
 * Testing approach:
 * - Uses Vitest + @angular/core/testing with provideZonelessChangeDetection().
 * - AgentRpcService is mocked with signal-based stubs matching the real service
 *   interface (no real HTTP calls are made).
 * - Tests verify signal-driven rendering: loading spinner, error banner, agent
 *   cards, sessions table, empty states, and terminate action.
 *
 * See docs/frontend/AGENTS_FRONTEND.md#testing for the full testing guide.
 */

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';
import { AgentsDashboardComponent } from './agents-dashboard.component';
import { AgentRpcService } from '../../services/agent-rpc.service';
import type { AgentListItem, AgentSessionsResponse } from '../../models/agent.models';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal AgentListItem fixture — represents the mcp-agent entry. */
const AGENT_FIXTURE: AgentListItem = {
    bindingKey: 'MCP_AGENT',
    slug: 'mcp-agent',
    displayName: 'Playwright MCP Agent',
    description: 'Headless browser automation.',
    requiredTier: 'admin',
    requiredScopes: ['agents'],
    enabled: true,
    transport: 'websocket',
    activeSessions: 0,
    lastActiveAt: null,
};

/** Minimal session response with one active session. */
const SESSIONS_RESPONSE: AgentSessionsResponse = {
    success: true,
    sessions: [
        {
            id: 'abc12345-0000-0000-0000-000000000000',
            user_id: 'user-001',
            agent_slug: 'mcp-agent',
            instance_id: 'default',
            started_at: new Date().toISOString(),
            ended_at: null,
            end_reason: null,
            ip_address: null,
            user_agent: null,
        },
    ],
    total: 1,
    limit: 25,
    offset: 0,
};

// ---------------------------------------------------------------------------
// Mock service factory
// ---------------------------------------------------------------------------

/**
 * Builds a mock AgentRpcService that returns predefined Observables.
 * Accepts override options to simulate errors or empty states per test.
 */
function buildMockService(opts: {
    agentsError?: boolean;
    sessionsError?: boolean;
    emptySessions?: boolean;
} = {}) {
    return {
        listAgents: vi.fn(() =>
            opts.agentsError
                ? throwError(() => ({ error: 'Failed to load agents.', status: 500 }))
                : of([AGENT_FIXTURE]),
        ),
        listSessions: vi.fn(() =>
            opts.sessionsError
                ? throwError(() => ({ error: 'Failed to load sessions.', status: 500 }))
                : of(opts.emptySessions ? { ...SESSIONS_RESPONSE, sessions: [], total: 0 } : SESSIONS_RESPONSE),
        ),
        terminateSession: vi.fn(() => of({ success: true })),
    };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AgentsDashboardComponent', () => {
    /**
     * Helper: configures TestBed with a given mock service and compiles the component.
     * Returns the fixture for direct signal inspection.
     */
    async function createComponent(mockService: ReturnType<typeof buildMockService>) {
        await TestBed.configureTestingModule({
            imports: [AgentsDashboardComponent],
            providers: [
                provideZonelessChangeDetection(),
                provideRouter([]),
                { provide: AgentRpcService, useValue: mockService },
                {
                    provide: MatSnackBar,
                    useValue: { open: vi.fn() },
                },
            ],
        }).compileComponents();

        return TestBed.createComponent(AgentsDashboardComponent);
    }

    afterEach(() => {
        TestBed.resetTestingModule();
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------

    /**
     * Verifies that the component initialises with loading=true before
     * afterNextRender() fires (i.e., before any data has been fetched).
     */
    it('should start in loading state', async () => {
        const mock = buildMockService();
        const fixture = await createComponent(mock);
        const comp = fixture.componentInstance;

        // Before any render cycle, loading should be true (initial signal value).
        expect(comp.loading()).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Successful data load
    // -----------------------------------------------------------------------

    /**
     * Verifies that after loadData() completes successfully, the agents signal
     * is populated with the mock agent fixture.
     */
    it('should populate agents signal after successful load', async () => {
        const mock = buildMockService();
        const fixture = await createComponent(mock);
        const comp = fixture.componentInstance;

        // Directly call loadData() (afterNextRender won't fire in unit tests).
        comp.loadData();
        fixture.detectChanges();

        expect(comp.agents()).toHaveLength(1);
        expect(comp.agents()[0].slug).toBe('mcp-agent');
    });

    /**
     * Verifies that after loadData() completes, the sessions signal contains
     * the session from the fixture response.
     */
    it('should populate sessions signal after successful load', async () => {
        const mock = buildMockService();
        const fixture = await createComponent(mock);
        const comp = fixture.componentInstance;

        comp.loadData();
        fixture.detectChanges();

        expect(comp.sessions()).toHaveLength(1);
        expect(comp.sessions()[0].agent_slug).toBe('mcp-agent');
    });

    /**
     * Verifies that loading is set to false after both parallel requests complete.
     */
    it('should set loading to false after both requests complete', async () => {
        const mock = buildMockService();
        const fixture = await createComponent(mock);
        const comp = fixture.componentInstance;

        comp.loadData();
        fixture.detectChanges();

        expect(comp.loading()).toBe(false);
    });

    // -----------------------------------------------------------------------
    // Error states
    // -----------------------------------------------------------------------

    /**
     * Verifies that when the agents API call fails, the error signal is
     * populated with a meaningful message.
     */
    it('should set error signal when agents API call fails', async () => {
        const mock = buildMockService({ agentsError: true });
        const fixture = await createComponent(mock);
        const comp = fixture.componentInstance;

        comp.loadData();
        fixture.detectChanges();

        expect(comp.error()).not.toBeNull();
        expect(comp.error()).toContain('Failed to load agents');
    });

    // -----------------------------------------------------------------------
    // Empty state
    // -----------------------------------------------------------------------

    /**
     * Verifies that when the sessions response is empty, the sessions signal
     * remains an empty array and activeSessions computed is also empty.
     */
    it('should show empty sessions when API returns no sessions', async () => {
        const mock = buildMockService({ emptySessions: true });
        const fixture = await createComponent(mock);
        const comp = fixture.componentInstance;

        comp.loadData();
        fixture.detectChanges();

        expect(comp.sessions()).toHaveLength(0);
        expect(comp.activeSessions()).toHaveLength(0);
    });

    // -----------------------------------------------------------------------
    // Terminate session
    // -----------------------------------------------------------------------

    /**
     * Verifies that terminateSession() calls the service terminateSession method
     * with the correct session ID.
     */
    it('should call terminateSession service method with session ID', async () => {
        const mock = buildMockService();
        const snackBar = { open: vi.fn() };
        await TestBed.configureTestingModule({
            imports: [AgentsDashboardComponent],
            providers: [
                provideZonelessChangeDetection(),
                provideRouter([]),
                { provide: AgentRpcService, useValue: mock },
                { provide: MatSnackBar, useValue: snackBar },
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(AgentsDashboardComponent);
        const comp = fixture.componentInstance;

        comp.loadData();
        fixture.detectChanges();

        // Trigger termination on the first session.
        comp.terminateSession(comp.sessions()[0]);
        fixture.detectChanges();

        expect(mock.terminateSession).toHaveBeenCalledWith('abc12345-0000-0000-0000-000000000000');
    });
});
