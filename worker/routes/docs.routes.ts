/// <reference types="@cloudflare/workers-types" />

/**
 * Documentation routes — Scalar, Swagger UI, ReDoc, and landing page endpoints.
 *
 * Routes:
 *   GET /          — Landing page (API overview with links to all doc UIs)
 *   GET /api       — Landing page (same handler, mounted at /api prefix)
 *   GET /api/docs  — Scalar UI (primary interactive docs, Bloqr dark theme)
 *   GET /api/swagger — Swagger UI (dark-themed Bloqr overrides)
 *   GET /api/redoc — Scalar UI in classic/ReDoc layout (Bloqr dark theme)
 *
 * All routes consume the live OpenAPI spec from /api/openapi.json.
 *
 * Note: /api/docs and /api/swagger are registered on the `docsRoutes` sub-app
 * (paths without the /api prefix).  The landing-page routes and /api/redoc are
 * registered directly on the root `app` in hono-app.ts via `app.route('/api', docsRoutes)`
 * so they bypass the authenticated `routes` sub-app.
 */

import { apiReference } from '@scalar/hono-api-reference';
import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';
import { getProjectUrls } from '../utils/constants.ts';

// ── Hono router ───────────────────────────────────────────────────────────────

export const docsRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Bloqr design-language CSS variables ──────────────────────────────────────
// Shared token set applied to every Scalar-based UI (Scalar + ReDoc).

const BLOQR_SCALAR_CSS = `
:root {
    --scalar-color-1: #F1F5F9;
    --scalar-color-2: #94A3B8;
    --scalar-color-3: #475569;
    --scalar-color-accent: #FF5500;
    --scalar-background-1: #070B14;
    --scalar-background-2: #0E1829;
    --scalar-background-3: #162035;
    --scalar-background-accent: rgba(255, 85, 0, 0.08);
    --scalar-border-color: #1E2D40;
    --scalar-sidebar-background-1: #050A12;
    --scalar-sidebar-color-1: #F1F5F9;
    --scalar-sidebar-color-2: #94A3B8;
    --scalar-sidebar-color-active: #FF5500;
    --scalar-sidebar-background-active-item: rgba(255, 85, 0, 0.10);
    --scalar-font: 'Space Grotesk', 'Inter', system-ui, sans-serif;
    --scalar-font-code: 'JetBrains Mono', 'Fira Code', monospace;
}
.scalar-app, .scalar-app body {
    background: #070B14 !important;
    color: #F1F5F9 !important;
}
/* Orange gradient hero accent across the top */
.scalar-app::before {
    content: '';
    display: block;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, #FF5500 0%, #FF7033 50%, #00D4FF 100%);
    z-index: 9999;
    pointer-events: none;
}
`;

// ── Scalar UI endpoint (Bloqr / modern) ──────────────────────────────────────
// Primary interactive OpenAPI documentation UI at /api/docs.
// Reference: https://hono.dev/examples/scalar/

const scalarDocsHandler = apiReference({
    theme: 'none',
    layout: 'modern',
    url: '/api/openapi.json',
    defaultHttpClient: { targetKey: 'js', clientKey: 'fetch' },
    pageTitle: 'Bloqr API Documentation',
    favicon: '/favicon.svg',
    customCss: BLOQR_SCALAR_CSS,
    metaData: {
        title: 'Bloqr API',
        description: 'Compiler-as-a-Service for adblock filter lists. Transform, optimize, and combine filter lists from multiple sources.',
        ogDescription: 'Interactive API documentation for Bloqr — Adblock & Privacy Filter Compiler-as-a-Service',
    },
});

docsRoutes.get('/docs', scalarDocsHandler);
// Wildcard variant handles trailing slashes and deep-links (e.g. /api/docs/).
docsRoutes.get('/docs/*', scalarDocsHandler);

// ── Swagger UI endpoint (Bloqr dark theme) ────────────────────────────────────
// Traditional Swagger UI documentation at /api/swagger.
// Reference: https://hono.dev/examples/swagger-ui/
//
// NOTE: We use manuallySwaggerUIHtml with pinned CDN URLs instead of relying on
// the `asset` object from @hono/swagger-ui's internal remoteAssets() helper.
// The dynamic asset injection pattern (asset.css.filter(...) / asset.js.filter(...))
// is fragile: if the library's CDN URLs change or the standalone preset is omitted
// from the asset list, SwaggerUIBundle is never defined and the page renders blank.
// Pinning to an exact swagger-ui-dist version on cdn.jsdelivr.net is stable,
// reproducible across deploys, and guarantees both required scripts are always loaded.

const BLOQR_SWAGGER_CSS = `
body { background: #070B14 !important; margin: 0; }
.swagger-ui { font-family: 'Inter', system-ui, sans-serif !important; }
.swagger-ui .topbar { background: #0E1829 !important; border-bottom: 3px solid #FF5500 !important; padding: 8px 0 !important; }
.swagger-ui .topbar .download-url-wrapper { display: none !important; }
.swagger-ui .info { margin: 32px 0 !important; }
.swagger-ui .info .title { color: #F1F5F9 !important; font-family: 'Space Grotesk', sans-serif !important; }
.swagger-ui .info p, .swagger-ui .info li, .swagger-ui .info table { color: #94A3B8 !important; }
.swagger-ui .scheme-container { background: #0E1829 !important; border-bottom: 1px solid #1E2D40 !important; box-shadow: none !important; }
.swagger-ui select { background: #162035 !important; border-color: #1E2D40 !important; color: #F1F5F9 !important; }
.swagger-ui .opblock-tag { color: #F1F5F9 !important; border-bottom: 1px solid #1E2D40 !important; font-family: 'Space Grotesk', sans-serif !important; }
.swagger-ui .opblock { border-radius: 8px !important; margin: 8px 0 !important; border-color: #1E2D40 !important; }
.swagger-ui .opblock.opblock-post { border-color: #FF5500 !important; background: rgba(255, 85, 0, 0.04) !important; }
.swagger-ui .opblock.opblock-get { border-color: #00D4FF !important; background: rgba(0, 212, 255, 0.04) !important; }
.swagger-ui .opblock.opblock-delete { border-color: #EF4444 !important; background: rgba(239, 68, 68, 0.04) !important; }
.swagger-ui .opblock.opblock-put { border-color: #F59E0B !important; background: rgba(245, 158, 11, 0.04) !important; }
.swagger-ui .opblock .opblock-summary-method { border-radius: 6px !important; font-weight: 700 !important; font-family: 'JetBrains Mono', monospace !important; }
.swagger-ui .opblock.opblock-post .opblock-summary-method { background: #FF5500 !important; }
.swagger-ui .opblock.opblock-get .opblock-summary-method { background: #00D4FF !important; color: #070B14 !important; }
.swagger-ui .opblock .opblock-summary-path { color: #F1F5F9 !important; font-family: 'JetBrains Mono', monospace !important; }
.swagger-ui .opblock .opblock-summary-description { color: #94A3B8 !important; }
.swagger-ui .opblock-body { background: #0E1829 !important; }
.swagger-ui .tab li { color: #94A3B8 !important; }
.swagger-ui .tab li.active { color: #FF5500 !important; border-bottom: 2px solid #FF5500 !important; }
.swagger-ui textarea,
.swagger-ui input[type=text],
.swagger-ui input[type=password],
.swagger-ui input[type=search],
.swagger-ui input[type=email] { background: #162035 !important; border-color: #1E2D40 !important; color: #F1F5F9 !important; border-radius: 6px !important; }
.swagger-ui .btn { border-radius: 6px !important; font-family: 'Space Grotesk', sans-serif !important; font-weight: 600 !important; }
.swagger-ui .btn.execute { background: #FF5500 !important; border-color: #FF5500 !important; color: #ffffff !important; }
.swagger-ui .btn.authorize { border-color: #00D4FF !important; color: #00D4FF !important; }
.swagger-ui .model { color: #94A3B8 !important; }
.swagger-ui .model-box { background: #162035 !important; border-radius: 8px !important; }
.swagger-ui section.models { background: #0E1829 !important; border-color: #1E2D40 !important; border-radius: 8px !important; }
.swagger-ui section.models h4 { color: #F1F5F9 !important; }
.swagger-ui .response-col_status { color: #22C55E !important; font-family: 'JetBrains Mono', monospace !important; }
.swagger-ui table.headers td, .swagger-ui .parameter__name { color: #F1F5F9 !important; }
.swagger-ui .parameter__type { color: #00D4FF !important; }
.swagger-ui .parameter__deprecated { color: #EF4444 !important; }
.swagger-ui .opblock-description-wrapper p { color: #94A3B8 !important; }
.swagger-ui .highlight-code { background: #050A12 !important; border-radius: 6px !important; }
.swagger-ui .highlight-code > .microlight { color: #F1F5F9 !important; }
`;

// Pin to an exact Swagger UI dist version so CDN assets are reproducible across deploys.
const SWAGGER_CDN_BASE = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14';

const swaggerDocsHandler = swaggerUI({
    url: '/api/openapi.json',
    title: 'Bloqr API — Swagger',
    // `manuallySwaggerUIHtml` is the only type-safe way to inject custom CSS in
    // @hono/swagger-ui@0.6.1 (the package does not expose a `customCss` option).
    manuallySwaggerUIHtml: (_asset) => {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bloqr API &#x2014; Swagger</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${SWAGGER_CDN_BASE}/swagger-ui.css" />
    <style>${BLOQR_SWAGGER_CSS}</style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="${SWAGGER_CDN_BASE}/swagger-ui-bundle.js" crossorigin="anonymous"></script>
    <script src="${SWAGGER_CDN_BASE}/swagger-ui-standalone-preset.js" crossorigin="anonymous"></script>
    <script>
        window.onload = function() {
            window.ui = SwaggerUIBundle({
                dom_id: '#swagger-ui',
                url: '/api/openapi.json',
                presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
                plugins: [SwaggerUIBundle.plugins.DownloadUrl],
                layout: 'StandaloneLayout',
                persistAuthorization: true,
                deepLinking: true,
            });
        };
    </script>
</body>
</html>`;
    },
});

docsRoutes.get('/swagger', swaggerDocsHandler);
// Wildcard variant handles trailing slashes and deep-links (e.g. /api/swagger/).
docsRoutes.get('/swagger/*', swaggerDocsHandler);

// ── ReDoc endpoint (Scalar classic layout, Bloqr dark theme) ─────────────────
// Classic three-panel OpenAPI documentation UI at /api/redoc.

const redocDocsHandler = apiReference({
    theme: 'none',
    layout: 'classic',
    url: '/api/openapi.json',
    pageTitle: 'Bloqr API Reference',
    favicon: '/favicon.svg',
    customCss: BLOQR_SCALAR_CSS,
    metaData: {
        title: 'Bloqr API Reference',
        description: 'Compiler-as-a-Service for adblock filter lists.',
    },
});

docsRoutes.get('/redoc', redocDocsHandler);
docsRoutes.get('/redoc/*', redocDocsHandler);

// ── Landing page handler ──────────────────────────────────────────────────────
// Shared HTML handler used by both GET / and GET /api.

// Inline tri-line SVG for the landing page hero (64 × 64).
// NOTE: This SVG pattern appears in three locations by necessity — each serves a different runtime context:
//   1. /frontend/src/favicon.svg           — browser favicon / Angular SPA img src (frontend build output)
//   2. frontend/src/app/app.component.ts   — Angular component inline template (compiled by Angular CLI, can't use file imports in templates)
//   3. Here (TRI_LINE_LOGO_SVG)            — Worker-rendered standalone HTML; the Cloudflare Worker bundle is
//                                            built separately from the frontend and cannot import frontend assets
//                                            at runtime. Inlining is the only option in this server-side context.
// All three instances share the same design tokens to maintain visual consistency:
// background #070B14; bar fills #F1F5F9, #00D4FF, and #FF5500; and #FF5500 for the top stripe/glow accents.
const TRI_LINE_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true" focusable="false">
  <defs>
    <filter id="heroOrangeGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="64" height="64" rx="12" fill="#070B14"/>
  <rect x="0" y="0" width="64" height="3" rx="1.5" fill="#FF5500"/>
  <rect x="12" y="20" width="40" height="6" rx="3" fill="#F1F5F9"/>
  <rect x="12" y="31" width="27" height="6" rx="3" fill="#00D4FF"/>
  <rect x="12" y="42" width="14" height="6" rx="3" fill="#FF5500" filter="url(#heroOrangeGlow)"/>
  <path d="M28 45 L33 45 L30.5 42 Z" fill="#FF5500" opacity="0.7"/>
</svg>`;

/**
 * Render the Bloqr API developer landing page.
 *
 * Completely inline HTML/CSS — no @fontsource available in standalone HTML responses.
 * Space Grotesk loaded via Google Fonts CDN (exception: this is a standalone HTML
 * response not served through the Angular SPA, so self-hosting via @fontsource is
 * not possible here).
 * Bloqr dark palette, orange #FF5500 accent, cyan #00D4FF accent, responsive layout.
 */
export function docsLandingHandler(env: Env): Response {
    const urls = getProjectUrls(env);
    const version = (env as { COMPILER_VERSION?: string }).COMPILER_VERSION ?? '—';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bloqr API — Internet Hygiene. Automated.</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <!-- Space Grotesk via Google Fonts CDN.
         REQUIRED EXCEPTION: This is a standalone HTML response served directly by the Cloudflare Worker,
         not rendered through the Angular SPA. The @fontsource npm packages (used elsewhere in the app)
         are not available in this context. Using a CDN for this one endpoint is the only viable option.
         Privacy note: users visiting the API docs landing page may be subject to Google's font CDN
         terms. This is an accepted trade-off for the standalone developer-facing landing page only. -->
    <link rel="preconnect" href="https://fonts.googleapis.com" referrerpolicy="no-referrer">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin referrerpolicy="no-referrer">
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" referrerpolicy="no-referrer">
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
            --bg:            #070B14;
            --surface:       #0E1829;
            --elevated:      #162035;
            --overlay:       #1C2A45;
            --border:        #1E2D40;
            --border-accent: #2A4060;
            --orange:        #FF5500;
            --orange-hover:  #FF7033;
            --orange-glow:   rgba(255, 85, 0, 0.15);
            --text:          #F1F5F9;
            --text-muted:    #94A3B8;
            --radius:        12px;
        }
        html, body {
            background: var(--bg);
            color: var(--text);
            font-family: 'Space Grotesk', system-ui, -apple-system, sans-serif;
            min-height: 100vh;
        }
        a { color: var(--orange); text-decoration: none; }
        a:hover { color: var(--orange-hover); text-decoration: underline; }

        /* ── Hero ─── */
        .hero {
            background:
                radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255, 85, 0, 0.12), transparent),
                radial-gradient(ellipse 60% 40% at 80% 60%, rgba(0, 212, 255, 0.06), transparent),
                var(--bg);
            border-bottom: 1px solid var(--border);
            padding: 4rem 2rem 3.5rem;
            text-align: center;
            /* Orange accent line at very top */
            border-top: 3px solid var(--orange);
        }
        .hero-logo { display: flex; justify-content: center; margin-bottom: 1.25rem; }
        .hero-logo svg { width: 64px; height: 64px; }
        .hero-badge {
            display: inline-block;
            background: rgba(255, 85, 0, 0.12);
            border: 1px solid rgba(255, 85, 0, 0.25);
            border-radius: 999px;
            padding: 0.25rem 1rem;
            font-size: 0.75rem;
            font-weight: 700;
            letter-spacing: 0.2em;
            text-transform: uppercase;
            color: var(--orange);
            margin-bottom: 1.5rem;
        }
        .hero h1 {
            font-size: clamp(2rem, 5vw, 3.25rem);
            font-weight: 700;
            letter-spacing: -0.03em;
            line-height: 1.1;
            color: var(--text);
        }
        .hero-tagline {
            margin-top: 0.75rem;
            font-size: 1.1rem;
            font-weight: 600;
            color: var(--orange);
            letter-spacing: -0.01em;
        }
        .hero p { margin-top: 1rem; color: var(--text-muted); font-size: 1rem; max-width: 560px; margin-inline: auto; line-height: 1.65; }
        .hero-links { margin-top: 2.25rem; display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
        .hero-links a {
            display: inline-flex; align-items: center; gap: 0.4rem;
            padding: 0.6rem 1.25rem; border-radius: 8px; font-size: 0.875rem; font-weight: 600;
            transition: all 150ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .btn-primary {
            background: var(--orange);
            color: #ffffff;
            box-shadow: 0 0 20px rgba(255, 85, 0, 0.30);
        }
        .btn-primary:hover {
            background: var(--orange-hover);
            box-shadow: 0 0 32px rgba(255, 85, 0, 0.45);
            transform: translateY(-1px);
            text-decoration: none;
            color: #ffffff;
        }
        .btn-outline {
            border: 1px solid var(--border-accent);
            color: var(--text-muted);
            background: transparent;
        }
        .btn-outline:hover {
            border-color: var(--orange);
            color: var(--text);
            background: rgba(255, 85, 0, 0.06);
            text-decoration: none;
            transform: translateY(-1px);
        }

        /* ── Cards ─── */
        .container { max-width: 960px; margin: 0 auto; padding: 3rem 1.5rem; }
        .section-label {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.2em;
            text-transform: uppercase;
            color: var(--orange);
            margin-bottom: 1.5rem;
        }
        .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1.25rem; }
        .card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 1.5rem;
            transition: border-color 150ms, background 150ms, transform 150ms;
        }
        .card:hover {
            border-color: var(--border-accent);
            background: var(--elevated);
            transform: translateY(-2px);
        }
        .card-icon { font-size: 1.5rem; margin-bottom: 0.75rem; }
        .card-title { font-size: 1rem; font-weight: 700; margin-bottom: 0.3rem; color: var(--text); }
        .card-desc { font-size: 0.85rem; color: var(--text-muted); line-height: 1.6; margin-bottom: 1rem; }
        .card-tag {
            display: inline-block;
            background: rgba(255, 85, 0, 0.10);
            border: 1px solid rgba(255, 85, 0, 0.20);
            border-radius: 4px;
            padding: 0.1rem 0.45rem;
            font-size: 0.7rem;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--orange);
            margin-bottom: 0.6rem;
        }
        .card-link {
            display: inline-flex; align-items: center; gap: 0.3rem;
            font-size: 0.82rem; font-weight: 600; color: var(--orange);
            padding: 0.35rem 0.85rem;
            border: 1px solid rgba(255, 85, 0, 0.25);
            border-radius: 6px;
            transition: background 150ms, box-shadow 150ms;
        }
        .card-link:hover {
            background: rgba(255, 85, 0, 0.10);
            box-shadow: 0 0 12px rgba(255, 85, 0, 0.20);
            text-decoration: none;
            color: var(--orange-hover);
        }
        /* ── Status ─── */
        .status-bar {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 0.75rem 1.25rem;
            display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
            margin-top: 2.5rem; font-size: 0.85rem;
        }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #22C55E; flex-shrink: 0; }
        .status-label { color: var(--text-muted); }
        .status-value { color: var(--text); font-weight: 600; }
        .status-sep { color: var(--border-accent); }

        /* ── Footer ─── */
        footer { text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 2rem 1rem 3rem; }
        footer a { color: var(--text-muted); }
        footer a:hover { color: var(--orange); }

        @media (max-width: 480px) {
            .hero { padding: 3rem 1.25rem 2.5rem; }
            .container { padding: 2rem 1rem; }
        }
    </style>
</head>
<body>
    <header class="hero">
        <div class="hero-logo" aria-hidden="true">
            ${TRI_LINE_LOGO_SVG}
        </div>
        <div class="hero-badge">API v1 &nbsp;·&nbsp; OpenAPI 3.0</div>
        <h1>Bloqr API</h1>
        <p class="hero-tagline">Internet Hygiene. Automated.</p>
        <p>Compile, manage, and deploy adblock filter lists at network scale. REST, streaming, and embedded library. JSON/YAML config. Fully typed.</p>
        <nav class="hero-links">
            <a href="/api/docs" class="btn-primary"><span aria-hidden="true">&#9654;</span> Explore the API</a>
            <a href="${urls.frontend}" class="btn-outline"><span aria-hidden="true">&#9670;</span> Open App</a>
            <a href="${urls.docs}" class="btn-outline"><span aria-hidden="true">&#128196;</span> Docs</a>
            <a href="${urls.landing}" class="btn-outline"><span aria-hidden="true">&#8962;</span> Home</a>
        </nav>
    </header>

    <main class="container">
        <p class="section-label">API Explorer</p>
        <div class="cards">
            <div class="card">
                <div class="card-tag">Primary</div>
                <div class="card-icon" aria-hidden="true">&#9670;</div>
                <div class="card-title">Scalar UI</div>
                <div class="card-desc">Modern interactive API explorer. Try requests directly in the browser. Bloqr dark theme with orange accents.</div>
                <a href="/api/docs" class="card-link">Open Scalar <span aria-hidden="true">&#8599;</span></a>
            </div>
            <div class="card">
                <div class="card-icon" aria-hidden="true">&#128218;</div>
                <div class="card-title">Swagger UI</div>
                <div class="card-desc">Classic Swagger interface. Supports all standard OpenAPI operations — familiar to most teams. Dark themed.</div>
                <a href="/api/swagger" class="card-link">Open Swagger <span aria-hidden="true">&#8599;</span></a>
            </div>
            <div class="card">
                <div class="card-icon" aria-hidden="true">&#128196;</div>
                <div class="card-title">ReDoc</div>
                <div class="card-desc">Three-panel reference documentation. Clean, readable layout ideal for browsing the full API surface.</div>
                <a href="/api/redoc" class="card-link">Open ReDoc <span aria-hidden="true">&#8599;</span></a>
            </div>
        </div>

        <div class="status-bar">
            <span class="status-dot"></span>
            <span class="status-label">Status</span>
            <span class="status-value">Operational</span>
            <span class="status-sep">|</span>
            <span class="status-label">Compiler</span>
            <span class="status-value">v${version}</span>
            <span class="status-sep">|</span>
            <a href="/api/health">Health check &#8599;</a>
        </div>
    </main>

    <footer>
        &copy; ${new Date().getFullYear()} Bloqr &mdash;
        <a href="${urls.frontend}">App</a> &middot;
        <a href="${urls.docs}">Docs</a> &middot;
        <a href="/api/openapi.json">OpenAPI spec</a>
    </footer>
</body>
</html>`;

    return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    });
}

// ── Root / /api landing page routes ──────────────────────────────────────────
// Also registered here so they are available via app.route('/api', docsRoutes)
// and can be tested through the docs router directly.

docsRoutes.get('/', (c) => docsLandingHandler(c.env));
