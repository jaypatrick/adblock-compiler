/**
 * Cloudflare Worker for compiling hostlists.
 *
 * Thin entry-point: wires the Container Durable Object, Sentry, and the
 * exported Workflow/MCP classes, then delegates every request to the
 * router in `./handlers/router.ts`.
 */

// Use a path reference (not triple-slash "types" directive) so the Deno LSP resolves
// the Cloudflare Workers global types directly, bypassing import-map lookup which the
// LSP does not apply to `/// <reference types />` directives.
/// <reference path="../node_modules/@cloudflare/workers-types/index.d.ts" />

// Types
import type { Env, QueueMessage } from './types.ts';

// Container class for Cloudflare Containers deployment.
// @deno-types="./cloudflare-containers-types.d.ts"
import { Container } from '@cloudflare/containers';

/**
 * Cloudflare Container-enabled Durable Object for the Adblock Compiler.
 */
export class AdblockCompiler extends Container {
    override defaultPort = 8787;
    /** Stop the container after 10 minutes of inactivity to reduce cost. */
    override sleepAfter = '10m';

    override onStart(): void {
        console.log('[AdblockCompiler] Container started');
    }

    override onStop(_: { exitCode: number; reason: string }): void {
        console.log('[AdblockCompiler] Container stopped');
    }

    override onError(error: unknown): void {
        console.error(
            '[AdblockCompiler] Container error:',
            error instanceof Error ? error.message : String(error),
        );
    }
}

// CORS helpers (needed in fetch() before delegation)
import { getCorsHeaders, getPublicCorsHeaders, handleCorsPreflight, isPublicEndpoint } from './utils/cors.ts';

// Router (all business-logic routing lives here)
import { handleRequest } from './handlers/router.ts';

// Scheduled cron handler
import { handleScheduled } from './handlers/scheduled.ts';

// Queue handler
import { handleQueue } from './handlers/queue.ts';

// Services
import { createDiagnosticsProvider } from './services/diagnostics-factory.ts';
import { withSentryWorker } from './services/sentry-init.ts';

// Workflows and MCP agent
import { BatchCompilationWorkflow, CacheWarmingWorkflow, CompilationWorkflow, HealthMonitoringWorkflow } from './workflows/index.ts';
import { PlaywrightMcpAgent } from './mcp-agent.ts';

// Re-export Env for compatibility with existing imports
export type { Env };

// ============================================================================
// Worker handler
// ============================================================================

interface WorkerHandler extends ExportedHandler<Env> {
    _handleRequest(
        request: Request,
        env: Env,
        url: URL,
        pathname: string,
        ctx: ExecutionContext,
    ): Promise<Response>;
}

const workerHandler: WorkerHandler = {
    async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext,
    ): Promise<Response> {
        const url = new URL(request.url);
        const { pathname } = url;

        if (request.method === 'OPTIONS') {
            return handleCorsPreflight(request, env);
        }

        const corsHeaders = isPublicEndpoint(pathname) ? getPublicCorsHeaders() : getCorsHeaders(request, env);
        const diagnostics = createDiagnosticsProvider(env);
        const requestSpan = diagnostics.startSpan(`http.${request.method}`, {
            url: pathname,
        });

        let response: Response;
        try {
            response = await this._handleRequest(
                request,
                env,
                url,
                pathname,
                ctx,
            );
        } catch (err) {
            requestSpan.recordException(
                err instanceof Error ? err : new Error(String(err)),
            );
            diagnostics.captureError(
                err instanceof Error ? err : new Error(String(err)),
                {
                    url: request.url,
                    method: request.method,
                },
            );
            throw err;
        } finally {
            requestSpan.end();
            ctx.waitUntil(diagnostics.flush());
        }

        if (response.status === 101) return response;

        const newHeaders = new Headers(response.headers);
        for (const [k, v] of Object.entries(corsHeaders)) newHeaders.set(k, v);
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
        });
    },

    /** @internal Delegates to the router; called by fetch() which wraps the response with CORS headers. */
    _handleRequest(
        request: Request,
        env: Env,
        url: URL,
        pathname: string,
        ctx: ExecutionContext,
    ): Promise<Response> {
        return handleRequest(request, env, url, pathname, ctx);
    },

    async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
        await handleQueue(batch as MessageBatch<QueueMessage>, env);
    },

    async scheduled(
        controller: ScheduledController,
        env: Env,
        _ctx: ExecutionContext,
    ): Promise<void> {
        await handleScheduled(controller, env);
    },
};

// Wrap with Sentry error tracking. When SENTRY_DSN is not set the original
// handler is returned unchanged — zero overhead in local development.
// Grafana/OTLP tracing is disabled — see diagnostics-factory.ts TODO(grafana-phase2).
export default withSentryWorker(workerHandler, (env) => ({
    dsn: env.SENTRY_DSN,
    release: env.SENTRY_RELEASE ?? env.COMPILER_VERSION,
    environment: env.ENVIRONMENT ?? 'production',
}));

// ============================================================================
// Export Workflow classes for Cloudflare Workers runtime
// ============================================================================
export { BatchCompilationWorkflow, CacheWarmingWorkflow, CompilationWorkflow, HealthMonitoringWorkflow, PlaywrightMcpAgent };
