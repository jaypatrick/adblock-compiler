import type { BrowserWorker } from '../cloudflare-workers-shim.ts';

/** Minimal interface for the env bindings relevant to Browser Rendering. */
export interface IBrowserEnv {
    readonly BROWSER?: BrowserWorker;
}

/**
 * Resolves the `BROWSER` binding from an env-like object.
 *
 * Throws an actionable error describing exactly what the operator needs to do
 * if the binding is absent.
 *
 * This is a **pure function** with no `cloudflare:*` imports, so it can be
 * imported and unit-tested outside the Cloudflare Workers runtime.
 *
 * In production it is called from `worker/mcp-agent.ts` with the module-level
 * `env` cast to {@link IBrowserEnv}.
 */
export function resolveBrowserBinding(envLike: IBrowserEnv): BrowserWorker {
    const binding = envLike.BROWSER;
    if (!binding) {
        throw new Error(
            'Cloudflare Browser Rendering binding "BROWSER" is not configured.\n' +
                'To fix:\n' +
                '  1. Ensure your Cloudflare account is on the Workers Paid plan\n' +
                '  2. Add `[browser]\\n  binding = "BROWSER"` to wrangler.toml\n' +
                '     (use [browser], NOT [[browser_rendering]] — the double-bracket form is\n' +
                '      array-of-tables syntax and is silently ignored by wrangler)\n' +
                '  3. Run `wrangler deploy` or `wrangler dev --remote` to activate the binding\n' +
                '  4. Verify: GET /api/browser/health should return { ok: true }',
        );
    }
    return binding;
}
