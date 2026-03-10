/**
 * BrowserFetcher — IContentFetcher implementation backed by Cloudflare Browser Rendering.
 *
 * WHY THIS EXISTS:
 * Many modern filter-list hosts render their download links or content
 * dynamically via JavaScript.  A plain `fetch()` call retrieves the raw HTML
 * skeleton with no rules inside.  BrowserFetcher launches a real Chromium
 * instance through the Cloudflare Browser Rendering binding (via Playwright),
 * waits for the page to reach network-idle, then extracts the fully-rendered
 * text content.
 *
 * WHY PLAYWRIGHT (not @cloudflare/puppeteer):
 * - Playwright is already in this project's dependency graph via
 *   `@cloudflare/playwright-mcp`; no new top-level dependency needed.
 * - Cloudflare now recommends Playwright as the preferred path for new
 *   Browser Rendering integrations.
 * - Keeps a single mental model for all browser automation in this project
 *   (the MCP agent, BrowserFetcher, and browser handler utilities all use
 *   the same Playwright-over-CDP pattern).
 *
 * WHEN TO USE:
 * - Source URL returns an HTML page instead of a plain-text filter list.
 * - Source URL requires a JS-triggered redirect (e.g. GitHub releases, custom
 *   download portals with JS-based auth tokens).
 * - Source URL sits behind a cookie-consent or lazy-loading interstitial.
 *
 * WHEN NOT TO USE:
 * - Static .txt / .dat filter files — use HttpFetcher (faster, cheaper).
 * - GitHub raw content URLs — use HttpFetcher.
 *
 * DESIGN:
 * Implements IContentFetcher so it drops cleanly into PlatformDownloader's
 * dependency-injection slot and into any CompositeFetcher chain.
 * canHandle() returns true only for http/https URLs to avoid accidentally
 * launching a browser for local file paths.
 *
 * The `@cloudflare/playwright` package is NOT imported directly here because it
 * is a Worker-specific runtime package that cannot be used in JSR-published Deno
 * code.  Instead, callers pass a `connector` function that wraps `launch` from
 * `@cloudflare/playwright` (their own environment where it is a PNPM dep).
 *
 * @see https://developers.cloudflare.com/browser-rendering/platform/playwright/
 * @see src/platform/types.ts — IContentFetcher
 * @see src/platform/CompositeFetcher.ts — chain this after HttpFetcher for fallback
 */

import type { IContentFetcher } from './types.ts';
import { NetworkError } from '../utils/ErrorUtils.ts';

/**
 * JavaScript snippet executed inside the browser page to extract plain text.
 * Prefers the first `<pre>` element (standard filter list delivery), then
 * falls back to the full `<body>` text.  Always returns a string.
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
 * Options for controlling browser-based content fetching.
 */
export interface BrowserFetcherOptions {
    /**
     * Navigation timeout in milliseconds.
     * @default 30000
     */
    timeout?: number;

    /**
     * When to consider the navigation complete.
     * - `'networkidle'`: No more than 0 network connections for 500ms (recommended for filter lists).
     * - `'load'`: The `load` event fires.
     * - `'domcontentloaded'`: The `DOMContentLoaded` event fires.
     * @default 'networkidle'
     */
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

    /**
     * When true, returns the full rendered HTML instead of extracted plain text.
     * Use this when the filter list is embedded in an HTML page structure.
     * @default false
     */
    extractFullHtml?: boolean;
}

/**
 * Browser Worker binding for Cloudflare Browser Rendering.
 * Provides a Fetcher interface used to acquire a CDP-accessible browser session.
 */
interface IBrowserWorker {
    fetch: typeof fetch;
}

/**
 * Minimal interface for a Playwright Page, covering only the operations used
 * by BrowserFetcher.  Defined locally so the JSR-published library has no
 * dependency on the `@cloudflare/playwright` npm package.
 */
export interface IPlaywrightPage {
    goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
    content(): Promise<string>;
    evaluate(script: string): Promise<unknown>;
    close(): Promise<void>;
}

/**
 * Minimal interface for a Playwright Browser, covering only the operations used
 * by BrowserFetcher.
 */
export interface IPlaywrightBrowser {
    newPage(): Promise<IPlaywrightPage>;
    close(): Promise<void>;
}

/**
 * A function that launches a browser via the Cloudflare Browser Rendering
 * binding and returns a Playwright-compatible browser instance.
 *
 * In the Cloudflare Worker runtime this is `launch` from
 * `@cloudflare/playwright` (a PNPM devDependency, never imported in the
 * Deno/JSR src/).
 *
 * @example
 * ```ts
 * import { launch } from '@cloudflare/playwright';
 * const fetcher = new BrowserFetcher(env.BROWSER, {}, launch);
 * ```
 */
export type BrowserConnector = (
    binding: IBrowserWorker,
) => Promise<IPlaywrightBrowser>;

const DEFAULT_OPTIONS: Required<BrowserFetcherOptions> = {
    timeout: 30_000,
    waitUntil: 'networkidle',
    extractFullHtml: false,
};

/**
 * Fetches content from a URL by driving a real Chromium browser via the
 * Cloudflare Browser Rendering binding and the Playwright CDP protocol.
 *
 * Use this as a fallback in a {@link CompositeFetcher} chain when plain HTTP
 * cannot reach JS-rendered or interstitial-protected filter list sources.
 *
 * @example
 * ```ts
 * import { launch } from '@cloudflare/playwright'; // worker-only PNPM dep
 * import { CompositeFetcher, HttpFetcher, BrowserFetcher } from '@jk-com/adblock-compiler';
 *
 * const fetcher = new CompositeFetcher([
 *     new HttpFetcher(),
 *     new BrowserFetcher(env.BROWSER, { timeout: 30_000 }, launch),
 * ]);
 * ```
 */
export class BrowserFetcher implements IContentFetcher {
    private readonly binding: IBrowserWorker;
    private readonly options: Required<BrowserFetcherOptions>;
    private readonly connector: BrowserConnector;

    /**
     * Creates a new BrowserFetcher.
     *
     * @param binding - The Cloudflare `BROWSER` binding from the Worker env.
     * @param options - Optional configuration for navigation behaviour.
     * @param connector - Function that launches a browser via the BROWSER binding.
     *   Required when calling `fetch()`.  `canHandle()` works without it.
     *   In a Cloudflare Worker: `launch` from `@cloudflare/playwright`
     *   (a PNPM devDependency).
     */
    constructor(binding: IBrowserWorker, options?: BrowserFetcherOptions, connector?: BrowserConnector) {
        this.binding = binding;
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.connector = connector ?? BrowserFetcher.missingConnector;
    }

    /**
     * Returns true for http:// and https:// URLs.
     * Browser Rendering does not support file:// paths or other schemes.
     */
    public canHandle(source: string): boolean {
        return source.startsWith('http://') || source.startsWith('https://');
    }

    /**
     * Navigates to the URL in a headless Chromium browser and extracts content.
     *
     * The browser acquires a CDP session from the `BROWSER` binding, waits for
     * the page to reach the configured idle state, then extracts either:
     * - The inner text of the first `<pre>` element (most filter lists), OR
     * - The full `<body>` inner text (if no `<pre>` is found), OR
     * - The complete rendered HTML (when `extractFullHtml: true`).
     *
     * The browser is always closed in the finally block regardless of outcome.
     *
     * @param source - The URL to navigate to.
     * @returns The extracted page content as a string.
     * @throws {NetworkError} On navigation timeout or failure.
     */
    public async fetch(source: string): Promise<string> {
        let browser: IPlaywrightBrowser;
        try {
            browser = await this.acquireBrowser();
        } catch (err) {
            throw new NetworkError(
                `Browser Rendering: failed to acquire browser session — ${err instanceof Error ? err.message : String(err)}`,
                source,
                undefined,
                true,
            );
        }

        const page = await browser.newPage();
        try {
            await page.goto(source, {
                waitUntil: this.options.waitUntil,
                timeout: this.options.timeout,
            });

            if (this.options.extractFullHtml) {
                return await page.content();
            }

            // Extract plain text: prefer <pre> blocks (standard filter list delivery),
            // fall back to the full body text for pages that render rules inline.
            // The script always returns a string so no nullish coalescing is needed.
            const text = (await page.evaluate(EXTRACT_TEXT_SCRIPT)) as string;

            return text;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const isTimeout = message.toLowerCase().includes('timeout');
            throw new NetworkError(
                `Browser Rendering: navigation failed for ${source} — ${message}`,
                source,
                undefined,
                isTimeout,
            );
        } finally {
            await browser.close();
        }
    }

    /**
     * Acquires a browser via the Cloudflare Browser Rendering binding.
     *
     * Delegates entirely to the injected connector (e.g. `launch` from
     * `@cloudflare/playwright`), which handles session acquisition internally.
     */
    private async acquireBrowser(): Promise<IPlaywrightBrowser> {
        return await this.connector(this.binding);
    }

    /**
     * Default connector that throws if no connector was injected.
     * Prevents silent failures when BrowserFetcher is constructed without a connector
     * and `fetch()` is called.
     */
    private static missingConnector(_binding: IBrowserWorker): Promise<IPlaywrightBrowser> {
        return Promise.reject(
            new Error(
                'BrowserFetcher: no connector provided. Pass `launch` from `@cloudflare/playwright` as the third constructor argument.',
            ),
        );
    }
}
