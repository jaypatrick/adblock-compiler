/**
 * Static asset and SPA serving handlers for the Cloudflare Worker.
 * Serves the Angular SPA shell with client-side routing support.
 *
 * Serving logic:
 *   1. Root path (`/`) — serve the Angular SPA shell directly.
 *   2. Paths with a file extension — serve from ASSETS binding, 404 on miss.
 *   3. Extensionless paths that are NOT server-handled — SPA fallback (Angular handles routing).
 *   4. Server-handled prefixes (`/api`, `/compile`, etc.) — real 404 so errors surface correctly.
 *   5. No ASSETS binding (local dev) — serve minimal HTML fallback.
 */

import { ASSETS_BASE_URL, FILE_EXTENSION_RE, SPA_SERVER_PREFIXES } from '../utils/constants.ts';
import type { Env } from '../types.ts';

/**
 * Fetch a single asset from the ASSETS binding, following any redirects the
 * binding may issue (301 / 302 / 307 / 308).
 */
export async function fetchAssetWithRedirects(assets: Fetcher, url: URL): Promise<Response> {
    let response = await assets.fetch(url);
    if (
        response.status === 301 || response.status === 302 ||
        response.status === 307 || response.status === 308
    ) {
        const location = response.headers.get('Location');
        if (location) {
            response = await assets.fetch(new URL(location, url));
        }
    }
    return response;
}

/**
 * Return the Angular SPA shell from the ASSETS binding.
 * Tries index.html first (the canonical name produced by the postbuild script),
 * then index.csr.html (the raw Angular artifact) as a defensive fallback.
 */
export async function fetchSpaShell(assets: Fetcher): Promise<Response | null> {
    const htmlResponse = await fetchAssetWithRedirects(
        assets,
        new URL('/index.html', ASSETS_BASE_URL),
    );
    if (htmlResponse.ok) {
        return htmlResponse;
    }
    const csrResponse = await fetchAssetWithRedirects(
        assets,
        new URL('/index.csr.html', ASSETS_BASE_URL),
    );
    if (csrResponse.ok) {
        return csrResponse;
    }
    return null;
}

/**
 * Serve a static file or the Angular SPA shell.
 *
 * For extensionless paths that match client-side Angular routes, the SPA shell
 * is returned with a 200 so Angular's router can handle navigation on the client.
 * Server-handled prefixes in {@link SPA_SERVER_PREFIXES} are excluded from the
 * SPA fallback so unknown API paths still receive a 404.
 */
export async function serveStaticAsset(
    request: Request,
    env: Env,
    pathname: string,
): Promise<Response> {
    if (env.ASSETS) {
        try {
            if (pathname === '/') {
                const shell = await fetchSpaShell(env.ASSETS);
                if (shell) {
                    return shell;
                }
            }

            const response = await fetchAssetWithRedirects(
                env.ASSETS,
                new URL(pathname, ASSETS_BASE_URL),
            );

            if (response.ok) {
                return response;
            }

            const isServerPath = SPA_SERVER_PREFIXES.some(
                (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
            );

            // Server-handled prefix with no matching asset — return a real 404 so
            // unknown API/compile/queue/etc. paths are not masked as 200 HTML responses.
            if (isServerPath) {
                return new Response('Not Found', { status: 404 });
            }

            const acceptsHtml = (request.headers.get('Accept') ?? '').includes('text/html');
            if (!FILE_EXTENSION_RE.test(pathname) && acceptsHtml) {
                const shell = await fetchSpaShell(env.ASSETS);
                if (shell) {
                    return shell;
                }
            }

            // Static file miss (with extension) or SPA shell unavailable — 404.
            return new Response('Not Found', { status: 404 });
        } catch (error) {
            // deno-lint-ignore no-console
            console.error('Asset fetch error:', error);
        }
    }

    if (!FILE_EXTENSION_RE.test(pathname)) {
        return serveWebUI(request);
    }

    return new Response('Not Found', { status: 404 });
}

/**
 * Serve a minimal fallback HTML page when the ASSETS binding is not available.
 * Used in local `deno task dev` mode only.
 */
export function serveWebUI(request: Request): Response {
    const origin = new URL(request.url).origin;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Bloqr — Compile, manage, and deploy adblock filter lists at network scale. REST, streaming, and embedded library. JSON/YAML config. Fully typed.">
    <title>Bloqr — API</title>
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23070B14'/%3E%3Crect x='6' y='8' width='20' height='3' rx='2' fill='%23F1F5F9'/%3E%3Crect x='6' y='14.5' width='15' height='3' rx='2' fill='%2300D4FF'/%3E%3Crect x='6' y='21' width='8' height='3' rx='2' fill='%23FF5500'/%3E%3C/svg%3E" />
</head>
<body style="font-family: sans-serif; max-width: 800px; margin: 50px auto; padding: 20px;">
    <h1>Bloqr API</h1>
    <p>The web UI is available for local development only.</p>
    <p>To use the web interface locally, run:</p>
    <pre style="background: #f5f5f5; padding: 15px; border-radius: 5px;">deno task wrangler:dev</pre>
    <p>Then visit: <code>http://localhost:8787</code></p>
    
    <h2>API Endpoints</h2>
    <ul>
        <li><strong>GET /api</strong> - API information</li>
        <li><strong>POST /compile</strong> - Compile filter list (JSON response)</li>
        <li><strong>POST /compile/stream</strong> - Compile with real-time progress (SSE)</li>
    </ul>
    
    <h2>Example Usage</h2>
    <pre style="background: #f5f5f5; padding: 15px; border-radius: 5px;">curl -X POST ${origin}/compile \\
  -H "Content-Type: application/json" \\
  -d '{
    "configuration": {
      "name": "My Filter List",
      "sources": [
        { "source": "https://example.com/filters.txt" }
      ],
      "transformations": ["Deduplicate", "RemoveEmptyLines"]
    }
  }'</pre>
  
    <p><a href="/api-docs">View full API documentation →</a></p>
</body>
</html>`;

    return new Response(html, {
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
        },
    });
}
