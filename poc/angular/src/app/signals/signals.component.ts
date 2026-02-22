/**
 * Angular PoC - Signals Component
 *
 * Angular 21 + Material Pattern: Signals with Material Design components
 * Demonstrates signal(), computed(), effect(), and Material UI
 */

import { Component, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { MatBadgeModule } from '@angular/material/badge';

/**
 * Interface for compilation history entry
 */
interface CompilationHistoryItem {
    readonly id: number;
    readonly timestamp: Date;
    readonly urlCount: number;
    readonly transformationCount: number;
    readonly status: 'success' | 'error';
}

/**
 * SignalsComponent
 * Demonstrates Angular 21 Signals with Material Design
 */
@Component({
    selector: 'app-signals',
    standalone: true,
    imports: [
        FormsModule,
        DatePipe,
        MatCardModule,
        MatButtonModule,
        MatIconModule,
        MatChipsModule,
        MatListModule,
        MatDividerModule,
        MatBadgeModule,
    ],
    template: `
    <div class="page-content">
        <h1 class="mat-headline-4">⚡ Angular Signals</h1>
        <p class="subtitle mat-body-1">Modern reactive state management with signals, computed values, and effects</p>

        <!-- SIGNAL DEMO: Counter -->
        <mat-card appearance="outlined" class="mb-2">
            <mat-card-header>
                <mat-icon mat-card-avatar>bolt</mat-icon>
                <mat-card-title>Compilation Counter (signal)</mat-card-title>
                <mat-card-subtitle><code>compilationCount = signal(0)</code></mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
                <div class="counter-display">
                    <span class="counter-value" [matBadge]="compilationCount()" matBadgeSize="large" matBadgeColor="primary">
                        <mat-icon style="font-size: 64px; width: 64px; height: 64px;">analytics</mat-icon>
                    </span>
                    <div class="counter-label mat-body-1">{{ compilationCount() }} compilations tracked</div>
                </div>
                <div class="button-group mt-2">
                    <button mat-raised-button color="primary" (click)="incrementCount()">
                        <mat-icon>add</mat-icon>
                        Add Compilation
                    </button>
                    <button mat-stroked-button (click)="resetCount()">
                        <mat-icon>refresh</mat-icon>
                        Reset Counter
                    </button>
                </div>
            </mat-card-content>
        </mat-card>

        <!-- COMPUTED DEMO: Statistics -->
        <mat-card appearance="outlined" class="mb-2">
            <mat-card-header>
                <mat-icon mat-card-avatar>calculate</mat-icon>
                <mat-card-title>Statistics (computed)</mat-card-title>
                <mat-card-subtitle>Derived values that auto-update when dependencies change</mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-value">{{ compilationCount() }}</div>
                        <div class="stat-label mat-caption">Total Compilations</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">{{ averageUrlsPerCompilation() }}</div>
                        <div class="stat-label mat-caption">Avg URLs/Compilation</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">{{ successRate() }}%</div>
                        <div class="stat-label mat-caption">Success Rate</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value" [style.color]="statusColor()">{{ compilationStatus() }}</div>
                        <div class="stat-label mat-caption">Status</div>
                    </div>
                </div>
            </mat-card-content>
        </mat-card>

        <!-- HISTORY: @for syntax -->
        <mat-card appearance="outlined" class="mb-2">
            <mat-card-header>
                <mat-icon mat-card-avatar>history</mat-icon>
                <mat-card-title>Compilation History (&#64;for syntax)</mat-card-title>
                <mat-card-subtitle>New Angular control flow syntax replaces *ngFor</mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
                @if (compilationHistory().length === 0) {
                    <p class="mat-body-2">No compilations yet. Click "Simulate Compilation" to add one!</p>
                } @else {
                    <mat-list>
                        @for (item of compilationHistory(); track item.id) {
                            <mat-list-item>
                                <mat-icon matListItemIcon [color]="item.status === 'success' ? 'primary' : 'warn'">
                                    {{ item.status === 'success' ? 'check_circle' : 'error' }}
                                </mat-icon>
                                <span matListItemTitle>Compilation #{{ item.id }}</span>
                                <span matListItemLine>
                                    {{ item.timestamp | date:'short' }} •
                                    {{ item.urlCount }} URLs •
                                    {{ item.transformationCount }} transformations
                                </span>
                            </mat-list-item>
                            <mat-divider></mat-divider>
                        }
                    </mat-list>
                }
            </mat-card-content>
            <mat-card-actions>
                <button mat-raised-button color="primary" (click)="simulateCompilation()">
                    <mat-icon>play_arrow</mat-icon>
                    Simulate Compilation
                </button>
            </mat-card-actions>
        </mat-card>

        <!-- EFFECT DEMO -->
        <mat-card appearance="outlined" class="mb-2">
            <mat-card-header>
                <mat-icon mat-card-avatar color="primary">electric_bolt</mat-icon>
                <mat-card-title>Side Effects (effect)</mat-card-title>
                <mat-card-subtitle>Runs when <code>compilationCount</code> changes</mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
                <p class="mat-body-1">
                    An <code>effect()</code> is watching <code>compilationCount</code>.
                    Every time you increment the counter, a message is logged to the console.
                    Open DevTools Console to see it!
                </p>
                <p class="mat-body-2">
                    Last effect triggered: <strong>{{ lastEffectTimestamp() }}</strong>
                </p>
            </mat-card-content>
        </mat-card>

        <!-- KEY TAKEAWAYS -->
        <mat-card appearance="outlined" class="info-card">
            <mat-card-header>
                <mat-icon mat-card-avatar>school</mat-icon>
                <mat-card-title>Key Takeaways</mat-card-title>
            </mat-card-header>
            <mat-card-content>
                <mat-chip-set>
                    <mat-chip highlighted color="primary">signal()</mat-chip>
                    <mat-chip highlighted color="accent">computed()</mat-chip>
                    <mat-chip highlighted color="warn">effect()</mat-chip>
                    <mat-chip>&#64;if/&#64;for</mat-chip>
                    <mat-chip>inject()</mat-chip>
                </mat-chip-set>
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

    .counter-display {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 24px;
        text-align: center;
    }

    .counter-value {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 16px;
    }

    .counter-label {
        color: var(--mat-sys-on-surface-variant, #666);
        font-size: 1.1rem;
    }

    .button-group {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
    }

    .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 16px;
    }

    .stat-item {
        text-align: center;
        padding: 16px;
        border-radius: 8px;
        background: var(--mat-sys-surface-variant, #f5f5f5);
    }

    .stat-value {
        font-size: 2rem;
        font-weight: 700;
        color: var(--mat-sys-primary, #1976d2);
    }

    .stat-label {
        color: var(--mat-sys-on-surface-variant, #666);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        font-size: 0.75rem;
        margin-top: 4px;
    }

    .info-card {
        background-color: var(--mat-sys-surface-variant, #f5f5f5);
    }

    code {
        font-family: 'Courier New', monospace;
        font-size: 0.9em;
    }
  `],
})
export class SignalsComponent {
    compilationCount = signal(0);
    private nextHistoryId = signal(0);
    compilationHistory = signal<CompilationHistoryItem[]>([]);
    lastEffectTimestamp = signal('Not triggered yet');

    averageUrlsPerCompilation = computed(() => {
        const history = this.compilationHistory();
        if (history.length === 0) return 0;
        const totalUrls = history.reduce((sum, item) => sum + item.urlCount, 0);
        return (totalUrls / history.length).toFixed(1);
    });

    successRate = computed(() => {
        const history = this.compilationHistory();
        if (history.length === 0) return 100;
        const successCount = history.filter(item => item.status === 'success').length;
        return Math.round((successCount / history.length) * 100);
    });

    compilationStatus = computed(() => {
        const count = this.compilationCount();
        if (count === 0) return 'Not Started';
        if (count < 5) return 'Getting Started';
        if (count < 10) return 'Active';
        return 'Power User';
    });

    statusColor = computed(() => {
        const count = this.compilationCount();
        if (count === 0) return '#666';
        if (count < 5) return '#3b82f6';
        if (count < 10) return '#10b981';
        return '#8b5cf6';
    });

    constructor() {
        effect(() => {
            const count = this.compilationCount();
            console.log(`[Angular Signals Effect] Compilation count changed to: ${count}`);
            this.lastEffectTimestamp.set(new Date().toLocaleTimeString());
        });
    }

    incrementCount(): void {
        this.compilationCount.update(count => count + 1);
    }

    resetCount(): void {
        this.compilationCount.set(0);
        this.compilationHistory.set([]);
    }

    simulateCompilation(): void {
        this.nextHistoryId.update(id => id + 1);
        const newItem: CompilationHistoryItem = {
            id: this.nextHistoryId(),
            timestamp: new Date(),
            urlCount: Math.floor(Math.random() * 5) + 1,
            transformationCount: Math.floor(Math.random() * 8) + 3,
            status: Math.random() > 0.2 ? 'success' : 'error',
        };
        this.compilationHistory.update(history => [...history, newItem]);
        this.incrementCount();
    }
}
