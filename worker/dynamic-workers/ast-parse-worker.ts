/**
 * AST Parse Dynamic Worker — pilot implementation for issue #1386.
 *
 * This module is loaded at runtime via `env.DYNAMIC_WORKER_LOADER.load(source)`.
 * It receives a serialised DynamicWorkerTask with type 'ast-parse' and returns
 * a JSON-serialised AST result in the canonical `{ parsedRules, summary }` shape
 * matching the existing `/ast/parse` response contract.
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

/** Matches ParsedRuleInfo from ASTViewerService. */
interface ParsedRuleInfo {
    ruleText: string;
    success: boolean;
    error?: string;
    category?: string;
    type?: string;
}

/** Matches RuleSummary from ASTViewerService. */
interface RuleSummary {
    total: number;
    successful: number;
    failed: number;
    byCategory: Record<string, number>;
    byType: Record<string, number>;
}

interface AstParseResult {
    parsedRules: ParsedRuleInfo[];
    summary: RuleSummary;
}

/**
 * Classifies a rule text into a category and type.
 * Mirrors a simplified heuristic before AGTree is available inside isolates.
 */
function classifyRule(rule: string): { category: string; type: string } {
    if (rule.startsWith('!')) return { category: 'Comment', type: 'Comment' };
    if (rule.includes('##') || rule.includes('#@#') || rule.includes('#?#')) {
        return { category: 'Cosmetic', type: 'CosmeticRule' };
    }
    if (/^\d+\.\d+\.\d+\.\d+/.test(rule)) {
        return { category: 'Network', type: 'HostRule' };
    }
    return { category: 'Network', type: 'NetworkRule' };
}

export default {
    async fetch(request: Request, _env: AstWorkerEnv): Promise<Response> {
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

        // Require either rules (can be empty array) or text to be present.
        if (!payload || (payload.rules === undefined && !payload.text)) {
            return new Response(
                JSON.stringify({ success: false, error: 'Payload must contain rules[] or text' }),
                { status: 422, headers: { 'Content-Type': 'application/json' } },
            );
        }

        try {
            // NOTE: AGTree import is not available in a Dynamic Worker source string context yet.
            // This produces ParsedRuleInfo-shaped objects compatible with the existing API contract.
            // Full AGTree integration will follow once Dynamic Workers support ESM imports
            // from npm — tracked in #1386.
            const lines = payload.text
                // Mirror ASTViewerService.parseRulesFromText: trim lines, drop empty lines only.
                ? payload.text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
                : (payload.rules ?? []);

            const parsedRules: ParsedRuleInfo[] = lines.map((rule) => {
                const { category, type } = classifyRule(rule);
                return { ruleText: rule, success: true, category, type };
            });

            const summary: RuleSummary = {
                total: parsedRules.length,
                successful: parsedRules.filter((r) => r.success).length,
                failed: parsedRules.filter((r) => !r.success).length,
                byCategory: {},
                byType: {},
            };
            for (const r of parsedRules) {
                if (r.category) summary.byCategory[r.category] = (summary.byCategory[r.category] ?? 0) + 1;
                if (r.type) summary.byType[r.type] = (summary.byType[r.type] ?? 0) + 1;
            }

            const result: AstParseResult = { parsedRules, summary };

            return new Response(JSON.stringify(result), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        } catch (err) {
            return new Response(
                JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
                { status: 500, headers: { 'Content-Type': 'application/json' } },
            );
        }
    },
};
