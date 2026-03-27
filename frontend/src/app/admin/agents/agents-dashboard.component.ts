/**
 * @fileoverview AgentsDashboardComponent — Admin agent management panel.
 *
 * Displays the registered agent list (card-per-agent), an active sessions
 * table with terminate action, and loading/error/empty states. This is the
 * main entry point for the /admin/agents route.
 *
 * Architecture notes:
 * - Data is fetched via AgentRpcService using afterNextRender() + manual signal-based state.
 * - Termination calls DELETE /admin/agents/sessions/:id and optimistically updates the local sessions list on success (no re-fetch).
 * - The agent card list is seeded from KNOWN_AGENTS and enriched with session counts.
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
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { DatePipe, SlicePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { AgentRpcService } from '../../services/agent-rpc.service';
import { KNOWN_AGENTS } from '../../models/agent.models';
import type { AgentListItem, AgentSession, AgentSessionsResponse } from '../../models/agent.models';

@Component({
    selector: 'app-agents-dashboard',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        // Angular common
        DatePipe,
        SlicePipe,
        RouterLink,
        // Angular Material
        MatCardModule,
        MatButtonModule,
        MatIconModule,
        MatTableModule,
        MatChipsModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        MatDividerModule,
    ],
    template: `
    <!-- Header card -->
    <mat-card appearance="outlined" class="mb-2">
        <mat-card-header>
            <mat-icon mat-card-avatar aria-hidden="true">smart_toy</mat-icon>
            <mat-card-title>Agent Management</mat-card-title>
            <mat-card-subtitle>Manage Cloudflare Agents SDK Durable Object agents</mat-card-subtitle>
        </mat-card-header>
        <mat-card-actions>
            <!-- Manual refresh button — reloads both agent list and sessions -->
            <button mat-stroked-button (click)="refresh()" [disabled]="loading()">
                <mat-icon aria-hidden="true">refresh</mat-icon> Refresh
            </button>
        </mat-card-actions>
    </mat-card>

    <!-- Global loading spinner -->
    @if (loading()) {
        <div class="loading-container">
            <mat-progress-spinner diameter="48" mode="indeterminate" />
        </div>
    }

    <!-- Error banner — dismissible -->
    @if (error()) {
        <mat-card appearance="outlined" class="error-card mb-2">
            <mat-card-content>
                <div class="error-row">
                    <mat-icon color="warn" aria-hidden="true">error_outline</mat-icon>
                    <span class="error-message">{{ error() }}</span>
                    <button mat-icon-button (click)="error.set(null)" aria-label="Dismiss error">
                        <mat-icon aria-hidden="true">close</mat-icon>
                    </button>
                </div>
            </mat-card-content>
        </mat-card>
    }

    @if (!loading()) {
        <!-- ---------------------------------------------------------------- -->
        <!-- Agent Registry Cards                                              -->
        <!-- ---------------------------------------------------------------- -->
        <mat-card appearance="outlined" class="mb-2">
            <mat-card-header>
                <mat-icon mat-card-avatar aria-hidden="true">inventory_2</mat-icon>
                <mat-card-title>Registered Agents</mat-card-title>
                <mat-card-subtitle>{{ agents().length }} agent(s) in registry</mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
                @if (agents().length === 0) {
                    <!-- Empty state for no registered agents -->
                    <div class="empty-state">
                        <mat-icon class="empty-icon" aria-hidden="true">smart_toy</mat-icon>
                        <p class="empty-title">No agents registered</p>
                        <p class="empty-subtitle">Add an entry to AGENT_REGISTRY in worker/agents/registry.ts to register an agent.</p>
                    </div>
                } @else {
                    <!-- Grid of agent cards — one per registry entry -->
                    <div class="agents-grid">
                        @for (agent of agents(); track agent.slug) {
                            <mat-card appearance="outlined" class="agent-card">
                                <mat-card-header>
                                    <!-- Transport badge: WS or SSE -->
                                    <mat-icon mat-card-avatar aria-hidden="true">
                                        {{ agent.transport === 'websocket' ? 'swap_horiz' : 'stream' }}
                                    </mat-icon>
                                    <mat-card-title>{{ agent.displayName }}</mat-card-title>
                                    <mat-card-subtitle>{{ agent.slug }}</mat-card-subtitle>
                                </mat-card-header>
                                <mat-card-content>
                                    <p class="agent-description">{{ agent.description }}</p>
                                    <!-- Chips: enabled state, transport, tier, scopes -->
                                    <div class="chip-row">
                                        <!-- Enabled/disabled chip -->
                                        @if (agent.enabled) {
                                            <mat-chip class="chip-enabled" aria-label="Agent is enabled">
                                                <mat-icon matChipLeadingIcon aria-hidden="true">check_circle</mat-icon>
                                                Enabled
                                            </mat-chip>
                                        } @else {
                                            <mat-chip class="chip-disabled" aria-label="Agent is disabled">
                                                <mat-icon matChipLeadingIcon aria-hidden="true">cancel</mat-icon>
                                                Disabled
                                            </mat-chip>
                                        }
                                        <!-- Transport chip -->
                                        <mat-chip class="chip-transport" [matTooltip]="'Primary transport: ' + agent.transport">
                                            {{ agent.transport === 'websocket' ? 'WS' : 'SSE' }}
                                        </mat-chip>
                                        <!-- Required tier chip -->
                                        <mat-chip class="chip-tier" [matTooltip]="'Required tier: ' + agent.requiredTier">
                                            <mat-icon matChipLeadingIcon aria-hidden="true">shield</mat-icon>
                                            {{ agent.requiredTier }}
                                        </mat-chip>
                                        <!-- Required scope chips -->
                                        @for (scope of agent.requiredScopes; track scope) {
                                            <mat-chip class="chip-scope" [matTooltip]="'Required scope: ' + scope">
                                                <mat-icon matChipLeadingIcon aria-hidden="true">key</mat-icon>
                                                {{ scope }}
                                            </mat-chip>
                                        }
                                    </div>
                                    <!-- Active session count -->
                                    <p class="agent-sessions-count">
                                        <mat-icon aria-hidden="true" style="font-size:16px;vertical-align:middle;">sensors</mat-icon>
                                        {{ agent.activeSessions }} active session(s)
                                        @if (agent.lastActiveAt) {
                                            &middot; last active {{ agent.lastActiveAt | date:'short' }}
                                        }
                                    </p>
                                </mat-card-content>
                                <mat-card-actions>
                                    <!-- Navigate to console for a new default instance -->
                                    <a mat-flat-button color="primary"
                                        [routerLink]="['/admin/agents', agent.slug, 'default']"
                                        [disabled]="!agent.enabled"
                                        [matTooltip]="agent.enabled ? 'Open agent console' : 'Agent is disabled'">
                                        <mat-icon aria-hidden="true">terminal</mat-icon>
                                        Connect
                                    </a>
                                </mat-card-actions>
                            </mat-card>
                        }
                    </div>
                }
            </mat-card-content>
        </mat-card>

        <!-- ---------------------------------------------------------------- -->
        <!-- Active Sessions Table                                             -->
        <!-- ---------------------------------------------------------------- -->
        <mat-card appearance="outlined">
            <mat-card-header>
                <mat-icon mat-card-avatar aria-hidden="true">sensors</mat-icon>
                <mat-card-title>Active Sessions</mat-card-title>
                <mat-card-subtitle>{{ activeSessions().length }} session(s) currently active</mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
                @if (sessions().length === 0) {
                    <!-- Empty state for no sessions -->
                    <div class="empty-state">
                        <mat-icon class="empty-icon" aria-hidden="true">sensors_off</mat-icon>
                        <p class="empty-title">No sessions yet</p>
                        <p class="empty-subtitle">Connect to an agent above to start a session.</p>
                    </div>
                } @else {
                    <!-- Sessions table — mat-table with terminate action column -->
                    <table mat-table [dataSource]="sessions()" class="sessions-table">

                        <!-- Session ID column — truncated to 8 chars for readability -->
                        <ng-container matColumnDef="id">
                            <th mat-header-cell *matHeaderCellDef>Session ID</th>
                            <td mat-cell *matCellDef="let row">
                                <code class="session-id" [matTooltip]="row.id">{{ row.id | slice:0:8 }}…</code>
                            </td>
                        </ng-container>

                        <!-- Agent slug column -->
                        <ng-container matColumnDef="agent_slug">
                            <th mat-header-cell *matHeaderCellDef>Agent</th>
                            <td mat-cell *matCellDef="let row">{{ row.agent_slug }}</td>
                        </ng-container>

                        <!-- Instance ID column -->
                        <ng-container matColumnDef="instance_id">
                            <th mat-header-cell *matHeaderCellDef>Instance</th>
                            <td mat-cell *matCellDef="let row">
                                <code class="instance-id">{{ row.instance_id }}</code>
                            </td>
                        </ng-container>

                        <!-- Started at column — relative time via DatePipe -->
                        <ng-container matColumnDef="started_at">
                            <th mat-header-cell *matHeaderCellDef>Started</th>
                            <td mat-cell *matCellDef="let row">{{ row.started_at | date:'short' }}</td>
                        </ng-container>

                        <!-- Status chip — active (green) or ended (grey) -->
                        <ng-container matColumnDef="status">
                            <th mat-header-cell *matHeaderCellDef>Status</th>
                            <td mat-cell *matCellDef="let row">
                                @if (!row.ended_at) {
                                    <span class="status-chip status-active">Active</span>
                                } @else {
                                    <span class="status-chip status-ended" [matTooltip]="row.end_reason ?? ''">Ended</span>
                                }
                            </td>
                        </ng-container>

                        <!-- Actions column — view console + terminate -->
                        <ng-container matColumnDef="actions">
                            <th mat-header-cell *matHeaderCellDef>Actions</th>
                            <td mat-cell *matCellDef="let row">
                                <div class="action-buttons">
                                    <!-- Navigate to the session console for this instance -->
                                    <a mat-icon-button
                                        [routerLink]="['/admin/agents', row.agent_slug, row.instance_id]"
                                        matTooltip="Open session console">
                                        <mat-icon aria-hidden="true">terminal</mat-icon>
                                    </a>
                                    <!-- Terminate button — only shown for active sessions -->
                                    @if (!row.ended_at) {
                                        <button mat-icon-button color="warn"
                                            (click)="terminateSession(row)"
                                            [disabled]="terminatingId() === row.id"
                                            matTooltip="Terminate session">
                                            @if (terminatingId() === row.id) {
                                                <mat-progress-spinner diameter="20" mode="indeterminate" />
                                            } @else {
                                                <mat-icon aria-hidden="true">stop_circle</mat-icon>
                                            }
                                        </button>
                                    }
                                </div>
                            </td>
                        </ng-container>

                        <tr mat-header-row *matHeaderRowDef="sessionColumns"></tr>
                        <tr mat-row *matRowDef="let row; columns: sessionColumns;"></tr>
                    </table>
                }
            </mat-card-content>
        </mat-card>
    }
    `,
    styles: [`
    .mb-2 { margin-bottom: 16px; }

    /* Loading */
    .loading-container {
        display: flex; justify-content: center; padding: 48px;
    }

    /* Error banner */
    .error-card {
        border-color: var(--mat-sys-error) !important;
    }
    .error-row {
        display: flex; align-items: center; gap: 12px;
    }
    .error-message {
        flex: 1; color: var(--mat-sys-error);
    }

    /* Empty states */
    .empty-state {
        display: flex; flex-direction: column; align-items: center;
        padding: 48px 24px; text-align: center;
        color: var(--mat-sys-on-surface-variant);
    }
    .empty-icon {
        font-size: 48px; width: 48px; height: 48px; opacity: 0.4; margin-bottom: 12px;
    }
    .empty-title {
        font-size: 16px; font-weight: 500; margin: 0 0 4px;
    }
    .empty-subtitle {
        font-size: 13px; margin: 0; max-width: 400px;
    }

    /* Agent registry grid */
    .agents-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 16px;
        padding: 8px 0;
    }
    .agent-card {
        height: 100%;
    }
    .agent-description {
        font-size: 13px;
        color: var(--mat-sys-on-surface-variant);
        margin: 0 0 12px;
        line-height: 1.5;
    }
    .chip-row {
        display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px;
    }
    .chip-enabled { background: color-mix(in srgb, var(--mat-sys-primary) 15%, transparent); color: var(--mat-sys-primary); }
    .chip-disabled { background: color-mix(in srgb, var(--mat-sys-error) 15%, transparent); color: var(--mat-sys-error); }
    .chip-transport { background: color-mix(in srgb, var(--mat-sys-tertiary) 15%, transparent); color: var(--mat-sys-tertiary); }
    .chip-tier { background: color-mix(in srgb, var(--mat-sys-secondary) 15%, transparent); color: var(--mat-sys-secondary); }
    .chip-scope { background: var(--mat-sys-surface-variant); color: var(--mat-sys-on-surface-variant); }

    .agent-sessions-count {
        font-size: 12px; color: var(--mat-sys-on-surface-variant); margin: 0;
    }

    /* Sessions table */
    .sessions-table { width: 100%; }
    .session-id {
        font-family: 'JetBrains Mono', monospace; font-size: 12px;
        background: var(--mat-sys-surface-container); padding: 2px 6px;
        border-radius: 4px;
    }
    .instance-id {
        font-family: 'JetBrains Mono', monospace; font-size: 12px;
    }

    /* Status chips */
    .status-chip {
        display: inline-block; padding: 2px 10px;
        border-radius: 12px; font-size: 12px; font-weight: 500;
    }
    .status-active {
        background: color-mix(in srgb, var(--mat-sys-primary) 15%, transparent);
        color: var(--mat-sys-primary);
    }
    .status-ended {
        background: var(--mat-sys-surface-variant);
        color: var(--mat-sys-on-surface-variant);
    }

    /* Action buttons row */
    .action-buttons {
        display: flex; align-items: center; gap: 4px;
    }
    `],
})
export class AgentsDashboardComponent {
    /** AgentRpcService — injected for HTTP API calls. */
    private readonly agentRpc = inject(AgentRpcService);

    /** DestroyRef — used by takeUntilDestroyed for subscription cleanup. */
    private readonly destroyRef = inject(DestroyRef);

    /** MatSnackBar — used to show terminate confirmation and error toasts. */
    private readonly snackBar = inject(MatSnackBar);

    // -------------------------------------------------------------------------
    // Component state signals
    // -------------------------------------------------------------------------

    /** True while initial data load or refresh is in progress. */
    readonly loading = signal(true);

    /** Non-null string when an error has occurred; shown in the error banner. */
    readonly error = signal<string | null>(null);

    /** List of known agents from the registry seed + session history. */
    readonly agents = signal<AgentListItem[]>([]);

    /** Full session list (active + ended) for the sessions table. */
    readonly sessions = signal<AgentSession[]>([]);

    /** ID of the session currently being terminated (drives inline spinner). */
    readonly terminatingId = signal<string | null>(null);

    /** Derived: only sessions where ended_at is null. */
    readonly activeSessions = computed(() => this.sessions().filter(s => !s.ended_at));

    /** Column definitions for the sessions mat-table. */
    readonly sessionColumns = ['id', 'agent_slug', 'instance_id', 'started_at', 'status', 'actions'] as const;

    /**
     * afterNextRender guard — triggers the initial data load after the first
     * browser render. Required because HttpClient should not be called during SSR.
     */
    private readonly _init = afterNextRender(() => this.loadData());

    // -------------------------------------------------------------------------
    // Data loading
    // -------------------------------------------------------------------------

    /**
     * Loads sessions from the API (single request) and derives the agent list
     * from the sessions response + KNOWN_AGENTS seed.
     *
     * Previously used forkJoin([listAgents(), listSessions()]), but listAgents()
     * itself calls listSessions() internally, which caused two identical GETs on
     * every refresh. Now we call listSessions() once and derive agents locally.
     *
     * Called on init and by refresh().
     */
    loadData(): void {
        this.loading.set(true);
        this.error.set(null);

        this.agentRpc
            .listSessions()
            .pipe(
                catchError((err: { error: string }) => {
                    this.error.set(err.error ?? 'Failed to load sessions.');
                    this.loading.set(false);
                    return of(null as AgentSessionsResponse | null);
                }),
                takeUntilDestroyed(this.destroyRef),
            )
            .subscribe((sessionsRes: AgentSessionsResponse | null) => {
                if (!sessionsRes) {
                    return;
                }

                const sessions = [...sessionsRes.sessions];
                this.sessions.set(sessions);
                this.agents.set(this.deriveAgentsFromSessions(sessions));
                this.loading.set(false);
            });
    }

    /**
     * Derives the AgentListItem list from a sessions array + KNOWN_AGENTS seed.
     * Groups sessions by slug, computes active-session counts and last-active timestamps.
     * Any slug found in session history but absent from KNOWN_AGENTS is added as a stub.
     *
     * @param sessions - The full session list from the API.
     * @returns AgentListItem[] — one entry per unique agent slug.
     */
    private deriveAgentsFromSessions(sessions: AgentSession[]): AgentListItem[] {
        const activeBySlug = new Map<string, number>();
        const lastActiveBySlug = new Map<string, string>();

        for (const session of sessions) {
            if (!session.ended_at) {
                activeBySlug.set(session.agent_slug, (activeBySlug.get(session.agent_slug) ?? 0) + 1);
            }
            const existing = lastActiveBySlug.get(session.agent_slug);
            if (!existing || session.started_at > existing) {
                lastActiveBySlug.set(session.agent_slug, session.started_at);
            }
        }

        const knownSlugs = new Set(KNOWN_AGENTS.map(a => a.slug));
        const sessionSlugs = new Set(sessions.map(s => s.agent_slug));

        const dynamicAgents: AgentListItem[] = [...sessionSlugs]
            .filter(slug => !knownSlugs.has(slug))
            .map(slug => ({
                bindingKey: slug.toUpperCase().replace(/-/g, '_'),
                slug,
                displayName: slug,
                description: 'Dynamically discovered agent (not in registry seed).',
                requiredTier: 'admin',
                requiredScopes: [],
                enabled: true,
                transport: 'websocket' as const,
                activeSessions: activeBySlug.get(slug) ?? 0,
                lastActiveAt: lastActiveBySlug.get(slug) ?? null,
            }));

        return [
            ...KNOWN_AGENTS.map(entry => ({
                ...entry,
                activeSessions: activeBySlug.get(entry.slug) ?? 0,
                lastActiveAt: lastActiveBySlug.get(entry.slug) ?? null,
            })),
            ...dynamicAgents,
        ];
    }

    /**
     * Manually refreshes the agent list and sessions table.
     * Bound to the Refresh button in the header card.
     */
    refresh(): void {
        this.loadData();
    }

    // -------------------------------------------------------------------------
    // Session termination
    // -------------------------------------------------------------------------

    /**
     * Terminates an active agent session via DELETE /admin/agents/sessions/:id.
     * Shows a snackbar confirmation on success or an error message on failure.
     * Optimistically updates the local session state instead of re-fetching the
     * entire list — only the affected session row is updated to ended state.
     *
     * @param session - The session row from the sessions table.
     */
    terminateSession(session: AgentSession): void {
        this.terminatingId.set(session.id);

        this.agentRpc.terminateSession(session.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: () => {
                this.terminatingId.set(null);
                this.snackBar.open(`Session ${session.id.slice(0, 8)}… terminated.`, 'Dismiss', { duration: 3000 });
                // Optimistically update only the affected session row rather than
                // re-fetching the entire list — avoids a redundant round-trip.
                const now = new Date().toISOString();
                this.sessions.update(prev =>
                    prev.map(s => s.id === session.id ? { ...s, ended_at: now, end_reason: 'admin_terminated' } : s),
                );
            },
            error: (err: { error: string; status: number }) => {
                this.terminatingId.set(null);
                const msg = err.error ?? 'Failed to terminate session.';
                this.snackBar.open(msg, 'Dismiss', { duration: 5000 });
            },
        });
    }
}
