/**
 * AST Parse Dynamic Worker — pilot implementation for issue #1386.
 *
 * This module is loaded at runtime via `env.DYNAMIC_WORKER_LOADER.load(source)`.
 * It receives a serialised DynamicWorkerTask with type 'ast-parse' and returns
 * a JSON-serialised AST result.
 *
 * Security posture:
 *   - No outbound network access (globalOutbound restricted by loader)
 *   - Only COMPILATION_CACHE, RATE_LIMIT, COMPILER_VERSION bindings injected
 *   - Input validated before processing
 *
 * NOTE: This file is the readable reference source for the AST parse Worker.
 * The inlined string in `worker/dynamic-workers/sources.ts` must be kept in
 * sync with the logic here. A future build step should generate sources.ts
 * automatically from this file — tracked in #1386.
 *
 * @see https://developers.cloudflare.com/dynamic-workers/
 * @see https://github.com/jaypatrick/adblock-compiler/issues/1386
 */

/** Minimal Env shape injected by the orchestrator. */
interface AstWorkerEnv {
    COMPILATION_CACHE: KVNamespace;
    RATE_LIMIT: KVNamespace;
    COMPILER_VERSION: string;
}

interface AstParseTaskPayload {
    rules?: string[];
    text?: string;
}

interface AstParseResult {
    success: boolean;
    nodeCount?: number;
    nodes?: unknown[];
    error?: string;
    workerVersion: string;
    parsedAt: string;
}

export default {
    async fetch(request: Request, env: AstWorkerEnv): Promise<Response> {
        if (request.method !== 'POST') {
            return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
                status: 405,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        let body: { payload?: AstParseTaskPayload };
        try {
            body = await request.json();
        } catch {
            return new Response(
                JSON.stringify({ success: false, error: 'Invalid JSON body' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } },
            );
        }

        const payload = body?.payload as AstParseTaskPayload | undefined;

        if (!payload || (!payload.rules?.length && !payload.text)) {
            return new Response(
                JSON.stringify({ success: false, error: 'Payload must contain rules[] or text' }),
                { status: 422, headers: { 'Content-Type': 'application/json' } },
            );
        }

        try {
            // NOTE: AGTree import is not available in a Dynamic Worker source string context yet.
            // This is a placeholder that returns structured metadata about the input.
            // Full AGTree integration will follow once Dynamic Workers support ESM imports
            // from npm — tracked in #1386.
            const lines = payload.text
                ? payload.text.split('\n').filter((l) => l.trim() && !l.startsWith('!'))
                : (payload.rules ?? []);

            const nodes = lines.map((rule, i) => ({
                index: i,
                raw: rule,
                type: rule.startsWith('@@') ? 'exception' : rule.startsWith('||') ? 'network' : 'host',
            }));

            const result: AstParseResult = {
                success: true,
                nodeCount: nodes.length,
                nodes,
                workerVersion: env.COMPILER_VERSION ?? 'unknown',
                parsedAt: new Date().toISOString(),
            };

            return new Response(JSON.stringify(result), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        } catch (err) {
            return new Response(
                JSON.stringify({ success: false, error: String(err) }),
                { status: 500, headers: { 'Content-Type': 'application/json' } },
            );
        }
    },
};
