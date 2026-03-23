/**
 * Cloudflare Workers SSR handler for Angular 21
 *
 * Architecture overview:
 *   - `AngularAppEngine` (from `@angular/ssr`) is the edge-compatible SSR engine.
 *     It speaks the standard fetch `Request`/`Response` API, making it portable
 *     across Cloudflare Workers, Deno Deploy, and any other WinterCG-compliant runtime.
 *   - Static assets (JS, CSS, fonts) are served by Cloudflare's `ASSETS` binding,
 *     configured in `wrangler.toml`. The Workers runtime intercepts asset requests
 *     before this handler is invoked, so `angularApp.handle()` only sees document
 *     (HTML) requests.
 *   - For routes that Angular cannot handle (e.g. unknown paths not covered by the
 *     Angular router), `handle()` returns `null` and we fall through to a 404.
 *
 * SSR render modes (defined in `src/app/app.routes.server.ts`):
 *   - `RenderMode.Prerender` — Home page is pre-rendered at `ng build` time and
 *     served as a static HTML file from the ASSETS binding.
 *   - `RenderMode.Server`    — All other routes are server-rendered per request
 *     inside the Worker.
 *
 * Local development:
 *   deno task wrangler:dev    (uses wrangler.toml — mirrors production)
 *
 * Deployment:
 *   deno task wrangler:deploy (after `pnpm --filter adblock-compiler-frontend run build`)
 */

// ɵsetAngularAppEngineManifest is an Angular-internal (ɵ-prefixed) API.
// In Angular 21 the builder no longer calls it automatically — the server entry
// must import and call it before constructing AngularAppEngine.
// Watch for a stable public replacement in future Angular minor/major releases.
import { AngularAppEngine, ɵsetAngularAppEngineManifest as setAngularAppEngineManifest } from '@angular/ssr';

// Minimal Cloudflare Workers type stubs.
// These are declared as module-scoped interfaces (this file has import/export statements,
// so it is a TypeScript module). They only affect this file and do not pollute the global
// namespace for the rest of the Angular app compilation, which avoids type conflicts with
// libraries such as better-auth that rely on the standard DOM `Response.json()` signature.
// The `Workers` prefix avoids shadowing the real Cloudflare globals if
// @cloudflare/workers-types is ever included for this compilation unit.
interface WorkersExecutionContext {
    waitUntil(promise: Promise<unknown>): void;
    passThroughOnException(): void;
}

interface WorkersFetcher {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

// Lazy, race-safe initialiser for AngularAppEngine.
//
// Angular 21 changed the manifest API: `angular-app-engine-manifest.mjs` is now
// a pure data export (it no longer calls `setAngularAppEngineManifest()` as a
// side effect).  We must call `setAngularAppEngineManifest()` ourselves before
// constructing `AngularAppEngine`, otherwise it throws at module load time.
//
// The manifest file is a *build artifact* — it lives alongside `server.mjs` in
// `dist/.../server/` after `ng build`, not in the TypeScript source tree.  We
// therefore use a *variable* import path so that:
//   • esbuild (Angular builder) does not attempt to bundle it during compilation
//     (esbuild only traces dynamic imports with *string literals*), and
//   • at runtime in Cloudflare Workers the module is resolved from the uploaded
//     bundle (all *.mjs files are uploaded via the [[rules]] glob in wrangler.toml).
//
// The promise is stored at module scope so the setup runs only once even when
// multiple concurrent requests arrive before initialisation completes.
let angularAppPromise: Promise<AngularAppEngine> | null = null;

function getAngularApp(): Promise<AngularAppEngine> {
    if (!angularAppPromise) {
        angularAppPromise = (async () => {
            // Variable path → esbuild does not bundle; resolved at runtime.
            const manifestPath = './angular-app-engine-manifest.mjs';
            let manifest: unknown;
            try {
                ({ default: manifest } = await import(manifestPath));
            } catch (err) {
                throw new Error(
                    `[server.ts] Failed to load angular-app-engine-manifest.mjs. ` +
                    `Ensure the Angular app was built with @angular/build:application before deploying. ` +
                    `Original error: ${err instanceof Error ? err.message : String(err)}`,
                    { cause: err },
                );
            }
            setAngularAppEngineManifest(manifest as Parameters<typeof setAngularAppEngineManifest>[0]);
            return new AngularAppEngine();
        })();
    }
    return angularAppPromise;
}

/**
 * Cloudflare Workers fetch handler.
 *
 * Cloudflare calls this `fetch` export for every incoming HTTP request that is
 * not matched by a static asset in the ASSETS binding.
 *
 * @param request  - The incoming `Request` object (standard fetch API).
 * @param env      - Cloudflare Workers environment bindings (see `Env` below).
 * @param ctx      - Execution context — used for `ctx.waitUntil()` / `ctx.passThroughOnException()`.
 * @returns A `Response` — either SSR-rendered HTML from Angular or a 404.
 */
const handler = {
    async fetch(request: Request, env: Env, ctx: WorkersExecutionContext): Promise<Response> {
        // Route SSR-time API calls to the backend on the internal Cloudflare network.
        // This avoids a public round-trip and bypasses CORS negotiation entirely.
        if (new URL(request.url).pathname.startsWith('/api/')) {
            try {
                const internalReq = new Request(request, {
                    headers: { ...Object.fromEntries(request.headers), 'CF-Worker-Source': 'ssr' }
            });
        return await env.API.fetch(internalReq);
    } catch (err) {
        return new Response('API unavailable', { status: 502 });
    }
}
        // Delegate the request to AngularAppEngine.
        // Returns a fully-formed Response (with HTML + headers) for Angular routes,
        // or null if the engine cannot handle the request (e.g. unrecognised path).
        const response = await (await getAngularApp()).handle(request);
        if (!response) return new Response('Not found', { status: 404 });

        // Item 2: Add Content-Security-Policy headers to HTML responses
        const contentType = response.headers.get('Content-Type') ?? '';
        if (contentType.includes('text/html')) {
            const csp = [
                "default-src 'self'",
                "script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://*.clerk.accounts.dev",
                "style-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev",
                "img-src 'self' data: https://img.clerk.com https://*.clerk.com",
                "font-src 'self'",
                "connect-src 'self' https://adblock-compiler.jayson-knight.workers.dev https://*.clerk.accounts.dev https://o*.ingest.sentry.io https://o*.ingest.us.sentry.io",
                "frame-src https://challenges.cloudflare.com https://*.clerk.accounts.dev",
                "object-src 'none'",
                "base-uri 'self'",
            ].join('; ');

            const headers = new Headers(response.headers);
            headers.set('Content-Security-Policy', csp);
            headers.set('X-Content-Type-Options', 'nosniff');
            headers.set('X-Frame-Options', 'DENY');
            headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers,
            });
        }

        return response;
    },
};

// Lazily-initialised Sentry-wrapped handler. Set on the first request that has
// SENTRY_DSN configured; null until then so local dev pays zero overhead.
// The @sentry/cloudflare module is only imported (and bundled into the hot path)
// when a DSN is actually present — mirrors the pattern in worker/services/sentry-init.ts.
// Declared after `handler` so `typeof handler` resolves correctly.
let sentryHandler: typeof handler | null = null;

export default {
    async fetch(request: Request, env: Env, ctx: WorkersExecutionContext): Promise<Response> {
        if (!env.SENTRY_DSN) {
            return handler.fetch(request, env, ctx);
        }
        if (!sentryHandler) {
            const Sentry = await import('@sentry/cloudflare');
            sentryHandler = Sentry.withSentry(
                (e: Env) => ({
                    dsn: e.SENTRY_DSN!,
                    release: e.SENTRY_RELEASE,
                    environment: e.ENVIRONMENT ?? 'production',
                    tracesSampleRate: 0.1,
                }),
                // `ExportedHandler` from @cloudflare/workers-types is suppressed by
                // tsconfig.app.json `types: []`. Cast via `any` to bridge the gap —
                // safe because `handler` structurally matches the expected shape.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                handler as any,
            ) as typeof handler;
        }
        return sentryHandler.fetch(request, env, ctx);
    },
};

/**
 * Cloudflare Workers environment bindings.
 * Declared in frontend/wrangler.toml and injected by the runtime.
 */
export interface Env {
    /** Static asset binding — serves JS/CSS/fonts from the CDN edge. */
    ASSETS: WorkersFetcher;
    /** Service binding to the adblock-compiler backend Worker.
     *  Calls travel on the internal Cloudflare network — no public hop, no CORS. */
    API: WorkersFetcher;
    /** Sentry DSN for server-side SSR error capture. Set via `wrangler secret put SENTRY_DSN`. */
    SENTRY_DSN?: string;
    /** Sentry release identifier. Injected at deploy time via `--var SENTRY_RELEASE:$GITHUB_SHA`. */
    SENTRY_RELEASE?: string;
    /** Deployment environment name (e.g. "production"). Defaults to "production" if absent. */
    ENVIRONMENT?: string;
}
