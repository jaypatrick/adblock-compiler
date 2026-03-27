/**
 * @fileoverview AgentSessionConsoleComponent — Live WebSocket session console.
 *
 * Renders a terminal-style message feed for a single agent Durable Object instance.
 * The route is /admin/agents/:slug/:instanceId — both params are read from ActivatedRoute.
 *
 * Architecture notes:
 * - WebSocket connection is opened via AgentRpcService.connect() inside afterNextRender()
 *   because WebSocket must not be constructed during SSR (no browser APIs available).
 * - The message list uses CDK Virtual Scroll for O(1) DOM regardless of message count.
 * - Connection duration is tracked via a live interval counter.
 * - The DestroyRef passed to connect() ensures the socket is closed when the component
 *   is destroyed, preventing memory leaks and orphaned DO connections.
 *
 * See docs/frontend/AGENTS_FRONTEND.md for the WebSocket lifecycle documentation.
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
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { interval } from 'rxjs';
import { map } from 'rxjs/operators';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AgentRpcService } from '../../services/agent-rpc.service';
import { AuthFacadeService } from '../../services/auth-facade.service';
import type { AgentConnection } from '../../models/agent.models';

@Component({
    selector: 'app-agent-session-console',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        // Angular common
        FormsModule,
        DatePipe,
        // CDK Virtual Scroll — renders only visible rows for large message lists.
        ScrollingModule,
        // Angular Material
        MatCardModule,
        MatButtonModule,
        MatIconModule,
        MatFormFieldModule,
        MatInputModule,
        MatChipsModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
    ],
    template: `
    <!-- Session metadata header card -->
    <mat-card appearance="outlined" class="mb-2">
        <mat-card-header>
            <mat-icon mat-card-avatar aria-hidden="true">terminal</mat-icon>
            <mat-card-title>Agent Console — {{ slug() }}</mat-card-title>
            <mat-card-subtitle>Instance: {{ instanceId() }}</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
            <!-- Connection metadata row -->
            <div class="meta-row">
                <!-- Status indicator dot + label -->
                <span class="status-dot" [class]="'dot-' + (connection()?.status() ?? 'disconnected')"
                    [matTooltip]="'Connection status: ' + (connection()?.status() ?? 'disconnected')">
                </span>
                <span class="status-label" [class]="'label-' + (connection()?.status() ?? 'disconnected')">
                    {{ statusLabel() }}
                </span>
                <!-- Live connection duration counter -->
                @if (connection()?.status() === 'connected') {
                    <span class="duration-label">
                        <mat-icon aria-hidden="true" style="font-size:14px;vertical-align:middle;">timer</mat-icon>
                        {{ connectionDuration() }}
                    </span>
                }
                <span class="spacer"></span>
                <!-- Message count badge -->
                <span class="msg-count">
                    {{ connection()?.messages().length ?? 0 }} message(s)
                </span>
            </div>
        </mat-card-content>
        <mat-card-actions>
            <!-- Reconnect button — visible when not connected -->
            @if (connection()?.status() !== 'connected' && connection()?.status() !== 'connecting') {
                <button mat-flat-button color="primary" (click)="reconnect()">
                    <mat-icon aria-hidden="true">refresh</mat-icon> Reconnect
                </button>
            }
            <!-- Disconnect button — visible when connected -->
            @if (connection()?.status() === 'connected') {
                <button mat-stroked-button color="warn" (click)="disconnectManually()">
                    <mat-icon aria-hidden="true">stop_circle</mat-icon> Disconnect
                </button>
            }
        </mat-card-actions>
    </mat-card>

    <!-- Message feed — CDK Virtual Scroll for performance with large message lists -->
    <mat-card appearance="outlined" class="mb-2">
        <mat-card-header>
            <mat-icon mat-card-avatar aria-hidden="true">chat</mat-icon>
            <mat-card-title>Message Log</mat-card-title>
        </mat-card-header>
        <mat-card-content>
            @if ((connection()?.messages().length ?? 0) === 0) {
                <!-- Empty state — shown before any messages arrive -->
                <div class="empty-feed">
                    <mat-icon class="empty-icon" aria-hidden="true">chat_bubble_outline</mat-icon>
                    <p>No messages yet. Connect to start receiving messages.</p>
                </div>
            } @else {
                <!--
                  CDK Virtual Scroll Viewport:
                  itemSize="64" — estimated row height in px (matches .msg-row min-height).
                  This renders only the visible rows in the DOM, keeping performance
                  constant even with thousands of messages.
                  See: https://material.angular.io/cdk/scrolling/overview
                -->
                <cdk-virtual-scroll-viewport itemSize="64" class="message-viewport" #viewport>
                    @for (msg of connection()?.messages() ?? []; track msg.id) {
                        <!-- Individual message row -->
                        <div class="msg-row" [class.msg-out]="msg.direction === 'out'" [class.msg-in]="msg.direction === 'in'"
                             [class.msg-system]="msg.type === 'system'" [class.msg-error]="msg.type === 'error'">
                            <!-- Direction arrow + timestamp -->
                            <span class="msg-meta">
                                <mat-icon aria-hidden="true" class="msg-arrow">
                                    {{ msg.direction === 'out' ? 'arrow_upward' : 'arrow_downward' }}
                                </mat-icon>
                                <span class="msg-time">{{ msg.timestamp | date:'HH:mm:ss' }}</span>
                            </span>
                            <!-- Message content — monospace for JSON -->
                            <pre class="msg-content" [class.msg-json]="msg.type === 'json'">{{ msg.content }}</pre>
                        </div>
                    }
                </cdk-virtual-scroll-viewport>
            }
        </mat-card-content>
    </mat-card>

    <!-- Message input -->
    <mat-card appearance="outlined">
        <mat-card-content>
            <div class="input-row">
                <!-- Text input — disabled when not connected, Enter to send -->
                <mat-form-field appearance="outline" class="message-field">
                    <mat-label>Send a message</mat-label>
                    <input matInput
                        [(ngModel)]="messageInput"
                        [disabled]="connection()?.status() !== 'connected'"
                        (keydown.enter)="sendMessage()"
                        placeholder="Type a message and press Enter or click Send…"
                        aria-label="Message input" />
                </mat-form-field>
                <!-- Send button -->
                <button mat-flat-button color="primary"
                    [disabled]="connection()?.status() !== 'connected' || !messageInput.trim()"
                    (click)="sendMessage()">
                    <mat-icon aria-hidden="true">send</mat-icon>
                    Send
                </button>
            </div>
        </mat-card-content>
    </mat-card>
    `,
    styles: [`
    .mb-2 { margin-bottom: 16px; }
    .spacer { flex: 1 1 auto; }

    /* Status metadata row */
    .meta-row {
        display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    }
    .status-dot {
        width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0;
    }
    .dot-connecting  { background: #ff9800; box-shadow: 0 0 6px rgba(255,152,0,0.5); }
    .dot-connected   { background: #4caf50; box-shadow: 0 0 6px rgba(76,175,80,0.5); }
    .dot-disconnected{ background: #9e9e9e; }
    .dot-error       { background: #f44336; box-shadow: 0 0 6px rgba(244,67,54,0.5); }

    .status-label { font-size: 13px; font-weight: 500; }
    .label-connecting  { color: #ff9800; }
    .label-connected   { color: #4caf50; }
    .label-disconnected{ color: #9e9e9e; }
    .label-error       { color: #f44336; }

    .duration-label { font-size: 12px; color: var(--mat-sys-on-surface-variant); }
    .msg-count { font-size: 12px; color: var(--mat-sys-on-surface-variant); }

    /* Empty feed state */
    .empty-feed {
        display: flex; flex-direction: column; align-items: center;
        padding: 48px 24px; text-align: center;
        color: var(--mat-sys-on-surface-variant);
    }
    .empty-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.4; margin-bottom: 12px; }

    /* CDK Virtual Scroll viewport — fixed height to enable virtualisation */
    .message-viewport {
        height: 500px;
        width: 100%;
    }

    /* Message rows */
    .msg-row {
        display: flex; align-items: flex-start; gap: 10px;
        padding: 8px 12px; border-bottom: 1px solid var(--mat-sys-outline-variant);
        min-height: 56px;
    }
    .msg-out { background: color-mix(in srgb, var(--mat-sys-primary) 5%, transparent); }
    .msg-system { background: color-mix(in srgb, var(--mat-sys-tertiary) 5%, transparent); }
    .msg-error { background: color-mix(in srgb, var(--mat-sys-error) 5%, transparent); }

    .msg-meta {
        display: flex; flex-direction: column; align-items: center;
        gap: 2px; min-width: 48px; flex-shrink: 0;
    }
    .msg-arrow { font-size: 16px; width: 16px; height: 16px; }
    .msg-time { font-size: 10px; color: var(--mat-sys-on-surface-variant); white-space: nowrap; }

    .msg-content {
        flex: 1; margin: 0; font-size: 13px; white-space: pre-wrap; word-break: break-all;
        font-family: inherit;
    }
    .msg-json {
        font-family: 'JetBrains Mono', monospace; font-size: 12px;
    }

    /* Input row */
    .input-row {
        display: flex; align-items: flex-start; gap: 12px;
    }
    .message-field { flex: 1; }
    `],
})
export class AgentSessionConsoleComponent {
    /** AgentRpcService — manages the WebSocket connection. */
    private readonly agentRpc = inject(AgentRpcService);

    /** AuthFacadeService — used to retrieve the auth token for WebSocket auth. */
    private readonly authFacade = inject(AuthFacadeService);

    /** ActivatedRoute — provides :slug and :instanceId from the route params. */
    private readonly route = inject(ActivatedRoute);

    /**
     * DestroyRef — passed to AgentRpcService.connect() so the WebSocket is
     * automatically closed when this component is destroyed (route navigation away).
     */
    readonly destroyRef = inject(DestroyRef);

    // -------------------------------------------------------------------------
    // Route params
    // -------------------------------------------------------------------------

    /** Agent slug from route :slug param (e.g. 'mcp-agent'). */
    readonly slug = toSignal(
        this.route.paramMap.pipe(map(p => p.get('slug') ?? 'unknown')),
        { initialValue: 'unknown' },
    );

    /** DO instance ID from route :instanceId param (e.g. 'default'). */
    readonly instanceId = toSignal(
        this.route.paramMap.pipe(map(p => p.get('instanceId') ?? 'default')),
        { initialValue: 'default' },
    );

    // -------------------------------------------------------------------------
    // Component state
    // -------------------------------------------------------------------------

    /** The active AgentConnection handle — null until afterNextRender() fires. */
    readonly connection = signal<AgentConnection | null>(null);

    /** Text currently typed in the message input field. */
    messageInput = '';

    /** Timestamp when the current connection was opened (for duration display). */
    private connectedAt: Date | null = null;

    /**
     * Live connection duration counter updated every second via interval().
     * Uses toSignal() to bridge the Observable → Signal gap with auto-cleanup.
     * Only meaningful when status is 'connected'.
     */
    readonly connectionDuration = toSignal(
        interval(1000).pipe(
            map(() => {
                if (!this.connectedAt) return '0s';
                const elapsed = Math.floor((Date.now() - this.connectedAt.getTime()) / 1000);
                const h = Math.floor(elapsed / 3600);
                const m = Math.floor((elapsed % 3600) / 60);
                const s = elapsed % 60;
                return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
            }),
        ),
        { initialValue: '0s' },
    );

    /**
     * Human-readable status label derived from the connection status signal.
     * Renders "Connecting…", "Connected", "Disconnected", or "Error" in the UI.
     */
    readonly statusLabel = computed<string>(() => {
        const status = this.connection()?.status() ?? 'disconnected';
        switch (status) {
            case 'connecting': return 'Connecting…';
            case 'connected': return 'Connected';
            case 'disconnected': return 'Disconnected';
            case 'error': return 'Error';
        }
    });

    /**
     * afterNextRender guard — opens the WebSocket after the first browser render.
     * WebSocket() cannot be called during SSR (no browser APIs).
     * The auth token is fetched asynchronously and passed to connect().
     */
    private readonly _init = afterNextRender(() => {
        void this.openConnection();
    });

    // -------------------------------------------------------------------------
    // Connection management
    // -------------------------------------------------------------------------

    /**
     * Fetches the auth token and opens a WebSocket connection to the agent DO.
     * Called on init and by reconnect().
     */
    private async openConnection(): Promise<void> {
        // Retrieve the current auth token for the Sec-WebSocket-Protocol auth header.
        const token = await this.authFacade.getToken();
        const conn = this.agentRpc.connect(
            this.slug(),
            this.instanceId(),
            token ?? undefined,
            this.destroyRef,
        );

        this.connection.set(conn);
        this.connectedAt = new Date();
    }

    /**
     * Closes the current connection and opens a new one.
     * Bound to the Reconnect button visible when status is disconnected/error.
     */
    reconnect(): void {
        this.connection()?.disconnect();
        this.connection.set(null);
        void this.openConnection();
    }

    /**
     * User-initiated disconnect. Closes the WebSocket cleanly (code 1000).
     * Bound to the Disconnect button visible when status is connected.
     */
    disconnectManually(): void {
        this.connection()?.disconnect();
        this.connectedAt = null;
    }

    // -------------------------------------------------------------------------
    // Messaging
    // -------------------------------------------------------------------------

    /**
     * Sends the current message input over the WebSocket and clears the input.
     * No-op when not connected or input is blank.
     */
    sendMessage(): void {
        const text = this.messageInput.trim();
        if (!text || this.connection()?.status() !== 'connected') return;
        this.connection()?.send(text);
        this.messageInput = '';
    }
}
