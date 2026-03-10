/**
 * Browser Rendering utilities for Cloudflare Workers.
 *
 * Provides low-level helpers that use Cloudflare Browser Rendering (via the
 * BROWSER binding and `@cloudflare/playwright` CDP) to:
 *   - Resolve the canonical URL of a page after all redirects.
 *   - Fetch the rendered HTML of a page.
 *   - Capture a full-page screenshot as PNG bytes.
 *
 * `@cloudflare/playwright` is Cloudflare's self-contained playwright fork
 * bundled for the Workers runtime.  It does not need to be marked external
 * and bundles correctly with wrangler.
 *
 * @see https://developers.cloudflare.com/browser-rendering/
 */

import { launch } from '@cloudflare/playwright';
import type { BrowserWorker } from '../cloudflare-workers-shim.ts';

/** Default navigation timeout (ms). */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Shared navigation options factory.
 * Centralises waitUntil and timeout so all helpers behave consistently.
 */
function navOptions(timeoutMs: number) {
    return { waitUntil: 'networkidle' as const, timeout: timeoutMs };
}

/**
 * Resolves the final canonical URL of a page after all redirects and any
 * JavaScript-driven navigation.
 *
 * @param browserBinding - The `BROWSER` binding from the Worker environment.
 * @param url - The URL to resolve.
 * @param timeoutMs - Optional navigation timeout in milliseconds.
 * @returns The resolved URL string.
 */
export async function resolveCanonicalUrl(
    browserBinding: BrowserWorker,
    url: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
    const browser = await launch(browserBinding);
    try {
        const page = await browser.newPage();
        try {
            await page.goto(url, navOptions(timeoutMs));
            return page.url();
        } finally {
            await page.close();
        }
    } finally {
        await browser.close();
    }
}

/**
 * Fetches the rendered HTML content of a page using a real browser.
 *
 * @param browserBinding - The `BROWSER` binding from the Worker environment.
 * @param url - The URL to fetch.
 * @param timeoutMs - Optional navigation timeout in milliseconds.
 * @returns The serialised DOM of the page as an HTML string.
 */
export async function fetchWithBrowser(
    browserBinding: BrowserWorker,
    url: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
    const browser = await launch(browserBinding);
    try {
        const page = await browser.newPage();
        try {
            await page.goto(url, navOptions(timeoutMs));
            return await page.content();
        } finally {
            await page.close();
        }
    } finally {
        await browser.close();
    }
}

/**
 * Captures a full-page screenshot of a URL and returns the PNG bytes.
 *
 * @param browserBinding - The `BROWSER` binding from the Worker environment.
 * @param url - The URL to screenshot.
 * @param timeoutMs - Optional navigation timeout in milliseconds.
 * @returns PNG image as a `Uint8Array`.
 */
export async function takeSourceScreenshot(
    browserBinding: BrowserWorker,
    url: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Uint8Array> {
    const browser = await launch(browserBinding);
    try {
        const page = await browser.newPage();
        try {
            await page.goto(url, navOptions(timeoutMs));
            return await page.screenshot({ fullPage: true });
        } finally {
            await page.close();
        }
    } finally {
        await browser.close();
    }
}
