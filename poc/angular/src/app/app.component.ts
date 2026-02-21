/**
 * Angular PoC - App Component (Root Component)
 *
 * ANGULAR PATTERN: Root component with router outlet
 * This is the entry point component that contains the app shell
 */

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/**
 * AppComponent
 * Pattern: Standalone component that serves as the app shell
 * Contains navigation and router outlet for nested routes
 */
@Component({
    selector: 'app-root',
    standalone: true,
    imports: [
        CommonModule,
        RouterOutlet,
        RouterLink,
        RouterLinkActive,
    ],
    template: `
    <div class="app-container">
      <!-- Navigation -->
      <nav class="nav">
        <ul class="nav-links">
          <li>
            <a 
              routerLink="/" 
              routerLinkActive="active"
              [routerLinkActiveOptions]="{exact: true}"
              class="nav-link"
            >
              🏠 Home
            </a>
          </li>
          <li>
            <a 
              routerLink="/compiler" 
              routerLinkActive="active"
              class="nav-link"
            >
              ⚙️ Compiler
            </a>
          </li>
          <li>
            <a 
              routerLink="/signals" 
              routerLinkActive="active"
              class="nav-link"
            >
              ⚡ Signals
            </a>
          </li>
        </ul>
        
        <!-- Theme Toggle Button -->
        <button class="theme-toggle" (click)="toggleTheme()">
          {{ theme === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode' }}
        </button>
      </nav>
      
      <!-- Main Content Area -->
      <!-- Angular Pattern: router-outlet renders matched route component -->
      <main class="main-content">
        <router-outlet />
      </main>
    </div>
  `,
    styles: [`
    /* App-level styles */
    
    .app-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    
    .nav {
      background: var(--container-bg);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .nav-links {
      display: flex;
      gap: 20px;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    
    .nav-link {
      color: var(--text-muted);
      text-decoration: none;
      padding: 8px 16px;
      border-radius: 6px;
      transition: all 0.3s ease;
      font-weight: 500;
      display: block;
    }
    
    .nav-link:hover {
      background: var(--button-hover);
      color: var(--primary);
    }
    
    /* Angular Pattern: routerLinkActive adds 'active' class */
    .nav-link.active {
      background: var(--primary);
      color: white;
    }
    
    .theme-toggle {
      background: var(--section-bg);
      border: 1px solid var(--border-color);
      color: var(--text-color);
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.3s ease;
    }
    
    .theme-toggle:hover {
      background: var(--button-hover);
      transform: translateY(-2px);
    }
    
    .main-content {
      background: var(--container-bg);
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      min-height: 400px;
    }
  `],
})
export class AppComponent implements OnInit {
    theme: 'light' | 'dark' = 'light';

    /**
     * Lifecycle Hook: OnInit
     * Initialize theme from localStorage
     */
    ngOnInit(): void {
        // Load theme from localStorage
        const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
        if (savedTheme) {
            this.theme = savedTheme;
            this.applyTheme();
        }
    }

    /**
     * Toggle Theme Handler
     * Pattern: Event handler method that updates state and DOM
     */
    toggleTheme(): void {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        this.applyTheme();
        localStorage.setItem('theme', this.theme);
    }

    /**
     * Apply Theme to DOM
     * Pattern: Direct DOM manipulation for theme attribute
     */
    private applyTheme(): void {
        document.documentElement.setAttribute('data-theme', this.theme);
    }
}
