/**
 * SentryDiagnosticsProvider — routes errors and performance spans to Sentry.
 *
 * Uses the Deno-native Sentry SDK (`@sentry/deno`), registered in the
 * `deno.json` imports map as:
 *   "@sentry/deno": "npm:@sentry/deno@^9"
 *
 * TODO: Add SENTRY_DSN to your Cloudflare Worker environment secrets:
 *   wrangler secret put SENTRY_DSN
 *
 * Initialise once at the worker entry point (worker/worker.ts) using
 * withSentryWorker() from worker/services/sentry-init.ts.
 */

import * as Sentry from '@sentry/deno';
import type { IDiagnosticsProvider, ISpan } from './IDiagnosticsProvider.ts';

/**
 * Options for the Sentry diagnostics provider.
 */
export interface SentryDiagnosticsProviderOptions {
    /** Sentry DSN. Read from env.SENTRY_DSN at the call site. */
    dsn: string;
    /**
     * Fraction of transactions to sample for performance monitoring (0.0–1.0).
     * Default: 0.1 (10 %)
     */
    tracesSampleRate?: number;
    /** Service release / version tag. Recommend passing env.COMPILER_VERSION. */
    release?: string;
    /** Sentry environment tag. Default: 'production' */
    environment?: string;
}

export class SentryDiagnosticsProvider implements IDiagnosticsProvider {
    private readonly options: Required<SentryDiagnosticsProviderOptions>;
    // Guard flag to ensure Sentry.init() is called at most once per instance.
    private initPromise: Promise<void> | null = null;

    constructor(options: SentryDiagnosticsProviderOptions) {
        this.options = {
            tracesSampleRate: 0.1,
            release: 'unknown',
            environment: 'production',
            ...options,
        };
    }

    private ensureInit(): void {
        if (this.initPromise !== null) return;
        // Mark as initialised immediately (single-threaded event loop — no race).
        this.initPromise = Promise.resolve();
        try {
            Sentry.init({
                dsn: this.options.dsn,
                tracesSampleRate: this.options.tracesSampleRate,
                release: this.options.release,
                environment: this.options.environment,
            });
        } catch (err) {
            // Log the failure so operators know Sentry is not capturing events,
            // then allow a retry on the next captureError/startSpan call.
            // deno-lint-ignore no-console
            console.warn(
                '[SentryDiagnosticsProvider] Sentry.init failed — error capture disabled:',
                err instanceof Error ? err.message : String(err),
            );
            this.initPromise = null;
        }
    }

    captureError(error: Error, context?: Record<string, unknown>): void {
        this.ensureInit();
        try {
            Sentry.withScope((scope: { setExtras: (extras: Record<string, unknown>) => void }) => {
                if (context) scope.setExtras(context);
                Sentry.captureException(error);
            });
        } catch {
            // Never propagate errors from the diagnostics layer
        }
    }

    startSpan(name: string, _attributes?: Record<string, string | number>): ISpan {
        // TODO(#sentry-deno): Replace with Sentry.startSpan() once @sentry/deno tracing is
        // fully configured via withSentryWorker().
        // For now this returns a lightweight span that records the exception to Sentry
        // on recordException().
        const recordException = (error: Error) => {
            this.captureError(error, { spanName: name });
        };
        return {
            end: () => {},
            setAttribute: () => {},
            recordException,
        };
    }

    recordMetric(_name: string, _value: number, _tags?: Record<string, string>): void {
        // TODO(#sentry-metrics): Sentry Metrics (currently in beta for CF Workers).
        // For numeric metrics, prefer routing through AnalyticsService.writeDataPoint()
        // or the Prometheus /metrics endpoint (Phase 2).
    }
}
