/**
 * ErrorBoundaryComponent — Displays fallback UI when an unhandled error occurs.
 *
 * Reads from GlobalErrorHandler's lastError signal and shows a dismissible
 * error card with the error message and a retry/dismiss button.
 *
 * Admin users additionally see an expandable `<details>` panel showing the
 * full stack trace and context, gated on AuthFacadeService.isAdmin().
 *
 * Angular 21 patterns: inject(), signal consumption, standalone component,
 * @if control flow, ChangeDetectionStrategy.OnPush
 */

import { Component, ErrorHandler, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { GlobalErrorHandler } from './global-error-handler';
import { AuthFacadeService } from '../services/auth-facade.service';

@Component({
    selector: 'app-error-boundary',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatCardModule, MatButtonModule, MatIconModule],
    template: `
        @if (errorHandler.hasError()) {
            <div class="error-boundary-overlay">
                <mat-card appearance="outlined" class="error-boundary-card">
                    <mat-card-header>
                        <mat-icon mat-card-avatar class="error-icon">error_outline</mat-icon>
                        <mat-card-title>Something went wrong</mat-card-title>
                        <mat-card-subtitle>{{ errorHandler.lastError()?.timestamp?.toLocaleTimeString() }}</mat-card-subtitle>
                    </mat-card-header>
                    <mat-card-content>
                        <p class="error-message">{{ errorHandler.lastError()?.message }}</p>

                        @if (isAdmin() && errorHandler.lastError()) {
                            <details class="eb-admin-details">
                                <summary class="eb-admin-summary">Admin Details</summary>
                                <div class="eb-admin-body">
                                    @if (errorHandler.lastError()!.stack) {
                                        <div class="eb-admin-section">
                                            <span class="eb-admin-label">Stack Trace</span>
                                            <pre class="eb-admin-pre">{{ errorHandler.lastError()!.stack }}</pre>
                                        </div>
                                    }
                                    @if (errorHandler.lastError()!.context) {
                                        <div class="eb-admin-section">
                                            <span class="eb-admin-label">Context</span>
                                            <pre class="eb-admin-pre">{{ errorHandler.lastError()!.context }}</pre>
                                        </div>
                                    }
                                </div>
                            </details>
                        }
                    </mat-card-content>
                    <mat-card-actions>
                        <button mat-button (click)="dismiss()">
                            <mat-icon>close</mat-icon> Dismiss
                        </button>
                        <button mat-raised-button color="primary" (click)="reload()">
                            <mat-icon>refresh</mat-icon> Reload Page
                        </button>
                    </mat-card-actions>
                </mat-card>
            </div>
        }
    `,
    styles: [`
        .error-boundary-overlay {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 9999;
            max-width: 420px;
            animation: slideUp 0.3s ease-out;
        }
        @keyframes slideUp {
            from { transform: translateY(100%); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        .error-boundary-card {
            border-color: var(--mat-sys-error);
            background-color: var(--mat-sys-error-container, #fce4ec);
        }
        .error-icon { color: var(--mat-sys-error); }
        .error-message {
            font-family: 'Courier New', monospace;
            font-size: 13px;
            color: var(--mat-sys-on-error-container, var(--mat-sys-error));
            word-break: break-word;
            max-height: 120px;
            overflow-y: auto;
        }

        /* ── admin details panel ── */
        .eb-admin-details {
            margin-top: 12px;
            background: rgba(0, 0, 0, 0.06);
            border: 1px solid rgba(0,0,0,0.12);
            border-radius: 6px;
            overflow: hidden;
        }
        .eb-admin-summary {
            font-size: 11px;
            font-weight: 700;
            color: #FF5500;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            padding: 8px 12px;
            cursor: pointer;
            user-select: none;
        }
        .eb-admin-body {
            padding: 0 12px 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .eb-admin-section { display: flex; flex-direction: column; gap: 4px; }
        .eb-admin-label {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #64748b;
        }
        .eb-admin-pre {
            font-family: 'Courier New', monospace;
            font-size: 11px;
            white-space: pre-wrap;
            word-break: break-word;
            margin: 0;
            background: rgba(0,0,0,0.08);
            padding: 6px;
            border-radius: 4px;
            max-height: 160px;
            overflow-y: auto;
        }
    `],
})
export class ErrorBoundaryComponent {
    readonly errorHandler = inject(ErrorHandler) as GlobalErrorHandler;
    readonly isAdmin = inject(AuthFacadeService).isAdmin;

    dismiss(): void {
        this.errorHandler.clearError();
    }

    reload(): void {
        window.location.reload();
    }
}

