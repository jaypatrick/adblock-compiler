/**
 * UserButtonComponent — Shows user identity in the app header.
 *
 * Displays the signed-in user's email, profile/admin links, and sign-out
 * button when authenticated. Shows sign-in/sign-up links when signed out.
 */

import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { AuthFacadeService } from '../../services/auth-facade.service';

@Component({
    selector: 'app-user-button',
    standalone: true,
    imports: [RouterLink, MatButtonModule],
    template: `
        @if (auth.isLoaded()) {
            @if (auth.isSignedIn()) {
                <div class="local-user">
                    <span class="local-user-email">{{ auth.userIdentifier() }}</span>
                    <a routerLink="/profile" mat-stroked-button type="button">Profile</a>
                    @if (auth.isAdmin()) {
                        <a routerLink="/admin" mat-stroked-button type="button">Admin</a>
                    }
                    <button mat-stroked-button type="button" (click)="signOut()">Sign out</button>
                </div>
            } @else {
                <nav class="auth-links" aria-label="Authentication">
                    <a routerLink="/sign-in" class="auth-link">Sign in</a>
                    <a routerLink="/sign-up" class="auth-link auth-link--primary">Sign up</a>
                </nav>
            }
        }
    `,
    styles: [`
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
export class UserButtonComponent {
    protected readonly auth = inject(AuthFacadeService);

    async signOut(): Promise<void> {
        await this.auth.signOut();
    }
}
