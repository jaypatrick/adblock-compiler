/**
 * Angular PoC - Application Routes Configuration
 * 
 * ANGULAR PATTERN: Declarative routing with standalone components
 * Angular 17+ uses standalone components without NgModules
 * Routes are defined as a simple array of route configurations
 */

import { Routes } from '@angular/router';
import { HomeComponent } from './home/home.component';
import { CompilerComponent } from './compiler/compiler.component';

/**
 * Application Routes
 * Pattern: File-based route configuration with lazy loading support
 * Each route maps a path to a component
 */
export const routes: Routes = [
  {
    path: '',
    component: HomeComponent,
    title: 'Home - Adblock Compiler'
  },
  {
    path: 'compiler',
    component: CompilerComponent,
    title: 'Compiler - Adblock Compiler'
  },
  {
    path: '**',
    redirectTo: ''
  }
];
