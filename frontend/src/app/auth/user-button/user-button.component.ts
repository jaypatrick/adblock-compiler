/**
 * UserButtonComponent — Shows user identity in the app header.
 *
 * Provider-aware via AuthFacadeService:
 *   - Clerk active + signed in  → mount Clerk's user button widget
 *   - Local auth + signed in    → email + sign-out button
 *   - Loaded + signed out       → sign-in / sign-up nav links
 *   - Still loading             → renders nothing (avoids flash)
 */

import { Component, ElementRef, afterNextRender, inject, viewChild, effect, OnDestroy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { ClerkService } from '../../services/clerk.service';
import { AuthFacadeService } from '../../services/auth-facade.service';
import { ThemeService } from '../../services/theme.service';

@Component({
    selector: 'app-user-button',
    standalone: true,
    imports: [RouterLink, MatButtonModule],
    template: `
        @if (auth.isLoaded()) {
            @if (auth.useClerk() && auth.isSignedIn()) {
                <!-- Clerk branch: mount the hosted user button widget -->
                <div #userButtonContainer class="user-button-container"></div>
            } @else if (auth.isSignedIn()) {
                <!-- Local auth branch: identifier + sign-out -->
                <div class="local-user">
                    <span class="local-user-email">{{ auth.userIdentifier() }}</span>
                    <a routerLink="/profile" mat-stroked-button type="button">Profile</a>
                    @if (auth.isAdmin()) {
                        <a routerLink="/admin" mat-stroked-button type="button">Admin</a>
                    }
                    <button mat-stroked-button type="button" (click)="signOut()">Sign out</button>
                </div>
            } @else {
                <!-- Signed-out state: nav links -->
                <nav class="auth-links" aria-label="Authentication">
                    <a routerLink="/sign-in" class="auth-link">Sign in</a>
                    <a routerLink="/sign-up" class="auth-link auth-link--primary">Sign up</a>
                </nav>
            }
        }
    `,
    styles: [`
        .user-button-container {
            display: inline-flex;
            align-items: center;
        }
        .local-user {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        .local-user-email {
            font-size: 0.875rem;
            color: var(--mat-sys-on-surface);
            max-width: 180px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .auth-links {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .auth-link {
            font-size: 0.875rem;
            font-weight: 500;
            text-decoration: none;
            padding: 0.375rem 0.75rem;
            border-radius: 4px;
            color: var(--mat-sys-on-surface);
            transition: background 0.15s;
        }
        .auth-link:hover {
            background: var(--mat-sys-surface-variant);
        }
        .auth-link--primary {
            background: var(--mat-sys-primary);
            color: var(--mat-sys-on-primary);
        }
        .auth-link--primary:hover {
            opacity: 0.9;
        }
    `],
})
export class UserButtonComponent implements OnDestroy {
    protected readonly auth = inject(AuthFacadeService);
    /** @deprecated TODO(auth-migration): Remove ClerkService injection when Clerk support is dropped. */
    private readonly clerk = inject(ClerkService);
    private readonly theme = inject(ThemeService);

    /** @deprecated TODO(auth-migration): Remove Clerk mount container + mounted flag. */
    private readonly container = viewChild<ElementRef<HTMLDivElement>>('userButtonContainer');
    private mounted = false;

    private readonly _mount = afterNextRender(() => this.tryMount());

    // TODO(auth-migration): Remove Clerk sign-in/mount effect when Clerk support is dropped.
    private readonly _signInEffect = effect(() => {
        const signedIn = this.auth.isSignedIn();
        const useClerk = this.auth.useClerk();
        if (signedIn && useClerk && !this.mounted) {
            queueMicrotask(() => this.tryMount());
        } else if (!signedIn) {
            this.mounted = false;
        }
    });

    // TODO(auth-migration): Remove Clerk theme re-mount effect when Clerk support is dropped.
    private readonly _themeEffect = effect(() => {
        this.theme.isDark();
        if (this.mounted) {
            const el = this.container()?.nativeElement;
            if (el) {
                this.clerk.unmountUserButton(el);
                this.mounted = false;
                this.tryMount();
            }
        }
    });

    // TODO(auth-migration): Remove Clerk unmount in ngOnDestroy when Clerk support is dropped.
    ngOnDestroy(): void {
        const el = this.container()?.nativeElement;
        if (el) this.clerk.unmountUserButton(el);
    }

    protected async signOut(): Promise<void> {
        await this.auth.signOut();
    }

    /** @deprecated TODO(auth-migration): Remove Clerk mount logic when Clerk support is dropped. */
    private tryMount(): void {
        const el = this.container()?.nativeElement;
        if (el && !this.mounted && this.auth.useClerk()) {
            this.clerk.mountUserButton(el);
            this.mounted = true;
        }
    }
}
