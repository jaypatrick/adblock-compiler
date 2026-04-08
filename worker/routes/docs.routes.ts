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
 * Completely inline HTML/CSS — no external CDN dependencies.
 * Purple/violet palette, dark theme, responsive layout.
 */
export function docsLandingHandler(env: Env): Response {
    const urls = getProjectUrls(env);
    const version = (env as { COMPILER_VERSION?: string }).COMPILER_VERSION ?? '—';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bloqr API</title>
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
            --bg:        #0d0d14;
            --surface:   #16162a;
            --border:    #2a2a45;
            --purple:    #7c3aed;
            --violet:    #6d28d9;
            --purple-lt: #a78bfa;
            --text:      #e2e2f0;
            --muted:     #8888aa;
            --radius:    12px;
        }
        html, body { background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; min-height: 100vh; }
        a { color: var(--purple-lt); text-decoration: none; }
        a:hover { text-decoration: underline; }

        /* ── Header ─── */
        .hero {
            background: linear-gradient(135deg, #1a0533 0%, #130d3a 50%, #0a1a3a 100%);
            border-bottom: 1px solid var(--border);
            padding: 3.5rem 2rem 3rem;
            text-align: center;
        }
        .hero-badge {
            display: inline-block;
            background: rgba(124, 58, 237, 0.2);
            border: 1px solid rgba(124, 58, 237, 0.5);
            border-radius: 999px;
            padding: 0.25rem 1rem;
            font-size: 0.78rem;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--purple-lt);
            margin-bottom: 1.25rem;
        }
        .hero h1 { font-size: clamp(1.8rem, 5vw, 3rem); font-weight: 800; letter-spacing: -0.02em; line-height: 1.15; }
        .hero h1 span { background: linear-gradient(90deg, #c084fc, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .hero p { margin-top: 1rem; color: var(--muted); font-size: 1.05rem; max-width: 560px; margin-inline: auto; line-height: 1.65; }
        .hero-links { margin-top: 2rem; display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
        .hero-links a {
            display: inline-flex; align-items: center; gap: 0.4rem;
            padding: 0.5rem 1.1rem; border-radius: 8px; font-size: 0.88rem; font-weight: 500;
            transition: opacity 0.15s;
        }
        .hero-links a:hover { opacity: 0.85; text-decoration: none; }
        .btn-primary { background: var(--purple); color: #fff; }
        .btn-outline { border: 1px solid var(--border); color: var(--text); background: transparent; }

        /* ── Cards ─── */
        .container { max-width: 900px; margin: 0 auto; padding: 3rem 1.5rem; }
        .section-title { font-size: 0.8rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin-bottom: 1.25rem; }
        .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1.25rem; }
        .card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 1.5rem;
            transition: border-color 0.18s, transform 0.18s;
        }
        .card:hover { border-color: var(--purple); transform: translateY(-2px); }
        .card-icon { font-size: 1.6rem; margin-bottom: 0.75rem; }
        .card-title { font-size: 1rem; font-weight: 700; margin-bottom: 0.3rem; }
        .card-desc { font-size: 0.85rem; color: var(--muted); line-height: 1.6; margin-bottom: 1rem; }
        .card-link {
            display: inline-flex; align-items: center; gap: 0.3rem;
            font-size: 0.82rem; font-weight: 600; color: var(--purple-lt);
            padding: 0.35rem 0.85rem;
            border: 1px solid rgba(167, 139, 250, 0.35);
            border-radius: 6px;
            transition: background 0.15s;
        }
        .card-link:hover { background: rgba(124, 58, 237, 0.15); text-decoration: none; }

        /* ── Status ─── */
        .status-bar {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 0.75rem 1.25rem;
            display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
            margin-top: 2.5rem; font-size: 0.85rem;
        }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; flex-shrink: 0; }
        .status-label { color: var(--muted); }
        .status-value { color: var(--text); font-weight: 600; }
        .status-sep { color: var(--border); }

        /* ── Footer ─── */
        footer { text-align: center; color: var(--muted); font-size: 0.8rem; padding: 2rem 1rem 3rem; }
        footer a { color: var(--muted); }
        footer a:hover { color: var(--purple-lt); }

        @media (max-width: 480px) {
            .hero { padding: 2.5rem 1.25rem 2rem; }
            .container { padding: 2rem 1rem; }
        }
    </style>
</head>
<body>
    <header class="hero">
        <div class="hero-badge">API v1 &nbsp;·&nbsp; OpenAPI 3.0</div>
        <h1><span>Bloqr API</span></h1>
        <p>Adblock &amp; Privacy Filter <strong>Compiler-as-a-Service</strong> — transform, optimize, and combine filter lists from multiple sources in real time.</p>
        <nav class="hero-links">
            <a href="/api/docs" class="btn-primary"><span aria-hidden="true">&#9654;</span> Try the API</a>
            <a href="${urls.frontend}" class="btn-outline"><span aria-hidden="true">&#9670;</span> Open App</a>
            <a href="${urls.docs}" class="btn-outline"><span aria-hidden="true">&#128196;</span> Docs</a>
            <a href="${urls.landing}" class="btn-outline"><span aria-hidden="true">&#8962;</span> Home</a>
        </nav>
    </header>

    <main class="container">
        <p class="section-title">Documentation UIs</p>
        <div class="cards">
            <div class="card">
                <div class="card-icon" aria-hidden="true">&#9670;</div>
                <div class="card-title">Scalar UI</div>
                <div class="card-desc">Modern interactive API explorer with a clean purple theme. Try requests directly in the browser.</div>
                <a href="/api/docs" class="card-link">Open Scalar <span aria-hidden="true">&#8599;</span></a>
            </div>
            <div class="card">
                <div class="card-icon" aria-hidden="true">&#128218;</div>
                <div class="card-title">Swagger UI</div>
                <div class="card-desc">Classic Swagger interface — familiar to most API developers. Supports all standard OpenAPI operations.</div>
                <a href="/api/swagger" class="card-link">Open Swagger <span aria-hidden="true">&#8599;</span></a>
            </div>
            <div class="card">
                <div class="card-icon" aria-hidden="true">&#128196;</div>
                <div class="card-title">ReDoc</div>
                <div class="card-desc">Three-panel reference documentation rendered with the Scalar classic layout for easy navigation.</div>
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
        <a href="${urls.docs}">mdBook Docs</a> &middot;
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
