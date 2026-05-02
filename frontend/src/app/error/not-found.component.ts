/**
 * NotFoundComponent — Bloqr-branded 404 page.
 *
 * Displayed when the router wildcard `**` matches (no route claimed the path).
 * Features:
 *  - Bloqr colour palette (#070B14 bg, #FF5500 accent, #00D4FF secondary)
 *  - SVG "404" illustration with animated dashes
 *  - Three action buttons: Go Home / Go Back / Report Issue
 *  - Admin-only chip showing the requested path for quick triage
 *
 * Angular 21 patterns: inject(), computed(), ChangeDetectionStrategy.OnPush,
 * standalone component with @if control flow.
 */

import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthFacadeService } from '../services/auth-facade.service';

@Component({
    selector: 'app-not-found',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterLink, MatButtonModule, MatIconModule],
    template: `
        <div class="nf-page">
            <!-- SVG illustration -->
            <svg class="nf-svg" viewBox="0 0 420 160" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <!-- "4" left -->
                <text x="10" y="140" class="nf-digit">4</text>
                <!-- "0" center circle -->
                <circle cx="210" cy="80" r="62" class="nf-circle-bg"/>
                <circle cx="210" cy="80" r="62" class="nf-circle-dash"/>
                <text x="210" y="104" class="nf-digit nf-digit--mid">0</text>
                <!-- "4" right -->
                <text x="278" y="140" class="nf-digit">4</text>
            </svg>

            <h1 class="nf-heading">Page Not Found</h1>
            <p class="nf-subtext">
                The page you're looking for doesn't exist, was moved, or you may not have access.
            </p>

            @if (isAdmin()) {
                <div class="nf-admin-chip" title="Requested path (admin view)">
                    <span class="nf-admin-label">PATH</span>
                    <code class="nf-admin-path">{{ requestedPath }}</code>
                </div>
            }

            <div class="nf-actions">
                <a mat-raised-button class="nf-btn-primary" routerLink="/">
                    <mat-icon>home</mat-icon>
                    Go Home
                </a>
                <button mat-stroked-button class="nf-btn-secondary" (click)="goBack()">
                    <mat-icon>arrow_back</mat-icon>
                    Go Back
                </button>
                <a
                    mat-stroked-button
                    class="nf-btn-report"
                    href="https://github.com/jaypatrick/adblock-compiler/issues/new?template=bug_report.md"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <mat-icon>bug_report</mat-icon>
                    Report Issue
                </a>
            </div>
        </div>
    `,
    styles: [`
        :host {
            display: block;
            min-height: 100vh;
            background: #070B14;
            color: #F1F5F9;
        }

        .nf-page {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 32px 24px;
            text-align: center;
            gap: 20px;
        }

        /* ── SVG illustration ── */
        .nf-svg {
            width: 320px;
            height: 130px;
            overflow: visible;
        }
        .nf-digit {
            font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
            font-size: 128px;
            font-weight: 900;
            fill: #FF5500;
            dominant-baseline: auto;
        }
        .nf-digit--mid {
            text-anchor: middle;
            fill: #070B14;
        }
        .nf-circle-bg {
            fill: #FF5500;
        }
        .nf-circle-dash {
            fill: none;
            stroke: #00D4FF;
            stroke-width: 3;
            stroke-dasharray: 18 8;
            animation: spin 14s linear infinite;
            transform-origin: 210px 80px;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        /* ── text ── */
        .nf-heading {
            font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
            font-size: 2rem;
            font-weight: 700;
            margin: 0;
            color: #F1F5F9;
        }
        .nf-subtext {
            font-size: 1rem;
            color: #94a3b8;
            max-width: 440px;
            margin: 0;
            line-height: 1.6;
        }

        /* ── admin path chip ── */
        .nf-admin-chip {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: rgba(0, 212, 255, 0.08);
            border: 1px solid rgba(0, 212, 255, 0.25);
            border-radius: 6px;
            padding: 4px 12px;
            font-size: 12px;
        }
        .nf-admin-label {
            font-weight: 700;
            color: #00D4FF;
            letter-spacing: 0.05em;
        }
        .nf-admin-path {
            color: #F1F5F9;
            font-family: 'Courier New', monospace;
            word-break: break-all;
        }

        /* ── action buttons ── */
        .nf-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            justify-content: center;
        }
        .nf-btn-primary {
            background-color: #FF5500 !important;
            color: #fff !important;
        }
        .nf-btn-secondary {
            border-color: #00D4FF !important;
            color: #00D4FF !important;
        }
        .nf-btn-report {
            border-color: #64748b !important;
            color: #94a3b8 !important;
        }
    `],
})
export class NotFoundComponent {
    private readonly authFacade = inject(AuthFacadeService);
    private readonly router = inject(Router);

    /** isAdmin computed signal — gates admin triage chip */
    readonly isAdmin = this.authFacade.isAdmin;

    /** Captures the path that led to this 404, for admin visibility. */
    readonly requestedPath: string = this.router.url;

    /** Navigate back one step in history. */
    goBack(): void {
        window.history.back();
    }
}

