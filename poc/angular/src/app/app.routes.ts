/**
 * Angular PoC - Application Routes Configuration
 *
 * ANGULAR ROUTER PATTERN: Declarative routing with standalone components
 *
 * Key Router Features Demonstrated:
 * 1. Lazy Loading      - loadComponent() splits code by route (smaller initial bundle)
 * 2. Route Titles      - title property updates the browser tab automatically
 * 3. Route Data        - Static metadata attached to routes, readable via ActivatedRoute
 * 4. Wildcard Route    - '**' catches all unmatched URLs and redirects to home
 */

import { Routes } from '@angular/router';

/**
 * Application Routes
 *
 * ANGULAR ROUTER: Using loadComponent() for automatic code splitting.
 * Angular compiles each lazily-loaded component into a separate JS chunk that
 * is only fetched from the network when the user navigates to that route.
 * This reduces the initial bundle size and improves Time-to-Interactive.
 */
export const routes: Routes = [
    {
        path: '',
        // Lazy load: HomeComponent is NOT included in the initial bundle.
        // Angular fetches it the first time the user visits '/'.
        loadComponent: () => import('./home/home.component').then((m) => m.HomeComponent),
        title: 'Home - Adblock Compiler',
    },
    {
        path: 'compiler',
        // Lazy load: CompilerComponent (and its dependencies) are split into a
        // separate chunk, keeping the initial bundle small.
        loadComponent: () => import('./compiler/compiler.component').then((m) => m.CompilerComponent),
        title: 'Compiler - Adblock Compiler',
        // Route Data: Static metadata passed to the component via ActivatedRoute.
        // Useful for breadcrumbs, page descriptions, permissions, etc.
        data: { description: 'Configure and run filter list compilations' },
    },
    {
        // Wildcard route: redirects any unknown path back to home.
        // Always place this last – routes are matched top-to-bottom.
        path: '**',
        redirectTo: '',
    },
];
