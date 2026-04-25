/// <reference types="@cloudflare/workers-types" />

/**
 * CompilationCoordinator — Durable Object for global request deduplication.
 *
 * Provides a single coordination point across all Worker instances worldwide to
 * deduplicate concurrent compilation requests for identical configurations.
 *
 * **Architecture**:
 * - Each unique cache key gets its own DO instance (derived from cache key hash)
 * - DO maintains in-flight status flag with transactional storage guarantees
 * - Multiple Workers hitting the same cache key coordinate via this DO
 * - First request sets in-flight flag, subsequent requests poll or wait
 * - DO does NOT perform compilation itself — that stays in the Worker
 *
 * **Cost optimization**:
 * - DO instances automatically hibernate after inactivity (reduces billing)
 * - In-flight status is held in memory only (no persistent storage overhead)
 * - DO lives only as long as there are pending compilations for that cache key
 *
 * **Usage from Worker**:
 * ```ts
 * const id = env.COMPILATION_COORDINATOR.idFromName(cacheKey);
 * const stub = env.COMPILATION_COORDINATOR.get(id);
 *
 * // Try to acquire lock
 * const acquired = await stub.fetch('/acquire');
 * if (acquired.ok) {
 *   try {
 *     // This Worker performs the compilation
 *     const result = await performCompilation();
 *     // Notify DO that compilation is complete
 *     await stub.fetch('/complete', { method: 'POST', body: JSON.stringify(result) });
 *   } catch (err) {
 *     await stub.fetch('/fail', { method: 'POST', body: JSON.stringify({ error: err.message }) });
 *   }
 * } else {
 *   // Wait for the in-flight compilation to complete
 *   const result = await stub.fetch('/wait');
 * }
 * ```
 */

import * as Sentry from '@sentry/cloudflare';

import type { Env } from './types.ts';

interface CompilationState {
    /** True if a compilation is currently in-flight */
    inFlight: boolean;
    /** Timestamp when the in-flight compilation started */
    startedAt?: number;
    /** Serialized CompilationResult once complete */
    result?: string;
    /** Serialized error if the compilation failed */
    error?: string;
    /** Number of waiters currently polling for this compilation */
    waiters: number;
}

/**
 * Durable Object that coordinates global request deduplication.
 */
class CompilationCoordinatorBase implements DurableObject {
    /** Compilation state for this cache key */
    private compilationState: CompilationState = {
        inFlight: false,
        waiters: 0,
    };

    constructor(_state: DurableObjectState, _env: unknown) {
        // State and env are currently unused but required by DurableObject interface
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const { pathname } = url;

        try {
            switch (pathname) {
                case '/acquire':
                    return this.handleAcquire();
                case '/complete':
                    return await this.handleComplete(request);
                case '/fail':
                    return await this.handleFail(request);
                case '/wait':
                    return await this.handleWait();
                case '/status':
                    return this.handleStatus();
                default:
                    return Response.json(
                        { success: false, error: 'Invalid path' },
                        { status: 404 },
                    );
            }
        } catch (err) {
            return Response.json(
                {
                    success: false,
                    error: err instanceof Error ? err.message : String(err),
                },
                { status: 500 },
            );
        }
    }

    /**
     * Try to acquire the compilation lock.
     * Returns 200 if lock acquired, 409 if already in-flight.
     */
    private handleAcquire(): Response {
        if (this.compilationState.inFlight) {
            return Response.json(
                { success: false, acquired: false, inFlight: true },
                { status: 409 },
            );
        }

        // Acquire the lock
        this.compilationState.inFlight = true;
        this.compilationState.startedAt = Date.now();
        this.compilationState.result = undefined;
        this.compilationState.error = undefined;

        return Response.json({ success: true, acquired: true });
    }

    /**
     * Mark compilation as complete and store the result.
     */
    private async handleComplete(request: Request): Promise<Response> {
        if (!this.compilationState.inFlight) {
            return Response.json(
                { success: false, error: 'No compilation in flight' },
                { status: 400 },
            );
        }

        const body = await request.text();
        this.compilationState.inFlight = false;
        this.compilationState.result = body;
        this.compilationState.error = undefined;

        // Wake up all waiters (if using WebSocket, this would be a broadcast)
        return Response.json({ success: true });
    }

    /**
     * Mark compilation as failed.
     */
    private async handleFail(request: Request): Promise<Response> {
        if (!this.compilationState.inFlight) {
            return Response.json(
                { success: false, error: 'No compilation in flight' },
                { status: 400 },
            );
        }

        const body = await request.text();
        this.compilationState.inFlight = false;
        this.compilationState.error = body;
        this.compilationState.result = undefined;

        return Response.json({ success: true });
    }

    /**
     * Wait for the in-flight compilation to complete.
     * Polls every 100ms until result is available (max 30s).
     */
    private async handleWait(): Promise<Response> {
        this.compilationState.waiters++;

        try {
            const maxWaitMs = 30000;
            const pollIntervalMs = 100;
            const started = Date.now();

            while (Date.now() - started < maxWaitMs) {
                if (this.compilationState.result) {
                    return new Response(this.compilationState.result, {
                        status: 200,
                        headers: { 'Content-Type': 'application/json', 'X-Request-Deduplication': 'HIT' },
                    });
                }

                if (this.compilationState.error) {
                    return Response.json(
                        { success: false, error: JSON.parse(this.compilationState.error) },
                        { status: 500, headers: { 'X-Request-Deduplication': 'HIT' } },
                    );
                }

                if (!this.compilationState.inFlight) {
                    // Compilation finished but no result/error set — stale state
                    return Response.json(
                        { success: false, error: 'Compilation completed but no result available' },
                        { status: 500 },
                    );
                }

                // Wait before next poll
                await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            }

            return Response.json(
                { success: false, error: 'Wait timeout - compilation did not complete within 30 seconds' },
                { status: 504 },
            );
        } finally {
            this.compilationState.waiters--;
        }
    }

    /**
     * Get current compilation status.
     */
    private handleStatus(): Response {
        return Response.json({
            success: true,
            inFlight: this.compilationState.inFlight,
            hasResult: !!this.compilationState.result,
            hasError: !!this.compilationState.error,
            waiters: this.compilationState.waiters,
            startedAt: this.compilationState.startedAt,
        });
    }
}

// The inner cast bridges the gap between our `implements DurableObject` constructor
// (which uses `_env: unknown`) and the `new(state, env: Env) => DurableObject<Env, {}>`
// signature that `instrumentDurableObjectWithSentry` requires (the actual runtime
// class is `cloudflare:workers`'s branded `DurableObject<Env, {}>`).  The outer cast
// restores `typeof CompilationCoordinatorBase` so callers see non-optional methods
// and an `unknown`-typed env parameter.
export const CompilationCoordinator = Sentry.instrumentDurableObjectWithSentry(
    (env: Env) => ({
        dsn: env.SENTRY_DSN,
        release: env.SENTRY_RELEASE ?? env.COMPILER_VERSION,
        environment: env.ENVIRONMENT ?? 'production',
        tracesSampleRate: 0.1,
    }),
    CompilationCoordinatorBase as unknown as new (state: DurableObjectState, env: Env) => DurableObject<Env, {}>,
) as unknown as typeof CompilationCoordinatorBase;
