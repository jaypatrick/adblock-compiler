/**
 * Tests for the static-asset and SPA-shell serving utilities.
 *
 * Covers:
 *   - fetchAssetWithRedirects: follows a 301 redirect
 *   - fetchAssetWithRedirects: returns a non-redirect response directly
 *   - serveWebUI: returns 200 with Content-Type text/html; charset=utf-8
 *   - serveWebUI: body contains "Bloqr"
 *   - serveStaticAsset: root "/" with ASSETS serves the SPA shell
 *   - serveStaticAsset: server-prefix path (/api/…) returns 404
 *   - serveStaticAsset: extensionless path with Accept:text/html serves SPA shell
 *   - serveStaticAsset: file-extension miss returns 404
 *   - serveStaticAsset: no ASSETS + extensionless path returns serveWebUI HTML
 *   - serveStaticAsset: no ASSETS + extension path returns 404
 *
 * @see worker/handlers/assets.ts
 */

import { assertEquals } from '@std/assert';
import { fetchAssetWithRedirects, serveStaticAsset, serveWebUI } from './assets.ts';
import { makeEnv } from '../test-helpers.ts';

// ============================================================================
// Fixtures
// ============================================================================

/**
 * Minimal Fetcher stub: calls handler(url) for every fetch().
 * Handles the URL | Request | string union that Fetcher.fetch() accepts.
 */
function makeUrlFetcher(handler: (url: URL) => Response): Fetcher {
    return {
        fetch: async (input: string | Request | URL) => {
            let url: URL;
            if (input instanceof URL) {
                url = input;
            } else if (typeof input === 'string') {
                url = new URL(input);
            } else {
                url = new URL((input as Request).url);
            }
            return handler(url);
        },
    } as unknown as Fetcher;
}

// ============================================================================
// fetchAssetWithRedirects
// ============================================================================

Deno.test('fetchAssetWithRedirects - follows a 301 redirect', async () => {
    let callCount = 0;
    const fetcher = makeUrlFetcher((url) => {
        callCount++;
        if (url.pathname === '/original') {
            return new Response(null, { status: 301, headers: { Location: 'http://assets/redirected' } });
        }
        return new Response('redirect target', { status: 200 });
    });

    const res = await fetchAssetWithRedirects(fetcher, new URL('http://assets/original'));
    assertEquals(res.status, 200);
    assertEquals(callCount, 2);
});

Deno.test('fetchAssetWithRedirects - returns non-redirect response directly', async () => {
    let callCount = 0;
    const fetcher = makeUrlFetcher((_url) => {
        callCount++;
        return new Response('ok', { status: 200 });
    });

    const res = await fetchAssetWithRedirects(fetcher, new URL('http://assets/style.css'));
    assertEquals(res.status, 200);
    assertEquals(callCount, 1);
});

// ============================================================================
// serveWebUI
// ============================================================================

Deno.test('serveWebUI - returns 200 with Content-Type text/html; charset=utf-8', () => {
    const res = serveWebUI(new Request('http://localhost/'));
    assertEquals(res.status, 200);
    assertEquals(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
});

Deno.test('serveWebUI - body contains "Bloqr"', async () => {
    const res = serveWebUI(new Request('http://localhost/'));
    const body = await res.text();
    assertEquals(body.includes('Bloqr'), true);
});

// ============================================================================
// serveStaticAsset
// ============================================================================

Deno.test('serveStaticAsset - root "/" with ASSETS serves the SPA shell', async () => {
    const fetcher = makeUrlFetcher((url) => {
        if (url.pathname === '/index.html') {
            return new Response('<html><head><title>App</title></head></html>', {
                status: 200,
                headers: { 'Content-Type': 'text/html' },
            });
        }
        return new Response('Not Found', { status: 404 });
    });
    const env = makeEnv({ ASSETS: fetcher });
    const res = await serveStaticAsset(new Request('http://localhost/'), env, '/');
    assertEquals(res.status, 200);
});

Deno.test('serveStaticAsset - server-prefix path /api/unknown returns 404', async () => {
    const fetcher = makeUrlFetcher((_url) => new Response('Not Found', { status: 404 }));
    const env = makeEnv({ ASSETS: fetcher });
    const res = await serveStaticAsset(new Request('http://localhost/api/unknown'), env, '/api/unknown');
    assertEquals(res.status, 404);
});

Deno.test('serveStaticAsset - extensionless path with Accept:text/html serves SPA shell', async () => {
    const fetcher = makeUrlFetcher((url) => {
        if (url.pathname === '/index.html') {
            return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
        }
        return new Response('Not Found', { status: 404 });
    });
    const env = makeEnv({ ASSETS: fetcher });
    const req = new Request('http://localhost/dashboard', { headers: { Accept: 'text/html,*/*' } });
    const res = await serveStaticAsset(req, env, '/dashboard');
    assertEquals(res.status, 200);
});

Deno.test('serveStaticAsset - file-extension miss returns 404', async () => {
    const fetcher = makeUrlFetcher((_url) => new Response('Not Found', { status: 404 }));
    const env = makeEnv({ ASSETS: fetcher });
    const res = await serveStaticAsset(new Request('http://localhost/app.abc123.js'), env, '/app.abc123.js');
    assertEquals(res.status, 404);
});

Deno.test('serveStaticAsset - no ASSETS + extensionless path returns serveWebUI HTML', async () => {
    const env = makeEnv(); // no ASSETS binding
    const res = await serveStaticAsset(new Request('http://localhost/about'), env, '/about');
    assertEquals(res.status, 200);
    assertEquals(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
});

Deno.test('serveStaticAsset - no ASSETS + extension path returns 404', async () => {
    const env = makeEnv();
    const res = await serveStaticAsset(new Request('http://localhost/style.css'), env, '/style.css');
    assertEquals(res.status, 404);
});
