/**
 * Angular PoC - Application Configuration (Server)
 *
 * Angular 21 SSR Pattern: Server-specific providers merged with browser config
 * Adds server-side rendering providers on top of the base app config
 *
 * Angular SSR 21.1+ Pattern: provideServerRendering(withRoutes()) replaces the
 * old provideServerRendering() + provideServerRoutesConfig() pair.
 */

import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
    providers: [
        provideServerRendering(withRoutes(serverRoutes)),
    ],
};

export const appServerConfig = mergeApplicationConfig(appConfig, serverConfig);
