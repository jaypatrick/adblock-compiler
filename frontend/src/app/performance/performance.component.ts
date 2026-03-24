/**
 * Performance Metrics Component
 *
 * Displays real compilation performance data from /api/metrics.
 * Uses rxResource() for signal-native async data fetching and
 * afterRenderEffect() for DOM measurements.
 */

import { Component, computed, inject } from '@angular/core';
import { DecimalPipe, TitleCasePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatTableModule } from '@angular/material/table';
import { SkeletonCardComponent } from '../skeleton/skeleton-card.component';
import { SparklineComponent } from '../sparkline/sparkline.component';
import { MetricsStore } from '../store/metrics.store';
import { API_BASE_URL } from '../tokens';
import { ContainerStatusWidgetComponent } from '../components/container-status/container-status-widget.component';

/** Health response shape from /api/health — mirrors worker/handlers/health.ts */
interface HealthServiceResult {
    readonly status: 'healthy' | 'degraded' | 'down';
    readonly latency_ms?: number;
    readonly provider?: 'better-auth' | 'none';
}

interface HealthResponse {
    readonly status: 'healthy' | 'degraded' | 'down';
    /** Not currently returned by the worker; kept optional for forward compatibility. */
    readonly uptime?: number;
    readonly version: string;
    readonly timestamp: string;
    readonly services?: {
        readonly gateway: HealthServiceResult;
        readonly database: HealthServiceResult;
        readonly compiler: HealthServiceResult;
        readonly auth: HealthServiceResult & { readonly provider: 'better-auth' | 'none' };
        readonly cache: HealthServiceResult;
    };
}

@Component({
    selector: 'app-performance',
    imports: [
        DecimalPipe,
        TitleCasePipe,
        MatCardModule,
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatChipsModule,
        MatDividerModule,
        MatTableModule,
        SkeletonCardComponent,
        SparklineComponent,
        ContainerStatusWidgetComponent,
    ],
    template: `
    <div class="page-content">
        <h1 class="mat-headline-4">Performance</h1>
        <p class="subtitle mat-body-1">
            Real-time compilation performance metrics from the API
        </p>

        <!-- Health Status -->
        <mat-card appearance="outlined" class="mb-2">
            <mat-card-header>
                <mat-icon mat-card-avatar
                    [style.color]="healthStatusColor()">
                    {{ healthStatusIcon() }}
                </mat-icon>
                <mat-card-title>System Health</mat-card-title>
                <mat-card-subtitle>
                    @if (healthResource.isLoading()) {
                        Checking…
                    } @else if (healthResource.value(); as h) {
                        {{ h.status | titlecase }} — v{{ h.version }}
                    } @else {
                        Unable to reach API
                    }
                </mat-card-subtitle>
            </mat-card-header>
            @if (healthResource.value(); as h) {
                <mat-card-content>
                    <mat-chip-set>
                        <mat-chip highlighted [color]="h.status === 'healthy' ? 'primary' : 'warn'">
                            {{ h.status | titlecase }}
                        </mat-chip>
                        @if (h.uptime !== null && h.uptime !== undefined) {
                            <mat-chip>Uptime: {{ formatUptime(h.uptime) }}</mat-chip>
                        }
                        <mat-chip>v{{ h.version }}</mat-chip>
                    </mat-chip-set>
                    <div class="container-status-row">
                        <mat-icon class="container-row-icon">memory</mat-icon>
                        <span class="container-row-label">Container:</span>
                        <app-container-status-widget [compact]="true" [autoPoll]="true" [pollIntervalMs]="15000" />
                    </div>
                </mat-card-content>
            }
        </mat-card>

        <!-- Key Metrics (Item 13: skeleton loading + Item 3: sparklines) -->
        @if (store.isMetricsRevalidating() && !store.metrics()) {
            <div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4 mb-4">
                @for (i of [0,1,2,3,4,5]; track i) {
                    <app-skeleton-card [lines]="2" [lineWidths]="['50%', '80%']" />
                }
            </div>
        } @else if (store.metrics(); as m) {
            <div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4 mb-4">
                <mat-card appearance="outlined">
                    <mat-card-content class="flex flex-col items-center px-4 py-5 text-center">
                        <mat-icon class="metric-icon" style="color: var(--mat-sys-primary)">api</mat-icon>
                        <div class="text-2xl font-bold text-on-surface">{{ m.totalRequests | number }}</div>
                        <div class="mat-caption uppercase tracking-wide mt-1 text-on-surface-variant">Total Requests</div>
                        <app-sparkline [data]="requestsHistory()" color="var(--mat-sys-primary, #1976d2)" [width]="100" [height]="24" label="Requests trend" />
                    </mat-card-content>
                </mat-card>
                <mat-card appearance="outlined">
                    <mat-card-content class="flex flex-col items-center px-4 py-5 text-center">
                        <mat-icon class="metric-icon" style="color: var(--mat-sys-tertiary)">timer</mat-icon>
                        <div class="text-2xl font-bold text-on-surface">{{ m.averageDuration | number:'1.0-0' }} ms</div>
                        <div class="mat-caption uppercase tracking-wide mt-1 text-on-surface-variant">Avg Duration</div>
                    </mat-card-content>
                </mat-card>
                <mat-card appearance="outlined">
                    <mat-card-content class="flex flex-col items-center px-4 py-5 text-center">
                        <mat-icon class="metric-icon" style="color: var(--mat-sys-secondary)">speed</mat-icon>
                        <div class="text-2xl font-bold text-on-surface">{{ m.p95Duration | number:'1.0-0' }} ms</div>
                        <div class="mat-caption uppercase tracking-wide mt-1 text-on-surface-variant">p95 Latency</div>
                    </mat-card-content>
                </mat-card>
                <mat-card appearance="outlined">
                    <mat-card-content class="flex flex-col items-center px-4 py-5 text-center">
                        <mat-icon class="metric-icon" style="color: var(--mat-sys-error)">check_circle</mat-icon>
                        <div class="text-2xl font-bold text-on-surface">{{ m.successRate }}%</div>
                        <div class="mat-caption uppercase tracking-wide mt-1 text-on-surface-variant">Success Rate</div>
                    </mat-card-content>
                </mat-card>
                <mat-card appearance="outlined">
                    <mat-card-content class="flex flex-col items-center px-4 py-5 text-center">
                        <mat-icon class="metric-icon" style="color: var(--mat-sys-primary)">cached</mat-icon>
                        <div class="text-2xl font-bold text-on-surface">{{ m.cacheHitRate }}%</div>
                        <div class="mat-caption uppercase tracking-wide mt-1 text-on-surface-variant">Cache Hit Rate</div>
                    </mat-card-content>
                </mat-card>
                <mat-card appearance="outlined">
                    <mat-card-content class="flex flex-col items-center px-4 py-5 text-center">
                        <mat-icon class="metric-icon" style="color: var(--mat-sys-tertiary)">warning</mat-icon>
                        <div class="text-2xl font-bold text-on-surface">{{ m.p99Duration | number:'1.0-0' }} ms</div>
                        <div class="mat-caption uppercase tracking-wide mt-1 text-on-surface-variant">p99 Latency</div>
                    </mat-card-content>
                </mat-card>
            </div>

            <!-- Endpoint Breakdown -->
            @if ((m.endpoints ?? []).length > 0) {
                <mat-card appearance="outlined" class="mb-2 mt-2">
                    <mat-card-header>
                        <mat-icon mat-card-avatar>table_chart</mat-icon>
                        <mat-card-title>Endpoint Breakdown</mat-card-title>
                    </mat-card-header>
                    <mat-card-content>
                        <table mat-table [dataSource]="m.endpoints ?? []" class="w-full">
                            <ng-container matColumnDef="endpoint">
                                <th mat-header-cell *matHeaderCellDef>Endpoint</th>
                                <td mat-cell *matCellDef="let row">{{ row.endpoint }}</td>
                            </ng-container>
                            <ng-container matColumnDef="requests">
                                <th mat-header-cell *matHeaderCellDef>Requests</th>
                                <td mat-cell *matCellDef="let row">{{ row.requests | number }}</td>
                            </ng-container>
                            <ng-container matColumnDef="avgDuration">
                                <th mat-header-cell *matHeaderCellDef>Avg (ms)</th>
                                <td mat-cell *matCellDef="let row">{{ row.avgDuration | number:'1.0-0' }}</td>
                            </ng-container>
                            <ng-container matColumnDef="errorRate">
                                <th mat-header-cell *matHeaderCellDef>Error Rate</th>
                                <td mat-cell *matCellDef="let row">{{ row.errorRate }}%</td>
                            </ng-container>
                            <tr mat-header-row *matHeaderRowDef="endpointColumns"></tr>
                            <tr mat-row *matRowDef="let row; columns: endpointColumns;"></tr>
                        </table>
                    </mat-card-content>
                </mat-card>
            }
        } @else {
            <mat-card appearance="outlined" class="error-card mb-2">
                <mat-card-content>
                    <div class="flex items-center gap-2" style="color: var(--mat-sys-error)">
                        <mat-icon color="warn">error</mat-icon>
                        <span>Failed to load metrics. The API may be unavailable.</span>
                    </div>
                </mat-card-content>
                <mat-card-actions>
                    <button mat-button (click)="refreshMetrics()">
                        <mat-icon>refresh</mat-icon> Retry
                    </button>
                </mat-card-actions>
            </mat-card>
        }

        <!-- Refresh button -->
        <div class="flex gap-3 mt-2">
            <button mat-stroked-button (click)="refreshMetrics()" [disabled]="store.isLoading()">
                <mat-icon>refresh</mat-icon> Refresh Metrics
            </button>
        </div>
    </div>
    `,
    styles: [`
    .page-content { padding: 0; }
    .subtitle { color: var(--mat-sys-on-surface-variant); margin-bottom: 24px; }
    .metric-icon { font-size: 32px; width: 32px; height: 32px; margin-bottom: 8px; }
    .error-card { border-color: var(--mat-sys-error); }
    .container-status-row { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
    .container-row-icon { font-size: 18px; width: 18px; height: 18px; color: var(--mat-sys-on-surface-variant); }
    .container-row-label { font-size: 13px; font-weight: 500; color: var(--mat-sys-on-surface-variant); }
  `],
})
export class PerformanceComponent {
    readonly endpointColumns = ['endpoint', 'requests', 'avgDuration', 'errorRate'];

    /** Item 9: Shared MetricsStore with SWR caching */
    readonly store = inject(MetricsStore);
    private readonly apiBaseUrl = inject(API_BASE_URL);

    /**
     * Item 7: httpResource() — Angular 21 signal-native HTTP primitive.
     * Replaces rxResource + HttpClient for the health endpoint.
     * Automatically manages loading/error/value as signals.
     */
    readonly healthResource = httpResource<HealthResponse>(() => `${this.apiBaseUrl}/health`);

    /** Item 3: Sparkline data — simulated history for demo purposes */
    readonly requestsHistory = computed(() => {
        const m = this.store.metrics();
        if (!m) return [];
        // Generate pseudo-historical data from current value for sparkline demo
        const base = m.totalRequests;
        return Array.from({ length: 12 }, (_, i) =>
            Math.max(0, base - Math.floor(Math.random() * base * 0.3) + i * Math.floor(base * 0.02)),
        );
    });

    readonly healthStatusColor = computed(() => this.getHealthColor(this.healthResource.value()?.status));

    readonly healthStatusIcon = computed(() => this.getHealthIcon(this.healthResource.value()?.status));

    /** Pure mapping from health status → CSS color token. Public for unit testing. */
    getHealthColor(status: 'healthy' | 'degraded' | 'down' | undefined): string {
        switch (status) {
            case 'healthy': return 'var(--mat-sys-primary)';
            case 'degraded': return 'var(--mat-sys-tertiary)';
            case 'down': return 'var(--mat-sys-error)';
            default: return 'var(--mat-sys-on-surface-variant)';
        }
    }

    /** Pure mapping from health status → Material icon name. Public for unit testing. */
    getHealthIcon(status: 'healthy' | 'degraded' | 'down' | undefined): string {
        switch (status) {
            case 'healthy': return 'check_circle';
            case 'degraded': return 'warning';
            case 'down': return 'error';
            default: return 'help_outline';
        }
    }

    refreshMetrics(): void {
        this.store.refresh();
    }

    formatUptime(seconds: number): string {
        if (seconds < 60) return `${seconds}s`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
        return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
    }
}
