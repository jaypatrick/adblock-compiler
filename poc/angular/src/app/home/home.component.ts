/**
 * Angular PoC - Home/Dashboard Component
 *
 * ANGULAR PATTERN: Standalone component with inline template
 * Demonstrates Angular's component architecture and data binding
 */

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

/**
 * Interface for stat cards
 * TypeScript interface for type safety
 */
interface StatCard {
    label: string;
    value: string;
}

/**
 * HomeComponent
 * Pattern: Standalone component (no NgModule required in Angular 17+)
 * Displays dashboard with statistics cards
 *
 * ANGULAR ROUTER PATTERNS DEMONSTRATED:
 * - Programmatic navigation via the Router service (imperative)
 * - Declarative navigation via the routerLink directive (template-driven)
 */
@Component({
    selector: 'app-home',
    standalone: true,
    imports: [CommonModule, RouterLink], // RouterLink enables the routerLink directive in the template
    template: `
    <div>
      <h1>Adblock Compiler Dashboard</h1>
      <p class="mb-2" style="color: var(--text-muted)">
        Welcome to the Adblock Compiler. Compile and transform filter lists with ease.
      </p>
      
      <!-- Stats Grid -->
      <!-- Angular Pattern: *ngFor directive for list rendering -->
      <div class="stats-grid">
        <div 
          *ngFor="let stat of stats" 
          class="stat-card"
        >
          <div class="stat-label">{{ stat.label }}</div>
          <div class="stat-value">{{ stat.value }}</div>
        </div>
      </div>

      <!-- Angular Router: Two Ways to Navigate -->
      <!-- Demonstrating both programmatic and declarative navigation patterns -->
      <div class="action-section">
        <h3>Get Started</h3>
        <div class="action-buttons">
          <!--
            ANGULAR ROUTER PATTERN 1: Programmatic Navigation
            Router.navigate() is called from component code — ideal when navigation
            depends on logic (e.g. after validation, after a timer, or in response to
            an event not triggered by a direct user click on a link).
          -->
          <button class="btn btn-primary" (click)="goToCompiler()">
            ⚙️ Start Compiling →
          </button>

          <!--
            ANGULAR ROUTER PATTERN 2: Declarative Navigation
            routerLink is an Angular directive that converts an anchor tag into
            a router-aware link. It prevents full page reloads and integrates
            with the browser history API — same behaviour as clicking the nav links above.
          -->
          <a routerLink="/compiler" class="btn btn-secondary">
            🔗 Open Compiler
          </a>
        </div>

        <div class="alert alert-info mt-2">
          <strong>🗺️ Angular Router:</strong> Both buttons navigate to the same route
          (<code>/compiler</code>). The first uses <strong>programmatic navigation</strong>
          (<code>Router.navigate()</code>) — useful when navigation is the result of
          application logic. The second uses a <strong>declarative</strong>
          <code>routerLink</code> directive — the idiomatic way to create navigation links
          in templates. Neither triggers a full page reload.
        </div>
      </div>
      
      <!-- Info Alert -->
      <div class="alert alert-info mt-2">
        <strong>ℹ️ Angular Pattern:</strong> This page demonstrates standalone components,
        structural directives (*ngFor), and interpolation binding (double curly braces).
      </div>
    </div>
  `,
    styles: [`
    /* Component-scoped styles */
    /* These styles are encapsulated to this component only */
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin: 30px 0;
    }
    
    .stat-card {
      background: var(--section-bg);
      padding: 24px;
      border-radius: 8px;
      border: 1px solid var(--border-color);
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    
    .stat-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
    }
    
    .stat-label {
      color: var(--text-muted);
      font-size: 14px;
      margin-bottom: 8px;
    }
    
    .stat-value {
      font-size: 32px;
      font-weight: 700;
      color: var(--primary);
    }
    
    .action-section {
      margin: 30px 0;
      padding: 24px;
      background: var(--section-bg);
      border-radius: 8px;
      border: 1px solid var(--border-color);
    }
    
    .action-section h3 {
      margin-bottom: 16px;
      color: var(--text-color);
    }
    
    .action-buttons {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    
    .btn {
      padding: 12px 24px;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
    }
    
    .btn-primary {
      background: var(--primary);
      color: white;
    }
    
    .btn-primary:hover {
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
    
    .mb-2 { margin-bottom: 20px; }
    .mt-2 { margin-top: 20px; }
    
    .alert {
      padding: 16px;
      border-radius: 6px;
      margin-bottom: 20px;
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
  `],
})
export class HomeComponent {
    /**
     * Component Properties
     * Pattern: TypeScript class properties define component state
     */
    stats: StatCard[] = [
        { label: 'Filter Lists Compiled', value: '1,234' },
        { label: 'Total Rules Processed', value: '456K' },
        { label: 'Active Transformations', value: '12' },
        { label: 'Cache Hit Rate', value: '89%' },
    ];

    /**
     * Constructor with Dependency Injection
     * ANGULAR ROUTER: Inject the Router service to enable programmatic navigation.
     * The Router service provides navigate(), navigateByUrl(), and other methods
     * that allow components to trigger navigation imperatively (from code).
     */
    constructor(private router: Router) {}

    /**
     * Navigate to the Compiler page programmatically.
     *
     * ANGULAR ROUTER PATTERN: Router.navigate()
     * Use this pattern when navigation should happen as a result of application
     * logic rather than a direct user click on a link. For example:
     * - After a successful login, navigate to the dashboard
     * - After saving a form, navigate back to the list page
     * - After a timeout, redirect to a session-expired page
     *
     * router.navigate() accepts an array of route segments (the "commands" array)
     * and an optional NavigationExtras object for query params, fragments, etc.
     */
    goToCompiler(): void {
        this.router.navigate(['/compiler']);
    }
}
