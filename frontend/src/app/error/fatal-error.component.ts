/**
 * FatalErrorComponent — Fatal / unrecoverable error page.
 *
 * Navigated to by GlobalErrorHandler when it catches an AppError
 * with `isFatal: true`. Provides two recovery actions:
 *   1. Reload the page (hard refresh).
 *   2. Navigate back to the home route.
 *
 * Angular 21 patterns: inject(), standalone, Angular Material
 */

import { Component, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
    selector: 'app-fatal-error',
    standalone: true,
    imports: [MatButtonModule, MatIconModule],
    template: `
        <div class="fatal-error-container">
            <mat-icon class="fatal-error-icon">error_outline</mat-icon>
            <h1 class="fatal-error-title">Something Went Wrong</h1>
            <p class="fatal-error-message">
                A critical error occurred. You can try reloading the page or
                returning to the home page.
            </p>
            <div class="fatal-error-actions">
                <button mat-raised-button color="primary" (click)="reload()">
                    <mat-icon>refresh</mat-icon>
                    Reload Page
                </button>
                <button mat-stroked-button (click)="goHome()">
                    <mat-icon>home</mat-icon>
                    Go Home
                </button>
            </div>
        </div>
    `,
    styles: [`
        .fatal-error-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 60vh;
            gap: 16px;
            padding: 32px;
            text-align: center;
        }
        .fatal-error-icon {
            font-size: 72px;
            width: 72px;
            height: 72px;
            color: var(--mat-sys-error, #c62828);
        }
        .fatal-error-title {
            font-size: 28px;
            font-weight: 600;
            margin: 0;
            color: var(--mat-sys-on-surface, #1c1b1f);
        }
        .fatal-error-message {
            font-size: 16px;
            color: var(--mat-sys-on-surface-variant, #49454f);
            max-width: 480px;
            margin: 0;
        }
        .fatal-error-actions {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            justify-content: center;
            margin-top: 8px;
        }
    `],
})
export class FatalErrorComponent {
    private readonly router = inject(Router);
    private readonly platformId = inject(PLATFORM_ID);

    reload(): void {
        if (isPlatformBrowser(this.platformId)) {
            window.location.reload();
        }
    }

    goHome(): void {
        void this.router.navigate(['/']);
    }
}
