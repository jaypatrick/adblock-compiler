/**
 * AstViewerComponent — AST viewer for adblock filter rules.
 *
 * Features:
 *   - Multi-line rules input with signal-based state
 *   - Parse AST button with loading state
 *   - Show/hide AST panel toggle (on/off per issue requirement)
 *   - Color-coded output by rule category
 *   - Expandable per-rule AST details with full JSON
 *   - Summary chips (total, success, failed, by category)
 *   - Example rules loader
 *
 * Angular 21 patterns: signal(), computed(), rxResource(), inject(),
 *   @if/@for, standalone, zoneless.
 */

import { Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { EMPTY } from 'rxjs';
import { JsonPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AstViewerService, AstParseResponse } from '../services/ast-viewer.service';
import type { ParsedRuleInfo } from '../schemas/api-responses';

const EXAMPLE_RULES = [
    '||example.com^$third-party',
    '@@||example.com/allowed^',
    '127.0.0.1 ad.example.com',
    'example.com##.ad-banner',
    'example.com##+js(abort-on-property-read, ads)',
    '! This is a comment',
    '! Title: My Filter List',
    'example.com,~subdomain.example.com##.selector',
    '||ads.example.com^$script,domain=example.com|example.org',
    'example.com#@#.ad-banner',
].join('\n');

@Component({
    selector: 'app-ast-viewer',
    standalone: true,
    imports: [
        JsonPipe,
        MatCardModule,
        MatButtonModule,
        MatIconModule,
        MatFormFieldModule,
        MatInputModule,
        MatChipsModule,
        MatProgressSpinnerModule,
        MatDividerModule,
        MatSlideToggleModule,
        MatExpansionModule,
        MatTooltipModule,
    ],
    template: `
<div class="page-content">
    <h1 class="mat-headline-4">AST Viewer</h1>
    <p class="subtitle mat-body-1">
        Examine the Abstract Syntax Tree of adblock filter rules using the AGTree parser
    </p>

    <!-- Input Card -->
    <mat-card appearance="outlined" class="mb-2">
        <mat-card-header>
            <mat-icon mat-card-avatar>account_tree</mat-icon>
            <mat-card-title>Rules Input</mat-card-title>
            <mat-card-subtitle>Enter filter rules (one per line) to parse into AST</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
            <mat-form-field appearance="outline" class="rules-field">
                <mat-label>Filter rules</mat-label>
                <textarea matInput
                    [value]="rulesText()"
                    (input)="rulesText.set($any($event.target).value)"
                    rows="10"
                    placeholder="||example.com^&#10;@@||trusted.com^&#10;example.com##.ad-banner"
                ></textarea>
                <mat-hint>{{ ruleCount() }} rule(s) entered</mat-hint>
            </mat-form-field>

            <div class="action-row">
                <button mat-stroked-button (click)="loadExamples()" matTooltip="Load example rules">
                    <mat-icon>auto_awesome</mat-icon> Load Examples
                </button>
                <div class="spacer"></div>
                <mat-slide-toggle
                    [checked]="showAst()"
                    (change)="showAst.set($event.checked)"
                    matTooltip="Toggle AST panel visibility">
                    Show AST
                </mat-slide-toggle>
                <button mat-raised-button color="primary"
                    [disabled]="astResource.isLoading() || ruleCount() === 0"
                    (click)="parseAst()">
                    @if (astResource.isLoading()) {
                        <mat-progress-spinner diameter="20" mode="indeterminate" />
                        Parsing…
                    } @else {
                        <span><mat-icon>account_tree</mat-icon> Parse AST</span>
                    }
                </button>
            </div>
        </mat-card-content>
    </mat-card>

    <!-- Error State -->
    @if (astResource.status() === 'error') {
        <mat-card appearance="outlined" class="error-card mt-2">
            <mat-card-content>
                <div class="error-content">
                    <mat-icon color="warn">error</mat-icon>
                    <span>{{ astResource.error() }}</span>
                </div>
            </mat-card-content>
        </mat-card>
    }

    <!-- Results -->
    @if (astResource.value(); as result) {
        <!-- Summary Card -->
        <mat-card appearance="outlined" class="summary-card mt-2">
            <mat-card-header>
                <mat-icon mat-card-avatar color="primary">summarize</mat-icon>
                <mat-card-title>Parse Summary</mat-card-title>
                <mat-card-subtitle>{{ result.summary?.total ?? result.parsedRules.length }} rules parsed</mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
                <mat-chip-set>
                    <mat-chip highlighted color="primary">{{ result.summary?.successful ?? 0 }} parsed</mat-chip>
                    @if ((result.summary?.failed ?? 0) > 0) {
                        <mat-chip highlighted color="warn">{{ result.summary?.failed }} failed</mat-chip>
                    }
                    @for (entry of objectEntries(result.summary?.byCategory ?? {}); track entry[0]) {
                        <mat-chip>{{ entry[0] }}: {{ entry[1] }}</mat-chip>
                    }
                </mat-chip-set>
            </mat-card-content>
        </mat-card>

        <!-- AST Panel (toggle on/off) -->
        @if (showAst()) {
            <mat-card appearance="outlined" class="ast-card mt-2">
                <mat-card-header>
                    <mat-icon mat-card-avatar>account_tree</mat-icon>
                    <mat-card-title>Abstract Syntax Tree</mat-card-title>
                    <mat-card-subtitle>Color-coded by rule category</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>
                    <!-- Color Legend -->
                    <div class="legend mb-2">
                        <span class="legend-item network">Network</span>
                        <span class="legend-item cosmetic">Cosmetic</span>
                        <span class="legend-item host">Host</span>
                        <span class="legend-item comment">Comment</span>
                        <span class="legend-item error">Invalid</span>
                    </div>
                    <mat-divider class="mb-2"></mat-divider>

                    <!-- Rule entries -->
                    <mat-accordion>
                        @for (rule of result.parsedRules; track $index) {
                            <mat-expansion-panel class="rule-panel"
                                [style.border-left-color]="getCategoryColor(rule)">
                                <mat-expansion-panel-header>
                                    <mat-panel-title>
                                        <mat-icon class="rule-icon"
                                            [style.color]="getCategoryColor(rule)">
                                            {{ getCategoryIcon(rule) }}
                                        </mat-icon>
                                        <code class="rule-text">{{ rule.ruleText }}</code>
                                    </mat-panel-title>
                                    <mat-panel-description>
                                        @if (rule.success) {
                                            <mat-chip-set>
                                                <mat-chip [style.background-color]="getCategoryColor(rule)" style="color: white; font-size: 11px;">
                                                    {{ rule.category }}
                                                </mat-chip>
                                                @if (rule.type) {
                                                    <mat-chip style="font-size: 11px;">{{ rule.type }}</mat-chip>
                                                }
                                                @if (rule.syntax) {
                                                    <mat-chip style="font-size: 11px;">{{ rule.syntax }}</mat-chip>
                                                }
                                            </mat-chip-set>
                                        } @else {
                                            <span class="error-label">Parse Error</span>
                                        }
                                    </mat-panel-description>
                                </mat-expansion-panel-header>

                                <!-- Expanded content -->
                                @if (rule.success) {
                                    <div class="rule-detail">
                                        <!-- Network properties -->
                                        @if (rule.properties?.network; as net) {
                                            <div class="prop-section">
                                                <h4 class="prop-title">Network Rule</h4>
                                                <div class="prop-row">
                                                    <span class="prop-key">Pattern:</span>
                                                    <code class="prop-value">{{ net.pattern }}</code>
                                                </div>
                                                <div class="prop-row">
                                                    <span class="prop-key">Type:</span>
                                                    <span class="prop-value">{{ net.isException ? 'Exception (Allowlist)' : 'Blocking' }}</span>
                                                </div>
                                                @if (net.modifiers.length > 0) {
                                                    <div class="prop-row">
                                                        <span class="prop-key">Modifiers:</span>
                                                        <mat-chip-set>
                                                            @for (mod of net.modifiers; track mod.name) {
                                                                <mat-chip class="modifier-chip">
                                                                    {{ mod.exception ? '~' : '' }}{{ mod.name }}{{ mod.value ? '=' + mod.value : '' }}
                                                                </mat-chip>
                                                            }
                                                        </mat-chip-set>
                                                    </div>
                                                }
                                            </div>
                                        }

                                        <!-- Cosmetic properties -->
                                        @if (rule.properties?.cosmetic; as cos) {
                                            <div class="prop-section">
                                                <h4 class="prop-title">Cosmetic Rule</h4>
                                                <div class="prop-row">
                                                    <span class="prop-key">Domains:</span>
                                                    <span class="prop-value">{{ cos.domains.length > 0 ? cos.domains.join(', ') : 'All domains' }}</span>
                                                </div>
                                                <div class="prop-row">
                                                    <span class="prop-key">Separator:</span>
                                                    <code class="prop-value">{{ cos.separator }}</code>
                                                </div>
                                                <div class="prop-row">
                                                    <span class="prop-key">Type:</span>
                                                    <span class="prop-value">{{ cos.isException ? 'Exception' : 'Hiding' }} ({{ cos.ruleType }})</span>
                                                </div>
                                                <div class="prop-row">
                                                    <span class="prop-key">Selector:</span>
                                                    <code class="prop-value">{{ cos.body }}</code>
                                                </div>
                                            </div>
                                        }

                                        <!-- Host properties -->
                                        @if (rule.properties?.host; as host) {
                                            <div class="prop-section">
                                                <h4 class="prop-title">Host Rule</h4>
                                                <div class="prop-row">
                                                    <span class="prop-key">IP Address:</span>
                                                    <code class="prop-value">{{ host.ip }}</code>
                                                </div>
                                                <div class="prop-row">
                                                    <span class="prop-key">Hostnames:</span>
                                                    <code class="prop-value">{{ host.hostnames.join(', ') }}</code>
                                                </div>
                                            </div>
                                        }

                                        <!-- Comment properties -->
                                        @if (rule.properties?.comment; as cmt) {
                                            <div class="prop-section">
                                                <h4 class="prop-title">Comment</h4>
                                                @if (cmt.header) {
                                                    <div class="prop-row">
                                                        <span class="prop-key">{{ cmt.header }}:</span>
                                                        <span class="prop-value">{{ cmt.value }}</span>
                                                    </div>
                                                } @else {
                                                    <div class="prop-row">
                                                        <span class="prop-key">Text:</span>
                                                        <span class="prop-value">{{ cmt.text }}</span>
                                                    </div>
                                                }
                                            </div>
                                        }

                                        <!-- Full AST JSON -->
                                        @if (rule.ast) {
                                            <mat-divider class="mt-2 mb-2"></mat-divider>
                                            <details class="ast-json-details">
                                                <summary class="ast-json-summary">Full AST JSON</summary>
                                                <pre class="ast-json">{{ formatAst(rule.ast) }}</pre>
                                            </details>
                                        }
                                    </div>
                                } @else {
                                    <div class="error-detail">
                                        <mat-icon style="color: var(--mat-sys-error)">error_outline</mat-icon>
                                        <span>{{ rule.error }}</span>
                                    </div>
                                }
                            </mat-expansion-panel>
                        }
                    </mat-accordion>
                </mat-card-content>
            </mat-card>
        }
    }
</div>
    `,
    styles: [`
.page-content { padding: 0; }
.subtitle { color: var(--mat-sys-on-surface-variant); margin-bottom: 24px; }
.rules-field { width: 100%; }
.action-row { display: flex; align-items: center; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
.spacer { flex: 1; }
.summary-card { border-color: var(--mat-sys-primary); }
.ast-card { border-color: var(--mat-sys-secondary); }
.error-card { border-color: var(--mat-sys-error); }
.error-content { display: flex; align-items: center; gap: 8px; color: var(--mat-sys-error); }

.legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; }
.legend-item { padding: 2px 8px; border-radius: 4px; font-weight: 500; }
.legend-item.network { background: rgba(var(--mat-sys-primary-rgb, 103,80,164), 0.15); color: var(--mat-sys-primary); border: 1px solid var(--mat-sys-primary); }
.legend-item.cosmetic { background: rgba(214, 51, 132, 0.1); color: #d63384; border: 1px solid #d63384; }
.legend-item.host { background: rgba(102, 16, 242, 0.1); color: #6610f2; border: 1px solid #6610f2; }
.legend-item.comment { background: var(--mat-sys-surface-container); color: var(--mat-sys-on-surface-variant); border: 1px solid var(--mat-sys-outline-variant); }
.legend-item.error { background: rgba(var(--mat-sys-error-rgb, 186,26,26), 0.1); color: var(--mat-sys-error); border: 1px solid var(--mat-sys-error); }

.rule-panel { border-left: 4px solid transparent; margin-bottom: 4px; }
.rule-icon { margin-right: 8px; flex-shrink: 0; font-size: 18px; width: 18px; height: 18px; }
.rule-text { font-family: 'Courier New', monospace; font-size: 13px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.error-label { color: var(--mat-sys-error); font-size: 12px; font-weight: 500; }

.rule-detail { padding: 8px 0; }
.prop-section { margin-bottom: 12px; }
.prop-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--mat-sys-on-surface-variant); margin: 0 0 8px 0; }
.prop-row { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
.prop-key { font-size: 13px; color: var(--mat-sys-on-surface-variant); min-width: 100px; flex-shrink: 0; }
.prop-value { font-size: 13px; flex: 1; }
code.prop-value { font-family: 'Courier New', monospace; background: var(--mat-sys-surface-container); padding: 1px 4px; border-radius: 3px; }
.modifier-chip { font-size: 11px !important; font-family: 'Courier New', monospace; }

.ast-json-details { margin-top: 8px; }
.ast-json-summary { cursor: pointer; font-size: 12px; font-weight: 500; color: var(--mat-sys-on-surface-variant); padding: 4px 0; user-select: none; }
.ast-json-summary:hover { color: var(--mat-sys-primary); }
.ast-json { background: var(--mat-sys-surface-container); padding: 12px; border-radius: 6px; font-family: 'Courier New', monospace; font-size: 11px; overflow-x: auto; max-height: 300px; overflow-y: auto; margin: 8px 0 0 0; }

.error-detail { display: flex; align-items: center; gap: 8px; padding: 8px 0; color: var(--mat-sys-error); }
    `],
})
export class AstViewerComponent {
    private readonly astViewerService = inject(AstViewerService);

    readonly rulesText = signal('');
    readonly showAst = signal(true);

    private readonly pendingRules = signal<string[] | undefined>(undefined);

    readonly ruleCount = computed(() => {
        const text = this.rulesText();
        if (!text.trim()) return 0;
        return text.split('\n').map(l => l.trim()).filter(l => l.length > 0).length;
    });

    readonly astResource = rxResource<AstParseResponse, string[] | undefined>({
        params: () => this.pendingRules(),
        stream: ({ params }) => params ? this.astViewerService.parse(params) : EMPTY,
    });

    /** Exposes Object.entries for template use */
    readonly objectEntries = Object.entries;

    parseAst(): void {
        const rules = this.rulesText()
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0);
        if (rules.length) {
            this.pendingRules.set(rules);
        }
    }

    loadExamples(): void {
        this.rulesText.set(EXAMPLE_RULES);
    }

    getCategoryColor(rule: ParsedRuleInfo): string {
        if (!rule.success) return 'var(--mat-sys-error)';
        switch (rule.category) {
            case 'Network': return 'var(--mat-sys-primary)';
            case 'Cosmetic': return '#d63384';
            case 'Host': return '#6610f2';
            case 'Comment': return 'var(--mat-sys-on-surface-variant)';
            default: return 'var(--mat-sys-on-surface)';
        }
    }

    getCategoryIcon(rule: ParsedRuleInfo): string {
        if (!rule.success) return 'error';
        switch (rule.category) {
            case 'Network': return 'block';
            case 'Cosmetic': return 'hide_source';
            case 'Host': return 'dns';
            case 'Comment': return 'comment';
            default: return 'rule';
        }
    }

    formatAst(ast: unknown): string {
        return JSON.stringify(ast, null, 2);
    }
}
