/**
 * ContainerStatusWidgetComponent
 *
 * Reusable widget showing Cloudflare Container lifecycle state.
 * Uses ContainerStatusService for data; can be set to auto-poll
 * or driven externally.
 *
 * Usage:
 *   <app-container-status-widget [compact]="true" />
 *
 * Angular 21 patterns: signal(), computed(), inject(), standalone,
 *   @if/@switch, zoneless-compatible
 */
import {
    Component, input, OnInit, OnDestroy, inject, computed, ChangeDetectionStrategy,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { ContainerStatusService } from '../../services/container-status.service';

@Component({
    selector: 'app-container-status-widget',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatIconModule, MatTooltipModule, MatProgressSpinnerModule, MatChipsModule],
    template: `
    <div class="container-status-widget" [class.compact]="compact()">
        @switch (status().status) {
            @case ('running') {
                <span class="status-dot dot-green pulse-slow" aria-hidden="true"></span>
                <mat-icon class="status-icon" [style.color]="statusColor()">check_circle</mat-icon>
                <span class="status-label">{{ statusLabel() }}</span>
                @if (status().latencyMs !== undefined) {
                    <span class="status-detail">{{ status().latencyMs }}ms</span>
                }
            }
            @case ('starting') {
                <mat-progress-spinner diameter="14" mode="indeterminate" class="inline-spinner" />
                <span class="status-label starting-pulse">{{ statusLabel() }}</span>
                <span class="status-detail hint">Container is waking up — this may take a moment</span>
            }
            @case ('sleeping') {
                <span class="status-dot dot-yellow" aria-hidden="true"></span>
                <mat-icon class="status-icon" [style.color]="statusColor()">bedtime</mat-icon>
                <span class="status-label">{{ statusLabel() }}</span>
                <span class="status-detail hint">Will start automatically on next request</span>
            }
            @case ('error') {
                <span class="status-dot dot-red" aria-hidden="true"></span>
                <mat-icon class="status-icon" [style.color]="statusColor()">error_outline</mat-icon>
                <span class="status-label">{{ statusLabel() }}</span>
            }
            @case ('unavailable') {
                <span class="status-dot dot-grey" aria-hidden="true"></span>
                <mat-icon class="status-icon" [style.color]="statusColor()">cloud_off</mat-icon>
                <span class="status-label">{{ statusLabel() }}</span>
            }
            @default {
                <span class="status-dot dot-grey" aria-hidden="true"></span>
                <span class="status-label muted">Checking container…</span>
            }
        }

        @if (!compact() && status().checkedAt) {
            <span class="status-timestamp">checked {{ checkedAgo() }}</span>
        }
    </div>
    `,
    styles: [`
    :host { display: block; }

    .container-status-widget {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 0;
        font-size: 13px;
        flex-wrap: wrap;
    }
    .container-status-widget.compact {
        padding: 2px 0;
        font-size: 12px;
        gap: 6px;
    }

    /* Reuse global status-dot from styles.css */
    .status-dot {
        width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
    }
    .dot-green  { background: #4caf50; }
    .dot-yellow { background: #ff9800; }
    .dot-red    { background: #f44336; }
    .dot-grey   { background: var(--mat-sys-on-surface-variant); opacity: 0.4; }

    @keyframes pulse-slow {
        0%, 100% { box-shadow: 0 0 0 0 rgba(76,175,80,0.5); }
        50%       { box-shadow: 0 0 0 5px rgba(76,175,80,0); }
    }
    .pulse-slow { animation: pulse-slow 2.5s ease-in-out infinite; }

    @keyframes starting-fade {
        0%, 100% { opacity: 1; }
        50%       { opacity: 0.5; }
    }
    .starting-pulse { animation: starting-fade 1.2s ease-in-out infinite; }

    .status-icon { font-size: 16px; width: 16px; height: 16px; }
    .status-label { font-weight: 500; color: var(--mat-sys-on-surface); }
    .status-detail {
        font-size: 11px;
        color: var(--mat-sys-on-surface-variant);
        font-variant-numeric: tabular-nums;
    }
    .status-detail.hint { font-style: italic; }
    .status-timestamp {
        font-size: 11px;
        color: var(--mat-sys-on-surface-variant);
        margin-left: auto;
    }
    .muted { color: var(--mat-sys-on-surface-variant); }

    .inline-spinner {
        display: inline-block;
        vertical-align: middle;
    }
    `],
})
export class ContainerStatusWidgetComponent implements OnInit, OnDestroy {
    /** Show in compact single-line mode */
    readonly compact = input<boolean>(false);
    /** If true, component manages its own polling lifecycle */
    readonly autoPoll = input<boolean>(true);
    /** Polling interval in ms (only used when autoPoll=true) */
    readonly pollIntervalMs = input<number>(10000);

    private readonly containerStatusService = inject(ContainerStatusService);

    readonly status = this.containerStatusService.status;
    readonly statusLabel = this.containerStatusService.statusLabel;
    readonly statusColor = this.containerStatusService.statusColor;

    readonly checkedAgo = computed(() => {
        const ts = this.status().checkedAt;
        if (!ts) return '';
        const diffMs = Date.now() - new Date(ts).getTime();
        if (diffMs < 5000) return 'just now';
        if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}s ago`;
        return `${Math.floor(diffMs / 60000)}m ago`;
    });

    ngOnInit(): void {
        if (this.autoPoll()) {
            this.containerStatusService.startPolling(this.pollIntervalMs());
        } else {
            this.containerStatusService.fetchOnce();
        }
    }

    ngOnDestroy(): void {
        if (this.autoPoll()) {
            this.containerStatusService.stopPolling();
        }
    }
}
