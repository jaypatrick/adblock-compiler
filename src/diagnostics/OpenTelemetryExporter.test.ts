/**
 * Tests for OpenTelemetry integration
 */

import { assertEquals, assertExists } from '@std/assert';
import { type Span, type SpanContext, SpanStatusCode, type Tracer } from '@opentelemetry/api';
import { createOpenTelemetryExporter, OpenTelemetryExporter } from './OpenTelemetryExporter.ts';
import { TraceCategory, TraceSeverity } from './types.ts';

/**
 * Mock Span implementation for testing
 */
class MockSpan implements Span {
    public attributes: Record<string, unknown> = {};
    public events: Array<{ name: string; attributes?: Record<string, unknown> }> = [];
    public status?: { code: SpanStatusCode; message?: string };
    public exceptions: Error[] = [];
    public ended = false;
    private readonly _spanContext: SpanContext = {
        traceId: 'mock-trace-id',
        spanId: 'mock-span-id',
        traceFlags: 1,
    };

    spanContext(): SpanContext {
        return this._spanContext;
    }

    isRecording(): boolean {
        return true;
    }

    setAttribute(key: string, value: unknown): this {
        this.attributes[key] = value;
        return this;
    }

    setAttributes(attributes: Record<string, unknown>): this {
        Object.assign(this.attributes, attributes);
        return this;
    }

    addEvent(name: string, attributesOrStartTime?: unknown, _startTime?: unknown): this {
        const attributes = typeof attributesOrStartTime === 'object' && !Array.isArray(attributesOrStartTime) ? attributesOrStartTime as Record<string, unknown> : undefined;
        this.events.push({ name, attributes });
        return this;
    }

    setStatus(status: { code: SpanStatusCode; message?: string }): this {
        this.status = status;
        return this;
    }

    updateName(_name: string): this {
        return this;
    }

    end(_endTime?: unknown): void {
        this.ended = true;
    }

    recordException(exception: Error): void {
        this.exceptions.push(exception);
    }

    addLink(_link: unknown): this {
        return this;
    }

    addLinks(_links: unknown[]): this {
        return this;
    }
}

/**
 * Mock Tracer implementation for testing
 */
class MockTracer implements Tracer {
    public spans: MockSpan[] = [];

    startSpan(_name: string): Span {
        const span = new MockSpan();
        this.spans.push(span);
        return span;
    }

    startActiveSpan<F extends (_span: Span) => unknown>(
        _name: string,
        _fn: F,
    ): ReturnType<F> {
        throw new Error('Not implemented in mock');
    }
}

Deno.test('OpenTelemetryExporter - constructor creates instance with default options', () => {
    const exporter = new OpenTelemetryExporter();
    assertExists(exporter);
});

Deno.test('OpenTelemetryExporter - constructor accepts custom options', () => {
    const mockTracer = new MockTracer();
    const exporter = new OpenTelemetryExporter({
        serviceName: 'test-service',
        serviceVersion: '1.0.0',
        enableConsoleLogging: true,
        tracer: mockTracer,
    });
    assertExists(exporter);
});

Deno.test('OpenTelemetryExporter - operationStart creates span with attributes', () => {
    const mockTracer = new MockTracer();
    const exporter = new OpenTelemetryExporter({ tracer: mockTracer });

    const eventId = exporter.operationStart('testOperation', {
        param1: 'value1',
        param2: 42,
    });

    assertExists(eventId);
    assertEquals(mockTracer.spans.length, 1);

    const span = mockTracer.spans[0];
    assertEquals(span.attributes['operation.name'], 'testOperation');
    assertEquals(span.attributes['service.name'], 'adblock-compiler');
    assertEquals(span.attributes['input.param1'], 'value1');
    assertEquals(span.attributes['input.param2'], 42);
    assertEquals(span.ended, false);
});

Deno.test('OpenTelemetryExporter - operationComplete ends span successfully', () => {
    const mockTracer = new MockTracer();
    const exporter = new OpenTelemetryExporter({ tracer: mockTracer });

    const eventId = exporter.operationStart('testOperation');
    exporter.operationComplete(eventId, {
        result: 'success',
        count: 100,
    });

    const span = mockTracer.spans[0];
    assertEquals(span.ended, true);
    assertEquals(span.status?.code, SpanStatusCode.OK);
    assertEquals(span.attributes['output.result'], 'success');
    assertEquals(span.attributes['output.count'], 100);
});

Deno.test('OpenTelemetryExporter - operationError records exception', () => {
    const mockTracer = new MockTracer();
    const exporter = new OpenTelemetryExporter({ tracer: mockTracer });

    const eventId = exporter.operationStart('testOperation');
    const error = new Error('Test error');
    exporter.operationError(eventId, error);

    const span = mockTracer.spans[0];
    assertEquals(span.ended, true);
    assertEquals(span.status?.code, SpanStatusCode.ERROR);
    assertEquals(span.status?.message, 'Test error');
    assertEquals(span.exceptions.length, 1);
    assertEquals(span.exceptions[0], error);
    assertEquals(span.attributes['error.type'], 'Error');
    assertEquals(span.attributes['error.message'], 'Test error');
});

Deno.test('OpenTelemetryExporter - recordMetric creates metric span', () => {
    const mockTracer = new MockTracer();
    const exporter = new OpenTelemetryExporter({ tracer: mockTracer });

    exporter.recordMetric('requestCount', 150, 'requests', {
        endpoint: '/api/test',
    });

    assertEquals(mockTracer.spans.length, 1);
    const span = mockTracer.spans[0];
    assertEquals(span.attributes['metric.name'], 'requestCount');
    assertEquals(span.attributes['metric.value'], 150);
    assertEquals(span.attributes['metric.unit'], 'requests');
    assertEquals(span.attributes['dimension.endpoint'], '/api/test');
    assertEquals(span.ended, true);
    assertEquals(span.status?.code, SpanStatusCode.OK);
});

Deno.test('OpenTelemetryExporter - recordCacheEvent creates cache span', () => {
    const mockTracer = new MockTracer();
    const exporter = new OpenTelemetryExporter({ tracer: mockTracer });

    exporter.recordCacheEvent('hit', 'cache-key-123', 1024);

    assertEquals(mockTracer.spans.length, 1);
    const span = mockTracer.spans[0];
    assertEquals(span.attributes['cache.operation'], 'hit');
    assertExists(span.attributes['cache.key']); // Key is hashed
    assertEquals(span.attributes['cache.size'], 1024);
    assertEquals(span.ended, true);
});

Deno.test('OpenTelemetryExporter - recordNetworkEvent creates HTTP span', () => {
    const mockTracer = new MockTracer();
    const exporter = new OpenTelemetryExporter({ tracer: mockTracer });

    exporter.recordNetworkEvent('GET', 'https://example.com/api/test?param=value', 200, 150.5, 2048);

    assertEquals(mockTracer.spans.length, 1);
    const span = mockTracer.spans[0];
    assertEquals(span.attributes['http.method'], 'GET');
    assertEquals(span.attributes['http.url'], 'https://example.com/api/test'); // Query removed
    assertEquals(span.attributes['http.status_code'], 200);
    assertEquals(span.attributes['http.duration_ms'], 150.5);
    assertEquals(span.attributes['http.response_size'], 2048);
    assertEquals(span.status?.code, SpanStatusCode.OK);
    assertEquals(span.ended, true);
});

Deno.test('OpenTelemetryExporter - recordNetworkEvent sets error status for 4xx/5xx', () => {
    const mockTracer = new MockTracer();
    const exporter = new OpenTelemetryExporter({ tracer: mockTracer });

    exporter.recordNetworkEvent('GET', 'https://example.com/api/error', 404);

    const span = mockTracer.spans[0];
    assertEquals(span.status?.code, SpanStatusCode.ERROR);
    assertEquals(span.status?.message, 'HTTP 404');
});

Deno.test('OpenTelemetryExporter - emit adds event to active span', () => {
    const mockTracer = new MockTracer();
    const exporter = new OpenTelemetryExporter({ tracer: mockTracer });

    const eventId = exporter.operationStart('testOperation');

    exporter.emit({
        eventId: 'test-event-id',
        timestamp: new Date().toISOString(),
        category: TraceCategory.Compilation,
        severity: TraceSeverity.Info,
        message: 'Test event message',
        metadata: { detail: 'test detail' },
    });

    const span = mockTracer.spans[0];
    assertEquals(span.events.length, 1);
    assertEquals(span.events[0].name, 'Test event message');
    assertEquals(span.events[0].attributes?.['event.category'], TraceCategory.Compilation);
    assertEquals(span.events[0].attributes?.['event.severity'], TraceSeverity.Info);

    exporter.operationComplete(eventId);
});

Deno.test('OpenTelemetryExporter - emit creates standalone span when no active span', () => {
    const mockTracer = new MockTracer();
    const exporter = new OpenTelemetryExporter({ tracer: mockTracer });

    exporter.emit({
        eventId: 'test-event-id',
        timestamp: new Date().toISOString(),
        category: TraceCategory.Error,
        severity: TraceSeverity.Error,
        message: 'Test error event',
    });

    assertEquals(mockTracer.spans.length, 1);
    const span = mockTracer.spans[0];
    assertEquals(span.attributes['event.severity'], TraceSeverity.Error);
    assertEquals(span.attributes['event.message'], 'Test error event');
    assertEquals(span.status?.code, SpanStatusCode.ERROR);
    assertEquals(span.ended, true);
});

Deno.test('OpenTelemetryExporter - clear ends all active spans', () => {
    const mockTracer = new MockTracer();
    const exporter = new OpenTelemetryExporter({ tracer: mockTracer });

    exporter.operationStart('operation1');
    exporter.operationStart('operation2');

    exporter.clear();

    assertEquals(mockTracer.spans[0].ended, true);
    assertEquals(mockTracer.spans[1].ended, true);
    assertEquals(mockTracer.spans[0].status?.code, SpanStatusCode.ERROR);
    assertEquals(mockTracer.spans[1].status?.code, SpanStatusCode.ERROR);
});

Deno.test('OpenTelemetryExporter - getEvents returns empty array', () => {
    const exporter = new OpenTelemetryExporter();
    const events = exporter.getEvents();
    assertEquals(events.length, 0);
});

Deno.test('OpenTelemetryExporter - createOpenTelemetryExporter factory function', () => {
    const exporter = createOpenTelemetryExporter({
        serviceName: 'test-service',
        enableConsoleLogging: false,
    });
    assertExists(exporter);
});

Deno.test('OpenTelemetryExporter - handles array attributes correctly', () => {
    const mockTracer = new MockTracer();
    const exporter = new OpenTelemetryExporter({ tracer: mockTracer });

    const eventId = exporter.operationStart('testOperation', {
        stringArray: ['a', 'b', 'c'],
        numberArray: [1, 2, 3],
        mixedArray: ['a', 1, { nested: 'object' }],
    });

    const span = mockTracer.spans[0];
    // String arrays should be stringified (OpenTelemetry API limitation)
    assertExists(span.attributes['input.stringArray']);
    assertExists(span.attributes['input.numberArray']);
    // Mixed array should be stringified
    assertExists(span.attributes['input.mixedArray']);

    exporter.operationComplete(eventId);
});

Deno.test('OpenTelemetryExporter - handles null and undefined attributes', () => {
    const mockTracer = new MockTracer();
    const exporter = new OpenTelemetryExporter({ tracer: mockTracer });

    const eventId = exporter.operationStart('testOperation', {
        nullValue: null,
        undefinedValue: undefined,
        validValue: 'test',
    });

    const span = mockTracer.spans[0];
    // null and undefined should not be set
    assertEquals(span.attributes['input.nullValue'], undefined);
    assertEquals(span.attributes['input.undefinedValue'], undefined);
    assertEquals(span.attributes['input.validValue'], 'test');

    exporter.operationComplete(eventId);
});
