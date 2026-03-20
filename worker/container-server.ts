/**
 * Cloudflare Container HTTP Server
 *
 * Minimal Deno HTTP server that runs inside the AdblockCompiler Cloudflare
 * Container. The Container Durable Object in worker.ts extends `Container`
 * from `@cloudflare/containers`, which starts this server and proxies
 * incoming Worker requests to it on `defaultPort` (8787).
 *
 * Endpoints:
 *   GET  /health   — liveness probe used by Cloudflare and the Docker HEALTHCHECK
 *   POST /compile  — compile a filter list and return the result as plain text
 *
 * The `handler` function is exported for use in tests. The `Deno.serve()`
 * startup is guarded by `import.meta.main` so that importing this module
 * in tests does not start a live HTTP server.
 */

import { WorkerCompiler } from '../src/platform/index.ts';
import { ConfigurationSchema } from '../src/configuration/index.ts';
import { VERSION } from '../src/version.ts';
import { z } from 'zod';

const PORT = parseInt(Deno.env.get('PORT') ?? '8787', 10);

/**
 * Zod schema for the `POST /compile` request body.
 *
 * Using runtime validation here (rather than a bare `as` cast) ensures callers
 * receive structured, field-level error messages when they send a malformed body,
 * instead of a generic string error that is hard to act on.
 */
const ContainerCompileRequestSchema = z.object({
    // Validate configuration against the full IConfiguration schema so invalid
    // configs produce a 400 (field-level detail) rather than a 500 from the
    // compiler.  Using ConfigurationSchema here keeps runtime and type-level
    // definitions in sync and avoids an unsafe `as IConfiguration` cast.
    configuration: ConfigurationSchema,
    preFetchedContent: z.record(z.string(), z.string()).optional(),
});

/**
 * Request body accepted by `POST /compile`.
 * Derived directly from the Zod schema so the runtime and type-level
 * definitions cannot drift apart.
 */
type ContainerCompileRequest = z.infer<typeof ContainerCompileRequestSchema>;

/**
 * HTTP handler for the container server.
 *
 * Routes:
 * - `GET /health`  – returns `{ status: "ok", version }` as JSON
 * - `POST /compile` – compiles the provided configuration and returns rules as plain text
 * - anything else  – 404
 *
 * Exported so that it can be imported and tested independently without
 * starting a live server.
 *
 * @param request - The incoming HTTP request
 * @returns A {@link Response} with the appropriate status code and body
 */
export async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
        return Response.json({ status: 'ok', version: VERSION });
    }

    if (request.method === 'POST' && url.pathname === '/compile') {
        // Read per-request so tests can set the env var before calling
        const containerSecret = Deno.env.get('CONTAINER_SECRET') ?? '';

        // Verify shared secret for defense-in-depth; fail closed if misconfigured
        if (!containerSecret) {
            console.error('[container-server] CONTAINER_SECRET is not configured; refusing /compile request');
            return new Response('Service unavailable: container secret not configured', { status: 503 });
        }

        const provided = request.headers.get('X-Container-Secret');
        if (!provided || provided !== containerSecret) {
            return new Response('Unauthorized', { status: 401 });
        }

        let rawBody: unknown;
        try {
            rawBody = await request.json();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return new Response(`Invalid JSON body: ${message}`, { status: 400 });
        }

        // Validate the request body with Zod so callers get structured,
        // field-level error messages instead of a generic string on bad input.
        const parseResult = ContainerCompileRequestSchema.safeParse(rawBody);
        if (!parseResult.success) {
            return Response.json(
                { error: 'Invalid request body', details: parseResult.error.format() },
                { status: 400 },
            );
        }
        const body = parseResult.data;

        try {
            const compiler = new WorkerCompiler({
                preFetchedContent: body.preFetchedContent,
            });
            const rules = await compiler.compile(body.configuration);
            const output = rules.join('\n');
            return new Response(output, {
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[container-server] Compilation error:', message);
            return new Response(`Compilation failed: ${message}`, { status: 500 });
        }
    }

    return new Response('Not Found', { status: 404 });
}

if (import.meta.main) {
    console.log(`[container-server] Listening on port ${PORT}`);
    Deno.serve({ port: PORT, hostname: '0.0.0.0' }, handler);
}
