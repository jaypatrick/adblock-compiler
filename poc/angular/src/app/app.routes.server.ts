/**
 * Angular PoC - Server Routes Configuration
 *
 * Angular 21 SSR Pattern: Define server-side rendering strategy per route
 * - RenderMode.Prerender: Pre-render at build time (SSG)
 * - RenderMode.Server: Render on each request (SSR)
 * - RenderMode.Client: Render on client only (CSR)
 */

import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
    {
        path: '**',
        renderMode: RenderMode.Server,
    },
];
