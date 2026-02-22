/**
 * Angular PoC - Compiler Form Component
 *
 * Angular 21 + Material Pattern: Reactive Forms with Material form fields
 * Demonstrates Material form inputs, buttons, and progress indicators
 */

import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
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
                [disabled]="loading || compilerForm.invalid"
            >
                @if (loading) {
                    <mat-progress-spinner diameter="20" mode="indeterminate" color="accent"></mat-progress-spinner>
                    Compiling...
                } @else {
                    <mat-icon>play_arrow</mat-icon>
                    Compile
                }
            </button>
        </form>

        <!-- Error State -->
        @if (error) {
            <mat-card appearance="outlined" class="error-card mt-2">
                <mat-card-content>
                    <div class="error-content">
                        <mat-icon color="warn">error</mat-icon>
                        <span>{{ error }}</span>
                    </div>
                </mat-card-content>
            </mat-card>
        }

        <!-- Results Display -->
        @if (results) {
            <mat-card appearance="outlined" class="results-card mt-2">
                <mat-card-header>
                    <mat-icon mat-card-avatar color="primary">check_circle</mat-icon>
                    <mat-card-title>Compilation Results</mat-card-title>
                    <mat-card-subtitle>Compilation completed successfully</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>
                    <!-- Stats chips -->
                    <mat-chip-set class="mb-2">
                        <mat-chip highlighted color="primary">{{ results.ruleCount }} rules</mat-chip>
                        <mat-chip>{{ results.sources }} sources</mat-chip>
                        @if (results.benchmark) {
                            <mat-chip>{{ results.benchmark.duration }}</mat-chip>
                        }
                    </mat-chip-set>
                    <!-- Raw JSON output -->
                    <pre class="results-json">{{ results | json }}</pre>
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
export class CompilerComponent implements OnInit, OnDestroy {
    private readonly URL_PATTERN = 'https?://.+';
    private readonly destroy$ = new Subject<void>();

    compilerForm!: FormGroup;
    availableTransformations: string[] = [];
    loading = false;
    error: string | null = null;
    results: CompileResponse | null = null;

    /**
     * Functional dependency injection using inject() (Angular 21 pattern)
     */
    private readonly fb = inject(FormBuilder);
    private readonly compilerService = inject(CompilerService);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);

    ngOnInit(): void {
        this.availableTransformations = this.compilerService.getAvailableTransformations();
        this.initializeForm();

        this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
            const urlParam = params.get('url');
            if (urlParam) {
                this.urlsArray.at(0).setValue(urlParam);
            }
        });
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
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
            this.error = 'Please fill in all required fields';
            return;
        }

        const urls: string[] = this.compilerForm.value.urls.filter((url: string) => url.trim() !== '');
        const transformationsObj = this.compilerForm.value.transformations;
        const selectedTransformations = Object.keys(transformationsObj)
            .filter((key) => transformationsObj[key]);

        if (urls.length === 0) {
            this.error = 'Please enter at least one URL';
            return;
        }

        this.loading = true;
        this.error = null;
        this.results = null;

        this.compilerService.compile(urls, selectedTransformations).pipe(takeUntil(this.destroy$)).subscribe({
            next: (response) => {
                this.results = response;
                this.loading = false;

                if (urls.length > 0) {
                    this.router.navigate([], {
                        relativeTo: this.route,
                        queryParams: { url: urls[0] },
                        queryParamsHandling: 'merge',
                    });
                }
            },
            error: (err) => {
                this.error = err.message || 'An error occurred during compilation';
                this.loading = false;
            },
        });
    }
}
