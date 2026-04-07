/**
 * Dynamic Worker source strings.
 *
 * Each exported constant is the complete ES module source for a dynamic Worker.
 * They are loaded at runtime via `env.DYNAMIC_WORKER_LOADER.load(source)`.
 *
 * Keep each source string self-contained — no top-level imports that depend on
 * module resolution, since the source is evaluated in an isolated V8 context.
 *
 * @see worker/dynamic-workers/ast-parse-worker.ts — readable source
 * @see https://github.com/jaypatrick/adblock-compiler/issues/1386
 */

/**
 * Inlined source for the AST Parse Dynamic Worker.
 *
 * Returns `{ parsedRules, summary }` matching the canonical `/ast/parse`
 * response contract. A future build step should generate this from
 * ast-parse-worker.ts automatically — tracked in #1386.
 */
export const AST_PARSE_WORKER_SOURCE = `
function classifyRule(rule) {
  if (rule.startsWith('!')) return { category: 'Comment', type: 'Comment' };
  if (rule.includes('##') || rule.includes('#@#') || rule.includes('#?#')) {
    return { category: 'Cosmetic', type: 'CosmeticRule' };
  }
  if (/^\\d+\\.\\d+\\.\\d+\\.\\d+/.test(rule)) {
    return { category: 'Network', type: 'HostRule' };
  }
  return { category: 'Network', type: 'NetworkRule' };
}
export default {
  async fetch(request, _env) {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
        status: 405, headers: { 'Content-Type': 'application/json' },
      });
    }
    let body;
    try { body = await request.json(); } catch {
      return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    const payload = body?.payload;
    if (!payload || (payload.rules === undefined && !payload.text)) {
      return new Response(JSON.stringify({ success: false, error: 'Payload must contain rules[] or text' }), {
        status: 422, headers: { 'Content-Type': 'application/json' },
      });
    }
    const lines = payload.text
      ? payload.text.split('\\n').map(l => l.trim()).filter(l => l.length > 0)
      : (payload.rules ?? []);
    const parsedRules = lines.map(rule => {
      const { category, type } = classifyRule(rule);
      return { ruleText: rule, success: true, category, type };
    });
    const summary = {
      total: parsedRules.length,
      successful: parsedRules.filter(r => r.success).length,
      failed: parsedRules.filter(r => !r.success).length,
      byCategory: {},
      byType: {},
    };
    for (const r of parsedRules) {
      if (r.category) summary.byCategory[r.category] = (summary.byCategory[r.category] ?? 0) + 1;
      if (r.type) summary.byType[r.type] = (summary.byType[r.type] ?? 0) + 1;
    }
    return new Response(JSON.stringify({ parsedRules, summary }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
};
`.trim();
