/**
 * HomeComponent — Bloqr Dashboard
 *
 * Full-featured application dashboard at route `/`.
 * Displays system health, live performance stats, quick actions,
 * navigation cards, endpoint comparison, and an interactive API tester.
 *
 * Angular 21 patterns: signal(), computed(), inject(), toSignal(), DestroyRef
 * Design language: Bloqr dark theme (Space Grotesk / Inter, orange accent)
 */

import {
    Component,
    computed,
    inject,
    signal,
    DestroyRef,
    PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { StatCardComponent } from '../stat-card/stat-card.component';
import { SkeletonCardComponent } from '../skeleton/skeleton-card.component';
import { QueueChartComponent } from '../queue-chart/queue-chart.component';
import { ApiTesterComponent } from '../api-tester/api-tester.component';
import { MetricsStore } from '../store/metrics.store';
import { NotificationService } from '../services/notification.service';
import { LogService } from '../services/log.service';

/** Navigation card definition */
export interface NavCard {
    readonly path: string;
    readonly label: string;
    readonly icon: string;
    readonly description: string;
    readonly tag?: string;
    readonly external?: true;
}

/** Endpoint comparison row */
export interface EndpointInfo {
    readonly endpoint: string;
    readonly method: string;
    readonly auth: string;
    readonly description: string;
    readonly rateLimit: string;
}

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [
        MatCardModule,
        MatButtonModule,
        MatIconModule,
        MatDividerModule,
        MatChipsModule,
        MatProgressSpinnerModule,
        MatSlideToggleModule,
        MatTooltipModule,
        StatCardComponent,
        SkeletonCardComponent,
        QueueChartComponent,
        ApiTesterComponent,
    ],
    template: `
    <div class="dashboard-page">

      <!-- Page Header -->
      <div class="dashboard-header">
        <h1 class="dashboard-title">Bloqr Dashboard</h1>
        <p class="dashboard-subtitle">Manage, compile, and monitor filter lists.</p>
      </div>

      <!-- System Status Bar -->
      <mat-card appearance="outlined" class="status-bar bloqr-card">
        <mat-card-content>
          <div class="status-row">
            <div class="status-indicator">
              <mat-icon [style.color]="healthColor()">{{ healthIcon() }}</mat-icon>
              <span class="status-text">System {{ store.health()?.status ?? 'loading…' }}</span>
              @if (store.health()?.version) {
                <mat-chip class="version-chip">v{{ store.health()!.version }}</mat-chip>
              }
            </div>
            <div class="status-actions">
              <button mat-icon-button (click)="store.refresh()"
                [matTooltip]="store.isLoading() ? 'Refreshing…' : 'Refresh data'"
                aria-label="Refresh metrics">
                @if (store.isLoading()) {
                  <mat-progress-spinner diameter="20" mode="indeterminate" />
                } @else {
                  <mat-icon>refresh</mat-icon>
                }
              </button>
            </div>
          </div>
        </mat-card-content>
      </mat-card>

      <!-- Live Stats Grid -->
      <section aria-labelledby="stats-heading" class="stats-section">
        <h2 id="stats-heading" class="section-heading">Live Statistics</h2>
        @if (store.isLoading() && !store.metrics()) {
          <div class="stats-grid">
            @for (_ of [0,1,2,3,4]; track $index) {
              <app-skeleton-card />
            }
          </div>
        } @else {
          <div class="stats-grid">
            <app-stat-card
              label="Total Requests"
              [value]="liveStats().totalRequests"
              icon="bar_chart"
              color="var(--mat-sys-primary)"
              [(highlighted)]="highlightedCard"
              (cardClicked)="onStatCardClicked($event)"
            />
            <app-stat-card
              label="Avg Response Time"
              [value]="liveStats().avgDuration"
              icon="timer"
              color="var(--mat-sys-secondary)"
              [(highlighted)]="highlightedCard"
              (cardClicked)="onStatCardClicked($event)"
            />
            <app-stat-card
              label="Cache Hit Rate"
              [value]="liveStats().cacheHitRate"
              icon="cached"
              color="var(--app-success, #4caf50)"
              [(highlighted)]="highlightedCard"
              (cardClicked)="onStatCardClicked($event)"
            />
            <app-stat-card
              label="Success Rate"
              [value]="liveStats().successRate"
              icon="check_circle"
              color="var(--app-success, #4caf50)"
              [(highlighted)]="highlightedCard"
              (cardClicked)="onStatCardClicked($event)"
            />
            <app-stat-card
              label="Queue Depth"
              [value]="liveStats().queueDepth"
              icon="queue"
              color="var(--app-warning, #ff9800)"
              [(highlighted)]="highlightedCard"
              (cardClicked)="onStatCardClicked($event)"
            />
          </div>
        }
      </section>

      <!-- Queue Chart -->
      @if (queueDepthHistory().length > 0 || store.queueStats()) {
        <section aria-labelledby="queue-heading" class="chart-section">
          <h2 id="queue-heading" class="section-heading">Queue Depth History</h2>
          <app-queue-chart
            [dataPoints]="queueDepthHistory()"
            label="Queue Depth Over Time"
            [color]="'var(--app-warning, #ff9800)'"
          />
          @if (queueProcessingRate() !== null) {
            <p class="processing-rate">
              Processing rate: <strong>{{ queueProcessingRate() }}</strong> jobs/min
            </p>
          }
        </section>
      }

      <!-- Quick Actions -->
      <section aria-labelledby="actions-heading" class="actions-section">
        <h2 id="actions-heading" class="section-heading">Quick Actions</h2>
        <div class="actions-grid">
          <button mat-raised-button class="bloqr-btn-primary action-btn"
            (click)="navigateTo('/compiler')">
            <mat-icon>build</mat-icon>
            Compile Filter List
          </button>
          <button mat-stroked-button class="action-btn"
            (click)="navigateTo('/compiler')">
            <mat-icon>layers</mat-icon>
            Batch Compile
          </button>
          <button mat-stroked-button class="action-btn"
            (click)="navigateTo('/compiler')">
            <mat-icon>cloud_queue</mat-icon>
            Async Compile
          </button>
          <button mat-stroked-button class="action-btn"
            (click)="showTester.set(true); testerCollapsed.set(false)">
            <mat-icon>science</mat-icon>
            API Tester
          </button>
        </div>
      </section>

      <!-- Deferred API Tester -->
      @if (showTester()) {
        @defer (on idle) {
          <section class="tester-section">
            <app-api-tester [(collapsed)]="testerCollapsed" />
          </section>
        } @placeholder {
          <div class="tester-placeholder">Loading API tester…</div>
        }
      }

      <!-- Navigation Grid -->
      <section aria-labelledby="nav-heading" class="nav-section">
        <h2 id="nav-heading" class="section-heading">Navigation</h2>
        <div class="nav-grid">
          @for (card of navCards; track card.path) {
            <mat-card
              appearance="outlined"
              class="nav-card bloqr-card cursor-pointer"
              (click)="navigateTo(card.path, card.external)"
              role="link"
              tabindex="0"
              (keydown.enter)="navigateTo(card.path, card.external)"
              (keydown.space)="navigateTo(card.path, card.external)"
              [matTooltip]="card.description"
            >
              <mat-card-header>
                <mat-icon mat-card-avatar class="nav-card-icon">{{ card.icon }}</mat-icon>
                <mat-card-title class="nav-card-title">{{ card.label }}</mat-card-title>
                @if (card.tag) {
                  <mat-chip class="nav-card-tag"
                    [class.warn-tag]="card.tag === 'Admin'"
                    [class.info-tag]="card.tag !== 'Admin'">
                    {{ card.tag }}
                  </mat-chip>
                }
              </mat-card-header>
              <mat-card-content>
                <p class="nav-card-desc">{{ card.description }}</p>
              </mat-card-content>
            </mat-card>
          }
        </div>
      </section>

      <!-- Cross-site navigation tiles -->
      <section aria-labelledby="external-nav-heading" class="nav-section">
        <h2 id="external-nav-heading" class="section-heading">More Bloqr</h2>
        <div class="nav-grid">
          <a href="https://api.bloqr.dev/" target="_blank" rel="noopener noreferrer" class="external-tile-link">
            <mat-card appearance="outlined" class="nav-card bloqr-card cursor-pointer">
              <mat-card-header>
                <mat-icon mat-card-avatar class="nav-card-icon">api</mat-icon>
                <mat-card-title class="nav-card-title">API Portal</mat-card-title>
              </mat-card-header>
              <mat-card-content>
                <p class="nav-card-desc">Interactive REST API explorer. Try requests in the browser.</p>
              </mat-card-content>
            </mat-card>
          </a>
          <a href="https://docs.bloqr.dev/" target="_blank" rel="noopener noreferrer" class="external-tile-link">
            <mat-card appearance="outlined" class="nav-card bloqr-card cursor-pointer">
              <mat-card-header>
                <mat-icon mat-card-avatar class="nav-card-icon">menu_book</mat-icon>
                <mat-card-title class="nav-card-title">Documentation</mat-card-title>
              </mat-card-header>
              <mat-card-content>
                <p class="nav-card-desc">Full technical reference, guides, and architecture docs.</p>
              </mat-card-content>
            </mat-card>
          </a>
          <a href="https://bloqr.dev/" target="_blank" rel="noopener noreferrer" class="external-tile-link">
            <mat-card appearance="outlined" class="nav-card bloqr-card cursor-pointer">
              <mat-card-header>
                <mat-icon mat-card-avatar class="nav-card-icon">open_in_new</mat-icon>
                <mat-card-title class="nav-card-title">Bloqr.com</mat-card-title>
              </mat-card-header>
              <mat-card-content>
                <p class="nav-card-desc">Marketing site, waitlist, and product overview.</p>
              </mat-card-content>
            </mat-card>
          </a>
        </div>
      </section>

      <!-- Endpoint Comparison Table -->
      <section aria-labelledby="endpoints-heading" class="endpoints-section">
        <h2 id="endpoints-heading" class="section-heading">API Endpoints</h2>
        <mat-card appearance="outlined" class="bloqr-card">
          <mat-card-content>
            <div class="table-wrapper" role="region" aria-label="API endpoints table" tabindex="0">
              <table class="endpoints-table" aria-labelledby="endpoints-heading">
                <thead>
                  <tr>
                    <th scope="col">Endpoint</th>
                    <th scope="col">Method</th>
                    <th scope="col">Auth</th>
                    <th scope="col">Description</th>
                    <th scope="col">Rate Limit</th>
                  </tr>
                </thead>
                <tbody>
                  @for (ep of endpointComparison; track ep.endpoint) {
                    <tr>
                      <td><code>{{ ep.endpoint }}</code></td>
                      <td><mat-chip class="method-chip" [class.post-chip]="ep.method === 'POST'">{{ ep.method }}</mat-chip></td>
                      <td>{{ ep.auth }}</td>
                      <td>{{ ep.description }}</td>
                      <td>{{ ep.rateLimit }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </mat-card-content>
        </mat-card>
      </section>

      <!-- Settings -->
      <section aria-labelledby="settings-heading" class="settings-section">
        <h2 id="settings-heading" class="section-heading">Settings</h2>
        <mat-card appearance="outlined" class="bloqr-card settings-card">
          <mat-card-content>
            <div class="setting-row">
              <div class="setting-label">
                <mat-icon>notifications</mat-icon>
                <span>Browser Notifications</span>
                <span class="setting-hint">Get notified when async jobs complete</span>
              </div>
              <mat-slide-toggle
                [checked]="notifications.isEnabled()"
                (change)="notifications.toggleNotifications()"
                aria-label="Toggle browser notifications"
              />
            </div>
            <mat-divider />
            <div class="setting-row">
              <div class="setting-label">
                <mat-icon>autorenew</mat-icon>
                <span>Auto-Refresh</span>
                <span class="setting-hint">Automatically refresh metrics every {{ autoRefreshInterval }}s</span>
              </div>
              <mat-slide-toggle
                [checked]="autoRefreshEnabled()"
                (change)="onAutoRefreshToggle()"
                aria-label="Toggle auto-refresh"
              />
            </div>
          </mat-card-content>
        </mat-card>
      </section>

    </div>
    `,
    styles: [`
    .dashboard-page {
        padding: 24px;
        max-width: 1280px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 32px;
    }

    .dashboard-header {
        padding-bottom: 8px;
    }

    .dashboard-title {
        font-family: 'Space Grotesk', system-ui, sans-serif;
        font-size: clamp(1.75rem, 3vw, 2.25rem);
        font-weight: 800;
        color: #F1F5F9;
        margin: 0 0 8px;
        letter-spacing: -0.02em;
    }

    .dashboard-subtitle {
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 1rem;
        color: #94A3B8;
        margin: 0;
    }

    .section-heading {
        font-family: 'Space Grotesk', system-ui, sans-serif;
        font-size: 1.125rem;
        font-weight: 600;
        color: #F1F5F9;
        margin: 0 0 16px;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        opacity: 0.85;
    }

    /* Status Bar */
    .status-bar {
        border-radius: 8px !important;
    }

    .status-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .status-indicator {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .status-text {
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 0.875rem;
        color: #F1F5F9;
        text-transform: capitalize;
    }

    .version-chip {
        font-size: 0.7rem;
        font-family: 'JetBrains Mono', monospace;
        background: rgba(255, 85, 0, 0.15) !important;
        color: #FF5500 !important;
    }

    /* Stats */
    .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 16px;
    }

    /* Chart */
    .chart-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .processing-rate {
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 0.875rem;
        color: #94A3B8;
        margin: 4px 0 0;
    }

    /* Quick Actions */
    .actions-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
    }

    .action-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: 'Space Grotesk', system-ui, sans-serif !important;
        font-weight: 600 !important;
    }

    /* Tester */
    .tester-placeholder {
        padding: 24px;
        text-align: center;
        color: #94A3B8;
        font-style: italic;
    }

    /* Nav Grid */
    .nav-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 16px;
    }

    .nav-card {
        cursor: pointer;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
    }

    .external-tile-link {
        display: block;
        text-decoration: none;
        color: inherit;
    }

    .nav-card:hover {
        transform: translateY(-2px);
        box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.4)) !important;
    }

    .nav-card:focus-visible {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
    }

    .nav-card-icon {
        color: var(--mat-sys-primary) !important;
        font-size: 28px !important;
        width: 28px !important;
        height: 28px !important;
    }

    .nav-card-title {
        font-family: 'Space Grotesk', system-ui, sans-serif;
        font-weight: 600;
        font-size: 1rem;
        color: #F1F5F9;
    }

    .nav-card-desc {
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 0.85rem;
        color: #94A3B8;
        margin: 0;
    }

    .nav-card-tag {
        font-size: 0.7rem !important;
    }

    .warn-tag {
        background: rgba(255, 85, 0, 0.15) !important;
        color: #FF5500 !important;
    }

    .info-tag {
        background: rgba(0, 212, 255, 0.12) !important;
        color: #00D4FF !important;
    }

    /* Endpoint Table */
    .table-wrapper {
        overflow-x: auto;
    }

    .endpoints-table {
        width: 100%;
        border-collapse: collapse;
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 0.85rem;
    }

    .endpoints-table th {
        text-align: left;
        padding: 10px 12px;
        border-bottom: 1px solid #1E2D40;
        color: #94A3B8;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-size: 0.75rem;
    }

    .endpoints-table td {
        padding: 10px 12px;
        border-bottom: 1px solid #162035;
        color: #F1F5F9;
        vertical-align: middle;
    }

    .endpoints-table tr:last-child td {
        border-bottom: none;
    }

    .endpoints-table code {
        font-family: 'JetBrains Mono', monospace;
        font-size: 0.8rem;
        color: #00D4FF;
        background: rgba(0, 212, 255, 0.08);
        padding: 2px 6px;
        border-radius: 4px;
    }

    .method-chip {
        font-size: 0.7rem !important;
        font-family: 'JetBrains Mono', monospace !important;
        font-weight: 700 !important;
        background: rgba(0, 212, 255, 0.12) !important;
        color: #00D4FF !important;
    }

    .post-chip {
        background: rgba(255, 85, 0, 0.15) !important;
        color: #FF5500 !important;
    }

    /* Settings */
    .settings-card {
        border-radius: 8px !important;
    }

    .setting-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 0;
        gap: 16px;
    }

    .setting-label {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1;
        min-width: 0;
    }

    .setting-label mat-icon {
        color: var(--mat-sys-primary);
        flex-shrink: 0;
    }

    .setting-label span:first-of-type {
        font-family: 'Space Grotesk', system-ui, sans-serif;
        font-weight: 600;
        color: #F1F5F9;
    }

    .setting-hint {
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 0.8rem;
        color: #94A3B8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* Bloqr card override */
    :host ::ng-deep .bloqr-card.mat-mdc-card {
        background: #0E1829;
        border: 1px solid #1E2D40;
        border-radius: 12px;
    }

    /* Bloqr primary button */
    :host ::ng-deep .bloqr-btn-primary.mat-mdc-raised-button {
        background: #FF5500;
        color: #ffffff;
        box-shadow: 0 0 20px rgba(255,85,0,0.30);
        border-radius: 8px;
        font-family: 'Space Grotesk', system-ui, sans-serif;
        font-weight: 600;
    }

    /* Responsive */
    @media (max-width: 600px) {
        .dashboard-page {
            padding: 16px;
            gap: 24px;
        }

        .actions-grid {
            flex-direction: column;
        }

        .action-btn {
            width: 100%;
        }
    }
    `],
})
export class HomeComponent {
    // ── Services ────────────────────────────────────────────────────────────
    readonly store = inject(MetricsStore);
    readonly notifications = inject(NotificationService);
    private readonly log = inject(LogService);
    private readonly liveAnnouncer = inject(LiveAnnouncer);
    private readonly router = inject(Router);
    private readonly destroyRef = inject(DestroyRef);
    private readonly platformId = inject(PLATFORM_ID);

    // ── UI state signals ────────────────────────────────────────────────────
    readonly highlightedCard = signal(false);
    readonly showTester = signal(false);
    readonly testerCollapsed = signal(true);
    readonly autoRefreshEnabled = signal(false);

    /** Auto-refresh interval in seconds */
    readonly autoRefreshInterval = 30;

    private refreshTimer: ReturnType<typeof setInterval> | null = null;

    // ── Navigation cards (6 entries) ────────────────────────────────────────
    readonly navCards: NavCard[] = [
        {
            path: '/compiler',
            label: 'Filter List Compiler',
            icon: 'build',
            description: 'Compile, merge, and transform adblock filter lists from multiple sources.',
        },
        {
            path: '/performance',
            label: 'Performance Metrics',
            icon: 'monitoring',
            description: 'Real-time compilation performance metrics and system health dashboards.',
        },
        {
            path: '/validation',
            label: 'Rule Validation',
            icon: 'check_circle',
            description: 'Validate adblock rules for syntax errors and compatibility issues.',
        },
        {
            path: '/api-docs',
            label: 'API Documentation',
            icon: 'description',
            description: 'Interactive REST API documentation with live request/response examples.',
        },
        {
            path: '/admin',
            label: 'Storage Admin',
            icon: 'admin_panel_settings',
            description: 'Manage R2 storage objects, D1 database tables, and KV cache entries.',
            tag: 'Admin',
        },
        {
            path: 'https://docs.bloqr.dev/',
            label: 'Documentation',
            icon: 'menu_book',
            description: 'Full developer documentation: API reference, guides, and examples.',
            tag: 'External',
            external: true,
        },
    ];

    // ── Endpoint comparison (9 entries) ────────────────────────────────────
    readonly endpointComparison: EndpointInfo[] = [
        { endpoint: '/api',              method: 'GET',  auth: 'None',     description: 'API information and version',         rateLimit: '100/min' },
        { endpoint: '/api/health',       method: 'GET',  auth: 'None',     description: 'System health status',                rateLimit: '100/min' },
        { endpoint: '/api/metrics',      method: 'GET',  auth: 'None',     description: 'Performance metrics snapshot',        rateLimit: '60/min'  },
        { endpoint: '/api/compile',      method: 'POST', auth: 'API Key',  description: 'Synchronous filter list compilation', rateLimit: '20/min'  },
        { endpoint: '/api/validate',     method: 'POST', auth: 'None',     description: 'Validate adblock rule syntax',        rateLimit: '60/min'  },
        { endpoint: '/api/queue/submit', method: 'POST', auth: 'API Key',  description: 'Submit async compilation job',        rateLimit: '10/min'  },
        { endpoint: '/api/queue/stats',  method: 'GET',  auth: 'None',     description: 'Queue depth and processing stats',    rateLimit: '60/min'  },
        { endpoint: '/api/ast/parse',    method: 'POST', auth: 'None',     description: 'Parse rules into AST',                rateLimit: '30/min'  },
        { endpoint: '/admin/storage',    method: 'GET',  auth: 'CF Access', description: 'Storage admin (R2/D1/KV)',           rateLimit: '30/min'  },
    ];

    // ── Computed stats ──────────────────────────────────────────────────────
    readonly liveStats = computed(() => {
        const m = this.store.metrics();
        const q = this.store.queueStats();
        return {
            totalRequests: m ? (m.totalRequests ?? 0).toLocaleString() : '—',
            avgDuration:   m ? `${(m.averageDuration ?? 0).toFixed(1)} ms` : '—',
            cacheHitRate:  m ? `${(m.cacheHitRate ?? 0).toFixed(1)}%` : '—',
            successRate:   m ? `${(m.successRate ?? 0).toFixed(1)}%` : '—',
            queueDepth:    q ? (q.currentDepth ?? 0).toString() : '—',
        };
    });

    readonly queueDepthHistory = computed(() => {
        const q = this.store.queueStats();
        if (!q?.depthHistory) return [];
        return q.depthHistory.map(e => e.depth);
    });

    readonly queueProcessingRate = computed(() => {
        const q = this.store.queueStats();
        return q ? q.processingRate : null;
    });

    readonly healthColor = computed(() => {
        const h = this.store.health();
        if (!h) return 'var(--app-success, #4caf50)';
        if (h.status === 'healthy') return 'var(--app-success, #4caf50)';
        if (h.status === 'degraded') return 'var(--app-warning, #ff9800)';
        return 'var(--app-error, #f44336)';
    });

    readonly healthIcon = computed(() => {
        const h = this.store.health();
        if (!h) return 'check_circle';
        if (h.status === 'healthy') return 'check_circle';
        if (h.status === 'degraded') return 'warning';
        return 'error';
    });

    constructor() {
        this.destroyRef.onDestroy(() => this.stopAutoRefresh());
    }

    // ── Event handlers ──────────────────────────────────────────────────────
    navigateTo(path: string, external?: true): void {
        if (external === true || path.startsWith('http://') || path.startsWith('https://')) {
            if (isPlatformBrowser(this.platformId)) {
                window.open(path, '_blank', 'noopener,noreferrer');
            }
            return;
        }
        void this.router.navigate([path]);
    }

    onStatCardClicked(label: string): void {
        const metricLabels = new Set(['Total Requests', 'Avg Response Time']);
        if (metricLabels.has(label)) {
            void this.router.navigate(['/performance']);
            void this.liveAnnouncer.announce(`Navigating to performance metrics`);
            this.log.info(`Stat card clicked: ${label}`, 'home');
        }
    }

    onAutoRefreshToggle(): void {
        if (this.autoRefreshEnabled()) {
            this.autoRefreshEnabled.set(false);
            this.stopAutoRefresh();
            this.log.info('Auto-refresh disabled', 'home');
        } else {
            this.autoRefreshEnabled.set(true);
            this.startAutoRefresh();
            this.log.info(`Auto-refresh enabled (${this.autoRefreshInterval}s)`, 'home');
        }
    }

    // ── Private helpers ─────────────────────────────────────────────────────
    private startAutoRefresh(): void {
        if (!isPlatformBrowser(this.platformId)) return;
        this.stopAutoRefresh();
        this.refreshTimer = setInterval(() => {
            this.store.refresh();
        }, this.autoRefreshInterval * 1000);
    }

    private stopAutoRefresh(): void {
        if (this.refreshTimer !== null) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }
}
