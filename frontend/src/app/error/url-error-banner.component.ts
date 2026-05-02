/**
 * UrlErrorBannerComponent — Displays transient flash messages from FlashService.
 *
 * Reads the `currentFlash` signal from FlashService and renders a dismissible
 * notification banner at the top of the viewport. The banner is colour-coded
 * by type: info / warn / error / success.
 *
 * Usage: <app-url-error-banner /> in AppComponent template (outside router-outlet).
 *
 * Angular 21 patterns: inject(), signal consumption, @if control flow, standalone
 */

import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { FlashService } from '../services/flash.service';
import type { FlashType } from '../services/flash.service';

/** Maps FlashType to a Material icon name. */
const FLASH_ICONS: Record<FlashType, string> = {
    info:    'info',
    warn:    'warning',
    error:   'error',
    success: 'check_circle',
};

@Component({
    selector: 'app-url-error-banner',
    standalone: true,
    imports: [MatIconModule, MatButtonModule],
    template: `
        @if (flash.currentFlash(); as msg) {
            <div
                role="alert"
                [class]="'url-error-banner url-error-banner--' + msg.type"
            >
                <mat-icon class="banner-icon">{{ flashIcon(msg.type) }}</mat-icon>
                <span class="banner-message">{{ msg.message }}</span>
                <button
                    mat-icon-button
                    class="banner-dismiss"
                    aria-label="Dismiss"
                    (click)="flash.clear()"
                >
                    <mat-icon>close</mat-icon>
                </button>
            </div>
        }
    `,
    styles: [`
        .url-error-banner {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 16px;
            font-size: 14px;
            line-height: 1.4;
            animation: bannerSlideDown 0.25s ease-out;
        }
        @keyframes bannerSlideDown {
            from { transform: translateY(-100%); opacity: 0; }
            to   { transform: translateY(0);     opacity: 1; }
        }
        .banner-message { flex: 1; }
        .banner-icon    { flex-shrink: 0; }
        .banner-dismiss { flex-shrink: 0; margin-left: auto; }

        .url-error-banner--info {
            background-color: var(--mat-sys-primary-container, #e3f2fd);
            color: var(--mat-sys-on-primary-container, #0d47a1);
        }
        .url-error-banner--info .banner-icon {
            color: var(--mat-sys-primary, #1976d2);
        }

        .url-error-banner--success {
            background-color: var(--mat-sys-tertiary-container, #e8f5e9);
            color: var(--mat-sys-on-tertiary-container, #1b5e20);
        }
        .url-error-banner--success .banner-icon {
            color: var(--mat-sys-tertiary, #388e3c);
        }

        .url-error-banner--warn {
            background-color: var(--mat-sys-secondary-container, #fff8e1);
            color: var(--mat-sys-on-secondary-container, #e65100);
        }
        .url-error-banner--warn .banner-icon {
            color: var(--mat-sys-secondary, #f57c00);
        }

        .url-error-banner--error {
            background-color: var(--mat-sys-error-container, #fce4ec);
            color: var(--mat-sys-on-error-container, #b71c1c);
        }
        .url-error-banner--error .banner-icon {
            color: var(--mat-sys-error, #c62828);
        }
    `],
})
export class UrlErrorBannerComponent {
    readonly flash = inject(FlashService);

    flashIcon(type: FlashType): string {
        return FLASH_ICONS[type];
    }
}
