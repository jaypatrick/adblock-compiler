/**
 * @fileoverview AgentAuditLogComponent — Paginated agent audit log viewer.
 *
 * Displays audit events from GET /admin/agents/audit with pagination,
 * event-type filter chips, and loading/error/empty states.
 *
 * Route: /admin/agents/audit
 *
 * Architecture notes:
 * - Pagination is handled server-side — the component passes limit/offset params.
 * - Event type filter is applied client-side on the currently-loaded page for
 *   responsiveness. A full server-side filter can be added when the backend
 *   supports it as a query param.
 * - afterNextRender() triggers initial load (not ngOnInit) per Angular 21 conventions.
 *
 * See docs/frontend/AGENTS_FRONTEND.md for the full component catalog.
 */

import {
    Component,
    ChangeDetectionStrategy,
    inject,
    signal,
    computed,
    afterNextRender,
    DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, SlicePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AgentRpcService } from '../../services/agent-rpc.service';
import type { AgentAuditLogEntry } from '../../models/agent.models';

/** Known event types used for filter chips. Extend as backend emits more types. */
const KNOWN_EVENT_TYPES = [
    'session_start',
    'session_end',
    'auth_failure',
    'invocation',
    'terminate',
] as const;

@Component({
    selector: 'app-agent-audit-log',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        // Angular common
        DatePipe,
        SlicePipe,
        // Angular Material
        MatCardModule,
        MatButtonModule,
        MatIconModule,
        MatTableModule,
        MatPaginatorModule,
        MatProgressSpinnerModule,
        MatChipsModule,
        MatTooltipModule,
    ],
    template: `
    <!-- Header -->
    <mat-card appearance="outlined" class="mb-2">
        <mat-card-header>
            <mat-icon mat-card-avatar aria-hidden="true">history</mat-icon>
            <mat-card-title>Agent Audit Log</mat-card-title>
            <mat-card-subtitle>Track agent authentication events, session lifecycle, and invocations</mat-card-subtitle>
        </mat-card-header>
        <mat-card-actions>
            <button mat-stroked-button (click)="refresh()" [disabled]="loading()">
                <mat-icon aria-hidden="true">refresh</mat-icon> Refresh
            </button>
        </mat-card-actions>
    </mat-card>

    <!-- Event type filter chips -->
    <mat-card appearance="outlined" class="mb-2">
        <mat-card-content>
            <div class="filter-row">
                <span class="filter-label">Filter by event type:</span>
                <!-- "All" chip -->
                <mat-chip-set aria-label="Event type filter">
                    <mat-chip
                        [class.active-filter]="!activeFilter()"
                        (click)="setFilter(null)">
                        All
                    </mat-chip>
                    <!-- One chip per known event type -->
                    @for (type of eventTypes; track type) {
                        <mat-chip
                            [class.active-filter]="activeFilter() === type"
                            (click)="setFilter(type)">
                            {{ type }}
                        </mat-chip>
                    }
                </mat-chip-set>
            </div>
        </mat-card-content>
    </mat-card>

    <!-- Results -->
    <mat-card appearance="outlined">
        <mat-card-content>
            @if (loading()) {
                <div class="loading-container">
                    <mat-progress-spinner diameter="40" mode="indeterminate" />
                </div>
            } @else if (error()) {
                <!-- Error state -->
                <div class="error-state">
                    <mat-icon color="warn" aria-hidden="true">error_outline</mat-icon>
                    <p>{{ error() }}</p>
                    <button mat-stroked-button (click)="refresh()">Retry</button>
                </div>
            } @else if (filteredEntries().length === 0) {
                <!-- Empty state -->
                <div class="empty-state">
                    <mat-icon class="empty-icon" aria-hidden="true">history</mat-icon>
                    <p class="empty-title">No audit entries found</p>
                    <p class="empty-subtitle">
                        @if (activeFilter()) {
                            No events of type "{{ activeFilter() }}" in this page. Try changing the filter.
                        } @else {
                            No audit events recorded yet.
                        }
                    </p>
                </div>
            } @else {
                <!-- Audit log table -->
                <table mat-table [dataSource]="filteredEntries()" class="audit-table">

                    <!-- Timestamp column -->
                    <ng-container matColumnDef="created_at">
                        <th mat-header-cell *matHeaderCellDef>Timestamp</th>
                        <td mat-cell *matCellDef="let row">{{ row.created_at | date:'short' }}</td>
                    </ng-container>

                    <!-- Agent slug column -->
                    <ng-container matColumnDef="agent_slug">
                        <th mat-header-cell *matHeaderCellDef>Agent</th>
                        <td mat-cell *matCellDef="let row">{{ row.agent_slug }}</td>
                    </ng-container>

                    <!-- Event type column — styled chip -->
                    <ng-container matColumnDef="event_type">
                        <th mat-header-cell *matHeaderCellDef>Event Type</th>
                        <td mat-cell *matCellDef="let row">
                            <span class="event-chip" [class]="'event-' + row.event_type">{{ row.event_type }}</span>
                        </td>
                    </ng-container>

                    <!-- User ID column — truncated with full-value tooltip -->
                    <ng-container matColumnDef="user_id">
                        <th mat-header-cell *matHeaderCellDef>User ID</th>
                        <td mat-cell *matCellDef="let row">
                            <code class="user-id" [matTooltip]="row.user_id">{{ row.user_id | slice:0:8 }}…</code>
                        </td>
                    </ng-container>

                    <!-- IP Address column -->
                    <ng-container matColumnDef="ip_address">
                        <th mat-header-cell *matHeaderCellDef>IP Address</th>
                        <td mat-cell *matCellDef="let row">{{ row.ip_address ?? '—' }}</td>
                    </ng-container>

                    <!-- Details column — JSON tooltip -->
                    <ng-container matColumnDef="details">
                        <th mat-header-cell *matHeaderCellDef>Details</th>
                        <td mat-cell *matCellDef="let row">
                            @if (row.details) {
                                <code class="details" [matTooltip]="row.details">{{ row.details | slice:0:40 }}…</code>
                            } @else {
                                <span class="muted">—</span>
                            }
                        </td>
                    </ng-container>

                    <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
                    <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
                </table>
            }

            <!-- Paginator — always rendered so page state is preserved -->
            <mat-paginator
                [length]="totalCount()"
                [pageSize]="pageSize"
                [pageSizeOptions]="[25, 50, 100]"
                [pageIndex]="pageIndex()"
                (page)="onPage($event)"
                showFirstLastButtons />
        </mat-card-content>
    </mat-card>
    `,
    styles: [`
    .mb-2 { margin-bottom: 16px; }

    /* Filter row */
    .filter-row {
        display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    }
    .filter-label { font-size: 13px; color: var(--mat-sys-on-surface-variant); }
    .active-filter { background: var(--mat-sys-primary) !important; color: var(--mat-sys-on-primary) !important; }

    /* Loading */
    .loading-container { display: flex; justify-content: center; padding: 32px; }

    /* Error state */
    .error-state {
        display: flex; flex-direction: column; align-items: center; gap: 12px;
        padding: 32px; text-align: center; color: var(--mat-sys-error);
    }

    /* Empty state */
    .empty-state {
        display: flex; flex-direction: column; align-items: center;
        padding: 48px 24px; text-align: center;
        color: var(--mat-sys-on-surface-variant);
    }
    .empty-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.4; margin-bottom: 12px; }
    .empty-title { font-size: 16px; font-weight: 500; margin: 0 0 4px; }
    .empty-subtitle { font-size: 13px; margin: 0; max-width: 400px; }

    /* Table */
    .audit-table { width: 100%; }
    .event-chip {
        display: inline-block; padding: 2px 8px;
        border-radius: 12px; font-size: 12px; font-weight: 500;
        background: var(--mat-sys-surface-variant); color: var(--mat-sys-on-surface-variant);
    }
    .event-session_start { background: color-mix(in srgb, var(--mat-sys-primary) 15%, transparent); color: var(--mat-sys-primary); }
    .event-session_end   { background: var(--mat-sys-surface-variant); color: var(--mat-sys-on-surface-variant); }
    .event-auth_failure  { background: color-mix(in srgb, var(--mat-sys-error) 15%, transparent); color: var(--mat-sys-error); }
    .event-invocation    { background: color-mix(in srgb, var(--mat-sys-tertiary) 15%, transparent); color: var(--mat-sys-tertiary); }
    .event-terminate     { background: color-mix(in srgb, var(--mat-sys-error) 15%, transparent); color: var(--mat-sys-error); }

    .user-id, .details {
        font-family: 'JetBrains Mono', monospace; font-size: 12px;
        background: var(--mat-sys-surface-container); padding: 2px 6px;
        border-radius: 4px;
    }
    .muted { color: var(--mat-sys-on-surface-variant); }
    `],
})
export class AgentAuditLogComponent {
    /** AgentRpcService — injected for the audit log HTTP call. */
    private readonly agentRpc = inject(AgentRpcService);

    /** DestroyRef — for subscription cleanup via takeUntilDestroyed. */
    private readonly destroyRef = inject(DestroyRef);

    // -------------------------------------------------------------------------
    // Component state
    // -------------------------------------------------------------------------

    /** True while the audit log is loading. */
    readonly loading = signal(true);

    /** Non-null string when an API error has occurred. */
    readonly error = signal<string | null>(null);

    /** Full page of audit log entries from the API. */
    readonly entries = signal<AgentAuditLogEntry[]>([]);

    /** Total row count from the API (for paginator length). */
    readonly totalCount = signal(0);

    /** Current 0-based page index. */
    readonly pageIndex = signal(0);

    /** Currently active event-type filter; null = show all. */
    readonly activeFilter = signal<string | null>(null);

    /** Page size for server-side pagination. */
    readonly pageSize = 25;

    /** Column definitions for the mat-table. */
    readonly displayedColumns = ['created_at', 'agent_slug', 'event_type', 'user_id', 'ip_address', 'details'] as const;

    /** Filter chip event type list. */
    readonly eventTypes = KNOWN_EVENT_TYPES;

    /**
     * Client-side filtered entries — applies activeFilter() to the current page.
     * When null filter is active, returns all entries.
     */
    readonly filteredEntries = computed(() => {
        const filter = this.activeFilter();
        if (!filter) return this.entries();
        return this.entries().filter(e => e.event_type === filter);
    });

    /** afterNextRender guard — triggers initial load after the first render. */
    private readonly _init = afterNextRender(() => this.loadData());

    // -------------------------------------------------------------------------
    // Data loading
    // -------------------------------------------------------------------------

    /**
     * Fetches the current page of audit log entries from GET /admin/agents/audit.
     * Resets loading/error state before each load.
     */
    loadData(): void {
        this.loading.set(true);
        this.error.set(null);

        this.agentRpc
            .listAuditLog(this.pageIndex(), this.pageSize)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (res) => {
                    this.entries.set([...res.items]);
                    this.totalCount.set(res.total);
                    this.loading.set(false);
                },
                error: (err: { error: string }) => {
                    this.error.set(err.error ?? 'Failed to load audit log.');
                    this.loading.set(false);
                },
            });
    }

    /** Manually refreshes the current page. Bound to the Refresh button. */
    refresh(): void {
        this.loadData();
    }

    /**
     * Handles mat-paginator page changes. Updates pageIndex and re-fetches data.
     * @param event - PageEvent emitted by mat-paginator.
     */
    onPage(event: PageEvent): void {
        this.pageIndex.set(event.pageIndex);
        this.loadData();
    }

    /**
     * Sets the active event-type filter chip.
     * @param type - Event type string to filter by, or null to show all.
     */
    setFilter(type: string | null): void {
        this.activeFilter.set(type);
    }
}
