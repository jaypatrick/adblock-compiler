/**
 * AuthSettingsComponent — Admin panel for viewing authentication configuration.
 *
 * Displays the active auth provider, social provider status, MFA settings,
 * and session configuration. All fields are read-only — secrets are managed
 * via `wrangler secret put` or the Cloudflare dashboard.
 *
 * Route: /admin/auth-settings
 * Required: admin role
 */

import {
    Component,
    ChangeDetectionStrategy,
    DestroyRef,
    afterNextRender,
    inject,
    signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatListModule } from '@angular/material/list';

interface SocialProviderStatus {
    readonly configured: boolean;
}

interface AuthConfigResponse {
    readonly success: boolean;
    readonly data: {
        readonly provider: 'better-auth';
        readonly socialProviders: {
            readonly github: SocialProviderStatus;
            readonly google: SocialProviderStatus;
        };
        readonly mfa: {
            readonly enabled: boolean;
        };
        readonly session: {
            readonly expiresIn: number;
            readonly updateAge: number;
            readonly cookieCacheMaxAge: number;
        };
        readonly betterAuth: {
            readonly secretConfigured: boolean;
            readonly baseUrl: string | null;
        };
    };
}

function formatDuration(seconds: number): string {
    if (seconds >= 86400) { const d = Math.floor(seconds / 86400); return `${d} day${d !== 1 ? 's' : ''}`; }
    if (seconds >= 3600)  { const h = Math.floor(seconds / 3600);  return `${h} hour${h !== 1 ? 's' : ''}`; }
    if (seconds >= 60)    { const m = Math.floor(seconds / 60);    return `${m} min${m !== 1 ? 's' : ''}`;  }
    return `${seconds}s`;
}

@Component({
    selector: 'app-admin-auth-settings',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        RouterLink,
        MatCardModule,
        MatButtonModule,
        MatIconModule,
        MatChipsModule,
        MatProgressSpinnerModule,
        MatTooltipModule,
        MatDividerModule,
        MatListModule,
    ],
    template: `
    <!-- Page header -->
    <mat-card appearance="outlined" class="header-card">
        <mat-card-header>
            <mat-icon mat-card-avatar aria-hidden="true">lock</mat-icon>
            <mat-card-title>Auth Settings</mat-card-title>
            <mat-card-subtitle>Read-only view of the runtime authentication configuration</mat-card-subtitle>
        </mat-card-header>
        <mat-card-actions>
            <button mat-stroked-button (click)="loadData()">
                <mat-icon aria-hidden="true">refresh</mat-icon> Refresh
            </button>
        </mat-card-actions>
    </mat-card>

    @if (loading()) {
        <div class="loading-center">
            <mat-progress-spinner diameter="40" mode="indeterminate" />
        </div>
    } @else if (error()) {
        <mat-card appearance="outlined" class="error-card">
            <mat-card-content>
                <mat-icon aria-hidden="true" class="error-icon">error_outline</mat-icon>
                <span>{{ error() }}</span>
            </mat-card-content>
        </mat-card>
    } @else if (config()) {
        <div class="panels-grid">
            <!-- Panel 1: Active Provider -->
            <mat-card appearance="outlined">
                <mat-card-header>
                    <mat-icon mat-card-avatar aria-hidden="true">verified_user</mat-icon>
                    <mat-card-title>Active Auth Provider</mat-card-title>
                    <mat-card-subtitle>Which identity system is handling sessions</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>
                    <mat-list>
                        <mat-list-item>
                            <mat-icon matListItemIcon aria-hidden="true">hub</mat-icon>
                            <span matListItemTitle>Active Provider</span>
                            <span matListItemLine>
                                <span class="badge badge-primary">{{ config()!.provider }}</span>
                            </span>
                        </mat-list-item>
                        <mat-list-item>
                            <mat-icon matListItemIcon aria-hidden="true">key</mat-icon>
                            <span matListItemTitle>Better Auth Secret</span>
                            <span matListItemLine>
                                <span class="badge" [class.badge-ok]="config()!.betterAuth.secretConfigured" [class.badge-error]="!config()!.betterAuth.secretConfigured">
                                    {{ config()!.betterAuth.secretConfigured ? 'Configured ✓' : 'Not configured ✗' }}
                                </span>
                            </span>
                        </mat-list-item>
                        @if (config()!.betterAuth.baseUrl) {
                            <mat-list-item>
                                <mat-icon matListItemIcon aria-hidden="true">link</mat-icon>
                                <span matListItemTitle>Better Auth Base URL</span>
                                <span matListItemLine class="monospace">{{ config()!.betterAuth.baseUrl }}</span>
                            </mat-list-item>
                        }
                    </mat-list>
                </mat-card-content>
            </mat-card>

            <!-- Panel 2: Social Providers -->
            <mat-card appearance="outlined">
                <mat-card-header>
                    <mat-icon mat-card-avatar aria-hidden="true">people</mat-icon>
                    <mat-card-title>Social Providers</mat-card-title>
                    <mat-card-subtitle>OAuth credential presence — secrets managed via Cloudflare dashboard</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>
                    <mat-list>
                        <mat-list-item>
                            <mat-icon matListItemIcon aria-hidden="true">code</mat-icon>
                            <span matListItemTitle>GitHub OAuth</span>
                            <span matListItemLine>
                                <span class="badge" [class.badge-ok]="config()!.socialProviders.github.configured" [class.badge-neutral]="!config()!.socialProviders.github.configured">
                                    {{ config()!.socialProviders.github.configured ? 'Configured ✓' : 'Not configured' }}
                                </span>
                            </span>
                        </mat-list-item>
                        <mat-list-item>
                            <mat-icon matListItemIcon aria-hidden="true">g_mobiledata</mat-icon>
                            <span matListItemTitle>Google OAuth</span>
                            <span matListItemLine>
                                <span class="badge" [class.badge-ok]="config()!.socialProviders.google.configured" [class.badge-neutral]="!config()!.socialProviders.google.configured">
                                    {{ config()!.socialProviders.google.configured ? 'Configured ✓' : 'Not configured (future)' }}
                                </span>
                            </span>
                        </mat-list-item>
                    </mat-list>
                    <p class="info-note">
                        <mat-icon aria-hidden="true" class="note-icon">info</mat-icon>
                        OAuth credentials are managed via
                        <code>wrangler secret put</code> or the Cloudflare dashboard.
                        This panel shows their current status only.
                    </p>
                </mat-card-content>
            </mat-card>

            <!-- Panel 3: MFA / 2FA -->
            <mat-card appearance="outlined">
                <mat-card-header>
                    <mat-icon mat-card-avatar aria-hidden="true">phonelink_lock</mat-icon>
                    <mat-card-title>MFA / 2FA Settings</mat-card-title>
                    <mat-card-subtitle>Multi-factor authentication via TOTP</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>
                    <mat-list>
                        <mat-list-item>
                            <mat-icon matListItemIcon aria-hidden="true">security</mat-icon>
                            <span matListItemTitle>TOTP 2FA Plugin</span>
                            <span matListItemLine>
                                <span class="badge" [class.badge-ok]="config()!.mfa.enabled" [class.badge-error]="!config()!.mfa.enabled">
                                    {{ config()!.mfa.enabled ? 'Active ✓' : 'Inactive' }}
                                </span>
                            </span>
                        </mat-list-item>
                    </mat-list>
                    <p class="info-note">
                        <mat-icon aria-hidden="true" class="note-icon">info</mat-icon>
                        To manage individual users' 2FA status, visit
                        <a routerLink="/admin/users" class="info-link">User Management</a>.
                    </p>
                </mat-card-content>
            </mat-card>

            <!-- Panel 4: Session Settings -->
            <mat-card appearance="outlined">
                <mat-card-header>
                    <mat-icon mat-card-avatar aria-hidden="true">timer</mat-icon>
                    <mat-card-title>Session Settings</mat-card-title>
                    <mat-card-subtitle>Configured in code — requires a deploy to change</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>
                    <mat-list>
                        <mat-list-item>
                            <mat-icon matListItemIcon aria-hidden="true">hourglass_top</mat-icon>
                            <span matListItemTitle>Session Expires In</span>
                            <span matListItemLine>{{ formatDuration(config()!.session.expiresIn) }} ({{ config()!.session.expiresIn }}s)</span>
                        </mat-list-item>
                        <mat-list-item>
                            <mat-icon matListItemIcon aria-hidden="true">update</mat-icon>
                            <span matListItemTitle>Session Update Age</span>
                            <span matListItemLine>{{ formatDuration(config()!.session.updateAge) }} ({{ config()!.session.updateAge }}s)</span>
                        </mat-list-item>
                        <mat-list-item>
                            <mat-icon matListItemIcon aria-hidden="true">cookie</mat-icon>
                            <span matListItemTitle>Cookie Cache Max Age</span>
                            <span matListItemLine>{{ formatDuration(config()!.session.cookieCacheMaxAge) }} ({{ config()!.session.cookieCacheMaxAge }}s)</span>
                        </mat-list-item>
                    </mat-list>
                    <p class="info-note">
                        <mat-icon aria-hidden="true" class="note-icon">info</mat-icon>
                        Session values are configured in <code>worker/lib/auth.ts</code> and require a Worker deploy to change.
                    </p>
                </mat-card-content>
            </mat-card>
        </div>
    }
    `,
    styles: [`
    .header-card { margin-bottom: 16px; }
    .loading-center { display: flex; justify-content: center; padding: 48px; }
    .error-card mat-card-content { display: flex; align-items: center; gap: 8px; color: var(--mat-sys-error); padding: 16px; }
    .error-icon { color: var(--mat-sys-error); }
    .panels-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
        gap: 16px;
    }
    .badge {
        display: inline-block;
        padding: 2px 10px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 500;
    }
    .badge-primary { background: color-mix(in srgb, var(--mat-sys-primary) 15%, transparent); color: var(--mat-sys-primary); }
    .badge-ok { background: color-mix(in srgb, #4caf50 15%, transparent); color: #2e7d32; }
    .badge-error { background: color-mix(in srgb, var(--mat-sys-error) 15%, transparent); color: var(--mat-sys-error); }
    .badge-warn { background: color-mix(in srgb, #ff9800 15%, transparent); color: #e65100; }
    .badge-neutral { background: var(--mat-sys-surface-variant); color: var(--mat-sys-on-surface-variant); }
    .monospace { font-family: 'JetBrains Mono', monospace; font-size: 12px; }
    .info-note {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        margin: 12px 0 0;
        padding: 10px 12px;
        border-radius: 6px;
        background: var(--mat-sys-surface-variant);
        font-size: 13px;
        color: var(--mat-sys-on-surface-variant);
        line-height: 1.5;
    }
    .note-icon { font-size: 16px; width: 16px; height: 16px; flex-shrink: 0; margin-top: 1px; }
    .info-link { color: var(--mat-sys-primary); }
    code {
        font-family: 'JetBrains Mono', monospace;
        font-size: 12px;
        background: var(--mat-sys-surface-container);
        padding: 1px 5px;
        border-radius: 3px;
    }
    `],
})
export class AuthSettingsComponent {
    private readonly http = inject(HttpClient);
    private readonly destroyRef = inject(DestroyRef);

    readonly loading = signal(false);
    readonly error = signal<string | null>(null);
    readonly config = signal<AuthConfigResponse['data'] | null>(null);

    protected readonly formatDuration = formatDuration;

    private readonly _init = afterNextRender(() => this.loadData());

    loadData(): void {
        this.loading.set(true);
        this.error.set(null);

        this.http.get<AuthConfigResponse>('/admin/auth/config')
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (res) => {
                    this.config.set(res.data ?? null);
                    this.loading.set(false);
                },
                error: (err: unknown) => {
                    const msg = (err as { message?: string })?.message ?? 'Failed to load auth configuration.';
                    this.error.set(msg);
                    this.loading.set(false);
                },
            });
    }
}
