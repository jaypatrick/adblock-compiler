/**
 * FatalErrorComponent — Bloqr-branded fatal / unrecoverable error page.
 *
 * Navigated to by GlobalErrorHandler when it catches an AppError with
 * `isFatal: true`.  The handler passes the structured AppError via Router
 * navigation state: `router.navigate(['/fatal-error'], { state: { error } })`.
 *
 * Features:
 *  - Reads AppError from `router.lastSuccessfulNavigation?.extras.state?.['error']`
 *  - Reads Sentry event ID via `Sentry.lastEventId?.()` (try/catch, best-effort)
 *  - Bloqr design tokens: bg #070B14, accent #FF5500, secondary #00D4FF
 *  - Admin `<details>` panel (gated on isAdmin()) showing stack + context + requestId
 *  - Recovery actions: Reload / Go Home / Contact Support
 *
 * Angular 21 patterns: inject(), computed(), OnInit, ChangeDetectionStrategy.OnPush,
 * standalone with @if control flow.
 */

import {
    Component,
    inject,
    computed,
    signal,
    OnInit,
    ChangeDetectionStrategy,
    PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser, DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthFacadeService } from '../services/auth-facade.service';
import { Sentry } from '../sentry';
import type { AppError } from './global-error-handler';

@Component({
    selector: 'app-fatal-error',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatButtonModule, MatIconModule, RouterLink, DatePipe],
    template: `
        <div class="fe-page">
            <!-- Animated hazard icon -->
            <div class="fe-icon-wrap" aria-hidden="true">
                <svg class="fe-svg" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
                    <polygon points="48,8 92,88 4,88" class="fe-triangle"/>
                    <line x1="48" y1="36" x2="48" y2="60" class="fe-excl-line"/>
                    <circle cx="48" cy="72" r="4" class="fe-excl-dot"/>
                </svg>
            </div>

            <h1 class="fe-heading">Something Went Wrong</h1>
            <p class="fe-subtext">
                @if (errorMessage()) {
                    {{ errorMessage() }}
                } @else {
                    A critical error occurred and the application cannot continue.
                    Your work may not have been saved.
                }
            </p>

            @if (sentryId()) {
                <p class="fe-sentry-id">
                    Error reference:&nbsp;<code>{{ sentryId() }}</code>
                </p>
            }

            <div class="fe-actions">
                <button mat-raised-button class="fe-btn-primary" (click)="reload()">
                    <mat-icon>refresh</mat-icon>
                    Reload Page
                </button>
                <button mat-stroked-button class="fe-btn-secondary" routerLink="/">
                    <mat-icon>home</mat-icon>
                    Go Home
                </button>
                @if (sentryId()) {
                    <a
                        mat-stroked-button
                        class="fe-btn-report"
                        href="https://github.com/jaypatrick/adblock-compiler/issues/new?template=bug_report.md"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <mat-icon>bug_report</mat-icon>
                        Contact Support
                    </a>
                }
            </div>

            @if (isAdmin() && appError()) {
                <details class="fe-admin-details">
                    <summary class="fe-admin-summary">Admin Details</summary>
                    <div class="fe-admin-body">
                        @if (appError()!.code) {
                            <div class="fe-admin-row">
                                <span class="fe-admin-key">Code</span>
                                <code class="fe-admin-val">{{ appError()!.code }}</code>
                            </div>
                        }
                        @if (appError()!.requestId) {
                            <div class="fe-admin-row">
                                <span class="fe-admin-key">Request ID</span>
                                <code class="fe-admin-val">{{ appError()!.requestId }}</code>
                            </div>
                        }
                        @if (appError()!.severity) {
                            <div class="fe-admin-row">
                                <span class="fe-admin-key">Severity</span>
                                <code class="fe-admin-val">{{ appError()!.severity }}</code>
                            </div>
                        }
                        @if (appError()!.timestamp) {
                            <div class="fe-admin-row">
                                <span class="fe-admin-key">Timestamp</span>
                                <code class="fe-admin-val">{{ appError()!.timestamp | date:'medium' }}</code>
                            </div>
                        }
                        @if (appError()!.context) {
                            <div class="fe-admin-row">
                                <span class="fe-admin-key">Context</span>
                                <pre class="fe-admin-pre">{{ appError()!.context }}</pre>
                            </div>
                        }
                        @if (appError()!.stack) {
                            <div class="fe-admin-row">
                                <span class="fe-admin-key">Stack</span>
                                <pre class="fe-admin-pre">{{ appError()!.stack }}</pre>
                            </div>
                        }
                    </div>
                </details>
            }
        </div>
    `,
    styles: [`
        :host {
            display: block;
            min-height: 100vh;
            background: #070B14;
            color: #F1F5F9;
        }

        .fe-page {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 32px 24px;
            text-align: center;
            gap: 20px;
        }

        /* ── hazard SVG ── */
        .fe-icon-wrap { line-height: 0; }
        .fe-svg {
            width: 80px;
            height: 80px;
            animation: pulse 2.4s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50%       { opacity: 0.5; }
        }
        .fe-triangle {
            fill: none;
            stroke: #FF5500;
            stroke-width: 5;
            stroke-linejoin: round;
        }
        .fe-excl-line {
            stroke: #FF5500;
            stroke-width: 5;
            stroke-linecap: round;
        }
        .fe-excl-dot { fill: #FF5500; }

        /* ── text ── */
        .fe-heading {
            font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
            font-size: 2rem;
            font-weight: 700;
            margin: 0;
            color: #F1F5F9;
        }
        .fe-subtext {
            font-size: 1rem;
            color: #94a3b8;
            max-width: 480px;
            margin: 0;
            line-height: 1.6;
        }
        .fe-sentry-id {
            font-size: 12px;
            color: #64748b;
            margin: 0;
        }
        .fe-sentry-id code {
            font-family: 'Courier New', monospace;
            color: #00D4FF;
        }

        /* ── actions ── */
        .fe-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            justify-content: center;
        }
        .fe-btn-primary {
            background-color: #FF5500 !important;
            color: #fff !important;
        }
        .fe-btn-secondary {
            border-color: #00D4FF !important;
            color: #00D4FF !important;
        }
        .fe-btn-report {
            border-color: #64748b !important;
            color: #94a3b8 !important;
        }

        /* ── admin details panel ── */
        .fe-admin-details {
            width: 100%;
            max-width: 700px;
            background: rgba(0, 212, 255, 0.04);
            border: 1px solid rgba(0, 212, 255, 0.2);
            border-radius: 8px;
            overflow: hidden;
            text-align: left;
        }
        .fe-admin-summary {
            font-weight: 700;
            color: #00D4FF;
            font-size: 13px;
            letter-spacing: 0.05em;
            padding: 12px 16px;
            cursor: pointer;
            user-select: none;
        }
        .fe-admin-summary:hover { background: rgba(0, 212, 255, 0.08); }
        .fe-admin-body {
            padding: 0 16px 16px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .fe-admin-row {
            display: grid;
            grid-template-columns: 100px 1fr;
            gap: 8px;
            align-items: baseline;
        }
        .fe-admin-key {
            font-size: 11px;
            font-weight: 700;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .fe-admin-val {
            font-family: 'Courier New', monospace;
            font-size: 12px;
            color: #F1F5F9;
        }
        .fe-admin-pre {
            font-family: 'Courier New', monospace;
            font-size: 11px;
            color: #94a3b8;
            white-space: pre-wrap;
            word-break: break-word;
            margin: 0;
            background: rgba(0,0,0,0.25);
            padding: 8px;
            border-radius: 4px;
            grid-column: span 1;
        }
    `],
})
export class FatalErrorComponent implements OnInit {
    private readonly router = inject(Router);
    private readonly authFacade = inject(AuthFacadeService);
    private readonly platformId = inject(PLATFORM_ID);

    readonly isAdmin = this.authFacade.isAdmin;

    /** AppError passed via Router state by GlobalErrorHandler. */
    readonly appError = signal<AppError | null>(null);

    /** User-facing message — prefer userMessage over generic message. */
    readonly errorMessage = computed(() => {
        const e = this.appError();
        return e?.userMessage ?? e?.message ?? null;
    });

    /** Sentry event ID for support reference, loaded best-effort. */
    readonly sentryId = signal<string | null>(null);

    ngOnInit(): void {
        this.loadErrorFromState();
        this.loadSentryId();
    }

    reload(): void {
        if (isPlatformBrowser(this.platformId)) {
            window.location.reload();
        }
    }

    private loadErrorFromState(): void {
        try {
            const nav = this.router.lastSuccessfulNavigation;
            const state = nav?.extras?.state as Record<string, unknown> | undefined;
            const error = state?.['error'] as AppError | undefined;
            if (error) {
                this.appError.set(error);
            }
        } catch {
            // Best-effort; state may not be available in all environments
        }
    }

    private loadSentryId(): void {
        try {
            const id: string | undefined = Sentry.lastEventId?.();
            if (id) this.sentryId.set(id);
        } catch {
            // Best-effort; Sentry may not be initialised
        }
    }
}

