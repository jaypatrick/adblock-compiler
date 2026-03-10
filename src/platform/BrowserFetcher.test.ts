import { assertEquals, assertRejects } from '@std/assert';
import { BrowserFetcher } from './BrowserFetcher.ts';

// ============================================================================
// Mock helpers
// ============================================================================

/**
 * Creates a minimal mock BrowserWorker binding whose acquire call returns
 * the given wsUrl, and whose browser navigation produces the given page text.
 */
function makeMockBinding(options: {
    wsUrl?: string;
    pageText?: string;
    pageHtml?: string;
    pageUrl?: string;
    acquireStatus?: number;
    gotoThrows?: string;
}): { fetch: typeof fetch } {
    const wsUrl = options.wsUrl ?? 'ws://mock-browser/devtools/browser/abc';

    // Intercept the acquire call
    const bindingFetch = async (input: Request | URL | string): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
        if (url.includes('workers-binding.browser')) {
            if (options.acquireStatus && options.acquireStatus !== 200) {
                return new Response('error', { status: options.acquireStatus });
            }
            return Response.json({ webSocketDebuggerUrl: wsUrl });
        }
        return new Response('unexpected fetch', { status: 500 });
    };

    // Patch chromium.connectOverCDP at module level is not easily done without
    // a proper mock framework, so we verify the integration boundary via the
    // public API contract below.  The tests that exercise real navigation are
    // marked ignore (require Cloudflare Workers runtime).
    return { fetch: bindingFetch as unknown as typeof fetch };
}

// ============================================================================
// canHandle
// ============================================================================

Deno.test('BrowserFetcher - canHandle returns true for http URLs', () => {
    const binding = makeMockBinding({});
    const fetcher = new BrowserFetcher(binding);
    assertEquals(fetcher.canHandle('http://example.com/list.txt'), true);
});

Deno.test('BrowserFetcher - canHandle returns true for https URLs', () => {
    const binding = makeMockBinding({});
    const fetcher = new BrowserFetcher(binding);
    assertEquals(fetcher.canHandle('https://example.com/filters/list.txt'), true);
});

Deno.test('BrowserFetcher - canHandle returns false for file paths', () => {
    const binding = makeMockBinding({});
    const fetcher = new BrowserFetcher(binding);
    assertEquals(fetcher.canHandle('/path/to/list.txt'), false);
    assertEquals(fetcher.canHandle('./relative/list.txt'), false);
    assertEquals(fetcher.canHandle('list.txt'), false);
});

Deno.test('BrowserFetcher - canHandle returns false for file:// URLs', () => {
    const binding = makeMockBinding({});
    const fetcher = new BrowserFetcher(binding);
    assertEquals(fetcher.canHandle('file:///path/to/list.txt'), false);
});

Deno.test('BrowserFetcher - canHandle returns false for ftp:// URLs', () => {
    const binding = makeMockBinding({});
    const fetcher = new BrowserFetcher(binding);
    assertEquals(fetcher.canHandle('ftp://example.com/list.txt'), false);
});

// ============================================================================
// Constructor / options
// ============================================================================

Deno.test('BrowserFetcher - accepts default options', () => {
    const binding = makeMockBinding({});
    const fetcher = new BrowserFetcher(binding);
    assertEquals(fetcher.canHandle('https://example.com'), true);
});

Deno.test('BrowserFetcher - accepts explicit options', () => {
    const binding = makeMockBinding({});
    const fetcher = new BrowserFetcher(binding, {
        timeout: 10_000,
        waitUntil: 'load',
        extractFullHtml: true,
    });
    assertEquals(fetcher.canHandle('https://example.com'), true);
});

// ============================================================================
// Fetch — acquire failure (does not need real browser runtime)
// ============================================================================

Deno.test('BrowserFetcher - fetch throws NetworkError when binding acquire returns non-200', async () => {
    const binding = makeMockBinding({ acquireStatus: 503 });
    const fetcher = new BrowserFetcher(binding);

    await assertRejects(
        () => fetcher.fetch('https://example.com/list.txt'),
        Error,
        'Browser Rendering: failed to acquire browser session',
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
        const { env } = await import('cloudflare:workers') as { env: { BROWSER: { fetch: typeof fetch } } };
        const fetcher = new BrowserFetcher(env.BROWSER, { timeout: 30_000 });

        const content = await fetcher.fetch('https://easylist.to/easylist/easylist.txt');
        assertEquals(typeof content, 'string');
        assertEquals(content.length > 0, true);
    },
});

Deno.test({
    name: 'BrowserFetcher - fetch throws NetworkError on navigation failure',
    ignore: true, // Requires Cloudflare Workers runtime with BROWSER binding
    async fn() {
        const { env } = await import('cloudflare:workers') as { env: { BROWSER: { fetch: typeof fetch } } };
        const fetcher = new BrowserFetcher(env.BROWSER, { timeout: 5_000 });

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
        const { env } = await import('cloudflare:workers') as { env: { BROWSER: { fetch: typeof fetch } } };
        const fetcher = new BrowserFetcher(env.BROWSER, { timeout: 1 }); // 1ms — should always timeout

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
        const { env } = await import('cloudflare:workers') as { env: { BROWSER: { fetch: typeof fetch } } };
        const fetcher = new BrowserFetcher(env.BROWSER, { extractFullHtml: true });

        const content = await fetcher.fetch('https://example.com');
        assertEquals(content.includes('<html'), true);
    },
});
