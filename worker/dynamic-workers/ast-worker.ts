/**
 * Dynamic Worker: AST Parse & Validate
 *
 * This module runs INSIDE a Cloudflare Dynamic Worker isolate — it is NOT
 * imported statically by the main Worker. It is loaded at runtime via
 * `env.LOADER.load()` with `globalOutbound: null` for full network lockdown.
 *
 * The isolate receives only:
 *   - The request body (rules/text to parse)
 *   - No network access (globalOutbound: null)
 *   - No KV, D1, R2, or Queue bindings
 *
 * This is intentional: AST parsing and rule validation are pure transforms.
 * Running them in a separate isolate gives V8-level tenant isolation with
 * no shared state between concurrent jobs.
 *
 * @see ideas/CLOUDFLARE_DYNAMIC_WORKERS_PIVOT.md — Tier 1 backport candidate
 * @see https://github.com/jaypatrick/adblock-compiler/issues/1386
 */

export default {
    async fetch(request: Request): Promise<Response> {
        if (request.method !== 'POST') {
            return Response.json({ error: 'Method not allowed' }, { status: 405 });
        }

        try {
            const body = await request.json() as {
                operation: 'parse' | 'validate';
                rules?: string[];
                text?: string;
                strict?: boolean;
            };

            const { operation } = body;

            if (operation === 'parse') {
                return handleParse(body.rules, body.text);
            } else if (operation === 'validate') {
                return handleValidate(body.rules ?? [], body.strict ?? false);
            }

            return Response.json({ error: `Unknown operation: ${operation}` }, { status: 400 });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return Response.json({ success: false, error: message }, { status: 500 });
        }
    },
};

/**
 * Handles AST parse requests inside the dynamic Worker isolate.
 * NOTE: ASTViewerService is bundled into this module at build time via
 * @cloudflare/worker-bundler. It does NOT import from the parent Worker.
 */
function handleParse(rules?: string[], text?: string): Promise<Response> {
    if (!rules && !text) {
        return Response.json(
            { error: 'Request must include either "rules" array or "text" string' },
            { status: 400 },
        );
    }

    // TODO(#1386): Replace with bundled ASTViewerService once @cloudflare/worker-bundler
    return Response.json({
        success: true,
        parsedRules: [],
        summary: {
            total: rules?.length ?? 0,
            note: 'Dynamic Worker AST parse stub — bundle ASTViewerService to activate',
        },
        executedIn: 'dynamic-worker-isolate',
    });
}

/**
 * Handles rule validation inside the dynamic Worker isolate.
 */
function handleValidate(rules: string[], _strict: boolean): Promise<Response> {
    const startTime = Date.now();

    // TODO(#1386): Replace with bundled ASTViewerService once @cloudflare/worker-bundler
    const duration = `${Date.now() - startTime}ms`;

    return Response.json({
        success: true,
        valid: true,
        totalRules: rules.length,
        validRules: rules.length,
        invalidRules: 0,
        errors: [],
        warnings: [],
        duration,
        executedIn: 'dynamic-worker-isolate',
        note: 'Dynamic Worker validate stub — bundle ASTViewerService to activate',
    });
}
