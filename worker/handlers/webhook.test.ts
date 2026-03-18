/**
 * Tests for the Notification webhook handler (POST /api/notify).
 *
 * Covers:
 *   - handleNotify: returns 400 on invalid JSON body
 *   - handleNotify: returns 422 on missing required fields
 *   - handleNotify: returns 503 when no webhook targets are configured
 *   - handleNotify: forwards to generic WEBHOOK_URL target
 *   - handleNotify: reports delivery failure (502) when all targets fail
 *   - handleNotify: includes deliveries array in response
 *   - handleNotify: response contains event and duration
 *
 * Uses a mock fetch interceptor to avoid real network calls.
 *
 * @see worker/handlers/webhook.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { handleNotify } from './webhook.ts';
import type { Env } from '../types.ts';

// ============================================================================
// Fixtures
// ============================================================================

function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
        COMPILER_VERSION: '1.0.0-test',
        COMPILATION_CACHE: undefined as unknown as KVNamespace,
        RATE_LIMIT: undefined as unknown as KVNamespace,
        METRICS: undefined as unknown as KVNamespace,
        ASSETS: undefined as unknown as Fetcher,
        ...overrides,
    } as unknown as Env;
}

function makeRequest(body: unknown): Request {
    return new Request('http://localhost/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

/** Intercept global fetch with a mock that returns the given status. */
function withMockFetch(
    status: number,
    fn: () => Promise<void>,
): Promise<void> {
    const originalFetch = globalThis.fetch;
    // deno-lint-ignore no-explicit-any
    (globalThis as any).fetch = async (_input: unknown, _init?: unknown) => {
        return new Response('{}', { status });
    };
    return fn().finally(() => {
        globalThis.fetch = originalFetch;
    });
}

/** Intercept global fetch with a mock that throws a network error. */
function withFailingFetch(fn: () => Promise<void>): Promise<void> {
    const originalFetch = globalThis.fetch;
    // deno-lint-ignore no-explicit-any
    (globalThis as any).fetch = async (_input: unknown, _init?: unknown) => {
        throw new Error('Network unreachable');
    };
    return fn().finally(() => {
        globalThis.fetch = originalFetch;
    });
}

// ============================================================================
// handleNotify — input validation
// ============================================================================

Deno.test('handleNotify - returns 400 on invalid JSON body', async () => {
    const env = makeEnv();
    const req = new Request('http://localhost/api/notify', {
        method: 'POST',
        body: 'not-json',
    });
    const res = await handleNotify(req, env);
    assertEquals(res.status, 400);
});

Deno.test('handleNotify - returns 422 when required fields are missing', async () => {
    const env = makeEnv({ WEBHOOK_URL: 'https://hooks.example.com' });
    const req = makeRequest({ level: 'info' }); // missing event and message
    const res = await handleNotify(req, env);
    assertEquals(res.status, 422);
});

Deno.test('handleNotify - returns 503 when no targets are configured', async () => {
    const env = makeEnv(); // no WEBHOOK_URL, SENTRY_DSN, or DATADOG_API_KEY
    const req = makeRequest({ event: 'deploy', message: 'Deployed v1.0.0' });
    const res = await handleNotify(req, env);
    assertEquals(res.status, 503);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertExists(body.error);
});

// ============================================================================
// handleNotify — delivery
// ============================================================================

Deno.test('handleNotify - delivers to WEBHOOK_URL and returns 200 on success', async () => {
    const env = makeEnv({ WEBHOOK_URL: 'https://hooks.example.com/notify' });
    const req = makeRequest({ event: 'test.event', message: 'Hello from test' });

    await withMockFetch(200, async () => {
        const res = await handleNotify(req, env);
        assertEquals(res.status, 200);
        const body = await res.json() as { success: boolean; event: string; deliveries: Array<{ success: boolean; target: string }> };
        assertEquals(body.success, true);
        assertEquals(body.event, 'test.event');
        assertExists(body.deliveries);
        assertEquals(body.deliveries.length, 1);
        assertEquals(body.deliveries[0].target, 'generic');
        assertEquals(body.deliveries[0].success, true);
    });
});

Deno.test('handleNotify - returns 502 when all configured targets fail', async () => {
    const env = makeEnv({ WEBHOOK_URL: 'https://hooks.example.com/notify' });
    const req = makeRequest({ event: 'test.fail', message: 'This will fail' });

    await withFailingFetch(async () => {
        const res = await handleNotify(req, env);
        assertEquals(res.status, 502);
        const body = await res.json() as { success: boolean };
        assertEquals(body.success, false);
    });
});

Deno.test('handleNotify - response includes duration field', async () => {
    const env = makeEnv({ WEBHOOK_URL: 'https://hooks.example.com/notify' });
    const req = makeRequest({ event: 'test.duration', message: 'Test' });

    await withMockFetch(200, async () => {
        const res = await handleNotify(req, env);
        const body = await res.json() as { duration: string };
        assertExists(body.duration);
        assertEquals(body.duration.endsWith('ms'), true);
    });
});

Deno.test('handleNotify - handles generic webhook delivery failure (non-ok status)', async () => {
    const env = makeEnv({ WEBHOOK_URL: 'https://hooks.example.com/notify' });
    const req = makeRequest({ event: 'test.fail', message: 'Test' });

    await withMockFetch(503, async () => {
        const res = await handleNotify(req, env);
        assertEquals(res.status, 502); // all targets failed
        const body = await res.json() as { deliveries: Array<{ success: boolean; statusCode: number }> };
        assertEquals(body.deliveries[0].success, false);
        assertEquals(body.deliveries[0].statusCode, 503);
    });
});

Deno.test('handleNotify - multiple optional fields are accepted', async () => {
    const env = makeEnv({ WEBHOOK_URL: 'https://hooks.example.com/notify' });
    const req = makeRequest({
        event: 'compile.success',
        message: 'Compilation succeeded',
        level: 'info',
        source: 'worker',
        metadata: { ruleCount: 1234 },
        timestamp: new Date().toISOString(),
    });

    await withMockFetch(200, async () => {
        const res = await handleNotify(req, env);
        assertEquals(res.status, 200);
    });
});

// ============================================================================
// handleNotify — Sentry delivery
// ============================================================================

Deno.test('handleNotify - delivers to Sentry when SENTRY_DSN is configured', async () => {
    const env = makeEnv({
        SENTRY_DSN: 'https://abc123@sentry.io/12345',
    });
    const req = makeRequest({ event: 'error.occurred', message: 'Something broke', level: 'error' });

    await withMockFetch(200, async () => {
        const res = await handleNotify(req, env);
        assertEquals(res.status, 200);
        const body = await res.json() as {
            success: boolean;
            deliveries: Array<{ target: string; success: boolean }>;
        };
        assertEquals(body.success, true);
        assertEquals(body.deliveries.length, 1);
        assertEquals(body.deliveries[0].target, 'sentry');
        assertEquals(body.deliveries[0].success, true);
    });
});

Deno.test('handleNotify - Sentry delivery returns 502 when fetch fails', async () => {
    const env = makeEnv({
        SENTRY_DSN: 'https://abc123@sentry.io/12345',
    });
    const req = makeRequest({ event: 'error.occurred', message: 'Test' });

    await withFailingFetch(async () => {
        const res = await handleNotify(req, env);
        assertEquals(res.status, 502);
        const body = await res.json() as { success: boolean };
        assertEquals(body.success, false);
    });
});

Deno.test('handleNotify - Sentry maps warn level to warning', async () => {
    const env = makeEnv({ SENTRY_DSN: 'https://abc123@sentry.io/12345' });
    const req = makeRequest({ event: 'quota.warn', message: 'Quota near limit', level: 'warn' });

    const capturedBodies: unknown[] = [];
    const originalFetch = globalThis.fetch;
    // deno-lint-ignore no-explicit-any
    (globalThis as any).fetch = async (_url: unknown, init?: { body?: string }) => {
        if (init?.body) capturedBodies.push(JSON.parse(init.body));
        return new Response('{}', { status: 200 });
    };

    try {
        const res = await handleNotify(req, env);
        assertEquals(res.status, 200);
        assertEquals(capturedBodies.length, 1);
        assertEquals((capturedBodies[0] as { level: string }).level, 'warning');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

// ============================================================================
// handleNotify — Datadog delivery
// ============================================================================

Deno.test('handleNotify - delivers to Datadog when DATADOG_API_KEY is configured', async () => {
    const env = makeEnv({ DATADOG_API_KEY: 'dd-api-key-test' });
    const req = makeRequest({ event: 'deploy.done', message: 'Deploy completed', level: 'info' });

    await withMockFetch(200, async () => {
        const res = await handleNotify(req, env);
        assertEquals(res.status, 200);
        const body = await res.json() as {
            success: boolean;
            deliveries: Array<{ target: string; success: boolean }>;
        };
        assertEquals(body.success, true);
        assertEquals(body.deliveries.length, 1);
        assertEquals(body.deliveries[0].target, 'datadog');
        assertEquals(body.deliveries[0].success, true);
    });
});

Deno.test('handleNotify - Datadog delivery returns 502 when fetch fails', async () => {
    const env = makeEnv({ DATADOG_API_KEY: 'dd-api-key-test' });
    const req = makeRequest({ event: 'deploy.done', message: 'Test' });

    await withFailingFetch(async () => {
        const res = await handleNotify(req, env);
        assertEquals(res.status, 502);
    });
});

Deno.test('handleNotify - Datadog maps error level to alert_type error', async () => {
    const env = makeEnv({ DATADOG_API_KEY: 'dd-api-key-test' });
    const req = makeRequest({ event: 'sys.error', message: 'Critical failure', level: 'error' });

    const capturedBodies: unknown[] = [];
    const originalFetch = globalThis.fetch;
    // deno-lint-ignore no-explicit-any
    (globalThis as any).fetch = async (_url: unknown, init?: { body?: string }) => {
        if (init?.body) capturedBodies.push(JSON.parse(init.body));
        return new Response('{}', { status: 200 });
    };

    try {
        await handleNotify(req, env);
        assertEquals(capturedBodies.length, 1);
        assertEquals((capturedBodies[0] as { alert_type: string }).alert_type, 'error');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

// ============================================================================
// handleNotify — Multiple targets
// ============================================================================

Deno.test('handleNotify - delivers to both WEBHOOK_URL and SENTRY_DSN', async () => {
    const env = makeEnv({
        WEBHOOK_URL: 'https://hooks.example.com/notify',
        SENTRY_DSN: 'https://key@sentry.io/99',
    });
    const req = makeRequest({ event: 'multi.target', message: 'Both targets' });

    await withMockFetch(200, async () => {
        const res = await handleNotify(req, env);
        assertEquals(res.status, 200);
        const body = await res.json() as {
            success: boolean;
            deliveries: Array<{ target: string }>;
        };
        assertEquals(body.success, true);
        assertEquals(body.deliveries.length, 2);
        const targets = body.deliveries.map((d) => d.target).sort();
        assertEquals(targets, ['generic', 'sentry']);
    });
});

Deno.test('handleNotify - partial success returns 200 when at least one target succeeds', async () => {
    // WEBHOOK_URL will succeed; SENTRY_DSN will fail (we throw for sentry's URL)
    const env = makeEnv({
        WEBHOOK_URL: 'https://hooks.example.com/notify',
        SENTRY_DSN: 'https://key@sentry.io/99',
    });
    const req = makeRequest({ event: 'partial.success', message: 'Test' });

    const originalFetch = globalThis.fetch;
    // deno-lint-ignore no-explicit-any
    (globalThis as any).fetch = async (url: string) => {
        if (url.includes('hooks.example.com')) return new Response('{}', { status: 200 });
        throw new Error('Sentry unreachable');
    };

    try {
        const res = await handleNotify(req, env);
        assertEquals(res.status, 200); // at least one succeeded
        const body = await res.json() as {
            success: boolean;
            deliveries: Array<{ success: boolean }>;
        };
        assertEquals(body.success, true);
        const successes = body.deliveries.filter((d) => d.success);
        assertEquals(successes.length, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test('handleNotify - all three targets can be configured simultaneously', async () => {
    const env = makeEnv({
        WEBHOOK_URL: 'https://hooks.example.com/notify',
        SENTRY_DSN: 'https://key@sentry.io/99',
        DATADOG_API_KEY: 'dd-key',
    });
    const req = makeRequest({ event: 'triple.target', message: 'All three' });

    await withMockFetch(200, async () => {
        const res = await handleNotify(req, env);
        assertEquals(res.status, 200);
        const body = await res.json() as {
            deliveries: Array<{ target: string }>;
        };
        assertEquals(body.deliveries.length, 3);
    });
});
