/**
 * Tests for the documentation routes.
 *
 * GET /api/docs     — Scalar UI
 * GET /api/swagger  — Swagger UI
 * GET /api/redoc    — Scalar classic / ReDoc
 * GET /             — Landing page
 * GET /api          — Landing page (same content at /api prefix)
 */

import { assertEquals, assertStringIncludes } from '@std/assert';
import { makeEnv } from '../test-helpers.ts';
import { app } from '../hono-app.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(): ExecutionContext {
    return {
        waitUntil: (_p: Promise<unknown>) => {},
        passThroughOnException: () => {},
    } as unknown as ExecutionContext;
}

async function fetchApp(
    path: string,
    options: RequestInit & { env?: ReturnType<typeof makeEnv> } = {},
): Promise<Response> {
    const { env: envOverride, ...init } = options;
    const env = envOverride ?? makeEnv();
    const request = new Request(`https://worker.example.com${path}`, init);
    return app.fetch(request, env, makeCtx());
}

// ── GET /api/docs — Scalar UI ─────────────────────────────────────────────────

Deno.test('GET /api/docs returns 200 and HTML content', async () => {
    const res = await fetchApp('/api/docs');
    assertEquals(res.status, 200);
    const contentType = res.headers.get('Content-Type');
    assertEquals(contentType?.includes('text/html'), true);
});

Deno.test('GET /api/docs returns Scalar UI page', async () => {
    const res = await fetchApp('/api/docs');
    const html = await res.text();
    // Scalar UI should contain Bloqr branding
    assertEquals(html.includes('Bloqr \u2014 API'), true);
});

Deno.test('GET /api/docs page title is "Bloqr — API Documentation"', async () => {
    const res = await fetchApp('/api/docs');
    const html = await res.text();
    assertStringIncludes(html, 'Bloqr \u2014 API Documentation');
});

Deno.test('GET /api/docs page uses /favicon.svg', async () => {
    const res = await fetchApp('/api/docs');
    const html = await res.text();
    assertStringIncludes(html, '/favicon.svg');
});

Deno.test('GET /api/docs includes Open Graph metadata', async () => {
    const res = await fetchApp('/api/docs');
    const html = await res.text();
    assertStringIncludes(html, '"ogTitle": "Bloqr — API Documentation"');
    assertStringIncludes(html, '"ogImage": "/apple-touch-icon.png"');
    assertStringIncludes(html, '"twitterCard": "summary_large_image"');
});

Deno.test('GET /api/docs is publicly accessible (no auth required)', async () => {
    // Should not return 401 for anonymous users
    const res = await fetchApp('/api/docs');
    assertEquals(res.status !== 401 && res.status !== 403, true);
});

// ── GET /api/swagger — Swagger UI ─────────────────────────────────────────────

Deno.test('GET /api/swagger returns 200 and HTML content', async () => {
    const res = await fetchApp('/api/swagger');
    assertEquals(res.status, 200);
    const contentType = res.headers.get('Content-Type');
    assertEquals(contentType?.includes('text/html'), true);
});

Deno.test('GET /api/swagger returns Swagger UI page', async () => {
    const res = await fetchApp('/api/swagger');
    const html = await res.text();
    // Swagger UI should contain these markers
    assertEquals(html.includes('swagger-ui'), true);
});

Deno.test('GET /api/swagger HTML includes required Swagger UI CDN assets', async () => {
    const res = await fetchApp('/api/swagger');
    const html = await res.text();
    // Both scripts are required: bundle provides SwaggerUIBundle, standalone-preset provides
    // SwaggerUIStandalonePreset which is needed for StandaloneLayout.
    assertStringIncludes(html, 'swagger-ui-bundle.js');
    assertStringIncludes(html, 'swagger-ui-standalone-preset.js');
    assertStringIncludes(html, 'swagger-ui.css');
});

Deno.test('GET /api/swagger is publicly accessible (no auth required)', async () => {
    // Should not return 401 for anonymous users
    const res = await fetchApp('/api/swagger');
    assertEquals(res.status !== 401 && res.status !== 403, true);
});

Deno.test('GET /api/swagger page title is "Bloqr — API — Swagger"', async () => {
    const res = await fetchApp('/api/swagger');
    const html = await res.text();
    assertStringIncludes(html, 'Bloqr \u2014 API \u2014 Swagger');
});

Deno.test('GET /api/swagger page uses /favicon.svg', async () => {
    const res = await fetchApp('/api/swagger');
    const html = await res.text();
    assertStringIncludes(html, '/favicon.svg');
});

Deno.test('GET /api/swagger includes Open Graph metadata', async () => {
    const res = await fetchApp('/api/swagger');
    const html = await res.text();
    assertStringIncludes(html, 'property="og:title" content="Bloqr — API — Swagger"');
    assertStringIncludes(html, 'property="og:image" content="/apple-touch-icon.png"');
    assertStringIncludes(html, 'name="twitter:card" content="summary_large_image"');
});

// ── GET /api/redoc — Scalar classic / ReDoc ───────────────────────────────────

Deno.test('GET /api/redoc returns 200 and HTML content', async () => {
    const res = await fetchApp('/api/redoc');
    assertEquals(res.status, 200);
    const contentType = res.headers.get('Content-Type');
    assertEquals(contentType?.includes('text/html'), true);
});

Deno.test('GET /api/redoc is publicly accessible (no auth required)', async () => {
    const res = await fetchApp('/api/redoc');
    assertEquals(res.status !== 401 && res.status !== 403, true);
});

Deno.test('GET /api/redoc/ (trailing slash) returns 200 and HTML', async () => {
    const res = await fetchApp('/api/redoc/');
    assertEquals(res.status, 200);
    const contentType = res.headers.get('Content-Type');
    assertEquals(contentType?.includes('text/html'), true);
});

Deno.test('GET /api/redoc/ is publicly accessible (no auth required)', async () => {
    const res = await fetchApp('/api/redoc/');
    assertEquals(res.status !== 401 && res.status !== 403, true);
});

Deno.test('GET /api/redoc page title is "Bloqr — API Reference"', async () => {
    const res = await fetchApp('/api/redoc');
    const html = await res.text();
    assertStringIncludes(html, 'Bloqr \u2014 API Reference');
});

Deno.test('GET /api/redoc page uses /favicon.svg', async () => {
    const res = await fetchApp('/api/redoc');
    const html = await res.text();
    assertStringIncludes(html, '/favicon.svg');
});

Deno.test('GET /api/redoc includes Open Graph metadata', async () => {
    const res = await fetchApp('/api/redoc');
    const html = await res.text();
    assertStringIncludes(html, '"ogTitle": "Bloqr — API Reference"');
    assertStringIncludes(html, '"ogImage": "/apple-touch-icon.png"');
    assertStringIncludes(html, '"twitterCard": "summary_large_image"');
});

// ── GET / — Landing page ──────────────────────────────────────────────────────

Deno.test('GET / returns 200 and HTML (landing page)', async () => {
    const res = await fetchApp('/');
    assertEquals(res.status, 200);
    const contentType = res.headers.get('Content-Type');
    assertEquals(contentType?.includes('text/html'), true);
});

Deno.test('GET / landing page contains Bloqr API branding', async () => {
    const res = await fetchApp('/');
    const html = await res.text();
    assertStringIncludes(html, 'Bloqr API');
});

Deno.test('GET / landing page links to Scalar docs', async () => {
    const res = await fetchApp('/');
    const html = await res.text();
    assertStringIncludes(html, '/api/docs');
});

Deno.test('GET / landing page links to Swagger docs', async () => {
    const res = await fetchApp('/');
    const html = await res.text();
    assertStringIncludes(html, '/api/swagger');
});

Deno.test('GET / landing page links to ReDoc', async () => {
    const res = await fetchApp('/');
    const html = await res.text();
    assertStringIncludes(html, '/api/redoc');
});

Deno.test('GET / landing page links to OpenAPI spec', async () => {
    const res = await fetchApp('/');
    const html = await res.text();
    assertStringIncludes(html, '/api/openapi.json');
});

Deno.test('GET / is publicly accessible (no auth required)', async () => {
    const res = await fetchApp('/');
    assertEquals(res.status !== 401 && res.status !== 403, true);
});

Deno.test('GET / landing page title is "Bloqr — API"', async () => {
    const res = await fetchApp('/');
    const html = await res.text();
    // The <h1> says "Bloqr API" (no em dash); the <title> is "Bloqr — API".
    assertStringIncludes(html, '<title>Bloqr \u2014 API</title>');
});

Deno.test('GET / landing page uses /favicon.svg', async () => {
    const res = await fetchApp('/');
    const html = await res.text();
    assertStringIncludes(html, '/favicon.svg');
});

Deno.test('GET / landing page includes Open Graph metadata', async () => {
    const res = await fetchApp('/');
    const html = await res.text();
    assertStringIncludes(html, 'property="og:title" content="Bloqr — API"');
    assertStringIncludes(html, 'property="og:image" content="/apple-touch-icon.png"');
    assertStringIncludes(html, 'name="twitter:card" content="summary_large_image"');
});

// ── GET /api — Landing page (same content) ────────────────────────────────────

Deno.test('GET /api returns 200 and HTML (landing page)', async () => {
    const res = await fetchApp('/api');
    assertEquals(res.status, 200);
    const contentType = res.headers.get('Content-Type');
    assertEquals(contentType?.includes('text/html'), true);
});

Deno.test('GET /api landing page contains Bloqr API branding', async () => {
    const res = await fetchApp('/api');
    const html = await res.text();
    assertStringIncludes(html, 'Bloqr API');
});

Deno.test('GET /api is publicly accessible (no auth required)', async () => {
    const res = await fetchApp('/api');
    assertEquals(res.status !== 401 && res.status !== 403, true);
});

// ── Trailing slash and subpath variants ───────────────────────────────────────

Deno.test('GET /api/docs/ (trailing slash) returns 200 and HTML content', async () => {
    const res = await fetchApp('/api/docs/');
    assertEquals(res.status, 200);
    const contentType = res.headers.get('Content-Type');
    assertEquals(contentType?.includes('text/html'), true);
});

Deno.test('GET /api/docs/ is publicly accessible (no auth required)', async () => {
    const res = await fetchApp('/api/docs/');
    assertEquals(res.status !== 401 && res.status !== 403, true);
});

Deno.test('GET /api/swagger/ (trailing slash) returns 200 and HTML content', async () => {
    const res = await fetchApp('/api/swagger/');
    assertEquals(res.status, 200);
    const contentType = res.headers.get('Content-Type');
    assertEquals(contentType?.includes('text/html'), true);
});

Deno.test('GET /api/swagger/ is publicly accessible (no auth required)', async () => {
    const res = await fetchApp('/api/swagger/');
    assertEquals(res.status !== 401 && res.status !== 403, true);
});
