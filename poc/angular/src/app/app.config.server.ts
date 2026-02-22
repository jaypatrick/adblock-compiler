/**
 * Angular PoC - Application Configuration (Server)
 *
 * Angular 21 SSR Pattern: Server-specific providers merged with browser config
 * Adds server-side rendering providers on top of the base app config
 */

import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';
import { provideServerRoutesConfig } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
    providers: [
        provideServerRendering(),
        provideServerRoutesConfig(serverRoutes),
    ],
};

export const appServerConfig = mergeApplicationConfig(appConfig, serverConfig);
