/**
 * IDiagnosticsProvider — pluggable observability abstraction.
 *
 * Implementations ship in this directory:
 *   - SentryDiagnosticsProvider          — errors + traces to Sentry
 *   - OpenTelemetryDiagnosticsProvider   — traces + metrics via OTLP
 *   - ConsoleDiagnosticsProvider         — structured JSON to stdout (dev/debug)
 *   - NoOpDiagnosticsProvider            — safe no-op (tests / default fallback)
 *
 * This interface sits alongside the existing IDiagnosticsCollector. The Collector
 * is for in-process event aggregation; the Provider is for external export.
 *
 * ## Adding a custom backend
 *
 * 1. Implement `IDiagnosticsProvider`.
 * 2. Register a builder with the factory (register once at module load):
 *
 * ```typescript
 * import { registerDiagnosticsProvider } from '../worker/services/diagnostics-factory.ts';
 * import { MyCustomProvider } from './my-custom-provider.ts';
 *
 * registerDiagnosticsProvider((env) =>
 *     env.MY_API_KEY ? new MyCustomProvider({ apiKey: env.MY_API_KEY }) : null,
 * );
 * ```
 */

// deno-lint-ignore-file no-console

// ============================================================================
// Supporting types
// ============================================================================

/** Log level / severity for captureMessage and addBreadcrumb. */
export type DiagnosticsLevel = 'debug' | 'info' | 'warning' | 'error' | 'fatal';

/** User identity context. Pass to setUser() to associate events with a user. */
export interface DiagnosticsUser {
    /** Unique identifier (e.g., Clerk user ID). */
    id?: string;
    username?: string;
    email?: string;
    /** Any additional user properties. */
    [key: string]: unknown;
}

/**
 * A structured breadcrumb recorded before a primary error or message.
 * Helps reconstruct the sequence of events that led to an issue.
 */
export interface DiagnosticsBreadcrumb {
    message: string;
    level?: DiagnosticsLevel;
    /** Logical grouping, e.g. 'http', 'ui.click', 'compile'. */
    category?: string;
    /** Arbitrary extra data. */
    data?: Record<string, unknown>;
}

// ============================================================================
// ISpan
// ============================================================================

/**
 * A single distributed-tracing span.
 * Callers MUST call end() exactly once; subsequent calls are no-ops.
 */
export interface ISpan {
    /** Finish the span and export it to the configured backend. */
    end(): void;
    /** Attach a single key/value attribute. */
    setAttribute(key: string, value: string | number | boolean): void;
    /** Attach multiple attributes in one call. Convenience over setAttribute(). */
    setAttributes(attributes: Record<string, string | number | boolean>): void;
    /** Record an exception on the span without ending it. */
    recordException(error: Error): void;
    /** Add a named event (log point) to the span timeline. */
    addEvent(name: string, attributes?: Record<string, string | number | boolean>): void;
}

// ============================================================================
// IDiagnosticsProvider
// ============================================================================

/**
 * Pluggable observability provider interface.
 *
 * All methods must be safe to call concurrently and must NEVER throw.
 * Implementations are expected to swallow / log their own errors internally.
 */
export interface IDiagnosticsProvider {
    // ------------------------------------------------------------------
    // Error / message capture
    // ------------------------------------------------------------------

    /**
     * Capture an error and forward it to the configured backend (e.g., Sentry).
     * Must never throw.
     */
    captureError(error: Error, context?: Record<string, unknown>): void;

    /**
     * Capture a plain message (non-error event) with an optional severity level.
     * Use for notable non-exception events such as "rate limit hit" or "cache miss".
     */
    captureMessage(
        message: string,
        level?: DiagnosticsLevel,
        context?: Record<string, unknown>,
    ): void;

    // ------------------------------------------------------------------
    // Distributed tracing
    // ------------------------------------------------------------------

    /**
     * Start a named span for distributed tracing.
     * @param name       - Span name, e.g. 'transform.deduplicate'
     * @param attributes - Optional initial attributes
     * @returns An ISpan that MUST be ended by the caller (call span.end()).
     */
    startSpan(name: string, attributes?: Record<string, string | number>): ISpan;

    // ------------------------------------------------------------------
    // Metrics
    // ------------------------------------------------------------------

    /**
     * Record a scalar metric (counter, gauge, or histogram observation).
     * @param name  - Metric name, e.g. 'compilation.ruleCount'
     * @param value - Numeric value
     * @param tags  - Optional tag dimensions
     */
    recordMetric(name: string, value: number, tags?: Record<string, string>): void;

    // ------------------------------------------------------------------
    // Context propagation
    // ------------------------------------------------------------------

    /**
     * Associate a user identity with subsequent events in this provider.
     * Implementations should scope user data to the current request / scope.
     */
    setUser(user: DiagnosticsUser): void;

    /**
     * Attach a named context object to subsequent events.
     * Useful for environment info, feature flags, request metadata.
     */
    setContext(name: string, context: Record<string, unknown>): void;

    /**
     * Record a breadcrumb — a structured event trail leading up to an error.
     * Implementations that do not support breadcrumbs should no-op.
     */
    addBreadcrumb(breadcrumb: DiagnosticsBreadcrumb): void;

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    /**
     * Flush any buffered events to the backend.
     *
     * IMPORTANT for Cloudflare Workers: call and await this in ctx.waitUntil()
     * to ensure delivery before the Worker context closes:
     *
     * ```typescript
     * ctx.waitUntil(diagnostics.flush());
     * ```
     *
     * Implementations that send synchronously may resolve immediately.
     */
    flush(): Promise<void>;
}

// ============================================================================
// No-op implementation (default / testing)
// ============================================================================

const NOOP_SPAN: ISpan = {
    end: () => {},
    setAttribute: () => {},
    setAttributes: () => {},
    recordException: () => {},
    addEvent: () => {},
};

/**
 * No-op provider — safe default that never throws and never exports data.
 * Returned by createNoOpDiagnosticsProvider() and useful in unit tests.
 */
export class NoOpDiagnosticsProvider implements IDiagnosticsProvider {
    captureError(_error: Error, _context?: Record<string, unknown>): void {}
    captureMessage(
        _message: string,
        _level?: DiagnosticsLevel,
        _context?: Record<string, unknown>,
    ): void {}
    startSpan(_name: string, _attributes?: Record<string, string | number>): ISpan {
        return NOOP_SPAN;
    }
    recordMetric(_name: string, _value: number, _tags?: Record<string, string>): void {}
    setUser(_user: DiagnosticsUser): void {}
    setContext(_name: string, _context: Record<string, unknown>): void {}
    addBreadcrumb(_breadcrumb: DiagnosticsBreadcrumb): void {}
    async flush(): Promise<void> {}
}

// ============================================================================
// Console implementation (development / debugging)
// ============================================================================

/**
 * Console provider — logs all observability calls to stdout as structured JSON.
 * Useful for local development or CI without a real backend configured.
 */
export class ConsoleDiagnosticsProvider implements IDiagnosticsProvider {
    captureError(error: Error, context?: Record<string, unknown>): void {
        console.error(
            JSON.stringify({
                level: 'error',
                event: 'captureError',
                message: error.message,
                stack: error.stack,
                context,
            }),
        );
    }

    captureMessage(
        message: string,
        level: DiagnosticsLevel = 'info',
        context?: Record<string, unknown>,
    ): void {
        const fn = level === 'error' || level === 'fatal' ? console.error : level === 'warning' ? console.warn : console.log;
        fn(JSON.stringify({ level, event: 'captureMessage', message, context }));
    }

    startSpan(name: string, attributes?: Record<string, string | number>): ISpan {
        const start = Date.now();
        console.log(JSON.stringify({ event: 'span.start', name, attributes }));
        return {
            end: () =>
                console.log(
                    JSON.stringify({ event: 'span.end', name, durationMs: Date.now() - start }),
                ),
            setAttribute: (key, value) => console.log(JSON.stringify({ event: 'span.setAttribute', name, key, value })),
            setAttributes: (attrs) =>
                console.log(
                    JSON.stringify({ event: 'span.setAttributes', name, attributes: attrs }),
                ),
            recordException: (err) =>
                console.error(
                    JSON.stringify({ event: 'span.recordException', name, message: err.message }),
                ),
            addEvent: (evtName, evtAttrs) =>
                console.log(
                    JSON.stringify({
                        event: 'span.addEvent',
                        name,
                        evtName,
                        attributes: evtAttrs,
                    }),
                ),
        };
    }

    recordMetric(name: string, value: number, tags?: Record<string, string>): void {
        console.log(JSON.stringify({ event: 'metric', name, value, tags }));
    }

    setUser(user: DiagnosticsUser): void {
        console.log(JSON.stringify({ event: 'setUser', user }));
    }

    setContext(name: string, context: Record<string, unknown>): void {
        console.log(JSON.stringify({ event: 'setContext', name, context }));
    }

    addBreadcrumb(breadcrumb: DiagnosticsBreadcrumb): void {
        console.log(JSON.stringify({ event: 'breadcrumb', ...breadcrumb }));
    }

    async flush(): Promise<void> {
        // Console output is synchronous; nothing to flush.
    }
}
