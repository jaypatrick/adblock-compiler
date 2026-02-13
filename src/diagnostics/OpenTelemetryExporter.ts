/**
 * OpenTelemetry integration for distributed tracing.
 * 
 * Bridges the existing IDiagnosticsCollector interface with OpenTelemetry's
 * standard tracing API for compatibility with major observability platforms.
 */

import { context, type Span, SpanStatusCode, type Tracer, trace } from '@opentelemetry/api';
import { VERSION } from '../version.ts';
import type { AnyDiagnosticEvent, IDiagnosticsCollector } from './types.ts';
import { TraceSeverity } from './types.ts';

/**
 * Configuration options for OpenTelemetry exporter
 */
export interface OpenTelemetryExporterOptions {
    /** Service name for telemetry */
    serviceName?: string;
    /** Service version */
    serviceVersion?: string;
    /** Whether to enable console output for debugging */
    enableConsoleLogging?: boolean;
    /** Tracer instance (if not provided, will use global tracer) */
    tracer?: Tracer;
}

/**
 * DiagnosticsCollector that exports events to OpenTelemetry.
 * 
 * This class bridges the existing diagnostics system with OpenTelemetry's
 * distributed tracing standard, enabling integration with platforms like
 * Datadog, Honeycomb, Jaeger, and others.
 */
export class OpenTelemetryExporter implements IDiagnosticsCollector {
    private readonly tracer: Tracer;
    private readonly serviceName: string;
    private readonly enableConsoleLogging: boolean;
    private readonly activeSpans = new Map<string, Span>();
    private readonly spanContexts = new Map<string, unknown>();
    private readonly operationNames = new Map<string, string>();

    /**
     * Creates a new OpenTelemetry exporter
     * @param options - Configuration options
     */
    constructor(options: OpenTelemetryExporterOptions = {}) {
        this.serviceName = options.serviceName ?? 'adblock-compiler';
        this.enableConsoleLogging = options.enableConsoleLogging ?? false;
        
        // Use provided tracer or get from global trace provider
        this.tracer = options.tracer ?? trace.getTracer(
            this.serviceName,
            options.serviceVersion ?? VERSION,
        );
    }

    /**
     * Records the start of an operation as an OpenTelemetry span
     */
    public operationStart(operation: string, input?: Record<string, unknown>): string {
        const span = this.tracer.startSpan(operation);
        const eventId = this.generateEventId();
        
        // Store span and context for later completion
        this.activeSpans.set(eventId, span);
        this.spanContexts.set(eventId, trace.setSpan(context.active(), span));
        this.operationNames.set(eventId, operation);

        // Add operation name as attribute
        span.setAttribute('operation.name', operation);
        span.setAttribute('service.name', this.serviceName);

        // Add input parameters as attributes if provided
        if (input) {
            for (const [key, value] of Object.entries(input)) {
                this.setSpanAttribute(span, `input.${key}`, value);
            }
        }

        if (this.enableConsoleLogging) {
            // deno-lint-ignore no-console
            console.debug(`[OpenTelemetry] Operation started: ${operation}`, { eventId, input });
        }

        return eventId;
    }

    /**
     * Records successful completion of an operation
     */
    public operationComplete(eventId: string, output?: Record<string, unknown>): void {
        const span = this.activeSpans.get(eventId);
        const operation = this.operationNames.get(eventId);

        if (!span) {
            if (this.enableConsoleLogging) {
                // deno-lint-ignore no-console
                console.warn(`[OpenTelemetry] Operation complete called for unknown span: ${eventId}`);
            }
            return;
        }

        // Add output as attributes if provided
        if (output) {
            for (const [key, value] of Object.entries(output)) {
                this.setSpanAttribute(span, `output.${key}`, value);
            }
        }

        // Mark span as successful
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();

        // Cleanup
        this.activeSpans.delete(eventId);
        this.spanContexts.delete(eventId);
        this.operationNames.delete(eventId);

        if (this.enableConsoleLogging) {
            // deno-lint-ignore no-console
            console.debug(`[OpenTelemetry] Operation completed: ${operation}`, { eventId, output });
        }
    }

    /**
     * Records an error during an operation
     */
    public operationError(eventId: string, error: Error): void {
        const span = this.activeSpans.get(eventId);
        const operation = this.operationNames.get(eventId);

        if (!span) {
            if (this.enableConsoleLogging) {
                // deno-lint-ignore no-console
                console.warn(`[OpenTelemetry] Operation error called for unknown span: ${eventId}`);
            }
            return;
        }

        // Record the exception in the span
        span.recordException(error);
        
        // Set span status to error
        span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
        });

        // Add error attributes
        span.setAttribute('error.type', error.name);
        span.setAttribute('error.message', error.message);
        if (error.stack) {
            span.setAttribute('error.stack', error.stack);
        }

        span.end();

        // Cleanup
        this.activeSpans.delete(eventId);
        this.spanContexts.delete(eventId);
        this.operationNames.delete(eventId);

        if (this.enableConsoleLogging) {
            // deno-lint-ignore no-console
            console.error(`[OpenTelemetry] Operation failed: ${operation}`, { eventId, error: error.message });
        }
    }

    /**
     * Records a performance metric as span attributes
     */
    public recordMetric(
        metric: string,
        value: number,
        unit: string,
        dimensions?: Record<string, string>,
    ): void {
        // Create a short-lived span for the metric
        const span = this.tracer.startSpan(`metric.${metric}`);
        
        span.setAttribute('metric.name', metric);
        span.setAttribute('metric.value', value);
        span.setAttribute('metric.unit', unit);

        if (dimensions) {
            for (const [key, dimValue] of Object.entries(dimensions)) {
                span.setAttribute(`dimension.${key}`, dimValue);
            }
        }

        span.setStatus({ code: SpanStatusCode.OK });
        span.end();

        if (this.enableConsoleLogging) {
            // deno-lint-ignore no-console
            console.debug(`[OpenTelemetry] Metric recorded: ${metric} = ${value} ${unit}`, dimensions);
        }
    }

    /**
     * Records a cache event as span attributes
     */
    public recordCacheEvent(
        operation: 'hit' | 'miss' | 'write' | 'evict',
        key: string,
        size?: number,
    ): void {
        const span = this.tracer.startSpan(`cache.${operation}`);
        
        span.setAttribute('cache.operation', operation);
        span.setAttribute('cache.key', this.hashKey(key));
        if (size !== undefined) {
            span.setAttribute('cache.size', size);
        }

        span.setStatus({ code: SpanStatusCode.OK });
        span.end();

        if (this.enableConsoleLogging) {
            // deno-lint-ignore no-console
            console.debug(`[OpenTelemetry] Cache event: ${operation}`, { key, size });
        }
    }

    /**
     * Records a network event as span attributes
     */
    public recordNetworkEvent(
        method: string,
        url: string,
        statusCode?: number,
        durationMs?: number,
        responseSize?: number,
    ): void {
        const span = this.tracer.startSpan(`http.${method.toLowerCase()}`);
        
        span.setAttribute('http.method', method);
        span.setAttribute('http.url', this.sanitizeUrl(url));
        
        if (statusCode !== undefined) {
            span.setAttribute('http.status_code', statusCode);
            // Set error status for 4xx and 5xx responses
            if (statusCode >= 400) {
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: `HTTP ${statusCode}`,
                });
            }
        }
        
        if (durationMs !== undefined) {
            span.setAttribute('http.duration_ms', durationMs);
        }
        
        if (responseSize !== undefined) {
            span.setAttribute('http.response_size', responseSize);
        }

        if (!statusCode || statusCode < 400) {
            span.setStatus({ code: SpanStatusCode.OK });
        }
        
        span.end();

        if (this.enableConsoleLogging) {
            // deno-lint-ignore no-console
            console.debug(`[OpenTelemetry] Network event: ${method} ${url}`, { statusCode, durationMs });
        }
    }

    /**
     * Emits a custom diagnostic event as a span event
     */
    public emit(event: AnyDiagnosticEvent): void {
        // Find the most recent active span to attach the event to
        const activeSpanEntries = Array.from(this.activeSpans.entries());
        if (activeSpanEntries.length > 0) {
            // Attach to the most recently started span
            const [, span] = activeSpanEntries[activeSpanEntries.length - 1];
            
            span.addEvent(event.message, {
                'event.id': event.eventId,
                'event.category': event.category,
                'event.severity': event.severity,
                'event.timestamp': event.timestamp,
                ...(event.metadata && this.flattenMetadata(event.metadata)),
            });
        } else {
            // No active span, create a standalone span for the event
            const span = this.tracer.startSpan(`event.${event.category}`);
            
            span.setAttribute('event.id', event.eventId);
            span.setAttribute('event.category', event.category);
            span.setAttribute('event.severity', event.severity);
            span.setAttribute('event.message', event.message);
            
            if (event.metadata) {
                for (const [key, value] of Object.entries(event.metadata)) {
                    this.setSpanAttribute(span, `metadata.${key}`, value);
                }
            }

            // Set span status based on severity
            if (event.severity === TraceSeverity.Error) {
                span.setStatus({ code: SpanStatusCode.ERROR, message: event.message });
            } else {
                span.setStatus({ code: SpanStatusCode.OK });
            }

            span.end();
        }

        if (this.enableConsoleLogging) {
            // deno-lint-ignore no-console
            console.debug(`[OpenTelemetry] Event emitted:`, event);
        }
    }

    /**
     * Gets all collected events (not applicable for OpenTelemetry)
     * @returns Empty array (events are sent to OpenTelemetry collector)
     */
    public getEvents(): AnyDiagnosticEvent[] {
        // OpenTelemetry exports events to external collectors
        // This method is here for interface compatibility
        return [];
    }

    /**
     * Clears all active spans and state
     */
    public clear(): void {
        // End all active spans
        for (const span of this.activeSpans.values()) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: 'Span cleared before completion' });
            span.end();
        }

        this.activeSpans.clear();
        this.spanContexts.clear();
        this.operationNames.clear();

        if (this.enableConsoleLogging) {
            // deno-lint-ignore no-console
            console.debug('[OpenTelemetry] Cleared all active spans');
        }
    }

    /**
     * Generates a unique event ID
     */
    private generateEventId(): string {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    }

    /**
     * Safely sets a span attribute handling various types
     */
    private setSpanAttribute(span: Span, key: string, value: unknown): void {
        if (value === null || value === undefined) {
            return;
        }

        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            span.setAttribute(key, value);
        } else if (Array.isArray(value)) {
            // OpenTelemetry API only supports string arrays, not mixed types
            // Stringify arrays for simplicity
            span.setAttribute(key, JSON.stringify(value));
        } else {
            // For objects, stringify
            span.setAttribute(key, JSON.stringify(value));
        }
    }

    /**
     * Flattens metadata object to simple key-value pairs
     */
    private flattenMetadata(metadata: Record<string, unknown>): Record<string, string | number | boolean> {
        const flattened: Record<string, string | number | boolean> = {};
        
        for (const [key, value] of Object.entries(metadata)) {
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                flattened[key] = value;
            } else {
                flattened[key] = JSON.stringify(value);
            }
        }
        
        return flattened;
    }

    /**
     * Hashes a cache key for privacy
     */
    private hashKey(key: string): string {
        // Simple hash for privacy - first 8 chars of key or hash
        return key.substring(0, 8) + '...';
    }

    /**
     * Sanitizes URL by removing query params and auth
     */
    private sanitizeUrl(url: string): string {
        try {
            const parsed = new URL(url);
            return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
        } catch {
            // If URL parsing fails, return domain only or sanitized version
            return url.replace(/[?#].*$/, '').substring(0, 100);
        }
    }
}

/**
 * Creates a new OpenTelemetry diagnostics collector with specified options
 * @param options - Configuration options
 * @returns Configured OpenTelemetry exporter
 */
export function createOpenTelemetryExporter(
    options: OpenTelemetryExporterOptions = {},
): OpenTelemetryExporter {
    return new OpenTelemetryExporter(options);
}
