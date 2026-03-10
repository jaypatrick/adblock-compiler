/**
 * Browser Rendering utility functions for the Cloudflare Worker.
 *
 * Exposes three composable utilities that power the `/browser/*` endpoints and
 * can be called directly from other handler modules.
 *
 * All three functions require the `BROWSER` binding (Cloudflare Browser
 * Rendering).  Callers are responsible for checking that the binding exists
 * before invoking these utilities.
 *
 * IMPORTANT — playwright-core dependency:
 * playwright-core is managed via PNPM (package.json devDependencies) and is
 * NOT in deno.json's import map.  It is imported DYNAMICALLY inside
 * acquireBrowser() so that Deno's module graph never eagerly loads it during
 * type-checking or test runs (playwright-core calls os.release() at module
 * initialisation, which requires --allow-sys).  The wrangler/esbuild bundle
 * step resolves the dynamic import from node_modules at build time.
 *
 * @see worker/handlers/url-resolver.ts — POST /browser/resolve-url
 * @see worker/handlers/source-monitor.ts — POST /browser/monitor
 * @see https://developers.cloudflare.com/browser-rendering/platform/playwright/
 */

import type { BrowserWorker } from '../cloudflare-workers-shim.ts';

// ============================================================================
// Shared helpers
// ============================================================================

/**
 * Extracts plain-text content from a rendered page.
 * Prefers the first `<pre>` element (standard filter list delivery),
 * then falls back to the full `<body>` text.
 *
 * Defined as a constant so both `fetchWithBrowser` and `BrowserFetcher` use
 * the same extraction script without duplication.
 */
const EXTRACT_TEXT_SCRIPT = `
    (() => {
        const pre = document.querySelector('pre');
        if (pre) return pre.innerText || '';
        const body = document.body;
        return body ? (body.innerText || '') : (document.documentElement.innerText || '');
    })()
`;

/**
 * Converts a Uint8Array to a Base-64 string using a chunked approach to avoid
 * stack overflows that occur when spreading large arrays into String.fromCharCode.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
    const CHUNK_SIZE = 8192;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
    }
    return btoa(binary);
}

// ============================================================================
// Types
// ============================================================================

/** Options for fetchWithBrowser */
export interface FetchWithBrowserOptions {
    /** Navigation timeout in milliseconds. @default 30000 */
    timeout?: number;
    /** When to consider navigation complete. @default 'networkidle' */
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
    /** Return full HTML instead of extracted plain text. @default false */
    extractFullHtml?: boolean;
}

/** Result of resolveCanonicalUrl */
export interface CanonicalUrlResult {
    /** The final URL after all redirects (including JS-triggered ones). */
    canonical: string;
    /** Number of URL changes observed during navigation. */
    hops: number;
}

/** Result of takeSourceScreenshot */
export interface ScreenshotResult {
    /** Base-64 encoded PNG screenshot of the full page. */
    screenshotBase64: string;
    /** R2 object key if the screenshot was stored, undefined otherwise. */
    storedKey?: string;
}

// Minimal Playwright interfaces used by this module.
// playwright-core is imported dynamically to avoid Deno's module graph
// loading it at require-time (playwright-core calls os.release() on load).
interface IPlaywrightPage {
    goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
    url(): string;
    content(): Promise<string>;
    evaluate(script: string): Promise<unknown>;
    screenshot(opts: { fullPage?: boolean; type?: string }): Promise<Uint8Array>;
    close(): Promise<void>;
}

interface IPlaywrightBrowser {
    newPage(): Promise<IPlaywrightPage>;
    close(): Promise<void>;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Acquires a Playwright Browser by connecting over CDP to the Browser Rendering
 * session obtained from the `BROWSER` binding's acquire endpoint.
 *
 * playwright-core is loaded via dynamic import so that Deno's static module
 * graph never includes it (avoids the os.release() initialisation side-effect
 * that fails without --allow-sys).  The wrangler esbuild bundler resolves the
 * dynamic import from PNPM's node_modules at Worker build time.
 */
async function acquireBrowser(binding: BrowserWorker, timeout: number): Promise<IPlaywrightBrowser> {
    const sessionResp = await binding.fetch(
        new Request('https://workers-binding.browser/acquire', { method: 'POST' }),
    );
    if (!sessionResp.ok) {
        throw new Error(`Browser Rendering acquire failed with status ${sessionResp.status}`);
    }
    const { webSocketDebuggerUrl } = (await sessionResp.json()) as { webSocketDebuggerUrl: string };

    // Dynamic import: evaluated only at call time, not at module load time.
    // playwright-core is a PNPM devDependency; esbuild bundles it into the Worker.
    // The `as unknown as` double-assertion is intentional: playwright-core is NOT
    // in deno.json (removed to prevent the package's os.release() side-effect from
    // failing Deno tests), so its static types are unavailable to the Deno compiler.
    // The local IPlaywrightBrowser interface defines the exact surface we use.
    const { chromium } = (await import('playwright-core')) as unknown as {
        chromium: {
            connectOverCDP(url: string, opts: { timeout: number }): Promise<IPlaywrightBrowser>;
        };
    };
    return chromium.connectOverCDP(webSocketDebuggerUrl, { timeout });
}

// ============================================================================
// resolveCanonicalUrl
// ============================================================================

/**
 * Resolves the canonical URL of a given address by following all redirects —
 * including JS-triggered ones — in a headless browser.
 *
 * WHY: Some filter-list distributors use short links, CDN redirects, or mirror
 * systems.  `fetch()` follows HTTP redirects but cannot follow JS-triggered
 * ones.  This function uses a real browser and returns `page.url()` after
 * `networkidle`, which reflects the final destination after the full redirect
 * chain.  Caching this canonical URL in D1 or KV reduces redirect hops on
 * every compilation run.
 *
 * @param binding - The `BROWSER` binding from the Worker env.
 * @param url - The URL to resolve.
 * @param timeout - Navigation timeout in ms. @default 30000
 * @returns `{ canonical, hops }` — the final URL and number of URL changes.
 */
export async function resolveCanonicalUrl(
    binding: BrowserWorker,
    url: string,
    timeout = 30_000,
): Promise<CanonicalUrlResult> {
    const browser = await acquireBrowser(binding, timeout);
    const page = await browser.newPage();

    try {
        await page.goto(url, { waitUntil: 'networkidle', timeout });

        const finalUrl = page.url();
        // Hops: 0 if the final URL matches the input, 1 if it changed.
        // (Deep hop counting would require request interception, which adds
        //  complexity for marginal value in this use case.)
        const hops = finalUrl === url ? 0 : 1;

        return { canonical: finalUrl, hops };
    } finally {
        await browser.close();
    }
}

// ============================================================================
// takeSourceScreenshot
// ============================================================================

/**
 * Takes a full-page PNG screenshot of a URL and optionally stores it to R2.
 *
 * WHY: Gives proactive visibility into source health.  Detects when a source
 * has gone behind a paywall, shows an error page, or changed structure before
 * a compile run fails.  Screenshots are stored under the key pattern:
 *   `screenshots/<hostname>/<YYYY-MM-DD>.png`
 *
 * @param binding - The `BROWSER` binding from the Worker env.
 * @param url - The URL to screenshot.
 * @param r2Bucket - Optional R2 bucket to persist the screenshot.
 * @param timeout - Navigation timeout in ms. @default 30000
 * @returns `{ screenshotBase64, storedKey? }`.
 */
export async function takeSourceScreenshot(
    binding: BrowserWorker,
    url: string,
    r2Bucket?: R2Bucket,
    timeout = 30_000,
): Promise<ScreenshotResult> {
    const browser = await acquireBrowser(binding, timeout);
    const page = await browser.newPage();

    try {
        await page.goto(url, { waitUntil: 'networkidle', timeout });

        const screenshotBytes = await page.screenshot({ fullPage: true, type: 'png' });
        const screenshotBase64 = uint8ArrayToBase64(screenshotBytes);

        let storedKey: string | undefined;
        if (r2Bucket) {
            const hostname = new URL(url).hostname;
            const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
            storedKey = `screenshots/${hostname}/${date}.png`;
            await r2Bucket.put(storedKey, screenshotBytes, {
                httpMetadata: { contentType: 'image/png' },
            });
        }

        return { screenshotBase64, storedKey };
    } finally {
        await browser.close();
    }
}

// ============================================================================
// fetchWithBrowser
// ============================================================================

/**
 * One-shot utility that fetches the rendered text content of a URL using
 * Cloudflare Browser Rendering.
 *
 * WHY: Drop-in companion to plain `fetch()` for JS-rendered pages in Worker
 * request handlers where dependency injection is less convenient than
 * instantiating a full BrowserFetcher.  Internally, it uses the same
 * Playwright-over-CDP pattern as BrowserFetcher.
 *
 * For compilation pipelines, prefer `BrowserFetcher` with `CompositeFetcher`
 * instead of calling this directly.
 *
 * @param binding - The `BROWSER` binding from the Worker env.
 * @param url - The URL to fetch.
 * @param options - Optional navigation options.
 * @returns The rendered page text (or full HTML when extractFullHtml is true).
 */
export async function fetchWithBrowser(
    binding: BrowserWorker,
    url: string,
    options: FetchWithBrowserOptions = {},
): Promise<string> {
    const timeout = options.timeout ?? 30_000;
    const waitUntil = options.waitUntil ?? 'networkidle';
    const extractFullHtml = options.extractFullHtml ?? false;

    const browser = await acquireBrowser(binding, timeout);
    const page = await browser.newPage();

    try {
        await page.goto(url, { waitUntil, timeout });

        if (extractFullHtml) {
            return await page.content();
        }

        const text = (await page.evaluate(EXTRACT_TEXT_SCRIPT)) as string;

        return text;
    } finally {
        await browser.close();
    }
}
