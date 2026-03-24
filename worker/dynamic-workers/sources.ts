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
 * Minified/inlined source for the AST Parse Dynamic Worker.
 *
 * In development this points to the readable source file.
 * In production a build step should inline the bundled output here.
 *
 * For now, this exports a human-readable stub that works for the pilot.
 */
export const AST_PARSE_WORKER_SOURCE = `
export default {
  async fetch(request, env) {
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
    if (!payload || (!payload.rules?.length && !payload.text)) {
      return new Response(JSON.stringify({ success: false, error: 'Payload must contain rules[] or text' }), {
        status: 422, headers: { 'Content-Type': 'application/json' },
      });
    }
    const lines = payload.text
      ? payload.text.split('\\n').filter(l => l.trim() && !l.startsWith('!'))
      : (payload.rules ?? []);
    const nodes = lines.map((rule, i) => ({
      index: i, raw: rule,
      type: rule.startsWith('@@') ? 'exception' : rule.startsWith('||') ? 'network' : 'host',
    }));
    return new Response(JSON.stringify({
      success: true, nodeCount: nodes.length, nodes,
      workerVersion: env.COMPILER_VERSION ?? 'unknown',
      parsedAt: new Date().toISOString(),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
};
`.trim();
