/**
 * Angular PoC - Compiler Form Component
 *
 * ANGULAR PATTERN: Reactive Forms with FormBuilder
 * Demonstrates form state management, validation, and API integration
 */

import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CompileResponse, CompilerService } from '../services/compiler.service';

/**
 * CompilerComponent
 * Pattern: Complex form with reactive forms approach
 * Uses FormBuilder for creating form controls and FormArray for dynamic lists
 *
 * ANGULAR ROUTER PATTERNS DEMONSTRATED:
 * - ActivatedRoute: Read query parameters from the current URL
 * - Router service: Programmatic navigation and URL state management
 */
@Component({
    selector: 'app-compiler',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule], // Import FormsModule for template-driven forms
    template: `
    <div>
      <h1>Compiler</h1>
      <p class="mb-2" style="color: var(--text-muted)">
        Configure and compile your filter lists
      </p>
      
      <!-- Angular Pattern: Reactive Forms with [formGroup] -->
      <form [formGroup]="compilerForm" (ngSubmit)="onSubmit()">
        
        <!-- URL Inputs Section -->
        <div class="form-section">
          <h3>Filter List URLs</h3>
          
          <!-- Angular Pattern: FormArray for dynamic form controls -->
          <div formArrayName="urls" class="url-list">
            <div 
              *ngFor="let url of urlsArray.controls; let i = index" 
              class="url-input-row"
            >
              <input
                type="url"
                class="input"
                placeholder="https://example.com/filters.txt"
                [formControlName]="i"
              />
              <button
                *ngIf="urlsArray.length > 1"
                type="button"
                class="btn btn-danger"
                (click)="removeUrl(i)"
              >
                Remove
              </button>
            </div>
          </div>
          
          <button
            type="button"
            class="btn btn-secondary"
            (click)="addUrl()"
          >
            + Add URL
          </button>
        </div>
        
        <!-- Transformations Section -->
        <div class="form-section">
          <h3>Transformations</h3>
          
          <!-- Angular Pattern: FormGroup for checkbox group -->
          <div formGroupName="transformations" class="transformations-grid">
            <label 
              *ngFor="let trans of availableTransformations" 
              class="checkbox-label"
            >
              <input
                type="checkbox"
                [formControlName]="trans"
              />
              <span>{{ trans }}</span>
            </label>
          </div>
        </div>
        
        <!-- Submit Button -->
        <button
          type="submit"
          class="btn btn-primary"
          [disabled]="loading || compilerForm.invalid"
        >
          {{ loading ? 'Compiling...' : '🚀 Compile' }}
        </button>
      </form>
      
      <!-- Loading State -->
      <!-- Angular Pattern: *ngIf directive for conditional rendering -->
      <div *ngIf="loading" class="loading">
        <div class="spinner"></div>
        <p>Compiling filter lists...</p>
      </div>
      
      <!-- Error State -->
      <div *ngIf="error" class="alert alert-error mt-2">
        <strong>❌ Error:</strong> {{ error }}
      </div>
      
      <!-- Results Display -->
      <div *ngIf="results" class="results-container">
        <h3>✅ Compilation Results</h3>
        <div class="results-code">
          <pre>{{ results | json }}</pre>
        </div>
        
        <!-- Angular Router Pattern: Programmatic navigation after action -->
        <div class="post-results-actions">
          <p class="bookmark-hint">
            💡 <strong>Angular Router:</strong> The URL above now includes a
            <code>?url=</code> query parameter so this compilation can be bookmarked
            or shared. Angular Router keeps the URL in sync with app state automatically.
          </p>
          <button class="btn btn-secondary" (click)="goHome()">
            ← Back to Dashboard
          </button>
        </div>
      </div>
      
      <div class="alert alert-info mt-2">
        <strong>ℹ️ Angular Pattern:</strong> This form demonstrates Reactive Forms with 
        FormBuilder, FormArray for dynamic controls, FormGroup for nested forms, 
        async service calls with RxJS Observables, and conditional rendering with *ngIf.
        <br><br>
        <strong>🗺️ Angular Router:</strong> Try navigating here with
        <code>?url=https://example.com/filters.txt</code> in the URL bar — the first
        URL input will be pre-populated automatically via <code>ActivatedRoute.queryParamMap</code>.
      </div>
    </div>
  `,
    styles: [`
    /* Component-scoped styles */
    
    .form-section {
      margin-bottom: 30px;
    }
    
    .form-section h3 {
      margin-bottom: 15px;
      color: var(--text-color);
    }
    
    .url-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 15px;
    }
    
    .url-input-row {
      display: flex;
      gap: 10px;
    }
    
    .input {
      flex: 1;
      padding: 12px;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      background: var(--input-bg);
      color: var(--text-color);
      font-size: 14px;
      transition: border-color 0.3s ease;
    }
    
    .input:focus {
      outline: none;
      border-color: var(--primary);
    }
    
    .btn {
      padding: 12px 24px;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
    }
    
    .btn-primary {
      background: var(--primary);
      color: white;
    }
    
    .btn-primary:hover:not(:disabled) {
      background: var(--primary-dark);
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }
    
    .btn-secondary {
      background: var(--section-bg);
      color: var(--text-color);
      border: 1px solid var(--border-color);
    }
    
    .btn-secondary:hover {
      background: var(--button-hover);
    }
    
    .btn-danger {
      background: var(--danger);
      color: white;
    }
    
    .btn-danger:hover {
      opacity: 0.9;
    }
    
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .transformations-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
      margin-top: 15px;
    }
    
    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px;
      background: var(--section-bg);
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.3s ease;
    }
    
    .checkbox-label:hover {
      background: var(--button-hover);
    }
    
    .checkbox-label input[type="checkbox"] {
      width: 18px;
      height: 18px;
      cursor: pointer;
    }
    
    .loading {
      text-align: center;
      padding: 40px;
      color: var(--text-muted);
    }
    
    .spinner {
      border: 3px solid var(--border-color);
      border-top: 3px solid var(--primary);
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    .results-container {
      margin-top: 30px;
      padding: 20px;
      background: var(--section-bg);
      border-radius: 8px;
      border: 1px solid var(--border-color);
    }
    
    .results-container h3 {
      margin-bottom: 15px;
      color: var(--text-color);
    }
    
    .results-code {
      background: var(--input-bg);
      padding: 15px;
      border-radius: 6px;
      overflow-x: auto;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      color: var(--text-color);
      max-height: 400px;
      overflow-y: auto;
    }
    
    .post-results-actions {
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    
    .bookmark-hint {
      color: var(--text-muted);
      font-size: 14px;
      margin: 0;
    }
    
    .bookmark-hint code {
      background: var(--input-bg);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
    }
    
    .alert {
      padding: 16px;
      border-radius: 6px;
      margin-bottom: 20px;
    }
    
    .alert-error {
      background: #fee2e2;
      color: #991b1b;
      border: 1px solid #fecaca;
    }
    
    .alert-info {
      background: #dbeafe;
      color: #1e40af;
      border: 1px solid #bfdbfe;
    }
    
    .alert-info code {
      background: rgba(0, 0, 0, 0.1);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
    }
    
    .mb-2 { margin-bottom: 20px; }
    .mt-2 { margin-top: 20px; }
  `],
})
export class CompilerComponent implements OnInit, OnDestroy {
    /**
     * Component Properties
     */
    // URL validation pattern constant
    private readonly URL_PATTERN = 'https?://.+';
    // Subject used to signal component destruction for takeUntil
    private readonly destroy$ = new Subject<void>();

    compilerForm!: FormGroup;
    availableTransformations: string[] = [];
    loading = false;
    error: string | null = null;
    results: CompileResponse | null = null;

    /**
     * Constructor with Dependency Injection
     * Angular's DI provides FormBuilder, CompilerService, ActivatedRoute, and Router instances
     *
     * ANGULAR ROUTER DI:
     * - ActivatedRoute: Provides access to the current route's URL, params, and query params
     * - Router: Service for imperative (programmatic) navigation between routes
     */
    constructor(
        private fb: FormBuilder,
        private compilerService: CompilerService,
        private route: ActivatedRoute,
        private router: Router,
    ) {}

    /**
     * Lifecycle Hook: OnInit
     * Called after component initialization
     * Pattern: Initialize form and load data
     */
    ngOnInit(): void {
        // Get available transformations from service
        this.availableTransformations = this.compilerService.getAvailableTransformations();

        // Initialize reactive form
        this.initializeForm();

        // ANGULAR ROUTER PATTERN: Read query parameters with ActivatedRoute
        // This allows the compiler page to be bookmarked or linked to with a pre-filled URL.
        // Example: /compiler?url=https://easylist.to/easylist/easylist.txt
        this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
            const urlParam = params.get('url');
            if (urlParam) {
                // Pre-populate the first URL input from the query parameter.
                // This makes the page deep-linkable – another app or email can link
                // directly to a pre-configured compilation.
                this.urlsArray.at(0).setValue(urlParam);
            }
        });
    }

    /**
     * Lifecycle Hook: OnDestroy
     * Complete the destroy$ subject to automatically unsubscribe all takeUntil pipelines
     */
    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    /**
     * Initialize Reactive Form
     * Pattern: FormBuilder for creating form structure
     */
    private initializeForm(): void {
        // Create transformations form group with all checkboxes
        const transformationsGroup: { [key: string]: boolean } = {};
        this.availableTransformations.forEach((trans, index) => {
            // Default first two to checked
            transformationsGroup[trans] = index < 2;
        });

        // Build form with FormBuilder
        this.compilerForm = this.fb.group({
            urls: this.fb.array([
                this.fb.control('', [Validators.required, Validators.pattern(this.URL_PATTERN)]),
            ]),
            transformations: this.fb.group(transformationsGroup),
        });
    }

    /**
     * Getter for URLs FormArray
     * Pattern: Convenient access to form array
     */
    get urlsArray(): FormArray {
        return this.compilerForm.get('urls') as FormArray;
    }

    /**
     * Add URL input field
     */
    addUrl(): void {
        this.urlsArray.push(
            this.fb.control('', [Validators.required, Validators.pattern(this.URL_PATTERN)]),
        );
    }

    /**
     * Remove URL input field
     */
    removeUrl(index: number): void {
        if (this.urlsArray.length > 1) {
            this.urlsArray.removeAt(index);
        }
    }

    /**
     * Navigate back to the Home/Dashboard page
     * ANGULAR ROUTER PATTERN: Programmatic navigation with Router.navigate()
     * This is useful when navigation needs to happen as a result of logic
     * (e.g., after a form submission or when a button is clicked programmatically).
     */
    goHome(): void {
        this.router.navigate(['/']);
    }

    /**
     * Form Submit Handler
     * Pattern: Reactive form submission with service call
     */
    onSubmit(): void {
        if (this.compilerForm.invalid) {
            this.error = 'Please fill in all required fields';
            return;
        }

        // Get form values
        const urls: string[] = this.compilerForm.value.urls.filter((url: string) => url.trim() !== '');

        // Get selected transformations
        const transformationsObj = this.compilerForm.value.transformations;
        const selectedTransformations = Object.keys(transformationsObj)
            .filter((key) => transformationsObj[key]);

        if (urls.length === 0) {
            this.error = 'Please enter at least one URL';
            return;
        }

        // Call API through service
        this.loading = true;
        this.error = null;
        this.results = null;

        // Subscribe to Observable
        // Pattern: takeUntil(destroy$) prevents memory leaks if component is destroyed mid-request
        this.compilerService.compile(urls, selectedTransformations).pipe(takeUntil(this.destroy$)).subscribe({
            next: (response) => {
                this.results = response;
                this.loading = false;

                // ANGULAR ROUTER PATTERN: Update URL query params to reflect app state.
                // This makes the current compilation result bookmarkable and shareable.
                // navigate([]) with no path segments means "stay on current route".
                // queryParamsHandling: 'merge' preserves any existing query params.
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
