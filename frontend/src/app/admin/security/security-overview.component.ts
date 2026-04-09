/**
 * SecurityOverviewComponent — Security Overview dashboard panel.
 *
 * Inspired by Cloudflare's Security Overview Dashboard, this panel surfaces
 * security signals from the admin audit log:
 *  - Total denied/failed events in the selected time window
 *  - Breakdown by status (denied vs failure)
 *  - Breakdown by action type
 *  - Breakdown by targeted resource type
 *  - Recent security event feed
 *  - Analytics Engine event-type manifest (what is being actively tracked)
 *
 * Data is loaded from GET /admin/security/overview?window=<24h|7d|30d>.
 * When ADMIN_DB is not configured the endpoint returns zeroes and the panel
 * gracefully shows placeholder states.
 */

import {
    Component,
    afterNextRender,
    inject,
    signal,
    computed,
    ChangeDetectionStrategy,
    DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';

// ---------------------------------------------------------------------------
// Response types (mirrors worker/handlers/security-overview.ts)
// ---------------------------------------------------------------------------

interface SecurityOverviewEvent {
    readonly id: number;
    readonly actor_id: string;
    readonly action: string;
    readonly resource_type: string;
    readonly resource_id: string | null;
    readonly status: 'failure' | 'denied';
    readonly ip_address: string | null;
    readonly created_at: string;
}

interface SecurityEventTypeCount {
    readonly event_type: string;
    readonly count: number;
}

interface TopTargetedResource {
    readonly resource_type: string;
    readonly count: number;
}

interface SecurityOverviewResponse {
    readonly success: true;
    readonly timestamp: string;
    readonly window: '24h' | '7d' | '30d';
    readonly total_security_events: number;
    readonly by_status: { readonly denied: number; readonly failure: number };
    readonly by_action: SecurityEventTypeCount[];
    readonly by_resource_type: TopTargetedResource[];
    readonly recent_events: SecurityOverviewEvent[];
    readonly analytics_engine_tracked_events: string[];
    readonly analytics_engine_configured: boolean;
}

type TimeWindow = '24h' | '7d' | '30d';

@Component({
    selector: 'app-admin-security-overview',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        DatePipe,
        FormsModule,
        MatCardModule,
        MatButtonModule,
        MatIconModule,
        MatFormFieldModule,
        MatSelectModule,
        MatTableModule,
        MatProgressSpinnerModule,
        MatChipsModule,
        MatTooltipModule,
        MatDividerModule,
    ],
    template: `
    <!-- Header card -->
    <mat-card appearance="outlined" class="mb-2">
        <mat-card-header>
            <mat-icon mat-card-avatar aria-hidden="true">security</mat-icon>
            <mat-card-title>Security Overview</mat-card-title>
            <mat-card-subtitle>Auth failures, access denials, and threat signals</mat-card-subtitle>
        </mat-card-header>
        <mat-card-actions>
            <mat-form-field appearance="outline" class="window-field">
                <mat-label>Time window</mat-label>
                <mat-select [(ngModel)]="selectedWindow" (ngModelChange)="loadData()">
                    @for (w of windowOptions; track w.value) {
                        <mat-option [value]="w.value">{{ w.label }}</mat-option>
                    }
                </mat-select>
            </mat-form-field>
            <button mat-stroked-button (click)="loadData()" [disabled]="loading()">
                <mat-icon aria-hidden="true">refresh</mat-icon> Refresh
            </button>
        </mat-card-actions>
    </mat-card>

    @if (loading()) {
        <div class="loading-container">
            <mat-progress-spinner diameter="40" mode="indeterminate" />
        </div>
    } @else {
        <!-- Summary cards -->
        <div class="summary-grid">
            <!-- Total events -->
            <mat-card appearance="outlined" class="summary-card summary-total">
                <mat-card-content>
                    <mat-icon aria-hidden="true" class="summary-icon">shield_with_heart</mat-icon>
                    <div class="summary-value">{{ overview()?.total_security_events ?? 0 }}</div>
                    <div class="summary-label">Total Security Events</div>
                    <div class="summary-sub">Last {{ selectedWindow }}</div>
                </mat-card-content>
            </mat-card>

            <!-- Denied -->
            <mat-card appearance="outlined" class="summary-card summary-denied">
                <mat-card-content>
                    <mat-icon aria-hidden="true" class="summary-icon">block</mat-icon>
                    <div class="summary-value">{{ overview()?.by_status?.denied ?? 0 }}</div>
                    <div class="summary-label">Access Denied</div>
                    <div class="summary-sub">Requests blocked by role/tier check</div>
                </mat-card-content>
            </mat-card>

            <!-- Failures -->
            <mat-card appearance="outlined" class="summary-card summary-failure">
                <mat-card-content>
                    <mat-icon aria-hidden="true" class="summary-icon">error_outline</mat-icon>
                    <div class="summary-value">{{ overview()?.by_status?.failure ?? 0 }}</div>
                    <div class="summary-label">Auth Failures</div>
                    <div class="summary-sub">Unsuccessful authentication attempts</div>
                </mat-card-content>
            </mat-card>

            <!-- Analytics Engine -->
            <mat-card appearance="outlined" class="summary-card"
                [class.summary-ae-on]="overview()?.analytics_engine_configured"
                [class.summary-ae-off]="!overview()?.analytics_engine_configured">
                <mat-card-content>
                    <mat-icon aria-hidden="true" class="summary-icon">analytics</mat-icon>
                    <div class="summary-value ae-status">
                        {{ overview()?.analytics_engine_configured ? 'Active' : 'Inactive' }}
                    </div>
                    <div class="summary-label">Analytics Engine</div>
                    <div class="summary-sub">Real-time threat telemetry</div>
                </mat-card-content>
            </mat-card>
        </div>

        <div class="detail-grid">
            <!-- By Action breakdown -->
            <mat-card appearance="outlined" class="detail-card">
                <mat-card-header>
                    <mat-icon mat-card-avatar aria-hidden="true">category</mat-icon>
                    <mat-card-title>By Action</mat-card-title>
                    <mat-card-subtitle>Top blocked / failed action types</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>
                    @if ((overview()?.by_action ?? []).length === 0) {
                        <div class="empty-state">No security events in window.</div>
                    } @else {
                        <div class="breakdown-list">
                            @for (item of overview()!.by_action; track item.event_type) {
                                <div class="breakdown-row">
                                    <span class="breakdown-name">{{ item.event_type }}</span>
                                    <div class="breakdown-bar-wrap">
                                        <div class="breakdown-bar"
                                            [style.width.%]="getBarWidth(item.count, overview()!.by_action)"
                                            aria-hidden="true">
                                        </div>
                                    </div>
                                    <span class="breakdown-count">{{ item.count }}</span>
                                </div>
                            }
                        </div>
                    }
                </mat-card-content>
            </mat-card>

            <!-- By Resource Type breakdown -->
            <mat-card appearance="outlined" class="detail-card">
                <mat-card-header>
                    <mat-icon mat-card-avatar aria-hidden="true">inventory_2</mat-icon>
                    <mat-card-title>By Resource Type</mat-card-title>
                    <mat-card-subtitle>Most targeted resource categories</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>
                    @if ((overview()?.by_resource_type ?? []).length === 0) {
                        <div class="empty-state">No resource targeting data in window.</div>
                    } @else {
                        <div class="breakdown-list">
                            @for (item of overview()!.by_resource_type; track item.resource_type) {
                                <div class="breakdown-row">
                                    <span class="breakdown-name">{{ item.resource_type }}</span>
                                    <div class="breakdown-bar-wrap">
                                        <div class="breakdown-bar breakdown-bar-secondary"
                                            [style.width.%]="getBarWidth(item.count, overview()!.by_resource_type)"
                                            aria-hidden="true">
                                        </div>
                                    </div>
                                    <span class="breakdown-count">{{ item.count }}</span>
                                </div>
                            }
                        </div>
                    }
                </mat-card-content>
            </mat-card>
        </div>

        <!-- Recent Security Events table -->
        <mat-card appearance="outlined" class="mb-2">
            <mat-card-header>
                <mat-icon mat-card-avatar aria-hidden="true">history</mat-icon>
                <mat-card-title>Recent Security Events</mat-card-title>
                <mat-card-subtitle>Last 10 denied or failed entries from the audit log</mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
                @if ((overview()?.recent_events ?? []).length === 0) {
                    <div class="empty-state">No recent security events.</div>
                } @else {
                    <table mat-table [dataSource]="overview()!.recent_events" class="events-table">
                        <ng-container matColumnDef="status">
                            <th mat-header-cell *matHeaderCellDef>Status</th>
                            <td mat-cell *matCellDef="let row">
                                <span class="status-chip" [class]="'status-' + row.status">{{ row.status }}</span>
                            </td>
                        </ng-container>

                        <ng-container matColumnDef="action">
                            <th mat-header-cell *matHeaderCellDef>Action</th>
                            <td mat-cell *matCellDef="let row">
                                <code class="action-code">{{ row.action }}</code>
                            </td>
                        </ng-container>

                        <ng-container matColumnDef="resource_type">
                            <th mat-header-cell *matHeaderCellDef>Resource</th>
                            <td mat-cell *matCellDef="let row">
                                {{ row.resource_type }}
                                @if (row.resource_id) {
                                    <code class="resource-id">{{ row.resource_id }}</code>
                                }
                            </td>
                        </ng-container>

                        <ng-container matColumnDef="actor_id">
                            <th mat-header-cell *matHeaderCellDef>Actor</th>
                            <td mat-cell *matCellDef="let row">
                                <code class="actor-id">{{ row.actor_id }}</code>
                            </td>
                        </ng-container>

                        <ng-container matColumnDef="created_at">
                            <th mat-header-cell *matHeaderCellDef>Time</th>
                            <td mat-cell *matCellDef="let row">
                                <span class="event-ts">{{ row.created_at | date:'short' }}</span>
                            </td>
                        </ng-container>

                        <tr mat-header-row *matHeaderRowDef="eventColumns"></tr>
                        <tr mat-row *matRowDef="let row; columns: eventColumns;" class="event-row"
                            [class.row-denied]="row.status === 'denied'"
                            [class.row-failure]="row.status === 'failure'"></tr>
                    </table>
                }
            </mat-card-content>
        </mat-card>

        <!-- Analytics Engine — tracked events info card -->
        <mat-card appearance="outlined">
            <mat-card-header>
                <mat-icon mat-card-avatar aria-hidden="true">bolt</mat-icon>
                <mat-card-title>Real-Time Threat Telemetry</mat-card-title>
                <mat-card-subtitle>
                    Event types actively tracked in Cloudflare Analytics Engine
                    @if (overview()?.analytics_engine_configured) {
                        — <span class="ae-active-label">Analytics Engine active</span>
                    } @else {
                        — Configure <code>ANALYTICS_ENGINE</code> binding to enable
                    }
                </mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
                <p class="ae-description">
                    The following security events are written to Cloudflare Analytics Engine on every
                    relevant request. Use the
                    <a href="https://developers.cloudflare.com/analytics/analytics-engine/" target="_blank" rel="noopener noreferrer">
                        Analytics Engine GraphQL API
                    </a>
                    or the Cloudflare dashboard to query trends and build custom threat intelligence views.
                </p>
                <div class="ae-chips">
                    @for (evt of overview()?.analytics_engine_tracked_events ?? []; track evt) {
                        <mat-chip [class]="'ae-chip ' + (overview()?.analytics_engine_configured ? 'ae-chip-on' : 'ae-chip-off')"
                            [matTooltip]="getEventDescription(evt)">
                            <mat-icon aria-hidden="true">{{ getEventIcon(evt) }}</mat-icon>
                            {{ evt }}
                        </mat-chip>
                    }
                </div>
            </mat-card-content>
        </mat-card>
    }
    `,
    styles: [`
    .mb-2 { margin-bottom: 16px; }
    .loading-container { display: flex; justify-content: center; padding: 48px; }
    .empty-state { text-align: center; color: var(--mat-sys-on-surface-variant); padding: 24px; font-size: 14px; }

    /* Header actions */
    .window-field { min-width: 140px; margin-right: 12px; }

    /* Summary cards */
    .summary-grid {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 16px; margin-bottom: 16px;
    }
    .summary-card { text-align: center; }
    .summary-icon { font-size: 32px; width: 32px; height: 32px; margin-bottom: 8px; color: var(--mat-sys-primary); }
    .summary-value { font-size: 36px; font-weight: 700; line-height: 1; color: var(--mat-sys-on-surface); }
    .summary-value.ae-status { font-size: 22px; }
    .summary-label {
        font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em;
        color: var(--mat-sys-on-surface-variant); font-weight: 600; margin-top: 4px;
    }
    .summary-sub { font-size: 11px; color: var(--mat-sys-on-surface-variant); margin-top: 2px; }

    .summary-total .summary-icon { color: var(--mat-sys-primary); }
    .summary-denied .summary-icon { color: #c62828; }
    .summary-failure .summary-icon { color: #ef6c00; }

    .summary-ae-on .summary-value { color: #2e7d32; }
    .summary-ae-off .summary-value { color: #9e9e9e; }

    /* Detail cards */
    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    @media (max-width: 768px) { .detail-grid { grid-template-columns: 1fr; } }
    .detail-card mat-card-content { padding-top: 8px; }

    /* Breakdown bars */
    .breakdown-list { display: flex; flex-direction: column; gap: 10px; }
    .breakdown-row { display: flex; align-items: center; gap: 8px; }
    .breakdown-name { font-size: 13px; width: 160px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .breakdown-bar-wrap { flex: 1; height: 8px; background: var(--mat-sys-surface-container); border-radius: 4px; overflow: hidden; }
    .breakdown-bar {
        height: 100%; border-radius: 4px;
        background: color-mix(in srgb, var(--mat-sys-primary) 60%, transparent);
        transition: width 300ms ease;
    }
    .breakdown-bar-secondary {
        background: color-mix(in srgb, var(--mat-sys-tertiary) 60%, transparent);
    }
    .breakdown-count { font-size: 12px; font-weight: 600; width: 36px; text-align: right; color: var(--mat-sys-on-surface-variant); }

    /* Events table */
    .events-table { width: 100%; }
    .status-chip {
        display: inline-block; padding: 2px 10px; border-radius: 10px;
        font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
    }
    .status-denied { background: color-mix(in srgb, #c62828 15%, transparent); color: #c62828; }
    .status-failure { background: color-mix(in srgb, #ef6c00 15%, transparent); color: #ef6c00; }
    .action-code {
        font-family: 'JetBrains Mono', monospace; font-size: 12px;
        background: var(--mat-sys-surface-container); padding: 2px 6px; border-radius: 4px;
    }
    .resource-id {
        font-family: 'JetBrains Mono', monospace; font-size: 11px;
        background: var(--mat-sys-surface-container); padding: 1px 4px; border-radius: 3px;
        margin-left: 4px;
    }
    .actor-id { font-family: 'JetBrains Mono', monospace; font-size: 12px; }
    .event-ts { font-size: 12px; color: var(--mat-sys-on-surface-variant); white-space: nowrap; }
    .event-row { transition: background 120ms; }
    .row-denied:hover { background: color-mix(in srgb, #c62828 6%, transparent); }
    .row-failure:hover { background: color-mix(in srgb, #ef6c00 6%, transparent); }

    /* Analytics Engine section */
    .ae-description { font-size: 13px; color: var(--mat-sys-on-surface-variant); margin-bottom: 16px; line-height: 1.6; }
    .ae-description a { color: var(--mat-sys-primary); }
    .ae-active-label { color: #2e7d32; font-weight: 600; }
    .ae-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .ae-chip mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; vertical-align: middle; }
    .ae-chip-on { background: color-mix(in srgb, #2e7d32 12%, transparent) !important; color: #2e7d32 !important; }
    .ae-chip-off { opacity: 0.55; }
    `],
})
export class SecurityOverviewComponent {
    private readonly http = inject(HttpClient);
    private readonly destroyRef = inject(DestroyRef);

    readonly loading = signal(false);
    readonly overview = signal<SecurityOverviewResponse | null>(null);
    selectedWindow: TimeWindow = '24h';

    readonly windowOptions: { value: TimeWindow; label: string }[] = [
        { value: '24h', label: 'Last 24 hours' },
        { value: '7d', label: 'Last 7 days' },
        { value: '30d', label: 'Last 30 days' },
    ];

    readonly eventColumns = ['status', 'action', 'resource_type', 'actor_id', 'created_at'];

    /** Max count across a breakdown array — used to scale bar widths. */
    readonly maxActionCount = computed(() => {
        const actions = this.overview()?.by_action ?? [];
        return actions.reduce((m, a) => Math.max(m, a.count), 1);
    });

    private readonly _init = afterNextRender(() => this.loadData());

    loadData(): void {
        this.loading.set(true);
        this.http
            .get<SecurityOverviewResponse>(`/admin/security/overview?window=${this.selectedWindow}`)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (res) => {
                    this.overview.set(res);
                    this.loading.set(false);
                },
                error: () => {
                    this.overview.set(null);
                    this.loading.set(false);
                },
            });
    }

    /** Compute a bar width percentage relative to the max in the dataset. */
    getBarWidth(count: number, dataset: { count: number }[]): number {
        const max = dataset.reduce((m, d) => Math.max(m, d.count), 1);
        return Math.round((count / max) * 100);
    }

    /** Return a human-readable description for each AE event type. */
    getEventDescription(eventType: string): string {
        const descriptions: Record<string, string> = {
            'auth_failure': 'Authentication or authorization failure',
            'rate_limit': 'Request rate limit exceeded',
            'turnstile_rejection': 'Cloudflare Turnstile challenge failed',
            'cors_rejection': 'CORS policy violation',
            'cf_access_denial': 'Cloudflare Access JWT verification failed',
            'size_limit': 'Request or response size limit exceeded',
        };
        return descriptions[eventType] ?? eventType;
    }

    /** Return a Material icon name for each AE event type. */
    getEventIcon(eventType: string): string {
        const icons: Record<string, string> = {
            'auth_failure': 'lock_person',
            'rate_limit': 'speed',
            'turnstile_rejection': 'robot_2',
            'cors_rejection': 'policy',
            'cf_access_denial': 'no_accounts',
            'size_limit': 'data_usage',
        };
        return icons[eventType] ?? 'security';
    }
}
