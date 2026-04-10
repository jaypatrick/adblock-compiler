/**
 * Unit tests for the PlaywrightMcpAgent module and its browser-binding helper.
 *
 * ## Structure
 *
 * ### Pure unit tests (always run)
 * `resolveBrowserBinding` is extracted to `worker/lib/browser-env.ts` — a file
 * with no `cloudflare:*` imports.  Its error-message logic and binding lookup
 * are tested here with an injected env object, so CI always validates them
 * regardless of whether the Cloudflare Workers runtime is available.
 *
 * ### Smoke tests (skipped outside Workers runtime)
 * `@cloudflare/playwright-mcp` transitively imports `cloudflare:*` modules at
 * the top level.  Outside the runtime (e.g. `deno test`) those imports fail.
 * The four `PlaywrightMcpAgent` shape tests therefore use a dynamic import and
 * are skipped automatically when the runtime is unavailable.
 */

import { assertEquals, assertExists, assertMatch, assertThrows } from '@std/assert';

// ── Pure unit tests (no cloudflare:* imports needed) ─────────────────────────

import { resolveBrowserBinding } from './lib/browser-env.ts';
import type { IBrowserEnv } from './lib/browser-env.ts';

Deno.test('resolveBrowserBinding - throws when BROWSER is undefined', () => {
    const envLike: IBrowserEnv = { BROWSER: undefined };
    assertThrows(
        () => resolveBrowserBinding(envLike),
        Error,
        'Cloudflare Browser Rendering binding "BROWSER" is not configured.',
    );
});

Deno.test('resolveBrowserBinding - error message includes wrangler.toml syntax hint', () => {
    let message = '';
    try {
        resolveBrowserBinding({ BROWSER: undefined });
    } catch (err) {
        message = err instanceof Error ? err.message : String(err);
    }
    assertMatch(message, /\[browser\]/);
    assertMatch(message, /NOT \[\[browser_rendering\]\]/);
});

Deno.test('resolveBrowserBinding - error message includes verification URL', () => {
    let message = '';
    try {
        resolveBrowserBinding({ BROWSER: undefined });
    } catch (err) {
        message = err instanceof Error ? err.message : String(err);
    }
    assertMatch(message, /\/api\/browser\/health/);
});

Deno.test('resolveBrowserBinding - returns binding when BROWSER is present', () => {
    const mockBinding = { fetch } as unknown as IBrowserEnv['BROWSER'];
    const result = resolveBrowserBinding({ BROWSER: mockBinding });
    assertEquals(result, mockBinding);
});

// ── Smoke tests — require the Cloudflare Workers runtime ─────────────────────

// deno-lint-ignore no-explicit-any
type AnyConstructor = new (...args: any[]) => any;
interface McpAgentModule {
    PlaywrightMcpAgent: AnyConstructor;
    default: AnyConstructor;
}

// Attempt to load the module; it requires the Cloudflare Workers runtime.
// If BROWSER is absent the try/catch in mcp-agent.ts exports a stub class, so
// the import always succeeds when the runtime is available.
let mcpModule: McpAgentModule | null = null;
try {
    mcpModule = await import('./mcp-agent.ts') as McpAgentModule;
} catch {
    // Not in Cloudflare Workers runtime — smoke tests below will be skipped.
}

const skip = mcpModule === null;

Deno.test({
    name: 'PlaywrightMcpAgent - named export exists',
    ignore: skip,
    fn() {
        assertExists(mcpModule!.PlaywrightMcpAgent);
    },
});

Deno.test({
    name: 'PlaywrightMcpAgent - named export is a constructor (function)',
    ignore: skip,
    fn() {
        assertEquals(typeof mcpModule!.PlaywrightMcpAgent, 'function');
    },
});

Deno.test({
    name: 'PlaywrightMcpAgent - default export matches named export',
    ignore: skip,
    fn() {
        assertEquals(mcpModule!.default, mcpModule!.PlaywrightMcpAgent);
    },
});

Deno.test({
    name: 'PlaywrightMcpAgent - has a prototype (is a class)',
    ignore: skip,
    fn() {
        assertExists(mcpModule!.PlaywrightMcpAgent.prototype);
    },
});
