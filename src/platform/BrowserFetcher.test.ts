import { assertEquals, assertRejects } from '@std/assert';
import { BrowserFetcher } from './BrowserFetcher.ts';

// ============================================================================
// Mock helpers
// ============================================================================

/** A minimal mock IBrowserWorker binding (opaque — passed through to connector). */
function makeMockBinding(): { fetch: typeof fetch } {
    return { fetch: (() => Promise.resolve(new Response())) as unknown as typeof fetch };
}

/**
 * Creates a mock connector that returns a browser whose single page produces
 * the given text/html content.
 */
function makeMockConnector(options: {
    pageText?: string;
    pageHtml?: string;
    gotoThrows?: string;
    throws?: string;
}): (binding: { fetch: typeof fetch }) => Promise<{
    newPage(): Promise<{
        goto(url: string, opts?: unknown): Promise<unknown>;
        content(): Promise<string>;
        evaluate(script: string): Promise<unknown>;
        close(): Promise<void>;
    }>;
    close(): Promise<void>;
}> {
    return async (_binding) => {
        if (options.throws) {
            throw new Error(options.throws);
        }
        return {
            async newPage() {
                return {
                    async goto(_url: string, _opts?: unknown) {
                        if (options.gotoThrows) throw new Error(options.gotoThrows);
                    },
                    async content() {
                        return options.pageHtml ?? '<html><body>mock</body></html>';
                    },
                    async evaluate(_script: string) {
                        return options.pageText ?? 'mock filter list content';
                    },
                    async close() {},
                };
            },
            async close() {},
        };
    };
}

// ============================================================================
// canHandle
// ============================================================================

Deno.test('BrowserFetcher - canHandle returns true for http URLs', () => {
    const fetcher = new BrowserFetcher(makeMockBinding());
    assertEquals(fetcher.canHandle('http://example.com/list.txt'), true);
});

Deno.test('BrowserFetcher - canHandle returns true for https URLs', () => {
    const fetcher = new BrowserFetcher(makeMockBinding());
    assertEquals(fetcher.canHandle('https://example.com/filters/list.txt'), true);
});

Deno.test('BrowserFetcher - canHandle returns false for file paths', () => {
    const fetcher = new BrowserFetcher(makeMockBinding());
    assertEquals(fetcher.canHandle('/path/to/list.txt'), false);
    assertEquals(fetcher.canHandle('./relative/list.txt'), false);
    assertEquals(fetcher.canHandle('list.txt'), false);
});

Deno.test('BrowserFetcher - canHandle returns false for file:// URLs', () => {
    const fetcher = new BrowserFetcher(makeMockBinding());
    assertEquals(fetcher.canHandle('file:///path/to/list.txt'), false);
});

Deno.test('BrowserFetcher - canHandle returns false for ftp:// URLs', () => {
    const fetcher = new BrowserFetcher(makeMockBinding());
    assertEquals(fetcher.canHandle('ftp://example.com/list.txt'), false);
});

// ============================================================================
// Constructor / options
// ============================================================================

Deno.test('BrowserFetcher - accepts default options', () => {
    const fetcher = new BrowserFetcher(makeMockBinding());
    assertEquals(fetcher.canHandle('https://example.com'), true);
});

Deno.test('BrowserFetcher - accepts explicit options', () => {
    const fetcher = new BrowserFetcher(makeMockBinding(), {
        timeout: 10_000,
        waitUntil: 'load',
        extractFullHtml: true,
    });
    assertEquals(fetcher.canHandle('https://example.com'), true);
});

// ============================================================================
// Fetch — connector failure (does not need real browser runtime)
// ============================================================================

Deno.test('BrowserFetcher - fetch throws NetworkError when connector throws', async () => {
    const connector = makeMockConnector({ throws: 'connection refused' });
    const fetcher = new BrowserFetcher(makeMockBinding(), {}, connector as unknown as Parameters<typeof BrowserFetcher>[2]);

    await assertRejects(
        () => fetcher.fetch('https://example.com/list.txt'),
        Error,
        'Browser Rendering: failed to acquire browser session',
    );
});

Deno.test('BrowserFetcher - fetch throws NetworkError when no connector provided', async () => {
    const fetcher = new BrowserFetcher(makeMockBinding());

    await assertRejects(
        () => fetcher.fetch('https://example.com/list.txt'),
        Error,
        'BrowserFetcher: no connector provided',
    );
});

Deno.test('BrowserFetcher - fetch returns page text via connector', async () => {
    const connector = makeMockConnector({ pageText: '||example.com^' });
    const fetcher = new BrowserFetcher(makeMockBinding(), {}, connector as unknown as Parameters<typeof BrowserFetcher>[2]);

    const result = await fetcher.fetch('https://example.com/list.txt');
    assertEquals(result, '||example.com^');
});

Deno.test('BrowserFetcher - fetch returns full HTML when extractFullHtml is true', async () => {
    const connector = makeMockConnector({ pageHtml: '<html><body>filter</body></html>' });
    const fetcher = new BrowserFetcher(makeMockBinding(), { extractFullHtml: true }, connector as unknown as Parameters<typeof BrowserFetcher>[2]);

    const result = await fetcher.fetch('https://example.com/list.txt');
    assertEquals(result, '<html><body>filter</body></html>');
});

Deno.test('BrowserFetcher - fetch throws NetworkError on navigation failure', async () => {
    const connector = makeMockConnector({ gotoThrows: 'Navigation timeout of 30000 ms exceeded' });
    const fetcher = new BrowserFetcher(makeMockBinding(), {}, connector as unknown as Parameters<typeof BrowserFetcher>[2]);

    await assertRejects(
        () => fetcher.fetch('https://example.com/list.txt'),
        Error,
        'Browser Rendering: navigation failed',
    );
});

// ============================================================================
// Fetch — integration tests (require Cloudflare Workers runtime + BROWSER binding)
// ============================================================================

Deno.test({
    name: 'BrowserFetcher - fetch returns page text content',
    ignore: true, // Requires Cloudflare Workers runtime with BROWSER binding
    async fn() {
        // This test would run inside a Cloudflare Worker where env.BROWSER is available.
        // It's kept here as documentation of the expected runtime behaviour.
        const { env } = await import('cloudflare:workers') as unknown as { env: { BROWSER: { fetch: typeof fetch } } };
        const { launch } = await import('@cloudflare/playwright') as unknown as { launch: (b: unknown) => Promise<unknown> };
        const fetcher = new BrowserFetcher(env.BROWSER, { timeout: 30_000 }, launch as unknown as Parameters<typeof BrowserFetcher>[2]);

        const content = await fetcher.fetch('https://easylist.to/easylist/easylist.txt');
        assertEquals(typeof content, 'string');
        assertEquals(content.length > 0, true);
    },
});

Deno.test({
    name: 'BrowserFetcher - fetch throws NetworkError on navigation failure',
    ignore: true, // Requires Cloudflare Workers runtime with BROWSER binding
    async fn() {
        const { env } = await import('cloudflare:workers') as unknown as { env: { BROWSER: { fetch: typeof fetch } } };
        const { launch } = await import('@cloudflare/playwright') as unknown as { launch: (b: unknown) => Promise<unknown> };
        const fetcher = new BrowserFetcher(env.BROWSER, { timeout: 5_000 }, launch as unknown as Parameters<typeof BrowserFetcher>[2]);

        await assertRejects(
            () => fetcher.fetch('https://this-domain-does-not-exist.invalid/list.txt'),
            Error,
            'Browser Rendering:',
        );
    },
});

Deno.test({
    name: 'BrowserFetcher - fetch respects timeout option',
    ignore: true, // Requires Cloudflare Workers runtime with BROWSER binding
    async fn() {
        const { env } = await import('cloudflare:workers') as unknown as { env: { BROWSER: { fetch: typeof fetch } } };
        const { launch } = await import('@cloudflare/playwright') as unknown as { launch: (b: unknown) => Promise<unknown> };
        const fetcher = new BrowserFetcher(env.BROWSER, { timeout: 1 }, launch as unknown as Parameters<typeof BrowserFetcher>[2]);

        await assertRejects(
            () => fetcher.fetch('https://easylist.to/easylist/easylist.txt'),
            Error,
        );
    },
});

Deno.test({
    name: 'BrowserFetcher - extractFullHtml returns HTML content',
    ignore: true, // Requires Cloudflare Workers runtime with BROWSER binding
    async fn() {
        const { env } = await import('cloudflare:workers') as unknown as { env: { BROWSER: { fetch: typeof fetch } } };
        const { launch } = await import('@cloudflare/playwright') as unknown as { launch: (b: unknown) => Promise<unknown> };
        const fetcher = new BrowserFetcher(env.BROWSER, { extractFullHtml: true }, launch as unknown as Parameters<typeof BrowserFetcher>[2]);

        const content = await fetcher.fetch('https://example.com');
        assertEquals(content.includes('<html'), true);
    },
});
