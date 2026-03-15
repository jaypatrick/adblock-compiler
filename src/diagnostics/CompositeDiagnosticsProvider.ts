/**
 * CompositeDiagnosticsProvider — fan-out to multiple backends simultaneously.
 *
 * Allows combining any number of IDiagnosticsProvider implementations so that,
 * for example, Sentry (error tracking) and OpenTelemetry (traces) both receive
 * every event without duplication of call sites.
 *
 * @example
 * ```typescript
 * import { CompositeDiagnosticsProvider, SentryDiagnosticsProvider, OpenTelemetryDiagnosticsProvider } from '../diagnostics/index.ts';
 *
 * const composite = new CompositeDiagnosticsProvider([
 *     new SentryDiagnosticsProvider({ dsn: env.SENTRY_DSN }),
 *     new OpenTelemetryDiagnosticsProvider({ serviceName: 'adblock-compiler' }),
 * ]);
 *
 * composite.captureError(new Error('oops'));
 * const span = composite.startSpan('compile');
 * composite.recordMetric('rule_count', 5000);
 * await composite.flush();
 * ```
 */

import type { DiagnosticsBreadcrumb, DiagnosticsLevel, DiagnosticsUser, IDiagnosticsProvider, ISpan } from './IDiagnosticsProvider.ts';

// ---------------------------------------------------------------------------
// CompositeSpan — delegates ISpan calls to all child spans
// ---------------------------------------------------------------------------

const NOOP_SPAN: ISpan = {
    end: () => {},
    setAttribute: () => {},
    setAttributes: () => {},
    recordException: () => {},
    addEvent: () => {},
};

class CompositeSpan implements ISpan {
    constructor(private readonly spans: ISpan[]) {}

    end(): void {
        for (const span of this.spans) {
            try {
                span.end();
            } catch {
                // Never let a child span failure propagate
            }
        }
    }

    setAttribute(key: string, value: string | number | boolean): void {
        for (const span of this.spans) {
            try {
                span.setAttribute(key, value);
            } catch {
                // swallow
            }
        }
    }

    setAttributes(attributes: Record<string, string | number | boolean>): void {
        for (const span of this.spans) {
            try {
                span.setAttributes(attributes);
            } catch {
                // swallow
            }
        }
    }

    recordException(error: Error): void {
        for (const span of this.spans) {
            try {
                span.recordException(error);
            } catch {
                // swallow
            }
        }
    }

    addEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
        for (const span of this.spans) {
            try {
                span.addEvent(name, attributes);
            } catch {
                // swallow
            }
        }
    }
}

// ---------------------------------------------------------------------------
// CompositeDiagnosticsProvider
// ---------------------------------------------------------------------------

/**
 * Fans out every call to all registered child providers.
 *
 * - Errors thrown by any child are swallowed so they cannot interfere with
 *   each other or with application logic.
 * - A CompositeDiagnosticsProvider can itself be nested inside another for
 *   hierarchical routing.
 * - flush() uses Promise.allSettled() so one slow backend never blocks others.
 */
export class CompositeDiagnosticsProvider implements IDiagnosticsProvider {
    private readonly providers: ReadonlyArray<IDiagnosticsProvider>;

    /**
     * @param providers - One or more providers to fan out to.
     *   Passing zero providers is valid and equivalent to NoOpDiagnosticsProvider.
     */
    constructor(providers: IDiagnosticsProvider[]) {
        this.providers = providers;
    }

    captureError(error: Error, context?: Record<string, unknown>): void {
        for (const provider of this.providers) {
            try {
                provider.captureError(error, context);
            } catch {
                // Never let a child provider failure propagate
            }
        }
    }

    captureMessage(
        message: string,
        level?: DiagnosticsLevel,
        context?: Record<string, unknown>,
    ): void {
        for (const provider of this.providers) {
            try {
                provider.captureMessage(message, level, context);
            } catch {
                // swallow
            }
        }
    }

    startSpan(name: string, attributes?: Record<string, string | number>): ISpan {
        const childSpans = this.providers.map((provider) => {
            try {
                return provider.startSpan(name, attributes);
            } catch {
                return NOOP_SPAN;
            }
        });
        return new CompositeSpan(childSpans);
    }

    recordMetric(name: string, value: number, tags?: Record<string, string>): void {
        for (const provider of this.providers) {
            try {
                provider.recordMetric(name, value, tags);
            } catch {
                // swallow
            }
        }
    }

    setUser(user: DiagnosticsUser): void {
        for (const provider of this.providers) {
            try {
                provider.setUser(user);
            } catch {
                // swallow
            }
        }
    }

    setContext(name: string, context: Record<string, unknown>): void {
        for (const provider of this.providers) {
            try {
                provider.setContext(name, context);
            } catch {
                // swallow
            }
        }
    }

    addBreadcrumb(breadcrumb: DiagnosticsBreadcrumb): void {
        for (const provider of this.providers) {
            try {
                provider.addBreadcrumb(breadcrumb);
            } catch {
                // swallow
            }
        }
    }

    async flush(): Promise<void> {
        // allSettled ensures a slow or failing provider never blocks the others
        await Promise.allSettled(this.providers.map((p) => p.flush()));
    }

    /** Returns the number of registered child providers. */
    get size(): number {
        return this.providers.length;
    }
}
