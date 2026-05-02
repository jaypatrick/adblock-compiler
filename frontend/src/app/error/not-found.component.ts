/**
 * NotFoundComponent — 404 page.
 *
 * Displayed when the router wildcard `**` is matched, meaning no other
 * route claimed the requested path. Provides a link back to the home page.
 *
 * Angular 21 patterns: inject(), standalone, RouterLink, Angular Material
 */

import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
    selector: 'app-not-found',
    standalone: true,
    imports: [RouterLink, MatButtonModule, MatIconModule],
    template: `
        <div class="not-found-container">
            <mat-icon class="not-found-icon">search_off</mat-icon>
            <h1 class="not-found-title">404 — Page Not Found</h1>
            <p class="not-found-message">
                The page you're looking for doesn't exist or has been moved.
            </p>
            <a mat-raised-button color="primary" routerLink="/">
                <mat-icon>home</mat-icon>
                Go Home
            </a>
        </div>
    `,
    styles: [`
        .not-found-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 60vh;
            gap: 16px;
            padding: 32px;
            text-align: center;
        }
        .not-found-icon {
            font-size: 72px;
            width: 72px;
            height: 72px;
            color: var(--mat-sys-outline, #9e9e9e);
        }
        .not-found-title {
            font-size: 28px;
            font-weight: 600;
            margin: 0;
            color: var(--mat-sys-on-surface, #1c1b1f);
        }
        .not-found-message {
            font-size: 16px;
            color: var(--mat-sys-on-surface-variant, #49454f);
            max-width: 420px;
            margin: 0;
        }
    `],
})
export class NotFoundComponent {}
