/**
 * Browser-based content fetcher using Cloudflare Browser Rendering.
 *
 * Implements `IContentFetcher` by launching a real Chromium instance via the
 * Cloudflare Browser Rendering binding (BROWSER) using `@cloudflare/playwright`,
 * Cloudflare's self-contained playwright fork designed for Workers.  This is
 * useful for sources that require JavaScript execution or that rely on
 * client-side rendering to produce their final content.
 *
 * @example
 * ```typescript
 * const fetcher = new BrowserFetcher(env.BROWSER);
 * const html = await fetcher.fetch('https://example.com/filter-list');
 * ```
 *
 * @see https://developers.cloudflare.com/browser-rendering/
 */

import { launch } from '@cloudflare/playwright';
import type { BrowserWorker } from '@cloudflare/playwright';
import type { IContentFetcher } from './types.ts';

/**
 * Options for configuring the BrowserFetcher.
 */
export interface BrowserFetcherOptions {
    /** Navigation timeout in milliseconds (default: 30 000). */
    readonly timeout?: number;
    /** Wait-until condition before capturing content (default: 'networkidle'). */
    readonly waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
}

/**
 * Content fetcher that renders pages through Cloudflare Browser Rendering.
 *
 * Only handles `http://` and `https://` URLs.  Other sources (local paths,
 * `pre-fetched://` keys, etc.) are declined so a composite fetcher can fall
 * back to a plain HTTP fetcher.
 */
export class BrowserFetcher implements IContentFetcher {
    readonly #browserBinding: BrowserWorker;
    readonly #timeout: number;
    readonly #waitUntil: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

    /**
     * @param browserBinding - The `BROWSER` binding from the Worker environment.
     * @param options - Optional fetch configuration.
     */
    constructor(browserBinding: BrowserWorker, options: BrowserFetcherOptions = {}) {
        this.#browserBinding = browserBinding;
        this.#timeout = options.timeout ?? 30_000;
        this.#waitUntil = options.waitUntil ?? 'networkidle';
    }

    /** Only HTTP/HTTPS URLs are handled by the browser fetcher. */
    canHandle(source: string): boolean {
        return source.startsWith('http://') || source.startsWith('https://');
    }

    /**
     * Fetches the rendered HTML content of a page using a real browser.
     *
     * Opens a new browser page, navigates to `source`, waits for the page to
     * settle, then returns the serialised DOM.  The browser connection and page
     * are always closed — even on error — to avoid leaking sessions against the
     * Browser Rendering concurrency limit.
     *
     * @throws {Error} if the browser binding is not configured or navigation fails.
     */
    async fetch(source: string): Promise<string> {
        if (!this.#browserBinding) {
            throw new Error('BrowserFetcher requires a Cloudflare Browser Rendering binding (BROWSER) but none was provided.');
        }

        const browser = await launch(this.#browserBinding);
        try {
            const page = await browser.newPage();
            try {
                await page.goto(source, {
                    waitUntil: this.#waitUntil,
                    timeout: this.#timeout,
                });
                return await page.content();
            } finally {
                await page.close();
            }
        } finally {
            await browser.close();
        }
    }
}
