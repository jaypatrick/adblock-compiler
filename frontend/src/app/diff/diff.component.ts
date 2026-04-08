/**
 * DiffComponent — compares two filter lists via POST /api/diff.
 *
 * Angular 21 patterns: rxResource for async diff, signal-based form state,
 * inline template following the same conventions as ValidationComponent.
 */

import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { EMPTY } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatTableModule } from '@angular/material/table';
import { DiffService, DiffOptions } from '../services/diff.service';
import { DiffApiResponse } from '../schemas/api-responses';

interface DiffParams {
    original: string[];
    current:  string[];
    options:  DiffOptions;
}

@Component({
    selector: 'app-diff',
    imports: [
        DecimalPipe,
        MatCardModule,
        MatButtonModule,
        MatIconModule,
        MatFormFieldModule,
        MatInputModule,
        MatChipsModule,
        MatProgressSpinnerModule,
        MatCheckboxModule,
        MatDividerModule,
        MatTableModule,
    ],
    template: `
    <div class="page-content">
        <h1 class="mat-headline-4">Filter List Diff</h1>
        <p class="subtitle mat-body-1">
            Compare two adblock filter lists using the AGTree AST diff engine
        </p>

        <!-- Two-panel input -->
        <mat-card appearance="outlined" class="mb-2">
            <mat-card-header>
                <mat-icon mat-card-avatar>compare</mat-icon>
                <mat-card-title>Input Lists</mat-card-title>
                <mat-card-subtitle>Enter filter rules (one per line) to compare</mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
                <div class="input-grid">
                    <mat-form-field appearance="outline" class="rules-field">
                        <mat-label>Original rules</mat-label>
                        <textarea matInput
                            [value]="originalText()"
                            (input)="onOriginalInput($event)"
                            rows="12"
                            placeholder="||example.com^&#10;||oldads.com^"
                        ></textarea>
                        <mat-hint>{{ originalCount() }} rule(s)</mat-hint>
                    </mat-form-field>

                    <mat-form-field appearance="outline" class="rules-field">
                        <mat-label>Current rules</mat-label>
                        <textarea matInput
                            [value]="currentText()"
                            (input)="onCurrentInput($event)"
                            rows="12"
                            placeholder="||example.com^&#10;||newads.com^"
                        ></textarea>
                        <mat-hint>{{ currentCount() }} rule(s)</mat-hint>
                    </mat-form-field>
                </div>

                <div class="options-row">
                    <mat-checkbox [checked]="opts.ignoreComments"    (change)="opts.ignoreComments    = $event.checked">Ignore comments</mat-checkbox>
                    <mat-checkbox [checked]="opts.ignoreEmptyLines"  (change)="opts.ignoreEmptyLines  = $event.checked">Ignore empty lines</mat-checkbox>
                    <mat-checkbox [checked]="opts.analyzeDomains"    (change)="opts.analyzeDomains    = $event.checked">Analyze domains</mat-checkbox>
                    <mat-checkbox [checked]="opts.includeFullRules"  (change)="opts.includeFullRules  = $event.checked">Include full rules</mat-checkbox>

                    <button mat-raised-button color="primary"
                        [disabled]="diffResource.isLoading() || !canCompare()"
                        (click)="compare()">
                        @if (diffResource.isLoading()) {
                            <mat-progress-spinner diameter="20" mode="indeterminate" />
                            Comparing…
                        } @else {
                            <span><mat-icon>compare_arrows</mat-icon> Compare</span>
                        }
                    </button>
                </div>
            </mat-card-content>
        </mat-card>

        <!-- Parse-error warnings (non-blocking) -->
        @if (diffResource.value(); as res) {
            @if (res.parseErrors.original.length || res.parseErrors.current.length) {
                <mat-card appearance="outlined" class="mb-2 warn-card">
                    <mat-card-header>
                        <mat-icon mat-card-avatar style="color: var(--mat-sys-tertiary)">warning</mat-icon>
                        <mat-card-title>Parse Warnings</mat-card-title>
                        <mat-card-subtitle>Some rules could not be parsed — diff may be incomplete</mat-card-subtitle>
                    </mat-card-header>
                    <mat-card-content>
                        @for (e of res.parseErrors.original; track $index) {
                            <div class="parse-error">
                                <mat-icon style="color:var(--mat-sys-tertiary)">warning</mat-icon>
                                <span><strong>Original line {{ e.line }}:</strong> {{ e.message }} — <code>{{ e.rule }}</code></span>
                            </div>
                        }
                        @for (e of res.parseErrors.current; track $index) {
                            <div class="parse-error">
                                <mat-icon style="color:var(--mat-sys-tertiary)">warning</mat-icon>
                                <span><strong>Current line {{ e.line }}:</strong> {{ e.message }} — <code>{{ e.rule }}</code></span>
                            </div>
                        }
                    </mat-card-content>
                </mat-card>
            }

            <!-- Summary stats -->
            <div class="stats-grid mb-2">
                <mat-card appearance="outlined" class="stat-card">
                    <mat-card-content class="stat-content">
                        <mat-icon style="color:var(--mat-sys-primary)">add_circle</mat-icon>
                        <span class="stat-value">{{ res.report.summary.addedCount }}</span>
                        <span class="stat-label">Added</span>
                    </mat-card-content>
                </mat-card>
                <mat-card appearance="outlined" class="stat-card">
                    <mat-card-content class="stat-content">
                        <mat-icon style="color:var(--mat-sys-error)">remove_circle</mat-icon>
                        <span class="stat-value">{{ res.report.summary.removedCount }}</span>
                        <span class="stat-label">Removed</span>
                    </mat-card-content>
                </mat-card>
                <mat-card appearance="outlined" class="stat-card">
                    <mat-card-content class="stat-content">
                        <mat-icon style="color:var(--mat-sys-on-surface-variant)">remove</mat-icon>
                        <span class="stat-value">{{ res.report.summary.unchangedCount }}</span>
                        <span class="stat-label">Unchanged</span>
                    </mat-card-content>
                </mat-card>
                <mat-card appearance="outlined" class="stat-card" [class.positive]="res.report.summary.netChange > 0" [class.negative]="res.report.summary.netChange < 0">
                    <mat-card-content class="stat-content">
                        <mat-icon>{{ res.report.summary.netChange >= 0 ? 'trending_up' : 'trending_down' }}</mat-icon>
                        <span class="stat-value">{{ res.report.summary.netChange >= 0 ? '+' : '' }}{{ res.report.summary.netChange }}</span>
                        <span class="stat-label">Net change ({{ res.report.summary.percentageChange | number:'1.1-1' }}%)</span>
                    </mat-card-content>
                </mat-card>
            </div>

            <!-- Added rules -->
            @if (res.report.added.length) {
                <mat-card appearance="outlined" class="mb-2 added-card">
                    <mat-card-header>
                        <mat-icon mat-card-avatar style="color:var(--mat-sys-primary)">add_circle</mat-icon>
                        <mat-card-title>Added Rules ({{ res.report.added.length }})</mat-card-title>
                    </mat-card-header>
                    <mat-card-content>
                        <div class="rule-list">
                            @for (r of res.report.added; track $index) {
                                <div class="rule-row added">
                                    <mat-icon class="rule-icon" style="color:var(--mat-sys-primary)">add</mat-icon>
                                    <code class="rule-text">{{ r.rule }}</code>
                                    @if (r.newLine) { <mat-chip>line {{ r.newLine }}</mat-chip> }
                                </div>
                            }
                        </div>
                    </mat-card-content>
                </mat-card>
            }

            <!-- Removed rules -->
            @if (res.report.removed.length) {
                <mat-card appearance="outlined" class="mb-2 removed-card">
                    <mat-card-header>
                        <mat-icon mat-card-avatar style="color:var(--mat-sys-error)">remove_circle</mat-icon>
                        <mat-card-title>Removed Rules ({{ res.report.removed.length }})</mat-card-title>
                    </mat-card-header>
                    <mat-card-content>
                        <div class="rule-list">
                            @for (r of res.report.removed; track $index) {
                                <div class="rule-row removed">
                                    <mat-icon class="rule-icon" style="color:var(--mat-sys-error)">remove</mat-icon>
                                    <code class="rule-text">{{ r.rule }}</code>
                                    @if (r.originalLine) { <mat-chip>line {{ r.originalLine }}</mat-chip> }
                                </div>
                            }
                        </div>
                    </mat-card-content>
                </mat-card>
            }

            <!-- Domain changes table -->
            @if (res.report.domainChanges.length) {
                <mat-card appearance="outlined" class="mb-2">
                    <mat-card-header>
                        <mat-icon mat-card-avatar>language</mat-icon>
                        <mat-card-title>Domain Changes ({{ res.report.domainChanges.length }})</mat-card-title>
                    </mat-card-header>
                    <mat-card-content>
                        <table mat-table [dataSource]="res.report.domainChanges" class="domain-table">
                            <ng-container matColumnDef="domain">
                                <th mat-header-cell *matHeaderCellDef>Domain</th>
                                <td mat-cell *matCellDef="let row"><code>{{ row.domain }}</code></td>
                            </ng-container>
                            <ng-container matColumnDef="added">
                                <th mat-header-cell *matHeaderCellDef>Added</th>
                                <td mat-cell *matCellDef="let row" style="color:var(--mat-sys-primary)">+{{ row.added }}</td>
                            </ng-container>
                            <ng-container matColumnDef="removed">
                                <th mat-header-cell *matHeaderCellDef>Removed</th>
                                <td mat-cell *matCellDef="let row" style="color:var(--mat-sys-error)">-{{ row.removed }}</td>
                            </ng-container>
                            <tr mat-header-row *matHeaderRowDef="domainCols"></tr>
                            <tr mat-row *matRowDef="let row; columns: domainCols"></tr>
                        </table>
                    </mat-card-content>
                </mat-card>
            }

            <!-- Footer: duration + generator version -->
            <p class="meta mat-body-2">
                Compared in {{ res.duration }} · generator {{ res.report.generatorVersion }}
            </p>
        }

        @if (diffResource.error()) {
            <mat-card appearance="outlined" class="mb-2 error-card">
                <mat-card-content class="flex gap-2 items-center">
                    <mat-icon style="color:var(--mat-sys-error)">error</mat-icon>
                    <span>Diff failed. Check that both lists are non-empty and try again.</span>
                </mat-card-content>
            </mat-card>
        }
    </div>
    `,
    styles: [`
    .page-content { padding: 0; }
    .subtitle { color: var(--mat-sys-on-surface-variant); margin-bottom: 24px; }

    .input-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
    }
    @media (max-width: 768px) {
        .input-grid { grid-template-columns: 1fr; }
    }
    .rules-field { width: 100%; }

    .options-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 16px;
        margin-top: 12px;
    }
    .options-row button { margin-left: auto; }

    .stats-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
    }
    @media (max-width: 768px) {
        .stats-grid { grid-template-columns: repeat(2, 1fr); }
    }
    .stat-card .stat-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 16px 8px;
    }
    .stat-value { font-size: 2rem; font-weight: 600; line-height: 1; }
    .stat-label { font-size: 0.75rem; color: var(--mat-sys-on-surface-variant); text-align: center; }
    .stat-card.positive { border-color: var(--mat-sys-primary); }
    .stat-card.negative { border-color: var(--mat-sys-error); }

    .rule-list { display: flex; flex-direction: column; gap: 6px; }
    .rule-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 6px;
    }
    .rule-row.added  { background: color-mix(in srgb, var(--mat-sys-primary) 8%, transparent); }
    .rule-row.removed { background: color-mix(in srgb, var(--mat-sys-error) 8%, transparent); }
    .rule-icon { flex-shrink: 0; font-size: 18px; width: 18px; height: 18px; }
    .rule-text { font-family: monospace; font-size: 0.85rem; flex: 1; word-break: break-all; }

    .domain-table { width: 100%; }

    .added-card   { border-color: var(--mat-sys-primary); }
    .removed-card { border-color: var(--mat-sys-error); }
    .warn-card    { border-color: var(--mat-sys-tertiary); }
    .error-card   { border-color: var(--mat-sys-error); }

    .parse-error {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 0;
        font-size: 0.85rem;
    }

    .meta { color: var(--mat-sys-on-surface-variant); margin-top: 8px; text-align: right; }
    .mb-2 { margin-bottom: 16px; }
    `],
})
export class DiffComponent {
    private readonly diffService = inject(DiffService);

    readonly originalText = signal('');
    readonly currentText  = signal('');

    opts: DiffOptions = {
        ignoreComments:   true,
        ignoreEmptyLines: true,
        analyzeDomains:   true,
        includeFullRules: true,
    };

    readonly domainCols = ['domain', 'added', 'removed'];

    private readonly pendingParams = signal<DiffParams | undefined>(undefined);

    private parseRules(text: string): string[] {
        return text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    }

    readonly originalCount = computed(() => this.parseRules(this.originalText()).length);
    readonly currentCount  = computed(() => this.parseRules(this.currentText()).length);
    readonly canCompare    = computed(() => this.originalCount() > 0 && this.currentCount() > 0);

    readonly diffResource = rxResource<DiffApiResponse, DiffParams | undefined>({
        params: () => this.pendingParams(),
        stream: ({ params }) => params
            ? this.diffService.diff(params.original, params.current, params.options)
            : EMPTY,
    });

    compare(): void {
        const original = this.parseRules(this.originalText());
        const current  = this.parseRules(this.currentText());
        if (original.length && current.length) {
            this.pendingParams.set({ original, current, options: { ...this.opts } });
        }
    }

    onOriginalInput(event: Event): void {
        this.originalText.set((event.target as HTMLTextAreaElement).value);
    }

    onCurrentInput(event: Event): void {
        this.currentText.set((event.target as HTMLTextAreaElement).value);
    }
}
