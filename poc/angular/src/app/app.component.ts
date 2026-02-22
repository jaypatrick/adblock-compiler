/**
 * Angular PoC - App Component (Root Component)
 *
 * Angular 21 + Material Pattern: Root component with Material toolbar and sidenav
 * Uses Angular Material for the app shell navigation
 */

import { Component, OnInit, signal, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DOCUMENT } from '@angular/common';

/**
 * Navigation item interface
 */
interface NavItem {
    readonly path: string;
    readonly label: string;
    readonly icon: string;
}

/**
 * AppComponent
 * Pattern: Standalone component with Angular Material toolbar and sidenav
 * Uses inject() for functional dependency injection (Angular 21 pattern)
 */
@Component({
    selector: 'app-root',
    standalone: true,
    imports: [
        RouterOutlet,
        RouterLink,
        RouterLinkActive,
        MatToolbarModule,
        MatSidenavModule,
        MatListModule,
        MatIconModule,
        MatButtonModule,
        MatTooltipModule,
    ],
    template: `
    <mat-sidenav-container class="app-container">
      <!-- Sidenav for navigation -->
      <mat-sidenav
        #sidenav
        mode="side"
        [opened]="sidenavOpen()"
        class="app-sidenav"
      >
        <mat-toolbar color="primary" class="sidenav-header">
          <span>Adblock Compiler</span>
        </mat-toolbar>
        <mat-nav-list>
          @for (item of navItems; track item.path) {
            <a
              mat-list-item
              [routerLink]="item.path"
              routerLinkActive="active-nav-item"
              [routerLinkActiveOptions]="item.path === '/' ? { exact: true } : {}"
            >
              <mat-icon matListItemIcon>{{ item.icon }}</mat-icon>
              <span matListItemTitle>{{ item.label }}</span>
            </a>
          }
        </mat-nav-list>
      </mat-sidenav>

      <!-- Main content -->
      <mat-sidenav-content>
        <!-- Top toolbar -->
        <mat-toolbar color="primary" class="app-toolbar">
          <button
            mat-icon-button
            (click)="toggleSidenav()"
            matTooltip="Toggle navigation"
            aria-label="Toggle navigation"
          >
            <mat-icon>menu</mat-icon>
          </button>
          <span class="toolbar-title">Adblock Compiler</span>
          <span class="toolbar-spacer"></span>
          <button
            mat-icon-button
            (click)="toggleTheme()"
            [matTooltip]="isDarkTheme() ? 'Switch to light mode' : 'Switch to dark mode'"
            aria-label="Toggle theme"
          >
            <mat-icon>{{ isDarkTheme() ? 'light_mode' : 'dark_mode' }}</mat-icon>
          </button>
        </mat-toolbar>

        <!-- Page content with router outlet -->
        <main class="app-main">
          <router-outlet />
        </main>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
    styles: [`
    .app-container {
      height: 100vh;
    }

    .app-sidenav {
      width: 240px;
    }

    .sidenav-header {
      position: sticky;
      top: 0;
      z-index: 1;
    }

    .app-toolbar {
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .toolbar-title {
      margin-left: 8px;
      font-size: 1.1rem;
      font-weight: 500;
    }

    .toolbar-spacer {
      flex: 1 1 auto;
    }

    .app-main {
      padding: 24px;
      max-width: 1200px;
      margin: 0 auto;
    }

    .active-nav-item {
      background: rgba(var(--mat-sys-primary), 0.12);
    }

    :host ::ng-deep .mat-mdc-list-item.active-nav-item {
      background-color: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
  `],
})
export class AppComponent implements OnInit {
    /** Navigation items */
    readonly navItems: NavItem[] = [
        { path: '/', label: 'Home', icon: 'home' },
        { path: '/compiler', label: 'Compiler', icon: 'settings' },
        { path: '/signals', label: 'Signals', icon: 'bolt' },
        { path: '/benchmark', label: 'Benchmark', icon: 'bar_chart' },
    ];

    /** Signal for sidenav open state */
    readonly sidenavOpen = signal(true);

    /** Signal for dark theme state */
    readonly isDarkTheme = signal(false);

    /** Inject DOCUMENT for SSR-safe DOM access */
    private readonly document = inject(DOCUMENT);

    ngOnInit(): void {
        // Only access localStorage in browser context
        if (typeof localStorage !== 'undefined') {
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme === 'dark') {
                this.isDarkTheme.set(true);
                this.applyTheme(true);
            }
        }
    }

    toggleSidenav(): void {
        this.sidenavOpen.update(open => !open);
    }

    toggleTheme(): void {
        const newDark = !this.isDarkTheme();
        this.isDarkTheme.set(newDark);
        this.applyTheme(newDark);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('theme', newDark ? 'dark' : 'light');
        }
    }

    private applyTheme(dark: boolean): void {
        const body = this.document.body;
        if (dark) {
            body.classList.add('dark-theme');
        } else {
            body.classList.remove('dark-theme');
        }
    }
}
