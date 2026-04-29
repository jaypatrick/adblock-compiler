/**
 * Tests for the Cloudflare Tail Worker
 *
 * Note: These are unit tests for the tail worker logic.
 * Integration testing requires actual Cloudflare deployment.
 */

import { assertEquals, assertExists } from '@std/assert';
import tailDefault, {
    captureSentryExceptions,
    createStructuredEvent,
    formatLogMessage,
    shouldForwardEvent,
    type TailEnv,
    type TailEvent,
    tailHandler,
    type TailLog,
} from './tail.ts';

// Tests
Deno.test('formatLogMessage - formats simple string message', () => {
    const log: TailLog = {
        timestamp: 1704931200000, // 2024-01-11T00:00:00.000Z
        level: 'info',
        message: ['Hello, world!'],
    };

    const formatted = formatLogMessage(log);
    assertEquals(formatted, '[2024-01-11T00:00:00.000Z] [INFO] Hello, world!');
});

Deno.test('formatLogMessage - formats multiple messages', () => {
    const log: TailLog = {
        timestamp: 1704931200000,
        level: 'error',
        message: ['Error:', 'Something went wrong'],
    };

    const formatted = formatLogMessage(log);
    assertEquals(formatted, '[2024-01-11T00:00:00.000Z] [ERROR] Error: Something went wrong');
});

Deno.test('formatLogMessage - formats object messages', () => {
    const log: TailLog = {
        timestamp: 1704931200000,
        level: 'log',
        message: [{ foo: 'bar', count: 42 }],
    };

    const formatted = formatLogMessage(log);
    assertEquals(formatted, '[2024-01-11T00:00:00.000Z] [LOG] {"foo":"bar","count":42}');
});

Deno.test('formatLogMessage - handles circular reference in objects', () => {
    // Create an object with circular reference
    const obj: any = { foo: 'bar' };
    obj.self = obj; // circular reference

    const log: TailLog = {
        timestamp: 1704931200000,
        level: 'log',
        message: [obj],
    };

    const formatted = formatLogMessage(log);
    // Should fall back to String() when JSON.stringify fails
    assertEquals(formatted, '[2024-01-11T00:00:00.000Z] [LOG] [object Object]');
});

Deno.test('shouldForwardEvent - forwards exception outcome', () => {
    const event: TailEvent = {
        outcome: 'exception',
        eventTimestamp: 1704931200000,
        logs: [],
        exceptions: [],
    };

    assertEquals(shouldForwardEvent(event), true);
});

Deno.test('shouldForwardEvent - forwards when exceptions present', () => {
    const event: TailEvent = {
        outcome: 'ok',
        eventTimestamp: 1704931200000,
        logs: [],
        exceptions: [{
            timestamp: 1704931200000,
            name: 'Error',
            message: 'Test error',
        }],
    };

    assertEquals(shouldForwardEvent(event), true);
});

Deno.test('shouldForwardEvent - forwards when error logs present', () => {
    const event: TailEvent = {
        outcome: 'ok',
        eventTimestamp: 1704931200000,
        logs: [{
            timestamp: 1704931200000,
            level: 'error',
            message: ['Error occurred'],
        }],
        exceptions: [],
    };

    assertEquals(shouldForwardEvent(event), true);
});

Deno.test('shouldForwardEvent - does not forward successful events', () => {
    const event: TailEvent = {
        outcome: 'ok',
        eventTimestamp: 1704931200000,
        logs: [{
            timestamp: 1704931200000,
            level: 'info',
            message: ['Request successful'],
        }],
        exceptions: [],
    };

    assertEquals(shouldForwardEvent(event), false);
});

Deno.test('createStructuredEvent - creates complete structured event', () => {
    const event: TailEvent = {
        scriptName: 'test-worker',
        outcome: 'exception',
        eventTimestamp: 1704931200000,
        logs: [{
            timestamp: 1704931200000,
            level: 'error',
            message: ['Test error'],
        }],
        exceptions: [{
            timestamp: 1704931200000,
            name: 'TypeError',
            message: 'Cannot read property',
        }],
        event: {
            request: {
                url: 'https://example.com/test',
                method: 'POST',
                headers: {},
            },
        },
    };

    const structured = createStructuredEvent(event);

    assertEquals(structured.scriptName, 'test-worker');
    assertEquals(structured.outcome, 'exception');
    assertEquals(structured.url, 'https://example.com/test');
    assertEquals(structured.method, 'POST');
    assertExists(structured.logs);
    assertExists(structured.exceptions);
    assertEquals((structured.logs as any).length, 1);
    assertEquals((structured.exceptions as any).length, 1);
});

Deno.test('createStructuredEvent - handles missing request data', () => {
    const event: TailEvent = {
        outcome: 'ok',
        eventTimestamp: 1704931200000,
        logs: [],
        exceptions: [],
    };

    const structured = createStructuredEvent(event);

    assertEquals(structured.scriptName, 'adblock-compiler'); // default value
    assertEquals(structured.url, undefined);
    assertEquals(structured.method, undefined);
});

Deno.test('createStructuredEvent - formats timestamps correctly', () => {
    const timestamp = 1704931200000; // 2024-01-11T00:00:00.000Z
    const event: TailEvent = {
        outcome: 'ok',
        eventTimestamp: timestamp,
        logs: [{
            timestamp,
            level: 'info',
            message: ['test'],
        }],
        exceptions: [],
    };

    const structured = createStructuredEvent(event);

    assertEquals(structured.timestamp, '2024-01-11T00:00:00.000Z');
    assertEquals((structured.logs as any)[0].timestamp, '2024-01-11T00:00:00.000Z');
});

// Additional tests for coverage
Deno.test('formatLogMessage - formats debug level message', () => {
    const log: TailLog = {
        timestamp: 1704931200000,
        level: 'debug',
        message: ['Debug info'],
    };

    const formatted = formatLogMessage(log);
    assertEquals(formatted, '[2024-01-11T00:00:00.000Z] [DEBUG] Debug info');
});

Deno.test('formatLogMessage - formats warn level message', () => {
    const log: TailLog = {
        timestamp: 1704931200000,
        level: 'warn',
        message: ['Warning message'],
    };

    const formatted = formatLogMessage(log);
    assertEquals(formatted, '[2024-01-11T00:00:00.000Z] [WARN] Warning message');
});

Deno.test('formatLogMessage - handles mixed message types', () => {
    const log: TailLog = {
        timestamp: 1704931200000,
        level: 'info',
        message: ['String', 42, { key: 'value' }, true],
    };

    const formatted = formatLogMessage(log);
    assertEquals(formatted, '[2024-01-11T00:00:00.000Z] [INFO] String 42 {"key":"value"} true');
});

Deno.test('formatLogMessage - handles empty message array', () => {
    const log: TailLog = {
        timestamp: 1704931200000,
        level: 'info',
        message: [],
    };

    const formatted = formatLogMessage(log);
    assertEquals(formatted, '[2024-01-11T00:00:00.000Z] [INFO] ');
});

Deno.test('shouldForwardEvent - forwards exceededCpu outcome', () => {
    const event: TailEvent = {
        outcome: 'exceededCpu',
        eventTimestamp: 1704931200000,
        logs: [],
        exceptions: [],
    };

    // exceededCpu is a critical resource limit error that should be forwarded
    assertEquals(shouldForwardEvent(event), true);
});

Deno.test('shouldForwardEvent - forwards exceededMemory outcome', () => {
    const event: TailEvent = {
        outcome: 'exceededMemory',
        eventTimestamp: 1704931200000,
        logs: [],
        exceptions: [],
    };

    // exceededMemory is a critical resource limit error that should be forwarded
    assertEquals(shouldForwardEvent(event), true);
});

Deno.test('shouldForwardEvent - does not forward warn logs', () => {
    const event: TailEvent = {
        outcome: 'ok',
        eventTimestamp: 1704931200000,
        logs: [{
            timestamp: 1704931200000,
            level: 'warn',
            message: ['Warning'],
        }],
        exceptions: [],
    };

    assertEquals(shouldForwardEvent(event), false);
});

Deno.test('createStructuredEvent - handles exception with timestamp formatting', () => {
    const event: TailEvent = {
        outcome: 'exception',
        eventTimestamp: 1704931200000,
        logs: [],
        exceptions: [{
            timestamp: 1704931200000,
            name: 'Error',
            message: 'Test',
        }],
    };

    const structured = createStructuredEvent(event);
    const exceptions = structured.exceptions as any[];
    assertEquals(exceptions[0].timestamp, '2024-01-11T00:00:00.000Z');
    assertEquals(exceptions[0].name, 'Error');
    assertEquals(exceptions[0].message, 'Test');
});

Deno.test('createStructuredEvent - preserves log message content', () => {
    const event: TailEvent = {
        outcome: 'ok',
        eventTimestamp: 1704931200000,
        logs: [{
            timestamp: 1704931200000,
            level: 'info',
            message: ['test', 123, { data: 'value' }],
        }],
        exceptions: [],
    };

    const structured = createStructuredEvent(event);
    const logs = structured.logs as any[];
    assertEquals(logs[0].level, 'info');
    assertEquals(logs[0].message, ['test', 123, { data: 'value' }]);
});

// ============================================================================
// tail() handler — Sentry integration path
// ============================================================================

/**
 * Minimal mock ExecutionContext for tail handler tests.
 * The tail() handler calls ctx.waitUntil(Promise.all(...)) before returning;
 * this mock discards the promise to keep tests synchronous-friendly.
 */
function createMockTailCtx(): ExecutionContext {
    return {
        waitUntil: (_p: Promise<unknown>) => {},
        passThroughOnException: () => {},
    } as unknown as ExecutionContext;
}

/** Build a minimal TailEnv for tests — only SENTRY_DSN is relevant here. */
function createMockTailEnv(overrides: Partial<TailEnv> = {}): TailEnv {
    return {
        ...overrides,
    } as TailEnv;
}

/** Build a minimal TailEvent with no logs and no exceptions. */
function makeEvent(overrides: Partial<TailEvent> = {}): TailEvent {
    return {
        outcome: 'ok',
        eventTimestamp: Date.now(),
        logs: [],
        exceptions: [],
        ...overrides,
    };
}

Deno.test('tail() handler - completes without throwing when SENTRY_DSN is absent and no events', async () => {
    const env = createMockTailEnv();
    const ctx = createMockTailCtx();
    // Should not throw
    await tailHandler.tail([], env, ctx);
});

Deno.test('tail() handler - completes without throwing when SENTRY_DSN is absent and events are present', async () => {
    const env = createMockTailEnv();
    const ctx = createMockTailCtx();
    await tailHandler.tail([makeEvent({ outcome: 'ok' })], env, ctx);
});

Deno.test('tail() handler - completes without throwing when events contain exceptions and no DSN', async () => {
    const env = createMockTailEnv();
    const ctx = createMockTailCtx();
    const event = makeEvent({
        outcome: 'exception',
        exceptions: [{ name: 'TypeError', message: 'test error', timestamp: Date.now() }],
    });
    await tailHandler.tail([event], env, ctx);
});

Deno.test({
    name: 'tail() handler - completes without throwing when events contain exceptions and DSN is set',
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
        // captureSentryExceptions() is called inside tail() when DSN is set.
        // It uses fetch() to post to the Sentry envelope API; errors are swallowed
        // so the tail worker always completes regardless of Sentry availability.
        const env = createMockTailEnv({ SENTRY_DSN: 'https://test@o0.ingest.sentry.io/0' });
        const ctx = createMockTailCtx();
        const event = makeEvent({
            outcome: 'exception',
            exceptions: [{ name: 'Error', message: 'unhandled', timestamp: Date.now() }],
        });
        await tailHandler.tail([event], env, ctx);
    },
});

Deno.test({
    name: 'tail() handler - completes without throwing when SENTRY_DSN is set and no exceptions in events',
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
        const env = createMockTailEnv({ SENTRY_DSN: 'https://test@o0.ingest.sentry.io/0' });
        const ctx = createMockTailCtx();
        await tailHandler.tail([makeEvent({ outcome: 'ok' })], env, ctx);
    },
});

Deno.test({
    name: 'tail() handler - handles multiple events with mixed outcomes',
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
        const env = createMockTailEnv();
        const ctx = createMockTailCtx();
        const events = [
            makeEvent({ outcome: 'ok' }),
            makeEvent({ outcome: 'exception', exceptions: [{ name: 'RangeError', message: 'boom', timestamp: Date.now() }] }),
            makeEvent({ outcome: 'canceled' }),
        ];
        await tailHandler.tail(events, env, ctx);
    },
});

Deno.test('tail() handler - garbage SENTRY_DSN does not throw (Sentry init is non-fatal)', async () => {
    // Malformed DSNs (non-URL, missing key, non-numeric project ID) are caught
    // by captureSentryExceptions() validation and silently swallowed.
    const env = createMockTailEnv({ SENTRY_DSN: 'not-a-valid-dsn' });
    const ctx = createMockTailCtx();
    const event = makeEvent({ exceptions: [{ name: 'Error', message: 'x', timestamp: Date.now() }] });
    await tailHandler.tail([event], env, ctx);
});

// ============================================================================
// default export — smoke tests for the production withSentry wrapper path
// ============================================================================

Deno.test('default export - has a tail() method', () => {
    assertExists(tailDefault.tail);
    assertEquals(typeof tailDefault.tail, 'function');
});

Deno.test('default export: fetch() returns 404', async () => {
    const env = createMockTailEnv({});
    const ctx = createMockTailCtx();
    const req = new Request('https://tail.bloqr.dev/');
    const res = await tailDefault.fetch(req, env, ctx);
    assertEquals(res.status, 404);
});

Deno.test({
    name: 'default export tail() - completes without throwing when SENTRY_DSN is absent',
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
        const env = createMockTailEnv();
        const ctx = createMockTailCtx();
        await tailDefault.tail([makeEvent({ outcome: 'ok' })], env, ctx);
    },
});

Deno.test({
    name: 'default export tail() - completes without throwing when SENTRY_DSN is present',
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
        // The default export is now `handler` directly. captureSentryExceptions() is
        // called with all batched exceptions when DSN is set; fetch errors are swallowed.
        const env = createMockTailEnv({ SENTRY_DSN: 'https://test@o0.ingest.sentry.io/0' });
        const ctx = createMockTailCtx();
        await tailDefault.tail([makeEvent({ outcome: 'ok' })], env, ctx);
    },
});

// ============================================================================
// captureSentryExceptions() — envelope construction unit tests
// ============================================================================

/** Minimal fetch spy that records calls and returns a 200 response. */
interface FetchCall {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
}

function makeFetchSpy(status = 200): { calls: FetchCall[]; restore: () => void } {
    const calls: FetchCall[] = [];
    const original = globalThis.fetch;
    // deno-lint-ignore require-await
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const headers: Record<string, string> = {};
        if (init?.headers) {
            new Headers(init.headers as HeadersInit).forEach((v, k) => {
                headers[k] = v;
            });
        }
        calls.push({
            url: String(input),
            method: String(init?.method ?? 'GET'),
            headers,
            body: String(init?.body ?? ''),
        });
        return new Response('{}', { status });
    }) as typeof globalThis.fetch;
    return {
        calls,
        restore: () => {
            globalThis.fetch = original;
        },
    };
}

Deno.test('captureSentryExceptions - sends to correct ingest URL (no trailing slash in DSN)', async () => {
    const { calls, restore } = makeFetchSpy();
    try {
        await captureSentryExceptions(
            'https://abc123@o12345.ingest.sentry.io/67890',
            [{ error: { name: 'Error', message: 'test' } }],
        );
        assertEquals(calls.length, 1);
        assertEquals(calls[0].url, 'https://o12345.ingest.sentry.io/api/67890/envelope/');
    } finally {
        restore();
    }
});

Deno.test('captureSentryExceptions - sends to correct ingest URL (trailing slash in DSN)', async () => {
    const { calls, restore } = makeFetchSpy();
    try {
        await captureSentryExceptions(
            'https://abc123@o12345.ingest.sentry.io/67890/',
            [{ error: { name: 'Error', message: 'test' } }],
        );
        assertEquals(calls.length, 1);
        assertEquals(calls[0].url, 'https://o12345.ingest.sentry.io/api/67890/envelope/');
    } finally {
        restore();
    }
});

Deno.test('captureSentryExceptions - sets correct Content-Type and X-Sentry-Auth headers', async () => {
    const { calls, restore } = makeFetchSpy();
    try {
        await captureSentryExceptions(
            'https://mykey@o12345.ingest.sentry.io/67890',
            [{ error: { name: 'Error', message: 'test' } }],
        );
        assertEquals(calls[0].headers['content-type'], 'application/x-sentry-envelope');
        assertEquals(calls[0].headers['x-sentry-auth'], 'Sentry sentry_version=7, sentry_key=mykey');
    } finally {
        restore();
    }
});

Deno.test('captureSentryExceptions - envelope body has correct header/item/payload structure', async () => {
    const { calls, restore } = makeFetchSpy();
    try {
        await captureSentryExceptions(
            'https://k@o1.ingest.sentry.io/12345',
            [{ error: { name: 'TypeError', message: 'Cannot read property' }, tags: { outcome: 'exception' } }],
        );
        const lines = calls[0].body.split('\n');
        // Envelope: 1 header + 1 item-header + 1 item-payload = 3 lines
        assertEquals(lines.length, 3);
        // Envelope header
        const envHeader = JSON.parse(lines[0]);
        assertExists(envHeader.sent_at);
        // Item header
        const itemHeader = JSON.parse(lines[1]);
        assertEquals(itemHeader.type, 'event');
        assertEquals(itemHeader.content_type, 'application/json');
        // Item payload
        const payload = JSON.parse(lines[2]);
        assertEquals(payload.platform, 'javascript');
        assertEquals(payload.level, 'error');
        assertEquals(payload.exception.values[0].type, 'TypeError');
        assertEquals(payload.exception.values[0].value, 'Cannot read property');
        assertEquals(payload.tags?.outcome, 'exception');
        assertExists(payload.event_id);
        assertExists(payload.timestamp);
    } finally {
        restore();
    }
});

Deno.test('captureSentryExceptions - batches multiple exceptions into one request', async () => {
    const { calls, restore } = makeFetchSpy();
    try {
        await captureSentryExceptions(
            'https://k@o1.ingest.sentry.io/12345',
            [
                { error: { name: 'Error', message: 'first' } },
                { error: { name: 'TypeError', message: 'second' } },
            ],
        );
        // One fetch call regardless of exception count
        assertEquals(calls.length, 1);
        const lines = calls[0].body.split('\n');
        // 1 envelope header + 2×(item-header + item-payload) = 5 lines
        assertEquals(lines.length, 5);
        assertEquals(JSON.parse(lines[1]).type, 'event');
        assertEquals(JSON.parse(lines[2]).exception.values[0].type, 'Error');
        assertEquals(JSON.parse(lines[3]).type, 'event');
        assertEquals(JSON.parse(lines[4]).exception.values[0].type, 'TypeError');
    } finally {
        restore();
    }
});

Deno.test('captureSentryExceptions - skips fetch when items array is empty', async () => {
    const { calls, restore } = makeFetchSpy();
    try {
        await captureSentryExceptions('https://k@o1.ingest.sentry.io/12345', []);
        assertEquals(calls.length, 0);
    } finally {
        restore();
    }
});

Deno.test('captureSentryExceptions - skips fetch when project ID is non-numeric', async () => {
    const { calls, restore } = makeFetchSpy();
    try {
        await captureSentryExceptions(
            'https://k@o1.ingest.sentry.io/not-a-number',
            [{ error: { name: 'Error', message: 'x' } }],
        );
        assertEquals(calls.length, 0);
    } finally {
        restore();
    }
});

Deno.test('captureSentryExceptions - skips fetch when key is absent from DSN', async () => {
    const { calls, restore } = makeFetchSpy();
    try {
        await captureSentryExceptions(
            'https://o1.ingest.sentry.io/12345',
            [{ error: { name: 'Error', message: 'x' } }],
        );
        assertEquals(calls.length, 0);
    } finally {
        restore();
    }
});

Deno.test('captureSentryExceptions - includes request context and extra in envelope payload', async () => {
    const { calls, restore } = makeFetchSpy();
    try {
        await captureSentryExceptions(
            'https://k@o1.ingest.sentry.io/12345',
            [{
                error: { name: 'Error', message: 'boom' },
                tags: { outcome: 'exception', scriptName: 'my-worker' },
                request: { url: 'https://example.com/api/compile', method: 'POST' },
                extra: { scriptName: 'my-worker', exceptionTimestamp: '2024-01-01T00:00:00.000Z' },
            }],
        );
        assertEquals(calls.length, 1);
        const lines = calls[0].body.split('\n');
        const payload = JSON.parse(lines[2]);
        assertEquals(payload.request?.url, 'https://example.com/api/compile');
        assertEquals(payload.request?.method, 'POST');
        assertEquals(payload.extra?.scriptName, 'my-worker');
        assertEquals(payload.extra?.exceptionTimestamp, '2024-01-01T00:00:00.000Z');
    } finally {
        restore();
    }
});

Deno.test('captureSentryExceptions - omits request field when request context is absent', async () => {
    const { calls, restore } = makeFetchSpy();
    try {
        await captureSentryExceptions(
            'https://k@o1.ingest.sentry.io/12345',
            [{ error: { name: 'Error', message: 'boom' } }],
        );
        assertEquals(calls.length, 1);
        const lines = calls[0].body.split('\n');
        const payload = JSON.parse(lines[2]);
        // request field must not be present when not provided
        assertEquals('request' in payload, false);
    } finally {
        restore();
    }
});
