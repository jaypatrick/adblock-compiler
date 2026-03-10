/**
 * Minimal type declarations for `playwright-core`.
 *
 * Playwright-core is a large package whose full type graph can slow down
 * Deno's TypeScript checker.  These stubs expose just enough typing for
 * BrowserFetcher while keeping `deno check` and `deno publish --dry-run` fast.
 *
 * The real types and implementation are resolved by wrangler's bundler at
 * deploy time; the full npm package is available at runtime on Cloudflare Workers.
 *
 * @see https://developers.cloudflare.com/browser-rendering/platform/playwright/
 * @see src/platform/BrowserFetcher.ts
 */

declare module 'playwright-core' {
    export interface Page {
        goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit'; timeout?: number }): Promise<unknown>;
        content(): Promise<string>;
        url(): string;
        screenshot(options?: { fullPage?: boolean; type?: 'png' | 'jpeg' }): Promise<Uint8Array>;
        evaluate<T = unknown>(pageFunction: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T>;
        close(): Promise<void>;
    }

    export interface Browser {
        newPage(): Promise<Page>;
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

    const playwright: { chromium: BrowserType };
    export default playwright;
}
