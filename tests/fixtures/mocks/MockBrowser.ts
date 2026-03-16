/**
 * Shared Browser mock factories for BrowserFetcher and browser monitoring tests.
 *
 * Consolidates the mockPage/mockBrowser pattern from
 * src/platform/BrowserFetcher.test.ts into a reusable module.
 *
 * Usage:
 *   import { mockPage, mockBrowser, MOCK_BROWSER_BINDING } from '../../tests/fixtures/mocks/MockBrowser.ts';
 */

// ============================================================================
// Re-export the canonical interfaces from src/platform/BrowserFetcher.ts so
// mocks are structurally drop-in compatible with the real interfaces.
// ============================================================================

import type { IBrowserWorker, IPlaywrightBrowser, IPlaywrightPage } from '../../../src/platform/BrowserFetcher.ts';

export type { IBrowserWorker, IPlaywrightBrowser, IPlaywrightPage };

// ============================================================================
// Mock factories
// ============================================================================

/**
 * Creates a mock Playwright page that returns the given body text.
 *
 * @param bodyText - Text content of the page body
 * @param outerHtml - Optional custom outerHTML (defaults to wrapping bodyText)
 */
export function mockPage(bodyText: string, outerHtml?: string): IPlaywrightPage {
    const resolvedHtml = outerHtml ?? `<html><body>${bodyText}</body></html>`;
    return {
        goto: async (_url: string, _options?: { waitUntil?: string; timeout?: number }) => null,
        content: async () => resolvedHtml,
        evaluate: async <T>(fn: string | ((...args: unknown[]) => T), ..._args: unknown[]): Promise<T> => {
            const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
            // Handle the EXTRACT_TEXT_SCRIPT evaluation
            if (fnStr.includes('innerText') || fnStr.includes('textContent')) {
                return bodyText as unknown as T;
            }
            // Handle outerHTML query
            if (fnStr.includes('outerHTML')) {
                return resolvedHtml as unknown as T;
            }
            return bodyText as unknown as T;
        },
        close: async () => {},
    };
}

/**
 * Creates a mock Playwright browser that yields the given page.
 *
 * @param page - Mock page to return from newPage()
 * @param closeSpy - Optional spy function called when browser.close() is invoked
 */
export function mockBrowser(page: IPlaywrightPage, closeSpy?: () => void): IPlaywrightBrowser {
    return {
        newPage: async () => page,
        close: async () => {
            closeSpy?.();
        },
    };
}

/**
 * A mock BrowserWorker binding stub.
 * Returns a simple 200 OK for any fetch call.
 */
export const MOCK_BROWSER_BINDING: IBrowserWorker = {
    fetch: async () => new Response('ok'),
};
