/**
 * Utility: build a minimal synthetic POST Request from a JSON body string.
 *
 * Used by tRPC procedures (and any other callers outside the Hono middleware
 * pipeline) to reconstruct a `Request` that existing handler functions
 * (which accept the legacy `(Request, Env, ...)` signature) can parse.
 *
 * For Hono route handlers that already have `c.req.url` and
 * `c.req.raw.headers` available, use the internal `buildHonoRequest` helper
 * defined in `worker/hono-app.ts` instead.
 */
export function buildSyntheticRequest(body: string): Request {
    return new Request('https://worker.local', {
        method: 'POST',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        body,
    });
}
