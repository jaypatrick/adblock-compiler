/**
 * Tests for the Prometheus metrics handler and metric registry.
 *
 * Covers:
 *  - Content-Type header
 *  - Fallback zeroed metrics when secrets are absent
 *  - # note: comment present when secrets are missing
 *  - Custom metric registration via registerPrometheusMetric
 *  - renderMetric() output format (counter and gauge)
 *  - Analytics Engine integration paths (serialized via t.step to prevent
 *    globalThis.fetch races and registry state interference between parallel tests)
 */

import { assertEquals, assertStringIncludes } from '@std/assert';
import type { Env } from '../types.ts';
import { _clearRegistryForTesting, handlePrometheusMetrics, registerPrometheusMetric } from './prometheus-metrics.ts';
import { renderMetric } from './prometheus-metric-registry.ts';

// ---------------------------------------------------------------------------
// Minimal env stub
// ---------------------------------------------------------------------------

function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
        COMPILER_VERSION: '1.0.0-test',
        ...overrides,
    } as unknown as Env;
}

function makeRequest(
    overrides: { headers?: Record<string, string>; method?: string } = {},
): Request {
    return new Request('https://worker.example.com/metrics/prometheus', {
        method: overrides.method ?? 'GET',
        headers: overrides.headers ?? {},
    });
}

// ---------------------------------------------------------------------------
// renderMetric helpers
// ---------------------------------------------------------------------------

Deno.test('renderMetric — counter emits _total in HELP, TYPE, and sample', () => {
    const out = renderMetric(
        { name: 'my_counter', type: 'counter', help: 'A counter.', collect: () => 0 },
        42,
    );
    assertStringIncludes(out, '# HELP my_counter_total A counter.');
    assertStringIncludes(out, '# TYPE my_counter_total counter');
    assertStringIncludes(out, 'my_counter_total 42');
});

Deno.test('renderMetric — gauge emits name without _total', () => {
    const out = renderMetric(
        { name: 'my_gauge', type: 'gauge', help: 'A gauge.', collect: () => 0 },
        3.14,
    );
    assertStringIncludes(out, '# HELP my_gauge A gauge.');
    assertStringIncludes(out, '# TYPE my_gauge gauge');
    assertStringIncludes(out, 'my_gauge 3.14');
});

Deno.test('renderMetric — null value returns empty string (metric opted out)', () => {
    const out = renderMetric(
        { name: 'my_gauge', type: 'gauge', help: 'A gauge.', collect: () => null },
        null,
    );
    assertEquals(out, '');
});

Deno.test('renderMetric — labels are rendered correctly', () => {
    const out = renderMetric(
        {
            name: 'my_gauge',
            type: 'gauge',
            help: 'Labelled gauge.',
            collect: () => 1,
            labels: { env: 'prod', region: 'us-east' },
        },
        1,
    );
    assertStringIncludes(out, 'my_gauge{env="prod",region="us-east"} 1');
});

// ---------------------------------------------------------------------------
// Response headers
// ---------------------------------------------------------------------------

Deno.test('handlePrometheusMetrics — correct Content-Type on 200', async () => {
    const req = makeRequest();
    const res = await handlePrometheusMetrics(req, makeEnv());
    assertEquals(res.status, 200);
    assertStringIncludes(res.headers.get('Content-Type') ?? '', 'text/plain');
    assertStringIncludes(res.headers.get('Content-Type') ?? '', '0.0.4');
    assertEquals(res.headers.get('Cache-Control'), 'no-store');
});

// ---------------------------------------------------------------------------
// Missing secrets → fallback zeroed output
// ---------------------------------------------------------------------------

Deno.test('handlePrometheusMetrics — missing secrets emits # note comment', async () => {
    const req = makeRequest();
    const res = await handlePrometheusMetrics(req, makeEnv()); // no ANALYTICS_* keys
    const body = await res.text();
    assertStringIncludes(body, '# note: ANALYTICS_ACCOUNT_ID or ANALYTICS_API_TOKEN not configured');
});

// ---------------------------------------------------------------------------
// Analytics Engine mock data
// ---------------------------------------------------------------------------

const MOCK_ANALYTICS_ROW = {
    total_requests: 1000,
    success_requests: 950,
    error_requests: 50,
    avg_latency_ms: 123.4,
    p95_latency_ms: 456.7,
    cache_hits: 800,
    cache_misses: 200,
    rate_limit_events: 5,
    source_errors: 3,
};

/**
 * Patches globalThis.fetch for the duration of `fn`, then restores it.
 * Must only be called from within a t.step() so steps are already serialised.
 */
function withMockFetch(
    mockResponse: unknown,
    fn: () => Promise<void>,
    status = 200,
): Promise<void> {
    const originalFetch = globalThis.fetch;
    // deno-lint-ignore no-explicit-any
    (globalThis as any).fetch = async () => new Response(JSON.stringify(mockResponse), { status });
    return fn().finally(() => {
        globalThis.fetch = originalFetch;
    });
}

// ---------------------------------------------------------------------------
// Registry and Analytics Engine tests
//
// All tests that modify the global metric registry OR patch globalThis.fetch
// are serialised inside a single Deno.test using t.step().  This prevents
// concurrent Deno.test blocks from racing on the shared registry state or on
// the globalThis.fetch patch.
//
// IMPORTANT: the built-in metrics step MUST run first (before any
// _clearRegistryForTesting() call) because the built-ins are registered once
// at module load time and cannot be re-registered after clearing.
// ---------------------------------------------------------------------------

Deno.test('prometheus registry and analytics engine paths', async (t) => {
    // Step 1 — built-in metrics: runs BEFORE any _clearRegistryForTesting() call
    // so the module-level metric registrations are still intact.
    await t.step('includes compilation metrics when analytics secrets configured', async () => {
        const env = makeEnv({
            ANALYTICS_ACCOUNT_ID: 'acct_test',
            ANALYTICS_API_TOKEN: 'tok_test',
        });

        await withMockFetch({ data: [MOCK_ANALYTICS_ROW] }, async () => {
            const res = await handlePrometheusMetrics(makeRequest(), env);
            assertEquals(res.status, 200);
            const body = await res.text();

            // Should not include the "missing secrets" note
            assertEquals(body.includes('ANALYTICS_ACCOUNT_ID or ANALYTICS_API_TOKEN not configured'), false);
            // Built-in counter metrics (rendered with _total suffix)
            assertStringIncludes(body, 'adblock_compilation_requests_total');
            assertStringIncludes(body, 'adblock_compilation_errors_total');
            assertStringIncludes(body, 'adblock_cache_hits_total');
        });
    });

    await t.step('no "note" comment when analytics secrets are present', async () => {
        _clearRegistryForTesting();
        const env = makeEnv({
            ANALYTICS_ACCOUNT_ID: 'acct_test',
            ANALYTICS_API_TOKEN: 'tok_test',
        });

        await withMockFetch({ data: [MOCK_ANALYTICS_ROW] }, async () => {
            const res = await handlePrometheusMetrics(makeRequest(), env);
            const body = await res.text();
            assertEquals(
                body.includes('# note: ANALYTICS_ACCOUNT_ID or ANALYTICS_API_TOKEN not configured'),
                false,
            );
        });
    });

    await t.step('returns 200 when analytics API fetch fails', async () => {
        _clearRegistryForTesting();
        const env = makeEnv({
            ANALYTICS_ACCOUNT_ID: 'acct_test',
            ANALYTICS_API_TOKEN: 'tok_test',
        });

        const originalFetch = globalThis.fetch;
        // deno-lint-ignore no-explicit-any
        (globalThis as any).fetch = async () => {
            throw new Error('Analytics unavailable');
        };

        try {
            const res = await handlePrometheusMetrics(makeRequest(), env);
            // collect() rejections are isolated via .catch(() => null); handler must not throw
            assertEquals(res.status, 200);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    await t.step('returns 200 when analytics API returns non-ok status', async () => {
        _clearRegistryForTesting();
        const env = makeEnv({
            ANALYTICS_ACCOUNT_ID: 'acct_test',
            ANALYTICS_API_TOKEN: 'tok_test',
        });

        await withMockFetch({ error: 'Unauthorized' }, async () => {
            const res = await handlePrometheusMetrics(makeRequest(), env);
            assertEquals(res.status, 200);
        }, 401);
    });

    await t.step('error rate is zero when total_requests is zero', async () => {
        _clearRegistryForTesting();
        const env = makeEnv({
            ANALYTICS_ACCOUNT_ID: 'acct_test',
            ANALYTICS_API_TOKEN: 'tok_test',
        });
        const emptyRow = { ...MOCK_ANALYTICS_ROW, total_requests: 0, error_requests: 0 };

        await withMockFetch({ data: [emptyRow] }, async () => {
            const res = await handlePrometheusMetrics(makeRequest(), env);
            const body = await res.text();
            // error rate should be 0 (not NaN/Infinity)
            assertStringIncludes(body, 'adblock_compilation_error_rate 0');
        });
    });

    // --- Custom metric registration ---

    await t.step('custom metric appears in output', async () => {
        _clearRegistryForTesting();

        registerPrometheusMetric({
            name: 'test_custom_gauge',
            type: 'gauge',
            help: 'A custom test gauge.',
            collect: () => 99,
        });

        const res = await handlePrometheusMetrics(makeRequest(), makeEnv());
        const body = await res.text();
        assertStringIncludes(body, '# HELP test_custom_gauge A custom test gauge.');
        assertStringIncludes(body, 'test_custom_gauge 99');
    });

    await t.step('duplicate name is a no-op (first wins)', async () => {
        _clearRegistryForTesting();

        registerPrometheusMetric({ name: 'dup_metric', type: 'gauge', help: 'First.', collect: () => 1 });
        registerPrometheusMetric({ name: 'dup_metric', type: 'gauge', help: 'Second.', collect: () => 2 });

        const res = await handlePrometheusMetrics(makeRequest(), makeEnv());
        const body = await res.text();

        // Only one occurrence
        const matches = body.match(/dup_metric/g) ?? [];
        assertEquals(matches.length, 3); // HELP + TYPE + sample — exactly one set
    });

    await t.step('collect returning null omits metric', async () => {
        _clearRegistryForTesting();

        registerPrometheusMetric({ name: 'null_metric', type: 'gauge', help: 'Null.', collect: () => null });

        const res = await handlePrometheusMetrics(makeRequest(), makeEnv());
        const body = await res.text();
        assertEquals(body.includes('null_metric'), false);
    });
});
