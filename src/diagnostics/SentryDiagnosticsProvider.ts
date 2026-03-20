/**
 * SentryDiagnosticsProvider — routes errors, messages, and performance spans
 * to Sentry via @sentry/cloudflare.
 *
 * Add the package to deno.json imports and run `deno install` to update deno.lock:
 *   "@sentry/cloudflare": "npm:@sentry/cloudflare@^10.43.0"
 *
 * Add your DSN to Cloudflare Worker secrets (never in wrangler.toml [vars]):
 *   wrangler secret put SENTRY_DSN
 *
 * The Worker export must be wrapped with withSentryWorker() (already done in
 * worker/worker.ts) to catch uncaught exceptions and attach request context.
 * This provider handles explicit, in-handler instrumentation.
 */

import type { DiagnosticsBreadcrumb, DiagnosticsLevel, DiagnosticsUser, IDiagnosticsProvider, ISpan } from './IDiagnosticsProvider.ts';

// Dynamic import keeps the module graph valid in environments where
// @sentry/cloudflare is not installed (e.g., Deno unit tests).
// deno-lint-ignore no-explicit-any
let SentryModule: any = null;

// deno-lint-ignore no-explicit-any
async function getSentry(): Promise<any> {
    if (!SentryModule) {
        SentryModule = await import('@sentry/cloudflare');
    }
    return SentryModule;
}

/** Sentinel level values understood by the Sentry SDK. */
const SENTRY_LEVEL_MAP: Record<DiagnosticsLevel, string> = {
    debug: 'debug',
    info: 'info',
    warning: 'warning',
    error: 'error',
    fatal: 'fatal',
};

/**
 * Options for the Sentry diagnostics provider.
 */
export interface SentryDiagnosticsProviderOptions {
    /** Sentry DSN. Read from env.SENTRY_DSN at the call site. */
    dsn: string;
    /**
     * Fraction of transactions sampled for performance monitoring (0.0–1.0).
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
    // Shared init promise prevents multiple concurrent Sentry.init() calls
    // if captureError() is invoked before the first init resolves.
    private initPromise: Promise<void> | null = null;

    constructor(options: SentryDiagnosticsProviderOptions) {
        this.options = {
            tracesSampleRate: 0.1,
            release: 'unknown',
            environment: 'production',
            ...options,
        };
    }

    private ensureInit(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = getSentry()
                .then((Sentry) => {
                    Sentry.init({
                        dsn: this.options.dsn,
                        tracesSampleRate: this.options.tracesSampleRate,
                        release: this.options.release,
                        environment: this.options.environment,
                    });
                })
                .catch((err) => {
                    // deno-lint-ignore no-console
                    console.warn(
                        '[SentryDiagnosticsProvider] Sentry.init failed — error capture disabled:',
                        err instanceof Error ? err.message : String(err),
                    );
                    this.initPromise = null;
                });
        }
        return this.initPromise;
    }

    captureError(error: Error, context?: Record<string, unknown>): void {
        this.ensureInit()
            .then(async () => {
                const Sentry = await getSentry();
                Sentry.withScope(
                    (scope: { setExtras: (extras: Record<string, unknown>) => void }) => {
                        if (context) scope.setExtras(context);
                        Sentry.captureException(error);
                    },
                );
            })
            .catch(() => {
                // Never propagate errors from the diagnostics layer
            });
    }

    captureMessage(
        message: string,
        level: DiagnosticsLevel = 'info',
        context?: Record<string, unknown>,
    ): void {
        this.ensureInit()
            .then(async () => {
                const Sentry = await getSentry();
                Sentry.withScope(
                    (scope: { setExtras: (extras: Record<string, unknown>) => void }) => {
                        if (context) scope.setExtras(context);
                        Sentry.captureMessage(message, SENTRY_LEVEL_MAP[level]);
                    },
                );
            })
            .catch(() => {});
    }

    startSpan(name: string, _attributes?: Record<string, string | number>): ISpan {
        // withSentryWorker() creates the top-level transaction for each request.
        // This span records sub-operations; on exception it also forwards to
        // captureError so the event appears in Sentry Issues.
        const recordException = (error: Error) => {
            this.captureError(error, { spanName: name });
        };
        return {
            end: () => {},
            setAttribute: () => {},
            setAttributes: () => {},
            recordException,
            addEvent: () => {},
        };
    }

    recordMetric(_name: string, _value: number, _tags?: Record<string, string>): void {
        // Sentry Metrics is in beta for CF Workers.
        // For numeric metrics, prefer AnalyticsService.writeDataPoint() or
        // the Prometheus /metrics endpoint.
    }

    setUser(user: DiagnosticsUser): void {
        this.ensureInit()
            .then(async () => {
                const Sentry = await getSentry();
                Sentry.setUser(user);
            })
            .catch(() => {});
    }

    setContext(name: string, context: Record<string, unknown>): void {
        this.ensureInit()
            .then(async () => {
                const Sentry = await getSentry();
                Sentry.setContext(name, context);
            })
            .catch(() => {});
    }

    addBreadcrumb(breadcrumb: DiagnosticsBreadcrumb): void {
        this.ensureInit()
            .then(async () => {
                const Sentry = await getSentry();
                Sentry.addBreadcrumb({
                    message: breadcrumb.message,
                    level: breadcrumb.level ? SENTRY_LEVEL_MAP[breadcrumb.level] : undefined,
                    category: breadcrumb.category,
                    data: breadcrumb.data,
                });
            })
            .catch(() => {});
    }

    async flush(): Promise<void> {
        try {
            const Sentry = await getSentry();
            // 2 000 ms is safe within a CF Worker's 10-30 s CPU budget
            await Sentry.flush(2000);
        } catch {
            // Never propagate errors from the diagnostics layer
        }
    }
}
