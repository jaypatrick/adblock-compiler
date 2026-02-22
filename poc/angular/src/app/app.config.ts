/**
 * Angular PoC - Application Configuration (Browser)
 *
 * Angular 21 Pattern: Centralized application configuration
 * Uses functional providers instead of NgModule
 */

import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
    providers: [
        // Zone-based change detection (optimized)
        provideZoneChangeDetection({ eventCoalescing: true }),

        // Router with component input binding (map route params to component inputs)
        // and view transitions API for smooth page transitions
        provideRouter(routes, withComponentInputBinding(), withViewTransitions()),

        // HttpClient with fetch API for better SSR compatibility
        provideHttpClient(withFetch()),

        // Angular Material animations (async for better performance)
        provideAnimationsAsync(),
    ],
};
