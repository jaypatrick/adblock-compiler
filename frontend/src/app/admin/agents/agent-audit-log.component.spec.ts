/**
 * @fileoverview Unit tests for AgentAuditLogComponent.
 *
 * Testing approach:
 * - Uses Vitest + @angular/core/testing with provideZonelessChangeDetection().
 * - HttpClient is provided via provideHttpClientTesting() so loadData() calls
 *   can be flushed synchronously with HttpTestingController.
 * - Tests cover: initial loading state, successful data load, error state,
 *   empty state, pagination via onPage(), and client-side event-type filtering.
 *
 * See docs/frontend/AGENTS_FRONTEND.md#testing for the full testing guide.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AgentAuditLogComponent } from './agent-audit-log.component';
import type { AgentAuditResponse, AgentAuditLogEntry } from '../../models/agent.models';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Builds a minimal AgentAuditLogEntry fixture with optional overrides. */
function makeEntry(overrides: Partial<AgentAuditLogEntry> = {}): AgentAuditLogEntry {
    return {
        id: 'audit-001',
        agent_slug: 'mcp-agent',
        event_type: 'session_start',
        user_id: 'user-001',
        session_id: null,
        ip_address: '127.0.0.1',
        details: null,
        created_at: '2026-03-24T00:00:00.000Z',
        ...overrides,
    };
}

/** Empty audit response for testing empty states. */
const EMPTY_AUDIT_RESPONSE: AgentAuditResponse = {
    success: true,
    items: [],
    total: 0,
    limit: 25,
    offset: 0,
};

/** Audit response with a single entry. */
const ONE_ENTRY_RESPONSE: AgentAuditResponse = {
    success: true,
    items: [makeEntry()],
    total: 1,
    limit: 25,
    offset: 0,
};

/** Audit response with two different event types for filter tests. */
const MULTI_ENTRY_RESPONSE: AgentAuditResponse = {
    success: true,
    items: [
        makeEntry({ id: 'a1', event_type: 'session_start' }),
        makeEntry({ id: 'a2', event_type: 'session_end' }),
        makeEntry({ id: 'a3', event_type: 'invocation' }),
    ],
    total: 3,
    limit: 25,
    offset: 0,
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AgentAuditLogComponent', () => {
    let fixture: ComponentFixture<AgentAuditLogComponent>;
    let component: AgentAuditLogComponent;
    let httpTesting: HttpTestingController;

    /**
     * Configures TestBed with the real HttpClient (backed by HttpTestingController)
     * so that HTTP calls made inside afterNextRender() and loadData() can be
     * controlled synchronously in tests.
     */
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [AgentAuditLogComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(AgentAuditLogComponent);
        component = fixture.componentInstance;
        httpTesting = TestBed.inject(HttpTestingController);

        // Trigger the first render (simulates afterNextRender → loadData()).
        fixture.detectChanges();
        // Drain the initial HTTP call so component starts in a clean state.
        httpTesting.match(() => true).forEach(r => r.flush(EMPTY_AUDIT_RESPONSE));
    });

    afterEach(() => httpTesting.verify());

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------

    /** Component should be created without errors. */
    it('should create the component', () => {
        expect(component).toBeTruthy();
    });

    /** Default signal values before any meaningful data is loaded. */
    it('should start with empty entries, totalCount=0, pageIndex=0', () => {
        expect(component.entries()).toEqual([]);
        expect(component.totalCount()).toBe(0);
        expect(component.pageIndex()).toBe(0);
        expect(component.activeFilter()).toBeNull();
        expect(component.loading()).toBe(false);
    });

    // -----------------------------------------------------------------------
    // Successful data load
    // -----------------------------------------------------------------------

    /**
     * Verifies that a successful API response populates the entries signal
     * and updates totalCount.
     */
    it('should populate entries and totalCount after successful load', () => {
        // Trigger a fresh load and provide the mock response.
        component.loadData();
        httpTesting.expectOne(r => r.url.includes('/admin/agents/audit')).flush(ONE_ENTRY_RESPONSE);
        fixture.detectChanges();

        expect(component.entries()).toHaveLength(1);
        expect(component.entries()[0].event_type).toBe('session_start');
        expect(component.totalCount()).toBe(1);
        expect(component.loading()).toBe(false);
    });

    /** Verifies that loading is set to false after the request completes. */
    it('should set loading=false after data is received', () => {
        component.loadData();
        // Before flush, loading should be true.
        expect(component.loading()).toBe(true);

        httpTesting.expectOne(r => r.url.includes('/admin/agents/audit')).flush(ONE_ENTRY_RESPONSE);
        fixture.detectChanges();

        expect(component.loading()).toBe(false);
    });

    // -----------------------------------------------------------------------
    // Error state
    // -----------------------------------------------------------------------

    /**
     * Verifies that an API error sets the error signal with a meaningful message
     * and sets loading=false.
     */
    it('should set error signal on API failure', () => {
        component.loadData();
        httpTesting.expectOne(r => r.url.includes('/admin/agents/audit')).flush(
            { error: 'Failed to load audit log.', success: false },
            { status: 500, statusText: 'Internal Server Error' },
        );
        fixture.detectChanges();

        expect(component.error()).not.toBeNull();
        expect(component.loading()).toBe(false);
    });

    // -----------------------------------------------------------------------
    // Empty state
    // -----------------------------------------------------------------------

    /**
     * Verifies that when the API returns no items, filteredEntries is empty
     * and totalCount is 0.
     */
    it('should show empty state when API returns no entries', () => {
        component.loadData();
        httpTesting.expectOne(r => r.url.includes('/admin/agents/audit')).flush(EMPTY_AUDIT_RESPONSE);
        fixture.detectChanges();

        expect(component.entries()).toHaveLength(0);
        expect(component.filteredEntries()).toHaveLength(0);
        expect(component.totalCount()).toBe(0);
    });

    // -----------------------------------------------------------------------
    // Client-side event-type filtering
    // -----------------------------------------------------------------------

    /**
     * Verifies that setFilter() updates the activeFilter signal and that
     * filteredEntries computed correctly narrows the entries list.
     */
    it('should filter entries by event type when setFilter() is called', () => {
        // Load 3 entries with different event types.
        component.loadData();
        httpTesting.expectOne(r => r.url.includes('/admin/agents/audit')).flush(MULTI_ENTRY_RESPONSE);
        fixture.detectChanges();

        // All 3 entries visible with no filter.
        expect(component.filteredEntries()).toHaveLength(3);

        // Apply filter for 'session_start'.
        component.setFilter('session_start');
        fixture.detectChanges();

        expect(component.filteredEntries()).toHaveLength(1);
        expect(component.filteredEntries()[0].event_type).toBe('session_start');
        expect(component.activeFilter()).toBe('session_start');
    });

    /** setFilter(null) clears the filter and restores all entries. */
    it('should clear filter when setFilter(null) is called', () => {
        component.loadData();
        httpTesting.expectOne(r => r.url.includes('/admin/agents/audit')).flush(MULTI_ENTRY_RESPONSE);
        fixture.detectChanges();

        // Apply and then clear the filter.
        component.setFilter('invocation');
        component.setFilter(null);
        fixture.detectChanges();

        expect(component.filteredEntries()).toHaveLength(3);
        expect(component.activeFilter()).toBeNull();
    });

    // -----------------------------------------------------------------------
    // Pagination
    // -----------------------------------------------------------------------

    /**
     * Verifies that onPage() updates the pageIndex signal and triggers a new
     * HTTP request with the updated offset.
     */
    it('should update pageIndex and reload when onPage() is called', () => {
        // Simulate mat-paginator emitting a page-2 event.
        component.onPage({ pageIndex: 1, pageSize: 25, length: 50 } as import('@angular/material/paginator').PageEvent);
        fixture.detectChanges();

        expect(component.pageIndex()).toBe(1);

        // The reload should have issued an HTTP request.
        const req = httpTesting.expectOne(r => r.url.includes('/admin/agents/audit'));
        // Expect offset param = 25 (page 1 × pageSize 25).
        expect(req.request.params.get('offset')).toBe('25');
        req.flush(EMPTY_AUDIT_RESPONSE);
    });
});
