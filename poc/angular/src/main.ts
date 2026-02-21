/**
 * Angular PoC - Application Bootstrap
 *
 * ANGULAR PATTERN: Application bootstrap with standalone components
 * This is the entry point that initializes the Angular application
 */

import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';

/**
 * Bootstrap Application
 * Pattern: Standalone bootstrap without NgModule
 * Angular 17+ uses standalone components and functional providers
 */
bootstrapApplication(AppComponent, {
    providers: [
        // Provide router with routes configuration
        provideRouter(routes),

        // Provide HttpClient for API calls
        provideHttpClient(),
    ],
}).catch((err) => console.error(err));
