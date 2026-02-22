/**
 * Angular PoC - Home/Dashboard Component
 *
 * Angular 21 + Material Pattern: Dashboard with Material cards and buttons
 * Uses inject() for functional dependency injection
 */

import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatGridListModule } from '@angular/material/grid-list';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';

/**
 * Interface for stat cards
 */
interface StatCard {
    readonly label: string;
    readonly value: string;
    readonly icon: string;
    readonly color: string;
}

/**
 * HomeComponent
 * Pattern: Standalone component with Angular Material cards
 * Uses inject() for functional DI (Angular 21 pattern)
 */
@Component({
    selector: 'app-home',
    standalone: true,
    imports: [
        RouterLink,
        MatCardModule,
        MatButtonModule,
        MatGridListModule,
        MatIconModule,
        MatDividerModule,
        MatChipsModule,
    ],
    template: `
    <div class="page-content">
        <h1 class="mat-headline-4">Adblock Compiler Dashboard</h1>
        <p class="mat-body-1 subtitle">
            Welcome to the Adblock Compiler Angular 21 PoC. Compile and transform filter lists with ease.
        </p>

        <!-- Stats Grid using Material Cards -->
        <div class="stats-grid">
            @for (stat of stats; track stat.label) {
                <mat-card class="stat-card" appearance="outlined">
                    <mat-card-content>
                        <mat-icon [style.color]="stat.color" class="stat-icon">{{ stat.icon }}</mat-icon>
                        <div class="stat-value">{{ stat.value }}</div>
                        <div class="stat-label">{{ stat.label }}</div>
                    </mat-card-content>
                </mat-card>
            }
        </div>

        <mat-divider class="mb-3 mt-3"></mat-divider>

        <!-- Navigation Actions using Material Buttons -->
        <mat-card appearance="outlined" class="action-card">
            <mat-card-header>
                <mat-card-title>Get Started</mat-card-title>
                <mat-card-subtitle>Choose how to navigate to the Compiler</mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
                <div class="action-buttons mt-2">
                    <!--
                        ANGULAR ROUTER PATTERN 1: Programmatic Navigation
                        Router.navigate() called from component code
                    -->
                    <button mat-raised-button color="primary" (click)="goToCompiler()">
                        <mat-icon>settings</mat-icon>
                        Start Compiling
                    </button>

                    <!--
                        ANGULAR ROUTER PATTERN 2: Declarative Navigation
                        routerLink directive for template-driven navigation
                    -->
                    <a mat-stroked-button color="primary" routerLink="/compiler">
                        <mat-icon>link</mat-icon>
                        Open Compiler
                    </a>
                </div>
            </mat-card-content>
            <mat-card-actions>
                <mat-chip-set>
                    <mat-chip highlighted color="primary">Angular 21</mat-chip>
                    <mat-chip>Material Design</mat-chip>
                    <mat-chip>SSR</mat-chip>
                    <mat-chip>Signals</mat-chip>
                </mat-chip-set>
            </mat-card-actions>
        </mat-card>

        <!-- Info Card -->
        <mat-card appearance="outlined" class="info-card mt-2">
            <mat-card-header>
                <mat-icon mat-card-avatar>info</mat-icon>
                <mat-card-title>Angular 21 Features</mat-card-title>
            </mat-card-header>
            <mat-card-content>
                <p class="mat-body-1">
                    This page demonstrates standalone components,
                    the new <code>&#64;for</code> control flow syntax (replaces <code>*ngFor</code>),
                    Angular Material 3 components, and functional dependency injection with <code>inject()</code>.
                </p>
            </mat-card-content>
        </mat-card>
    </div>
    `,
    styles: [`
    .page-content {
        padding: 0;
    }

    .subtitle {
        color: var(--mat-sys-on-surface-variant, #666);
        margin-bottom: 24px;
    }

    .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px;
        margin-bottom: 24px;
    }

    .stat-card {
        text-align: center;
    }

    .stat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        margin-bottom: 8px;
    }

    .stat-value {
        font-size: 2rem;
        font-weight: 700;
        line-height: 1.2;
        margin-bottom: 4px;
    }

    .stat-label {
        font-size: 0.875rem;
        color: var(--mat-sys-on-surface-variant, #666);
    }

    .action-card {
        margin-bottom: 16px;
    }

    .action-buttons {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
    }

    .info-card {
        background-color: var(--mat-sys-surface-variant, #f5f5f5);
    }
  `],
})
export class HomeComponent {
    /** Component state: stat cards data */
    readonly stats: StatCard[] = [
        { label: 'Filter Lists Compiled', value: '1,234', icon: 'filter_list', color: '#1976d2' },
        { label: 'Total Rules Processed', value: '456K', icon: 'rule', color: '#388e3c' },
        { label: 'Active Transformations', value: '12', icon: 'transform', color: '#f57c00' },
        { label: 'Cache Hit Rate', value: '89%', icon: 'speed', color: '#7b1fa2' },
    ];

    /**
     * Inject Router using functional DI (Angular 21 pattern)
     * inject() replaces constructor DI for cleaner, more composable code
     */
    private readonly router = inject(Router);

    /**
     * Navigate to the Compiler page programmatically.
     * ANGULAR ROUTER PATTERN: Router.navigate() for imperative navigation
     */
    goToCompiler(): void {
        this.router.navigate(['/compiler']);
    }
}
