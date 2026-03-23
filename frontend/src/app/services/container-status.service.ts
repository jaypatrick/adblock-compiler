/**
 * ContainerStatusService
 *
 * Polls GET /api/container/status and exposes the result as Angular signals.
 * Uses a configurable polling interval (default 5s when active, 30s when idle).
 *
 * Angular 21 patterns: signal(), computed(), effect(), inject(), DestroyRef
 */
import { Injectable, inject, signal, computed, DestroyRef, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, Subscription, switchMap, catchError, of, startWith, map } from 'rxjs';
import { API_BASE_URL } from '../tokens';
import { ContainerStatusResponseSchema, validateResponse } from '../schemas/api-responses';

export type ContainerLifecycleStatus = 'running' | 'starting' | 'sleeping' | 'error' | 'unavailable' | 'unknown';

export interface ContainerStatus {
    readonly status: ContainerLifecycleStatus;
    readonly version?: string;
    readonly latencyMs?: number;
    readonly checkedAt?: string;
}

@Injectable({ providedIn: 'root' })
export class ContainerStatusService {
    private readonly http = inject(HttpClient);
    private readonly apiBaseUrl = inject(API_BASE_URL);
    private readonly destroyRef = inject(DestroyRef);
    private readonly platformId = inject(PLATFORM_ID);

    private readonly _status = signal<ContainerStatus>({ status: 'unknown' });
    private readonly _isPolling = signal(false);
    private pollSub: Subscription | null = null;

    /** Current container status */
    readonly status = this._status.asReadonly();
    /** Whether polling is active */
    readonly isPolling = this._isPolling.asReadonly();

    /** Human-readable label for the current status */
    readonly statusLabel = computed(() => {
        switch (this._status().status) {
            case 'running':     return 'Container Running';
            case 'starting':    return 'Container Starting…';
            case 'sleeping':    return 'Container Sleeping';
            case 'error':       return 'Container Error';
            case 'unavailable': return 'Container Unavailable';
            default:            return 'Container Status Unknown';
        }
    });

    /** Material icon name for current status */
    readonly statusIcon = computed(() => {
        switch (this._status().status) {
            case 'running':     return 'check_circle';
            case 'starting':    return 'hourglass_top';
            case 'sleeping':    return 'bedtime';
            case 'error':       return 'error';
            case 'unavailable': return 'cloud_off';
            default:            return 'help_outline';
        }
    });

    /** CSS color var for current status */
    readonly statusColor = computed(() => {
        switch (this._status().status) {
            case 'running':     return 'var(--mat-sys-primary)';
            case 'starting':    return 'var(--mat-sys-tertiary)';
            case 'sleeping':    return 'var(--mat-sys-on-surface-variant)';
            case 'error':       return 'var(--mat-sys-error)';
            default:            return 'var(--mat-sys-on-surface-variant)';
        }
    });

    /** True when status is a transient / interesting state worth showing */
    readonly isNoteworthyState = computed(() => {
        const s = this._status().status;
        return s === 'starting' || s === 'sleeping' || s === 'error';
    });

    /**
     * Start polling at the given interval (ms). Call with a short interval
     * (e.g. 2000ms) when user initiates a container compilation, and a longer
     * interval (e.g. 30000ms) for background health monitoring.
     */
    startPolling(intervalMs = 5000): void {
        if (!isPlatformBrowser(this.platformId)) return;
        this.stopPolling();
        this._isPolling.set(true);

        this.pollSub = interval(intervalMs).pipe(
            startWith(0),
            switchMap(() => this.http.get<unknown>(`${this.apiBaseUrl}/container/status`).pipe(
                map((raw) => validateResponse(ContainerStatusResponseSchema, raw, 'GET /container/status')),
                catchError(() => of<ContainerStatus>({ status: 'unavailable' })),
            )),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(status => this._status.set(status));
    }

    /** Stop polling */
    stopPolling(): void {
        this.pollSub?.unsubscribe();
        this.pollSub = null;
        this._isPolling.set(false);
    }

    /** Fetch once immediately (no polling) */
    fetchOnce(): void {
        if (!isPlatformBrowser(this.platformId)) return;
        this.http.get<unknown>(`${this.apiBaseUrl}/container/status`).pipe(
            map((raw) => validateResponse(ContainerStatusResponseSchema, raw, 'GET /container/status')),
            catchError(() => of<ContainerStatus>({ status: 'unavailable' })),
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(status => this._status.set(status));
    }
}
