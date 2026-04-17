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
import type { Env, ErrorQueueMessage, QueueMessage } from './types.ts';

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

// Hono app (handles routing, CORS, auth)
import { app } from './hono-app.ts';

// Scheduled cron handler
import { handleScheduled } from './handlers/scheduled.ts';

// Queue handlers
import { handleQueue } from './handlers/queue.ts';
import { handleErrorQueue } from './handlers/error-queue.ts';

// Services
import { createDiagnosticsProvider } from './services/diagnostics-factory.ts';
import { withSentryWorker } from './services/sentry-init.ts';
import { withTimeout } from './utils/with-timeout.ts';

// Workflows and MCP agent
import { BatchCompilationWorkflow, CacheWarmingWorkflow, CompilationWorkflow, HealthMonitoringWorkflow } from './workflows/index.ts';
import { PlaywrightMcpAgent } from './mcp-agent.ts';
import { CompilationCoordinator } from './compilation-coordinator.ts';
import { RateLimiterDO } from './rate-limiter-do.ts';
import { WsHibernationDO } from './ws-hibernation-do.ts';

// Re-export Env for compatibility with existing imports
export type { Env };

// ============================================================================
// Feature flag usage example
// ============================================================================
//
// Create the service once per request (or cache it on the env object):
//
//   import { createFeatureFlagService } from './services/feature-flag-service.ts';
//
//   const featureFlags = createFeatureFlagService(env.FEATURE_FLAGS, logger);
//
//   // Check a flag before executing feature-specific code:
//   if (await featureFlags.isEnabled('ENABLE_BATCH_STREAMING')) {
//       return handleCompileStreamBatch(request, env, ctx);
//   }
//
//   // Toggle a flag programmatically (e.g. from an admin handler):
//   await featureFlags.setFlag('ENABLE_VERBOSE_ERRORS', true);
//
//   // Inject into WorkerCompiler for compiler-level feature gating:
//   const compiler = new WorkerCompiler({
//       dependencies: { featureFlagService: featureFlags },
//   });
//
// See: docs/feature-flags/KV_FEATURE_FLAGS.md

// ============================================================================
// Worker handler
// ============================================================================

interface WorkerHandler extends ExportedHandler<Env> {}

const workerHandler: WorkerHandler = {
    async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext,
    ): Promise<Response> {
        const url = new URL(request.url);
        const { pathname } = url;

        const diagnostics = createDiagnosticsProvider(env);
        const requestSpan = diagnostics.startSpan(`http.${request.method}`, {
            url: pathname,
        });

        try {
            return await app.fetch(request, env, ctx);
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
            ctx.waitUntil(withTimeout(diagnostics.flush(), 3_000));
        }
    },

    async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
        // Route to appropriate handler based on queue name
        const queueName = batch.queue;

        if (queueName === 'adblock-compiler-error-queue') {
            // Error logging queue - persist errors to R2
            await handleErrorQueue(batch as MessageBatch<ErrorQueueMessage>, env);
        } else if (queueName === 'adblock-compiler-worker-queue' || queueName === 'adblock-compiler-worker-queue-high-priority') {
            // Compilation queues - process compile jobs
            await handleQueue(batch as MessageBatch<QueueMessage>, env);
        } else {
            // Unknown queue - log warning and ack all messages to prevent retries
            // deno-lint-ignore no-console
            console.warn(`[WORKER] Unknown queue: ${queueName}, acking all messages`);
            batch.ackAll();
        }
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
export { BatchCompilationWorkflow, CacheWarmingWorkflow, CompilationCoordinator, CompilationWorkflow, HealthMonitoringWorkflow, PlaywrightMcpAgent, RateLimiterDO, WsHibernationDO };
