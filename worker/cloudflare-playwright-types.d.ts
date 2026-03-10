/**
 * Minimal type declarations for `npm:playwright-core`.
 *
 * The full playwright-core type graph is large and causes Deno's type checker
 * to struggle with resolution when imported inside large worker files.
 *
 * These stubs expose just enough typing for BrowserFetcher and the browser
 * handler utilities while keeping `deno check` stable.  The real types are
 * resolved by the Cloudflare Workers / wrangler bundler at deploy time.
 *
 * @see https://developers.cloudflare.com/browser-rendering/platform/playwright/
 * @see src/platform/BrowserFetcher.ts
 * @see worker/handlers/browser.ts
 */

declare module 'playwright-core' {
    export interface Page {
        goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit'; timeout?: number }): Promise<Response | null>;
        content(): Promise<string>;
        url(): string;
        screenshot(options?: { fullPage?: boolean; type?: 'png' | 'jpeg' }): Promise<Uint8Array>;
        evaluate<T>(pageFunction: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T>;
        close(): Promise<void>;
    }

    export interface BrowserContext {
        newPage(): Promise<Page>;
        close(): Promise<void>;
    }

    export interface Browser {
        newPage(): Promise<Page>;
        newContext(options?: Record<string, unknown>): Promise<BrowserContext>;
        close(): Promise<void>;
    }

    export interface ConnectOptions {
        timeout?: number;
        headers?: Record<string, string>;
    }

    export interface BrowserType {
        connectOverCDP(endpointURL: string, options?: ConnectOptions): Promise<Browser>;
        connect(wsEndpoint: string, options?: ConnectOptions): Promise<Browser>;
    }

    export const chromium: BrowserType;

    const playwright: {
        chromium: BrowserType;
    };
    export default playwright;
}
