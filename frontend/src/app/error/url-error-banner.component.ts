/**
 * UrlErrorBannerComponent — Comprehensive error banner with URL param handling.
 *
 * Reads transient error/flash state from two sources and renders a fixed-top
 * dismissible notification banner:
 *
 *  1. FlashService.currentFlash() — in-process signal (set by guards, services)
 *  2. ?error=<CODE> URL query param — resolved via resolveErrorCode()
 *
 * Severity-coded colours follow Bloqr design tokens:
 *   fatal/error → red   (#FF5500-adjacent)
 *   warning     → amber
 *   info        → cyan  (#00D4FF-adjacent)
 *   success     → green
 *
 * Admin-only detail chip shows the raw error code for faster triage.
 * CTA button navigates to suggestedRoute when defined.
 * All param clearing uses replaceUrl:true so no history entry is created.
 *
 * Angular 21 patterns: inject(), signal(), computed(), @if control flow,
 * standalone component with ChangeDetectionStrategy.OnPush.
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
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { FlashService } from '../services/flash.service';
import type { FlashType } from '../services/flash.service';
import { AuthFacadeService } from '../services/auth-facade.service';
import { NavigationErrorService } from '../services/navigation-error.service';
import { resolveErrorCode, ErrorCodeDefinition } from './error-codes';
import { HttpClient } from '@angular/common/http';
import { API_BASE_URL } from '../tokens';

/** Maps FlashType to a Material icon name. */
const FLASH_ICONS: Record<FlashType, string> = {
    info:    'info',
    warn:    'warning',
    error:   'error',
    success: 'check_circle',
};

/** Maps severity to CSS class modifier. */
const SEVERITY_CLASS: Record<string, string> = {
    info:    'info',
    warning: 'warn',
    error:   'error',
    fatal:   'error',
};

interface ActiveBanner {
    message: string;
    type: FlashType;
    code?: string;
    definition?: ErrorCodeDefinition;
    isAdmin: boolean;
}

@Component({
    selector: 'app-url-error-banner',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatIconModule, MatButtonModule],
    template: `
        @if (activeBanner(); as banner) {
            <div
                role="alert"
                [class]="'url-error-banner url-error-banner--' + banner.type"
            >
                <mat-icon class="banner-icon">{{ flashIcon(banner.type) }}</mat-icon>

                <div class="banner-body">
                    <span class="banner-message">{{ banner.message }}</span>

                    @if (banner.isAdmin && banner.code) {
                        <span class="banner-code-chip">{{ banner.code }}</span>
                    }

                    @if (banner.isAdmin && banner.definition?.adminMessage) {
                        <span class="banner-admin-detail">{{ banner.definition!.adminMessage }}</span>
                    }
                </div>

                @if (banner.definition?.suggestedRoute) {
                    <button
                        mat-stroked-button
                        class="banner-cta"
                        (click)="navigateCta(banner.definition!.suggestedRoute!)"
                    >
                        {{ banner.definition!.suggestedAction ?? 'Learn More' }}
                    </button>
                }

                <button
                    mat-icon-button
                    class="banner-dismiss"
                    aria-label="Dismiss"
                    (click)="dismiss()"
                >
                    <mat-icon>close</mat-icon>
                </button>
            </div>
        }
    `,
    styles: [`
        :host {
            display: block;
            position: sticky;
            top: 0;
            z-index: 1000;
        }
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
        .banner-body {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
        }
        .banner-message { word-break: break-word; }
        .banner-icon    { flex-shrink: 0; }
        .banner-dismiss { flex-shrink: 0; margin-left: auto; }
        .banner-cta     { flex-shrink: 0; }

        .banner-code-chip {
            display: inline-block;
            font-family: 'Courier New', monospace;
            font-size: 11px;
            font-weight: 700;
            background: rgba(0,0,0,0.15);
            border-radius: 4px;
            padding: 1px 6px;
            width: fit-content;
        }
        .banner-admin-detail {
            font-size: 12px;
            opacity: 0.8;
            font-style: italic;
        }

        /* ── info */
        .url-error-banner--info {
            background-color: #003d52;
            color: #e0f7ff;
        }
        .url-error-banner--info .banner-icon { color: #00D4FF; }

        /* ── success */
        .url-error-banner--success {
            background-color: #0a2e14;
            color: #c8f5d1;
        }
        .url-error-banner--success .banner-icon { color: #4caf50; }

        /* ── warn */
        .url-error-banner--warn {
            background-color: #3d2800;
            color: #ffe0b2;
        }
        .url-error-banner--warn .banner-icon { color: #FF8F00; }

        /* ── error */
        .url-error-banner--error {
            background-color: #3d0a00;
            color: #ffe5dd;
        }
        .url-error-banner--error .banner-icon { color: #FF5500; }
    `],
})
export class UrlErrorBannerComponent implements OnInit {
    readonly flash = inject(FlashService);
    private readonly authFacade = inject(AuthFacadeService);
    private readonly navError = inject(NavigationErrorService);
    private readonly router = inject(Router);
    private readonly platformId = inject(PLATFORM_ID);
    private readonly http = inject(HttpClient);
    private readonly apiBase = inject(API_BASE_URL);

    private readonly isAdmin = computed(() => this.authFacade.isAdmin());

    /**
     * Stores code + definition when a ?error= URL param is resolved so that
     * activeBanner can include them for the admin chip and CTA.
     */
    private readonly urlErrorCtx = signal<{ code: string; definition: ErrorCodeDefinition } | null>(null);

    /**
     * Resolved banner from three sources in priority order:
     *   1. NavigationErrorService — errors set by guards (includes code + definition)
     *   2. FlashService — in-process signal (may be accompanied by urlErrorCtx)
     */
    readonly activeBanner = computed<ActiveBanner | null>(() => {
        // Priority 1: NavigationErrorService (guards attach code + definition)
        const navErr = this.navError.currentError();
        if (navErr) {
            const severity = navErr.definition.severity;
            const type: FlashType = severity === 'info' ? 'info'
                : severity === 'warning' ? 'warn'
                : 'error';
            return {
                message: navErr.message ?? navErr.definition.userMessage,
                type,
                code: navErr.code,
                definition: navErr.definition,
                isAdmin: this.isAdmin(),
            };
        }

        // Priority 2: FlashService — plain flash or URL ?error= param
        const flash = this.flash.currentFlash();
        if (flash) {
            const ctx = this.urlErrorCtx();
            return {
                message: flash.message,
                type: flash.type,
                code: ctx?.code,
                definition: ctx?.definition,
                isAdmin: this.isAdmin(),
            };
        }

        return null;
    });

    ngOnInit(): void {
        this.readErrorParam();
    }

    flashIcon(type: FlashType): string {
        return FLASH_ICONS[type];
    }

    dismiss(): void {
        this.flash.clear();
        this.navError.clear();
        this.urlErrorCtx.set(null);
        this.clearUrlParams();
    }

    navigateCta(route: string): void {
        void this.router.navigateByUrl(route);
    }

    /** Read ?error=CODE from the URL and resolve it into a flash message. */
    private readErrorParam(): void {
        if (!isPlatformBrowser(this.platformId)) return;

        const params = new URLSearchParams(window.location.search);
        const code = params.get('error');
        if (!code) return;

        const definition = resolveErrorCode(code);
        const severity = definition.severity;
        const type: FlashType = severity === 'info' ? 'info'
            : severity === 'warning' ? 'warn'
            : 'error';

        // Store code/definition so activeBanner can surface the admin chip and CTA
        this.urlErrorCtx.set({ code, definition });
        this.flash.set(definition.userMessage, type);

        // Report the URL-surfaced error to the backend for observability
        try {
            const payload = { message: definition.userMessage, url: window.location.href };
            this.http.post(`${this.apiBase}/log/frontend-error`, payload).subscribe({ error: () => {} });
        } catch {
            // Best-effort; never disrupt the UI
        }

        this.clearUrlParams();
    }

    private clearUrlParams(): void {
        if (!isPlatformBrowser(this.platformId)) return;
        void this.router.navigate([], {
            queryParams: { flash: null, error: null },
            queryParamsHandling: 'merge',
            replaceUrl: true,
        });
    }

    protected severityClass(severity: string): string {
        return SEVERITY_CLASS[severity] ?? 'info';
    }
}

