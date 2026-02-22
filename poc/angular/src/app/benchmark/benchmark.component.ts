/**
 * Angular PoC - Benchmark Component
 *
 * Angular 21 + Material Pattern: Performance benchmarking with Material table
 * Uses inject() for functional dependency injection
 */

import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { CompilerService } from '../services/compiler.service';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatBadgeModule } from '@angular/material/badge';

/**
 * Interface for an individual benchmark run result
 */
interface BenchmarkRun {
    readonly run: number;
    readonly durationMs: number;
    readonly ruleCount: number;
    readonly status: 'success' | 'error';
}

/**
 * BenchmarkComponent
 * Uses Material table and progress bar for benchmark visualization
 */
@Component({
    selector: 'app-benchmark',
    standalone: true,
    imports: [
        FormsModule,
        DecimalPipe,
        MatCardModule,
        MatButtonModule,
        MatIconModule,
        MatSelectModule,
        MatFormFieldModule,
        MatCheckboxModule,
        MatProgressBarModule,
        MatTableModule,
        MatChipsModule,
        MatDividerModule,
        MatBadgeModule,
    ],
    template: `
    <div class="page-content">
        <h1 class="mat-headline-4">📊 Benchmark</h1>
        <p class="subtitle mat-body-1">
            Measure compilation API performance using <code>performance.now()</code>
        </p>

        <!-- Configuration -->
        <mat-card appearance="outlined" class="mb-2">
            <mat-card-header>
                <mat-icon mat-card-avatar>tune</mat-icon>
                <mat-card-title>Configuration</mat-card-title>
            </mat-card-header>
            <mat-card-content>
                <div class="config-row">
                    <mat-form-field appearance="outline">
                        <mat-label>Number of runs</mat-label>
                        <mat-select
                            [ngModel]="runCount()"
                            (ngModelChange)="runCount.set($event)"
                            [disabled]="running()"
                        >
                            <mat-option [value]="1">1 run</mat-option>
                            <mat-option [value]="5">5 runs</mat-option>
                            <mat-option [value]="10">10 runs</mat-option>
                            <mat-option [value]="20">20 runs</mat-option>
                        </mat-select>
                    </mat-form-field>
                </div>

                <div class="transformations-grid mt-2">
                    @for (name of transformationNames; track name) {
                        <mat-checkbox
                            [checked]="selectedTransformations().includes(name)"
                            (change)="toggleTransformation(name)"
                            [disabled]="running()"
                        >
                            {{ name }}
                        </mat-checkbox>
                    }
                </div>
            </mat-card-content>
            <mat-card-actions>
                <button
                    mat-raised-button
                    color="primary"
                    (click)="handleRunBenchmark()"
                    [disabled]="running()"
                >
                    @if (running()) {
                        <mat-icon>hourglass_empty</mat-icon>
                        Running... ({{ runs().length }}/{{ runCount() }})
                    } @else {
                        <mat-icon>play_arrow</mat-icon>
                        Run Benchmark
                    }
                </button>
            </mat-card-actions>
        </mat-card>

        <!-- Progress Bar -->
        @if (running()) {
            <mat-progress-bar
                mode="determinate"
                [value]="progressPercent()"
                class="mb-2"
            ></mat-progress-bar>
        }

        <!-- Results Table -->
        @if (runs().length > 0) {
            <mat-card appearance="outlined" class="mb-2">
                <mat-card-header>
                    <mat-icon mat-card-avatar>table_chart</mat-icon>
                    <mat-card-title>Results</mat-card-title>
                    <mat-card-subtitle>{{ runs().length }} runs completed</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>
                    <table mat-table [dataSource]="runs()" class="benchmark-table w-full">
                        <!-- Run column -->
                        <ng-container matColumnDef="run">
                            <th mat-header-cell *matHeaderCellDef>Run #</th>
                            <td mat-cell *matCellDef="let row">{{ row.run }}</td>
                        </ng-container>

                        <!-- Duration column -->
                        <ng-container matColumnDef="duration">
                            <th mat-header-cell *matHeaderCellDef>Duration (ms)</th>
                            <td mat-cell *matCellDef="let row">{{ row.durationMs }} ms</td>
                        </ng-container>

                        <!-- Rules/sec column -->
                        <ng-container matColumnDef="rulesPerSec">
                            <th mat-header-cell *matHeaderCellDef>Rules/sec</th>
                            <td mat-cell *matCellDef="let row">
                                {{ row.durationMs > 0 ? ((row.ruleCount / row.durationMs) * 1000 | number:'1.0-0') : '—' }}
                            </td>
                        </ng-container>

                        <!-- Status column -->
                        <ng-container matColumnDef="status">
                            <th mat-header-cell *matHeaderCellDef>Status</th>
                            <td mat-cell *matCellDef="let row">
                                <mat-icon [color]="row.status === 'success' ? 'primary' : 'warn'">
                                    {{ row.status === 'success' ? 'check_circle' : 'error' }}
                                </mat-icon>
                            </td>
                        </ng-container>

                        <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
                        <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
                    </table>

                    <!-- Summary Statistics -->
                    @if (!running()) {
                        <mat-divider class="mt-2 mb-2"></mat-divider>
                        <div class="summary-grid">
                            <div class="summary-item">
                                <div class="summary-value">{{ summary().min }} ms</div>
                                <div class="summary-label mat-caption">Min</div>
                            </div>
                            <div class="summary-item">
                                <div class="summary-value">{{ summary().max }} ms</div>
                                <div class="summary-label mat-caption">Max</div>
                            </div>
                            <div class="summary-item">
                                <div class="summary-value">{{ summary().avg }} ms</div>
                                <div class="summary-label mat-caption">Avg</div>
                            </div>
                            <div class="summary-item">
                                <div class="summary-value">{{ runs().length }}</div>
                                <div class="summary-label mat-caption">Runs</div>
                            </div>
                        </div>
                    }
                </mat-card-content>
            </mat-card>
        }

        <!-- Info Card -->
        <mat-card appearance="outlined" class="info-card">
            <mat-card-header>
                <mat-icon mat-card-avatar>info</mat-icon>
                <mat-card-title>Angular 21 Signals Pattern</mat-card-title>
            </mat-card-header>
            <mat-card-content>
                <p class="mat-body-1">
                    This component uses <code>signal()</code> for mutable reactive state and
                    <code>computed()</code> for derived summary statistics that update automatically.
                    Each run's wall-clock duration is measured with <code>performance.now()</code>.
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

    .config-row {
        display: flex;
        gap: 16px;
        align-items: flex-start;
        flex-wrap: wrap;
    }

    .transformations-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 12px;
    }

    .benchmark-table {
        width: 100%;
    }

    .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 16px;
    }

    .summary-item {
        text-align: center;
        padding: 16px;
        background: var(--mat-sys-surface-variant, #f5f5f5);
        border-radius: 8px;
    }

    .summary-value {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--mat-sys-primary, #1976d2);
    }

    .summary-label {
        color: var(--mat-sys-on-surface-variant, #666);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-top: 4px;
    }

    .info-card {
        background-color: var(--mat-sys-surface-variant, #f5f5f5);
    }
  `],
})
export class BenchmarkComponent {
    readonly transformationNames: string[] = [
        'RemoveComments',
        'Deduplicate',
        'TrimLines',
        'RemoveEmptyLines',
    ];

    readonly displayedColumns: string[] = ['run', 'duration', 'rulesPerSec', 'status'];
    readonly runCount = signal<number>(5);
    readonly running = signal<boolean>(false);
    readonly runs = signal<BenchmarkRun[]>([]);
    readonly selectedTransformations = signal<string[]>(['RemoveComments', 'Deduplicate']);

    readonly progressPercent = computed(() =>
        this.runCount() > 0
            ? Math.round((this.runs().length / this.runCount()) * 100)
            : 0,
    );

    readonly summary = computed(() => {
        const r = this.runs();
        if (r.length === 0) return { min: 0, max: 0, avg: 0 };
        const durations = r.map((x) => x.durationMs);
        return {
            min: Math.min(...durations),
            max: Math.max(...durations),
            avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
        };
    });

    private readonly compilerService = inject(CompilerService);

    toggleTransformation(name: string): void {
        this.selectedTransformations.update((prev) =>
            prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name],
        );
    }

    async handleRunBenchmark(): Promise<void> {
        this.running.set(true);
        this.runs.set([]);

        for (let i = 1; i <= this.runCount(); i++) {
            const start = performance.now();
            let durationMs: number;
            let ruleCount = 0;
            let status: 'success' | 'error' = 'success';

            try {
                const response = await fetch('/api/compile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        configuration: {
                            name: `Benchmark Run ${i}`,
                            sources: [{ source: 'https://easylist.to/easylist/easylist.txt' }],
                            transformations: this.selectedTransformations(),
                        },
                        benchmark: true,
                    }),
                });

                durationMs = Math.round(performance.now() - start);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json() as { ruleCount?: number };
                ruleCount = data.ruleCount ?? 0;
            } catch {
                durationMs = Math.round(performance.now() - start);
                ruleCount = 1234;
                status = 'error';
            }

            this.runs.update((prev) => [...prev, { run: i, durationMs, ruleCount, status }]);
        }

        this.running.set(false);
    }
}
