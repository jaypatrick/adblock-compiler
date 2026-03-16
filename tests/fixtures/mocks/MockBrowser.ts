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
// Types matching the interfaces in src/platform/BrowserFetcher.ts
// ============================================================================

export interface IPlaywrightPage {
    goto(url: string, options?: Record<string, unknown>): Promise<null>;
    content(): Promise<string>;
    evaluate(fn: unknown): Promise<unknown>;
    close(): Promise<void>;
}

export interface IPlaywrightBrowser {
    newPage(): Promise<IPlaywrightPage>;
    close(): Promise<void>;
}

export interface IBrowserWorker {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

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
        goto: async (_url: string, _options?: Record<string, unknown>) => null,
        content: async () => resolvedHtml,
        evaluate: async (fn: unknown) => {
            const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
            // Handle the EXTRACT_TEXT_SCRIPT evaluation
            if (fnStr.includes('innerText') || fnStr.includes('textContent')) {
                return bodyText;
            }
            // Handle outerHTML query
            if (fnStr.includes('outerHTML')) {
                return resolvedHtml;
            }
            return bodyText;
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
