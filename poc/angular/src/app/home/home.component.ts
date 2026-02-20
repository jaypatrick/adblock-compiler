/**
 * Angular PoC - Home/Dashboard Component
 * 
 * ANGULAR PATTERN: Standalone component with inline template
 * Demonstrates Angular's component architecture and data binding
 */

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

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
 */
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule], // Import common directives like *ngFor, *ngIf
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
      
      <!-- Info Alert -->
      <div class="alert alert-info mt-2">
        <strong>ℹ️ Angular Pattern:</strong> This page demonstrates standalone components,
        structural directives (*ngFor), and interpolation binding ({{ }}).
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
  `]
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
    { label: 'Cache Hit Rate', value: '89%' }
  ];
}
