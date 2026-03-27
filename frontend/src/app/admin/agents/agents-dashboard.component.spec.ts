/**
 * @fileoverview Unit tests for AgentsDashboardComponent.
 *
 * Testing approach:
 * - Uses Vitest + @angular/core/testing with provideZonelessChangeDetection().
 * - AgentRpcService is mocked with signal-based stubs matching the real service
 *   interface (no real HTTP calls are made).
 * - afterNextRender() DOES fire when fixture.detectChanges() is called in unit
 *   tests. Calling `comp.loadData()` explicitly and then `fixture.detectChanges()`
 *   would invoke loadData() twice (once explicit + once via afterNextRender).
 *   Tests rely on a single detectChanges() call to trigger the initial load.
 * - The component derives the agents list internally from the sessions response,
 *   so only listSessions() needs to be mocked (listAgents() is unused by the
 *   component since the loadData() refactor that eliminated the double fetch).
 * - Tests verify signal-driven rendering: loading spinner, error banner, agent
 *   cards derived from KNOWN_AGENTS+sessions, sessions table, empty states,
 *   and terminate action with optimistic local update.
 *
 * See docs/frontend/AGENTS_FRONTEND.md#testing for the full testing guide.
 */

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';
import { AgentsDashboardComponent } from './agents-dashboard.component';
import { AgentRpcService } from '../../services/agent-rpc.service';
import type { AgentSessionsResponse } from '../../models/agent.models';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal session response with one active mcp-agent session. */
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
 * Builds a mock AgentRpcService that returns predefined Observables for
 * listSessions() and terminateSession(). listAgents() is intentionally absent
 * because loadData() no longer calls it (agents are derived from sessions locally).
 */
function buildMockService(opts: {
    sessionsError?: boolean;
    emptySessions?: boolean;
} = {}) {
    return {
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
            imports: [AgentsDashboardComponent, NoopAnimationsModule],
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
    // Successful data load — agents derived from sessions
    // -----------------------------------------------------------------------

    /**
     * Verifies that after loadData() completes, the agents signal is populated
     * with an entry for 'mcp-agent' (derived from KNOWN_AGENTS + session history).
     * The component derives agents from the single listSessions() response.
     */
    it('should populate agents signal (derived from sessions) after successful load', async () => {
        const mock = buildMockService();
        const fixture = await createComponent(mock);
        const comp = fixture.componentInstance;

        // Trigger the first render — fires afterNextRender() → loadData().
        fixture.detectChanges();
        await fixture.whenStable();

        // mcp-agent is in KNOWN_AGENTS seed, so it should always appear.
        const mcpAgent = comp.agents().find(a => a.slug === 'mcp-agent');
        expect(mcpAgent).toBeDefined();
        // With one active session in the fixture, activeSessions should be 1.
        expect(mcpAgent?.activeSessions).toBe(1);
    });

    /**
     * Verifies that after loadData() completes, the sessions signal contains
     * the session from the fixture response.
     */
    it('should populate sessions signal after successful load', async () => {
        const mock = buildMockService();
        const fixture = await createComponent(mock);
        const comp = fixture.componentInstance;

        // Trigger the first render — fires afterNextRender() → loadData().
        fixture.detectChanges();
        await fixture.whenStable();

        expect(comp.sessions()).toHaveLength(1);
        expect(comp.sessions()[0].agent_slug).toBe('mcp-agent');
    });

    /**
     * Verifies that loading is set to false after the request completes.
     */
    it('should set loading to false after request completes', async () => {
        const mock = buildMockService();
        const fixture = await createComponent(mock);
        const comp = fixture.componentInstance;

        // Trigger the first render — fires afterNextRender() → loadData().
        fixture.detectChanges();
        await fixture.whenStable();

        expect(comp.loading()).toBe(false);
    });

    /**
     * Only listSessions() should be called — not listAgents() — since the
     * component derives the agent list from the sessions response locally.
     */
    it('should call listSessions exactly once (no separate listAgents call)', async () => {
        const mock = buildMockService();
        const fixture = await createComponent(mock);

        // Trigger the first render — fires afterNextRender() → loadData() once.
        fixture.detectChanges();
        await fixture.whenStable();

        // loadData() is triggered exactly once via afterNextRender, not twice.
        expect(mock.listSessions).toHaveBeenCalledTimes(1);
    });

    // -----------------------------------------------------------------------
    // Error states
    // -----------------------------------------------------------------------

    /**
     * Verifies that when the sessions API call fails, the error signal is
     * populated with a meaningful message and loading returns to false.
     */
    it('should set error signal when sessions API call fails', async () => {
        const mock = buildMockService({ sessionsError: true });
        const fixture = await createComponent(mock);
        const comp = fixture.componentInstance;

        // Trigger the first render — fires afterNextRender() → loadData().
        fixture.detectChanges();
        await fixture.whenStable();

        expect(comp.error()).not.toBeNull();
        expect(comp.error()).toContain('Failed to load sessions');
        expect(comp.loading()).toBe(false);
    });

    // -----------------------------------------------------------------------
    // Empty state
    // -----------------------------------------------------------------------

    /**
     * Verifies that when the sessions response is empty, the sessions signal
     * remains an empty array and activeSessions computed is also empty.
     * The agents signal still contains the KNOWN_AGENTS seed entries.
     */
    it('should show empty sessions when API returns no sessions', async () => {
        const mock = buildMockService({ emptySessions: true });
        const fixture = await createComponent(mock);
        const comp = fixture.componentInstance;

        // Trigger the first render — fires afterNextRender() → loadData().
        fixture.detectChanges();
        await fixture.whenStable();

        expect(comp.sessions()).toHaveLength(0);
        expect(comp.activeSessions()).toHaveLength(0);
        // KNOWN_AGENTS seed always provides at least the mcp-agent entry.
        expect(comp.agents().length).toBeGreaterThanOrEqual(1);
    });

    // -----------------------------------------------------------------------
    // Terminate session — optimistic local update
    // -----------------------------------------------------------------------

    /**
     * Verifies that terminateSession() calls the service terminateSession method
     * with the correct session ID and optimistically marks it ended in local state.
     */
    it('should call terminateSession service method and optimistically update session', async () => {
        const mock = buildMockService();
        const snackBar = { open: vi.fn() };
        await TestBed.configureTestingModule({
            imports: [AgentsDashboardComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideRouter([]),
                { provide: AgentRpcService, useValue: mock },
                { provide: MatSnackBar, useValue: snackBar },
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(AgentsDashboardComponent);
        const comp = fixture.componentInstance;

        // Trigger the first render — fires afterNextRender() → loadData().
        fixture.detectChanges();
        await fixture.whenStable();

        const session = comp.sessions()[0];
        expect(session.ended_at).toBeNull();

        // Trigger termination on the first session.
        comp.terminateSession(session);
        fixture.detectChanges();

        expect(mock.terminateSession).toHaveBeenCalledWith('abc12345-0000-0000-0000-000000000000');
        // Optimistic update — the session row should now have ended_at set.
        expect(comp.sessions()[0].ended_at).not.toBeNull();
        expect(comp.sessions()[0].end_reason).toBe('admin_terminated');
        expect(snackBar.open).toHaveBeenCalled();
    });
});

