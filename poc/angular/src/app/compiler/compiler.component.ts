/**
 * Angular PoC - Compiler Form Component
 *
 * Angular 21 + Material Pattern: Reactive Forms with Material form fields
 * Demonstrates Material form inputs, buttons, and progress indicators
 *
 * Zoneless Pattern: all mutable state uses signal() so Angular's scheduler
 * can track changes without Zone.js.  takeUntilDestroyed() replaces the
 * manual Subject<void> + ngOnDestroy teardown pattern.
 */

import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CompileResponse, CompilerService } from '../services/compiler.service';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { JsonPipe } from '@angular/common';

/**
 * CompilerComponent
 * Pattern: Complex form with Angular Material form components
 * Uses inject() for functional dependency injection (Angular 21 pattern)
 */
@Component({
    selector: 'app-compiler',
    standalone: true,
    imports: [
        ReactiveFormsModule,
        JsonPipe,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatIconModule,
        MatCheckboxModule,
        MatCardModule,
        MatProgressSpinnerModule,
        MatChipsModule,
        MatDividerModule,
    ],
    template: `
    <div class="page-content">
        <h1 class="mat-headline-4">Compiler</h1>
        <p class="subtitle mat-body-1">Configure and compile your filter lists</p>

        <!-- Reactive Form with Material Components -->
        <form [formGroup]="compilerForm" (ngSubmit)="onSubmit()">

            <!-- URL Inputs Section -->
            <mat-card appearance="outlined" class="mb-2">
                <mat-card-header>
                    <mat-card-title>Filter List URLs</mat-card-title>
                    <mat-card-subtitle>Add one or more filter list URLs to compile</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>
                    <div formArrayName="urls" class="url-list">
                        @for (url of urlsArray.controls; track $index; let i = $index) {
                            <div class="url-input-row">
                                <mat-form-field appearance="outline" class="url-field">
                                    <mat-label>Filter List URL {{ i + 1 }}</mat-label>
                                    <input
                                        matInput
                                        type="url"
                                        placeholder="https://example.com/filters.txt"
                                        [formControlName]="i"
                                    />
                                    <mat-icon matSuffix>link</mat-icon>
                                    @if (urlsArray.at(i).hasError('required')) {
                                        <mat-error>URL is required</mat-error>
                                    }
                                    @if (urlsArray.at(i).hasError('pattern')) {
                                        <mat-error>Please enter a valid URL (http:// or https://)</mat-error>
                                    }
                                </mat-form-field>
                                @if (urlsArray.length > 1) {
                                    <button
                                        mat-icon-button
                                        color="warn"
                                        type="button"
                                        (click)="removeUrl(i)"
                                        aria-label="Remove URL"
                                    >
                                        <mat-icon>delete</mat-icon>
                                    </button>
                                }
                            </div>
                        }
                    </div>
                    <button
                        mat-stroked-button
                        type="button"
                        (click)="addUrl()"
                    >
                        <mat-icon>add</mat-icon>
                        Add URL
                    </button>
                </mat-card-content>
            </mat-card>

            <!-- Transformations Section -->
            <mat-card appearance="outlined" class="mb-2">
                <mat-card-header>
                    <mat-card-title>Transformations</mat-card-title>
                    <mat-card-subtitle>Select which transformations to apply</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>
                    <div formGroupName="transformations" class="transformations-grid">
                        @for (trans of availableTransformations; track trans) {
                            <mat-checkbox [formControlName]="trans">
                                {{ trans }}
                            </mat-checkbox>
                        }
                    </div>
                </mat-card-content>
            </mat-card>

            <!-- Submit -->
            <button
                mat-raised-button
                color="primary"
                type="submit"
                [disabled]="loading() || compilerForm.invalid"
            >
                @if (loading()) {
                    <mat-progress-spinner diameter="20" mode="indeterminate" color="accent"></mat-progress-spinner>
                    Compiling...
                } @else {
                    <mat-icon>play_arrow</mat-icon>
                    Compile
                }
            </button>
        </form>

        <!-- Error State -->
        @if (error(); as e) {
            <mat-card appearance="outlined" class="error-card mt-2">
                <mat-card-content>
                    <div class="error-content">
                        <mat-icon color="warn">error</mat-icon>
                        <span>{{ e }}</span>
                    </div>
                </mat-card-content>
            </mat-card>
        }

        <!-- Results Display -->
        @if (results(); as r) {
            <mat-card appearance="outlined" class="results-card mt-2">
                <mat-card-header>
                    <mat-icon mat-card-avatar color="primary">check_circle</mat-icon>
                    <mat-card-title>Compilation Results</mat-card-title>
                    <mat-card-subtitle>Compilation completed successfully</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>
                    <!-- Stats chips -->
                    <mat-chip-set class="mb-2">
                        <mat-chip highlighted color="primary">{{ r.ruleCount }} rules</mat-chip>
                        <mat-chip>{{ r.sources }} sources</mat-chip>
                        @if (r.benchmark) {
                            <mat-chip>{{ r.benchmark.duration }}</mat-chip>
                        }
                    </mat-chip-set>
                    <!-- Raw JSON output -->
                    <pre class="results-json">{{ r | json }}</pre>
                </mat-card-content>
                <mat-card-actions>
                    <button mat-button (click)="goHome()">
                        <mat-icon>arrow_back</mat-icon>
                        Back to Dashboard
                    </button>
                </mat-card-actions>
            </mat-card>
        }

        <!-- Info Card -->
        <mat-card appearance="outlined" class="info-card mt-2">
            <mat-card-header>
                <mat-icon mat-card-avatar>info</mat-icon>
                <mat-card-title>Angular 21 Patterns</mat-card-title>
            </mat-card-header>
            <mat-card-content>
                <p class="mat-body-1">
                    This form demonstrates <strong>Reactive Forms</strong> with Material form fields,
                    <code>FormBuilder</code>, <code>FormArray</code> for dynamic controls,
                    <code>inject()</code> for functional DI, and the new
                    <code>&#64;if/&#64;for</code> control flow syntax.
                </p>
                <p class="mat-body-1">
                    <strong>🗺️ Angular Router:</strong> Try navigating here with
                    <code>?url=https://example.com/filters.txt</code> — the first URL input
                    will be pre-populated via <code>ActivatedRoute.queryParamMap</code>.
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

    .url-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 16px;
    }

    .url-input-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .url-field {
        flex: 1;
    }

    .transformations-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 12px;
        margin-top: 8px;
    }

    .error-card {
        border-color: var(--mat-sys-error, #f44336);
    }

    .error-content {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--mat-sys-error, #f44336);
    }

    .results-card {
        border-color: var(--mat-sys-primary, #1976d2);
    }

    .results-json {
        background: var(--mat-sys-surface-variant, #f5f5f5);
        padding: 16px;
        border-radius: 8px;
        font-family: 'Courier New', monospace;
        font-size: 13px;
        overflow-x: auto;
        max-height: 400px;
        overflow-y: auto;
        margin: 0;
    }

    .info-card {
        background-color: var(--mat-sys-surface-variant, #f5f5f5);
    }
  `],
})
export class CompilerComponent {
    private readonly URL_PATTERN = 'https?://.+';

    /** Mutable state as signals — required for zoneless change detection */
    readonly loading = signal(false);
    readonly error = signal<string | null>(null);
    readonly results = signal<CompileResponse | null>(null);

    compilerForm!: FormGroup;
    readonly availableTransformations: readonly string[];

    /**
     * Functional dependency injection using inject() (Angular 21 pattern)
     */
    private readonly fb = inject(FormBuilder);
    private readonly compilerService = inject(CompilerService);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    /** DestroyRef allows takeUntilDestroyed() outside the constructor */
    private readonly destroyRef = inject(DestroyRef);

    constructor() {
        this.availableTransformations = this.compilerService.getAvailableTransformations();
        this.initializeForm();

        // takeUntilDestroyed() with the injected DestroyRef tears down the
        // subscription when the component is destroyed — no manual Subject<void>
        // or ngOnDestroy needed.
        this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
            const urlParam = params.get('url');
            if (urlParam) {
                this.urlsArray.at(0).setValue(urlParam);
            }
        });
    }

    private initializeForm(): void {
        const transformationsGroup: { [key: string]: boolean } = {};
        this.availableTransformations.forEach((trans, index) => {
            transformationsGroup[trans] = index < 2;
        });

        this.compilerForm = this.fb.group({
            urls: this.fb.array([
                this.fb.control('', [Validators.required, Validators.pattern(this.URL_PATTERN)]),
            ]),
            transformations: this.fb.group(transformationsGroup),
        });
    }

    get urlsArray(): FormArray {
        return this.compilerForm.get('urls') as FormArray;
    }

    addUrl(): void {
        this.urlsArray.push(
            this.fb.control('', [Validators.required, Validators.pattern(this.URL_PATTERN)]),
        );
    }

    removeUrl(index: number): void {
        if (this.urlsArray.length > 1) {
            this.urlsArray.removeAt(index);
        }
    }

    goHome(): void {
        this.router.navigate(['/']);
    }

    onSubmit(): void {
        if (this.compilerForm.invalid) {
            this.error.set('Please fill in all required fields');
            return;
        }

        const urls: string[] = this.compilerForm.value.urls.filter((url: string) => url.trim() !== '');
        const transformationsObj = this.compilerForm.value.transformations;
        const selectedTransformations = Object.keys(transformationsObj)
            .filter((key) => transformationsObj[key]);

        if (urls.length === 0) {
            this.error.set('Please enter at least one URL');
            return;
        }

        this.loading.set(true);
        this.error.set(null);
        this.results.set(null);

        this.compilerService.compile(urls, selectedTransformations).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: (response) => {
                this.results.set(response);
                this.loading.set(false);

                if (urls.length > 0) {
                    this.router.navigate([], {
                        relativeTo: this.route,
                        queryParams: { url: urls[0] },
                        queryParamsHandling: 'merge',
                    });
                }
            },
            error: (err: unknown) => {
                const message = err instanceof Error ? err.message : String(err);
                this.error.set(message || 'An error occurred during compilation');
                this.loading.set(false);
            },
        });
    }
}
