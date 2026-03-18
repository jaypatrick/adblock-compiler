/**
 * @disabled Grafana/OTLP tracing is not active in the Worker runtime.
 * TODO(grafana-phase2): Wire this provider into diagnostics-factory.ts once
 * OTEL_EXPORTER_OTLP_ENDPOINT is configured in Cloudflare Worker secrets.
 *
 * The file is kept intact so Phase 2 re-enablement is a one-line uncomment
 * in diagnostics-factory.ts.
 */

/**
 * OpenTelemetryDiagnosticsProvider — routes spans and metrics via OTLP.
 *
 * Bridges the IDiagnosticsProvider interface to the OpenTelemetry JS SDK.
 *
 * Set OTEL_EXPORTER_OTLP_ENDPOINT in your Worker secrets to point at
 * your collector (Grafana Cloud, Honeycomb, Dash0, etc.):
 *   wrangler secret put OTEL_EXPORTER_OTLP_ENDPOINT
 *
 * Wire this provider into worker/worker.ts alongside the Sentry wrap, or
 * via registerDiagnosticsProvider() in diagnostics-factory.ts.
 */

import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { Span as OtelSpan, Tracer } from '@opentelemetry/api';
import type { DiagnosticsBreadcrumb, DiagnosticsLevel, DiagnosticsUser, IDiagnosticsProvider, ISpan } from './IDiagnosticsProvider.ts';

export interface OpenTelemetryDiagnosticsProviderOptions {
    /** Service name reported in traces. Default: 'adblock-compiler' */
    serviceName?: string;
    /** Service version. Recommend passing env.COMPILER_VERSION. */
    serviceVersion?: string;
    /**
     * Optional pre-configured tracer. If not provided, uses the global
     * OTel tracer obtained via trace.getTracer().
     */
    tracer?: Tracer;
}

const OTEL_LEVEL_MAP: Record<DiagnosticsLevel, string> = {
    debug: 'DEBUG',
    info: 'INFO',
    warning: 'WARN',
    error: 'ERROR',
    fatal: 'FATAL',
};

/**
 * Wraps an OpenTelemetry Span as an ISpan.
 */
class OtelSpanAdapter implements ISpan {
    constructor(private readonly span: OtelSpan) {}

    end(): void {
        this.span.end();
    }

    setAttribute(key: string, value: string | number | boolean): void {
        this.span.setAttribute(key, value);
    }

    setAttributes(attributes: Record<string, string | number | boolean>): void {
        this.span.setAttributes(attributes);
    }

    recordException(error: Error): void {
        this.span.recordException(error);
        this.span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    }

    addEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
        this.span.addEvent(name, attributes);
    }
}

export class OpenTelemetryDiagnosticsProvider implements IDiagnosticsProvider {
    private readonly tracer: Tracer;
    // Stored for attaching to future spans (OTel has no global setUser/setContext)
    private _user: DiagnosticsUser | null = null;
    private _contexts: Map<string, Record<string, unknown>> = new Map();

    constructor(options: OpenTelemetryDiagnosticsProviderOptions = {}) {
        this.tracer = options.tracer ??
            trace.getTracer(
                options.serviceName ?? 'adblock-compiler',
                options.serviceVersion ?? '0.0.0',
            );
    }

    captureError(error: Error, context?: Record<string, unknown>): void {
        const span = this.tracer.startSpan('captureError');
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        if (context) {
            for (const [key, value] of Object.entries(context)) {
                if (
                    typeof value === 'string' ||
                    typeof value === 'number' ||
                    typeof value === 'boolean'
                ) {
                    span.setAttribute(`error.context.${key}`, value);
                }
            }
        }
        span.end();
    }

    captureMessage(
        message: string,
        level: DiagnosticsLevel = 'info',
        context?: Record<string, unknown>,
    ): void {
        const span = this.tracer.startSpan('captureMessage');
        span.setAttribute('message', message);
        span.setAttribute('level', OTEL_LEVEL_MAP[level]);
        if (context) {
            for (const [key, value] of Object.entries(context)) {
                if (
                    typeof value === 'string' ||
                    typeof value === 'number' ||
                    typeof value === 'boolean'
                ) {
                    span.setAttribute(`message.context.${key}`, value);
                }
            }
        }
        span.end();
    }

    startSpan(name: string, attributes?: Record<string, string | number>): ISpan {
        const span = this.tracer.startSpan(name);
        if (attributes) {
            for (const [key, value] of Object.entries(attributes)) {
                span.setAttribute(key, value);
            }
        }
        // Attach current user / context state to every new span
        if (this._user?.id) span.setAttribute('enduser.id', String(this._user.id));
        if (this._user?.email) span.setAttribute('enduser.email', String(this._user.email));
        for (const [ctxName, ctxData] of this._contexts) {
            for (const [key, value] of Object.entries(ctxData)) {
                if (
                    typeof value === 'string' ||
                    typeof value === 'number' ||
                    typeof value === 'boolean'
                ) {
                    span.setAttribute(`context.${ctxName}.${key}`, value);
                }
            }
        }
        return new OtelSpanAdapter(span);
    }

    recordMetric(name: string, value: number, tags?: Record<string, string>): void {
        // OTel MeterProvider not yet configured — emit a span event so
        // trace backends (Grafana, Honeycomb) can at least see the value.
        const span = this.tracer.startSpan(`metric.${name}`);
        span.setAttribute('metric.value', value);
        if (tags) {
            for (const [k, v] of Object.entries(tags)) {
                span.setAttribute(`metric.tag.${k}`, v);
            }
        }
        span.end();
    }

    setUser(user: DiagnosticsUser): void {
        this._user = user;
    }

    setContext(name: string, context: Record<string, unknown>): void {
        this._contexts.set(name, context);
    }

    addBreadcrumb(breadcrumb: DiagnosticsBreadcrumb): void {
        // Breadcrumbs don't map directly to OTel — emit a span event instead
        const span = this.tracer.startSpan('breadcrumb');
        span.addEvent(breadcrumb.message, {
            ...(breadcrumb.level ? { level: OTEL_LEVEL_MAP[breadcrumb.level] } : {}),
            ...(breadcrumb.category ? { category: breadcrumb.category } : {}),
        });
        span.end();
    }

    async flush(): Promise<void> {
        // OTel force-flush is not universally available across exporters.
        // The OTLP HTTP exporter sends spans eagerly on end(); this is a no-op.
        await Promise.resolve();
    }
}
