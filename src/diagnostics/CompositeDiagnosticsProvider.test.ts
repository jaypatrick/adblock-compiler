/**
 * Tests for CompositeDiagnosticsProvider.
 */

import { assertEquals, assertStrictEquals } from '@std/assert';
import { CompositeDiagnosticsProvider } from './CompositeDiagnosticsProvider.ts';
import type { IDiagnosticsProvider, ISpan } from './IDiagnosticsProvider.ts';
import { NoOpDiagnosticsProvider } from './IDiagnosticsProvider.ts';

// ---------------------------------------------------------------------------
// Test spy provider
// ---------------------------------------------------------------------------

interface SpyCalls {
    errors: Array<{ error: Error; context?: Record<string, unknown> }>;
    messages: Array<{ message: string; level?: string; context?: Record<string, unknown> }>;
    spans: Array<{ name: string; attributes?: Record<string, string | number> }>;
    metrics: Array<{ name: string; value: number; tags?: Record<string, string> }>;
    spansEnded: number;
    attributesSet: Array<{ key: string; value: string | number | boolean }>;
    bulkAttributesSet: Array<Record<string, string | number | boolean>>;
    exceptionsRecorded: Error[];
    events: Array<{ name: string; attributes?: Record<string, string | number | boolean> }>;
    users: Array<unknown>;
    contexts: Array<{ name: string; context: Record<string, unknown> }>;
    breadcrumbs: Array<unknown>;
    flushCount: number;
}

function makeSpyProvider(): IDiagnosticsProvider & { calls: SpyCalls } {
    const calls: SpyCalls = {
        errors: [],
        messages: [],
        spans: [],
        metrics: [],
        spansEnded: 0,
        attributesSet: [],
        bulkAttributesSet: [],
        exceptionsRecorded: [],
        events: [],
        users: [],
        contexts: [],
        breadcrumbs: [],
        flushCount: 0,
    };
    return {
        calls,
        captureError(error, context) {
            calls.errors.push({ error, context });
        },
        captureMessage(message, level, context) {
            calls.messages.push({ message, level, context });
        },
        startSpan(name, attributes): ISpan {
            calls.spans.push({ name, attributes });
            return {
                end: () => {
                    calls.spansEnded++;
                },
                setAttribute: (key, value) => {
                    calls.attributesSet.push({ key, value });
                },
                setAttributes: (attrs) => {
                    calls.bulkAttributesSet.push(attrs);
                },
                recordException: (err) => {
                    calls.exceptionsRecorded.push(err);
                },
                addEvent: (evtName, evtAttrs) => {
                    calls.events.push({ name: evtName, attributes: evtAttrs });
                },
            };
        },
        recordMetric(name, value, tags) {
            calls.metrics.push({ name, value, tags });
        },
        setUser(user) {
            calls.users.push(user);
        },
        setContext(name, context) {
            calls.contexts.push({ name, context });
        },
        addBreadcrumb(breadcrumb) {
            calls.breadcrumbs.push(breadcrumb);
        },
        async flush() {
            calls.flushCount++;
        },
    };
}

// ---------------------------------------------------------------------------
// captureError
// ---------------------------------------------------------------------------

Deno.test('CompositeDiagnosticsProvider — captureError forwards to all providers', () => {
    const a = makeSpyProvider();
    const b = makeSpyProvider();
    const composite = new CompositeDiagnosticsProvider([a, b]);

    const err = new Error('boom');
    composite.captureError(err, { key: 'value' });

    assertEquals(a.calls.errors.length, 1);
    assertStrictEquals(a.calls.errors[0].error, err);
    assertEquals(a.calls.errors[0].context, { key: 'value' });

    assertEquals(b.calls.errors.length, 1);
    assertStrictEquals(b.calls.errors[0].error, err);
});

Deno.test('CompositeDiagnosticsProvider — captureError swallows child exceptions', () => {
    const throwing: IDiagnosticsProvider = {
        captureError: () => {
            throw new Error('provider exploded');
        },
        captureMessage: () => {},
        startSpan: () => ({ end: () => {}, setAttribute: () => {}, setAttributes: () => {}, recordException: () => {}, addEvent: () => {} }),
        recordMetric: () => {},
        setUser: () => {},
        setContext: () => {},
        addBreadcrumb: () => {},
        flush: async () => {},
    };
    const spy = makeSpyProvider();
    const composite = new CompositeDiagnosticsProvider([throwing, spy]);

    // Should not throw, and the healthy provider still receives the call
    composite.captureError(new Error('original'));
    assertEquals(spy.calls.errors.length, 1);
});

// ---------------------------------------------------------------------------
// startSpan
// ---------------------------------------------------------------------------

Deno.test('CompositeDiagnosticsProvider — startSpan forwards to all providers', () => {
    const a = makeSpyProvider();
    const b = makeSpyProvider();
    const composite = new CompositeDiagnosticsProvider([a, b]);

    const span = composite.startSpan('compile', { ruleCount: 5000 });
    assertEquals(a.calls.spans.length, 1);
    assertEquals(a.calls.spans[0].name, 'compile');
    assertEquals(b.calls.spans.length, 1);

    span.end();
    assertEquals(a.calls.spansEnded, 1);
    assertEquals(b.calls.spansEnded, 1);
});

Deno.test('CompositeDiagnosticsProvider — span.setAttribute forwards to all child spans', () => {
    const a = makeSpyProvider();
    const b = makeSpyProvider();
    const composite = new CompositeDiagnosticsProvider([a, b]);
    const span = composite.startSpan('test');

    span.setAttribute('foo', 'bar');
    assertEquals(a.calls.attributesSet.length, 1);
    assertEquals(a.calls.attributesSet[0], { key: 'foo', value: 'bar' });
    assertEquals(b.calls.attributesSet.length, 1);
});

Deno.test('CompositeDiagnosticsProvider — span.recordException forwards to all child spans', () => {
    const a = makeSpyProvider();
    const b = makeSpyProvider();
    const composite = new CompositeDiagnosticsProvider([a, b]);
    const span = composite.startSpan('test');

    const err = new Error('inner');
    span.recordException(err);
    assertStrictEquals(a.calls.exceptionsRecorded[0], err);
    assertStrictEquals(b.calls.exceptionsRecorded[0], err);
});

// ---------------------------------------------------------------------------
// recordMetric
// ---------------------------------------------------------------------------

Deno.test('CompositeDiagnosticsProvider — recordMetric forwards to all providers', () => {
    const a = makeSpyProvider();
    const b = makeSpyProvider();
    const composite = new CompositeDiagnosticsProvider([a, b]);

    composite.recordMetric('rule_count', 5000, { source: 'easylist' });
    assertEquals(a.calls.metrics[0], { name: 'rule_count', value: 5000, tags: { source: 'easylist' } });
    assertEquals(b.calls.metrics[0], { name: 'rule_count', value: 5000, tags: { source: 'easylist' } });
});

Deno.test('CompositeDiagnosticsProvider — recordMetric swallows child exceptions', () => {
    const throwing: IDiagnosticsProvider = {
        captureError: () => {},
        captureMessage: () => {},
        startSpan: () => ({ end: () => {}, setAttribute: () => {}, setAttributes: () => {}, recordException: () => {}, addEvent: () => {} }),
        recordMetric: () => {
            throw new Error('metric exploded');
        },
        setUser: () => {},
        setContext: () => {},
        addBreadcrumb: () => {},
        flush: async () => {},
    };
    const spy = makeSpyProvider();
    const composite = new CompositeDiagnosticsProvider([throwing, spy]);

    composite.recordMetric('count', 1);
    assertEquals(spy.calls.metrics.length, 1);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

Deno.test('CompositeDiagnosticsProvider — zero providers is valid (no-op)', async () => {
    const composite = new CompositeDiagnosticsProvider([]);
    assertEquals(composite.size, 0);
    // None of these should throw
    composite.captureError(new Error('e'));
    composite.captureMessage('m', 'info');
    const span = composite.startSpan('s');
    span.end();
    span.setAttribute('k', 1);
    span.setAttributes({ a: 1, b: 'x' });
    span.recordException(new Error('se'));
    span.addEvent('evt');
    composite.recordMetric('m', 1);
    composite.setUser({ id: 'u1' });
    composite.setContext('req', { path: '/' });
    composite.addBreadcrumb({ message: 'click', level: 'info' });
    await composite.flush();
});

Deno.test('CompositeDiagnosticsProvider — size returns provider count', () => {
    const composite = new CompositeDiagnosticsProvider([
        new NoOpDiagnosticsProvider(),
        new NoOpDiagnosticsProvider(),
        new NoOpDiagnosticsProvider(),
    ]);
    assertEquals(composite.size, 3);
});

Deno.test('CompositeDiagnosticsProvider — nested composites work correctly', () => {
    const spy = makeSpyProvider();
    const inner = new CompositeDiagnosticsProvider([spy]);
    const outer = new CompositeDiagnosticsProvider([inner, new NoOpDiagnosticsProvider()]);

    outer.captureError(new Error('nested'));
    assertEquals(spy.calls.errors.length, 1);
});

// ---------------------------------------------------------------------------
// captureMessage
// ---------------------------------------------------------------------------

Deno.test('CompositeDiagnosticsProvider — captureMessage forwards to all providers', () => {
    const a = makeSpyProvider();
    const b = makeSpyProvider();
    const composite = new CompositeDiagnosticsProvider([a, b]);

    composite.captureMessage('rate limit hit', 'warning', { path: '/api/compile' });

    assertEquals(a.calls.messages.length, 1);
    assertEquals(a.calls.messages[0], { message: 'rate limit hit', level: 'warning', context: { path: '/api/compile' } });
    assertEquals(b.calls.messages.length, 1);
    assertEquals(b.calls.messages[0].message, 'rate limit hit');
});

Deno.test('CompositeDiagnosticsProvider — captureMessage swallows child exceptions', () => {
    const throwing: IDiagnosticsProvider = {
        captureError: () => {},
        captureMessage: () => { throw new Error('msg exploded'); },
        startSpan: () => ({ end: () => {}, setAttribute: () => {}, setAttributes: () => {}, recordException: () => {}, addEvent: () => {} }),
        recordMetric: () => {},
        setUser: () => {},
        setContext: () => {},
        addBreadcrumb: () => {},
        flush: async () => {},
    };
    const spy = makeSpyProvider();
    const composite = new CompositeDiagnosticsProvider([throwing, spy]);

    composite.captureMessage('hello');
    assertEquals(spy.calls.messages.length, 1);
});

// ---------------------------------------------------------------------------
// setUser / setContext / addBreadcrumb
// ---------------------------------------------------------------------------

Deno.test('CompositeDiagnosticsProvider — setUser forwards to all providers', () => {
    const a = makeSpyProvider();
    const b = makeSpyProvider();
    const composite = new CompositeDiagnosticsProvider([a, b]);

    composite.setUser({ id: 'user_123', email: 'test@example.com' });

    assertEquals(a.calls.users.length, 1);
    assertEquals((a.calls.users[0] as { id: string }).id, 'user_123');
    assertEquals(b.calls.users.length, 1);
});

Deno.test('CompositeDiagnosticsProvider — setUser swallows child exceptions', () => {
    const throwing: IDiagnosticsProvider = {
        captureError: () => {},
        captureMessage: () => {},
        startSpan: () => ({ end: () => {}, setAttribute: () => {}, setAttributes: () => {}, recordException: () => {}, addEvent: () => {} }),
        recordMetric: () => {},
        setUser: () => { throw new Error('setUser exploded'); },
        setContext: () => {},
        addBreadcrumb: () => {},
        flush: async () => {},
    };
    const spy = makeSpyProvider();
    const composite = new CompositeDiagnosticsProvider([throwing, spy]);

    composite.setUser({ id: 'u1' });
    assertEquals(spy.calls.users.length, 1);
});

Deno.test('CompositeDiagnosticsProvider — setContext forwards to all providers', () => {
    const a = makeSpyProvider();
    const b = makeSpyProvider();
    const composite = new CompositeDiagnosticsProvider([a, b]);

    composite.setContext('request', { url: '/api/compile', method: 'POST' });

    assertEquals(a.calls.contexts.length, 1);
    assertEquals(a.calls.contexts[0].name, 'request');
    assertEquals(b.calls.contexts.length, 1);
});

Deno.test('CompositeDiagnosticsProvider — addBreadcrumb forwards to all providers', () => {
    const a = makeSpyProvider();
    const b = makeSpyProvider();
    const composite = new CompositeDiagnosticsProvider([a, b]);

    composite.addBreadcrumb({ message: 'user clicked compile', level: 'info', category: 'ui.click' });

    assertEquals(a.calls.breadcrumbs.length, 1);
    assertEquals(b.calls.breadcrumbs.length, 1);
});

// ---------------------------------------------------------------------------
// flush
// ---------------------------------------------------------------------------

Deno.test('CompositeDiagnosticsProvider — flush calls flush on all providers', async () => {
    const a = makeSpyProvider();
    const b = makeSpyProvider();
    const composite = new CompositeDiagnosticsProvider([a, b]);

    await composite.flush();

    assertEquals(a.calls.flushCount, 1);
    assertEquals(b.calls.flushCount, 1);
});

Deno.test('CompositeDiagnosticsProvider — flush continues if one provider throws synchronously', async () => {
    const synchronouslyThrowing: IDiagnosticsProvider = {
        captureError: () => {},
        captureMessage: () => {},
        startSpan: () => ({ end: () => {}, setAttribute: () => {}, setAttributes: () => {}, recordException: () => {}, addEvent: () => {} }),
        recordMetric: () => {},
        setUser: () => {},
        setContext: () => {},
        addBreadcrumb: () => {},
        flush: () => { throw new Error('flush exploded synchronously'); },
    };
    const spy = makeSpyProvider();
    const composite = new CompositeDiagnosticsProvider([synchronouslyThrowing, spy]);

    // Must not throw and must still flush healthy providers
    await composite.flush();
    assertEquals(spy.calls.flushCount, 1);
});

Deno.test('CompositeDiagnosticsProvider — flush continues if one provider rejects', async () => {
    const rejectingProvider: IDiagnosticsProvider = {
        captureError: () => {},
        captureMessage: () => {},
        startSpan: () => ({ end: () => {}, setAttribute: () => {}, setAttributes: () => {}, recordException: () => {}, addEvent: () => {} }),
        recordMetric: () => {},
        setUser: () => {},
        setContext: () => {},
        addBreadcrumb: () => {},
        flush: () => Promise.reject(new Error('flush rejected')),
    };
    const spy = makeSpyProvider();
    const composite = new CompositeDiagnosticsProvider([rejectingProvider, spy]);

    // Must not throw and must still flush healthy providers
    await composite.flush();
    assertEquals(spy.calls.flushCount, 1);
});

// ---------------------------------------------------------------------------
// span.setAttributes / span.addEvent
// ---------------------------------------------------------------------------

Deno.test('CompositeDiagnosticsProvider — span.setAttributes forwards to all child spans', () => {
    const a = makeSpyProvider();
    const b = makeSpyProvider();
    const composite = new CompositeDiagnosticsProvider([a, b]);
    const span = composite.startSpan('test');

    span.setAttributes({ ruleCount: 1000, source: 'easylist' });

    assertEquals(a.calls.bulkAttributesSet.length, 1);
    assertEquals(a.calls.bulkAttributesSet[0], { ruleCount: 1000, source: 'easylist' });
    assertEquals(b.calls.bulkAttributesSet.length, 1);
});

Deno.test('CompositeDiagnosticsProvider — span.addEvent forwards to all child spans', () => {
    const a = makeSpyProvider();
    const b = makeSpyProvider();
    const composite = new CompositeDiagnosticsProvider([a, b]);
    const span = composite.startSpan('test');

    span.addEvent('cache.hit', { key: 'abc123' });

    assertEquals(a.calls.events.length, 1);
    assertEquals(a.calls.events[0].name, 'cache.hit');
    assertEquals(b.calls.events.length, 1);
});
