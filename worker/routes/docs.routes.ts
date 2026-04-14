/// <reference types="@cloudflare/workers-types" />

/**
 * Documentation routes — Scalar, Swagger UI, ReDoc, and landing page endpoints.
 *
 * Routes:
 *   GET /          — Landing page (API overview with links to all doc UIs)
 *   GET /api       — Landing page (same handler, mounted at /api prefix)
 *   GET /api/docs  — Scalar UI (modern OpenAPI documentation, purple theme)
 *   GET /api/swagger — Swagger UI (traditional OpenAPI documentation)
 *   GET /api/redoc — Scalar UI in classic/ReDoc layout (theme: default)
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

// ── Scalar UI endpoint (purple / modern) ─────────────────────────────────────
// Modern, beautiful OpenAPI documentation UI at /api/docs
// Reference: https://hono.dev/examples/scalar/

const scalarDocsHandler = apiReference({
    theme: 'purple',
    layout: 'modern',
    url: '/api/openapi.json',
    defaultHttpClient: { targetKey: 'js', clientKey: 'fetch' },
    pageTitle: 'Bloqr API Documentation',
    favicon: '/favicon.ico',
    metaData: {
        title: 'Bloqr API',
        description: 'Compiler-as-a-Service for adblock filter lists. Transform, optimize, and combine filter lists from multiple sources.',
        ogDescription: 'Interactive API documentation for Bloqr — Adblock & Privacy Filter Compiler-as-a-Service',
    },
});

docsRoutes.get('/docs', scalarDocsHandler);
// Wildcard variant handles trailing slashes and deep-links (e.g. /api/docs/).
docsRoutes.get('/docs/*', scalarDocsHandler);

// ── Swagger UI endpoint ───────────────────────────────────────────────────────
// Traditional Swagger UI documentation at /api/swagger
// Reference: https://hono.dev/examples/swagger-ui/

const swaggerDocsHandler = swaggerUI({ url: '/api/openapi.json' });

docsRoutes.get('/swagger', swaggerDocsHandler);
// Wildcard variant handles trailing slashes and deep-links (e.g. /api/swagger/).
docsRoutes.get('/swagger/*', swaggerDocsHandler);

// ── ReDoc endpoint (Scalar classic layout) ────────────────────────────────────
// Classic three-panel OpenAPI documentation UI at /api/redoc

const redocDocsHandler = apiReference({
    theme: 'default',
    layout: 'classic',
    url: '/api/openapi.json',
    pageTitle: 'Bloqr API Reference',
    metaData: {
        title: 'Bloqr API Reference',
        description: 'Compiler-as-a-Service for adblock filter lists.',
    },
});

docsRoutes.get('/redoc', redocDocsHandler);
docsRoutes.get('/redoc/*', redocDocsHandler);

// ── Landing page handler ──────────────────────────────────────────────────────
// Shared HTML handler used by both GET / and GET /api.

/**
 * Render the Bloqr API developer landing page.
 *
 * Completely inline HTML/CSS — no @fontsource available in standalone HTML responses.
 * Space Grotesk loaded via Google Fonts CDN (exception: this is a standalone HTML
 * response not served through the Angular SPA, so self-hosting via @fontsource is
 * not possible here).
 * Bloqr dark palette, orange #FF5500 accent, responsive layout.
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
    <!-- Space Grotesk via Google Fonts CDN.
         REQUIRED EXCEPTION: This is a standalone HTML response served directly by the Cloudflare Worker,
         not rendered through the Angular SPA. The @fontsource npm packages (used elsewhere in the app)
         are not available in this context. Using a CDN for this one endpoint is the only viable option.
         Privacy note: users visiting the API docs landing page may be subject to Google's font CDN
         terms. This is an accepted trade-off for the standalone developer-facing landing page only. -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
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
            --cyan:          #00D4FF;
            --cyan-glow:     rgba(0, 212, 255, 0.12);
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
        }
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
        .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1.25rem; }
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
                <div class="card-icon" aria-hidden="true">&#9670;</div>
                <div class="card-title">Scalar UI</div>
                <div class="card-desc">Modern interactive API explorer. Try requests directly in the browser with one click.</div>
                <a href="/api/docs" class="card-link">Open Scalar <span aria-hidden="true">&#8599;</span></a>
            </div>
            <div class="card">
                <div class="card-icon" aria-hidden="true">&#128218;</div>
                <div class="card-title">Swagger UI</div>
                <div class="card-desc">Classic Swagger interface. Supports all standard OpenAPI operations — familiar to most teams.</div>
                <a href="/api/swagger" class="card-link">Open Swagger <span aria-hidden="true">&#8599;</span></a>
            </div>
            <div class="card">
                <div class="card-icon" aria-hidden="true">&#128196;</div>
                <div class="card-title">ReDoc</div>
                <div class="card-desc">Three-panel reference documentation rendered with the Scalar classic layout.</div>
                <a href="/api/redoc" class="card-link">Open ReDoc <span aria-hidden="true">&#8599;</span></a>
            </div>
            <div class="card">
                <div class="card-icon" aria-hidden="true">{ }</div>
                <div class="card-title">OpenAPI Spec</div>
                <div class="card-desc">Machine-readable OpenAPI 3.0 JSON spec. Import into Insomnia, Postman, or generate a client SDK.</div>
                <a href="/api/openapi.json" class="card-link">Download JSON <span aria-hidden="true">&#8599;</span></a>
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
