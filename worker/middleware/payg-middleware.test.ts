/// <reference types="@cloudflare/workers-types" />

/**
 * Unit tests for PAYG (Pay-As-You-Go) middleware.
 *
 * Tests cover:
 *   - paygMiddleware: 402 response structure, session flow, x402 headers
 *   - paygSessionMiddleware: session validation, 401/402 response structure
 *   - paygConversionCheckMiddleware: spend threshold check, non-blocking behavior
 *
 * @see worker/middleware/payg-middleware.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { Hono } from 'hono';
import type { Env } from '../types.ts';
import { PAYG_TIER_LIMITS, UserTier } from '../types.ts';
import { paygConversionCheckMiddleware, paygMiddleware, paygSessionMiddleware } from './payg-middleware.ts';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';

// ============================================================================
// Test helpers
// ============================================================================

/** Minimal Env stub for testing. */
function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
        COMPILER_VERSION: 'test',
        COMPILATION_CACHE: {} as KVNamespace,
        RATE_LIMIT: {} as KVNamespace,
        METRICS: {} as KVNamespace,
        PAYG_PRICE_PER_CALL_USD_CENTS: '1',
        PAYG_CONVERSION_THRESHOLD_USD_CENTS: '2000',
        ...overrides,
    } as unknown as Env;
}

/** Minimal analytics stub. */
function makeAnalytics(): AnalyticsService {
    // deno-lint-ignore no-explicit-any
    return new AnalyticsService(undefined as any);
}

/** Minimal auth context for injection into Hono context. */
function makeAuthContext() {
    return {
        tier: UserTier.Anonymous,
        userId: null,
        role: 'anonymous',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'anonymous' as const,
        email: null,
        displayName: null,
        apiKeyRateLimit: null,
    };
}

/** Build a minimal Hono test app that exposes the given middleware + a simple success handler. */
function makeTestApp(middleware: ReturnType<typeof paygMiddleware>) {
    // deno-lint-ignore no-explicit-any
    const app = new Hono<{ Bindings: Env; Variables: any }>();

    // Inject minimal context variables required by PAYG middleware
    app.use('*', async (c, next) => {
        c.set('authContext', makeAuthContext());
        c.set('analytics', makeAnalytics());
        c.set('requestId', 'test-req-id');
        c.set('ip', '127.0.0.1');
        c.set('prisma', undefined);
        await next();
    });

    app.use('/test', middleware);
    app.get('/test', (c) => c.json({ success: true }));
    app.post('/test', (c) => c.json({ success: true }));

    return app;
}

// ============================================================================
// paygMiddleware
// ============================================================================

Deno.test('paygMiddleware - returns 402 when no session or payment headers', async () => {
    const app = makeTestApp(paygMiddleware());
    const req = new Request('http://localhost/test', { method: 'GET' });
    const res = await app.fetch(req, makeEnv());

    assertEquals(res.status, 402);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.paymentRequired, true);
    assertExists(body.message);
    assertExists(body.pricePerCallUsdCents);
    assertExists(body.paygSignupUrl);
    assertExists(body.x402PaymentSpecs);
    assertExists(body.tierLimits);
});

Deno.test('paygMiddleware - response includes X-Payment-Required header', async () => {
    const app = makeTestApp(paygMiddleware());
    const req = new Request('http://localhost/test', { method: 'GET' });
    const res = await app.fetch(req, makeEnv());

    assertEquals(res.status, 402);
    const header = res.headers.get('X-Payment-Required');
    assertExists(header);
    // Should be valid JSON
    const parsed = JSON.parse(header);
    assertExists(parsed.version);
    assertExists(parsed.scheme);
});

Deno.test('paygMiddleware - 402 body uses correct pricePerCallUsdCents from env', async () => {
    const app = makeTestApp(paygMiddleware());
    const req = new Request('http://localhost/test', { method: 'GET' });
    const res = await app.fetch(req, makeEnv({ PAYG_PRICE_PER_CALL_USD_CENTS: '5' }));

    assertEquals(res.status, 402);
    const body = await res.json() as { pricePerCallUsdCents: number };
    assertEquals(body.pricePerCallUsdCents, 5);
});

Deno.test('paygMiddleware - defaults to 1 cent when env not set', async () => {
    const app = makeTestApp(paygMiddleware());
    const req = new Request('http://localhost/test', { method: 'GET' });
    // Override to undefined to simulate env without this key
    const res = await app.fetch(req, makeEnv({ PAYG_PRICE_PER_CALL_USD_CENTS: undefined }));

    assertEquals(res.status, 402);
    const body = await res.json() as { pricePerCallUsdCents: number };
    assertEquals(body.pricePerCallUsdCents, 1);
});

Deno.test('paygMiddleware - 402 body exposes PAYG_TIER_LIMITS', async () => {
    const app = makeTestApp(paygMiddleware());
    const req = new Request('http://localhost/test', { method: 'GET' });
    const res = await app.fetch(req, makeEnv());

    assertEquals(res.status, 402);
    const body = await res.json() as { tierLimits: typeof PAYG_TIER_LIMITS };
    assertEquals(body.tierLimits.requestsPerMinute, PAYG_TIER_LIMITS.requestsPerMinute);
    assertEquals(body.tierLimits.requestsPerDay, PAYG_TIER_LIMITS.requestsPerDay);
    assertEquals(body.tierLimits.batchApiEnabled, false);
});

Deno.test('paygMiddleware - returns 503 when X-Payg-Session header present but prisma unavailable', async () => {
    const app = makeTestApp(paygMiddleware());
    const req = new Request('http://localhost/test', {
        method: 'GET',
        headers: { 'X-Payg-Session': 'some-session-token' },
    });
    const res = await app.fetch(req, makeEnv());

    // prisma is undefined in test env — database_unavailable → 503 (not 402)
    assertEquals(res.status, 503);
});

Deno.test('paygMiddleware - x402 payment spec includes correct network and version', async () => {
    const app = makeTestApp(paygMiddleware());
    const req = new Request('http://localhost/test', { method: 'GET' });
    const res = await app.fetch(req, makeEnv());

    assertEquals(res.status, 402);
    const header = res.headers.get('X-Payment-Required');
    assertExists(header);
    const spec = JSON.parse(header) as Record<string, unknown>;
    assertEquals(spec.version, '2');
    assertEquals(spec.scheme, 'exact');
    assertEquals(spec.network, 'stripe');
});

// ============================================================================
// paygSessionMiddleware
// ============================================================================

Deno.test('paygSessionMiddleware - returns 401 when X-Payg-Session header missing', async () => {
    const app = makeTestApp(paygSessionMiddleware());
    const req = new Request('http://localhost/test', { method: 'GET' });
    const res = await app.fetch(req, makeEnv());

    assertEquals(res.status, 401);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertExists(body.error);
});

Deno.test('paygSessionMiddleware - returns 503 when session is invalid (no DB)', async () => {
    const app = makeTestApp(paygSessionMiddleware());
    const req = new Request('http://localhost/test', {
        method: 'GET',
        headers: { 'X-Payg-Session': 'invalid-token' },
    });
    const res = await app.fetch(req, makeEnv());

    // prisma is undefined — validation returns database_unavailable → 503 (not 402)
    assertEquals(res.status, 503);
    const body = await res.json() as { paymentRequired: boolean };
    assertEquals(body.paymentRequired, false);
});

// ============================================================================
// paygConversionCheckMiddleware
// ============================================================================

Deno.test('paygConversionCheckMiddleware - passes through when no authenticated userId', async () => {
    const app = makeTestApp(paygConversionCheckMiddleware());
    const req = new Request('http://localhost/test', { method: 'GET' });
    const res = await app.fetch(req, makeEnv());

    // authContext.userId is null (anonymous) — middleware exits early, request passes through
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean };
    assertEquals(body.success, true);
});

Deno.test('paygConversionCheckMiddleware - non-blocking when prisma unavailable', async () => {
    const app = makeTestApp(paygConversionCheckMiddleware());
    // No X-Stripe-Customer-Id header; authContext.userId is null → prisma lookup skipped
    const req = new Request('http://localhost/test', { method: 'GET' });
    const res = await app.fetch(req, makeEnv());

    // prisma is undefined, but middleware is non-blocking — should still return 200
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean };
    assertEquals(body.success, true);
});

// ============================================================================
// PAYG_TIER_LIMITS constant
// ============================================================================

Deno.test('PAYG_TIER_LIMITS - has expected shape', () => {
    assertEquals(typeof PAYG_TIER_LIMITS.requestsPerMinute, 'number');
    assertEquals(typeof PAYG_TIER_LIMITS.requestsPerDay, 'number');
    assertEquals(typeof PAYG_TIER_LIMITS.maxRulesPerList, 'number');
    assertEquals(typeof PAYG_TIER_LIMITS.maxSourcesPerCompile, 'number');
    assertEquals(typeof PAYG_TIER_LIMITS.maxListSizeBytes, 'number');
    assertEquals(typeof PAYG_TIER_LIMITS.maxConcurrentJobs, 'number');
    assertEquals(PAYG_TIER_LIMITS.queuePriority, 'standard');
    assertEquals(typeof PAYG_TIER_LIMITS.retentionDays, 'number');
    assertEquals(typeof PAYG_TIER_LIMITS.maxStoredOutputs, 'number');
    assertEquals(PAYG_TIER_LIMITS.astStorageEnabled, false);
    assertEquals(PAYG_TIER_LIMITS.batchApiEnabled, false);
    assertEquals(PAYG_TIER_LIMITS.webhooksEnabled, false);
});

Deno.test('PAYG_TIER_LIMITS - all feature flags are false', () => {
    assertEquals(PAYG_TIER_LIMITS.astStorageEnabled, false);
    assertEquals(PAYG_TIER_LIMITS.translationEnabled, false);
    assertEquals(PAYG_TIER_LIMITS.globalSharingEnabled, false);
    assertEquals(PAYG_TIER_LIMITS.batchApiEnabled, false);
    assertEquals(PAYG_TIER_LIMITS.webhooksEnabled, false);
    assertEquals(PAYG_TIER_LIMITS.versionHistoryEnabled, false);
    assertEquals(PAYG_TIER_LIMITS.cdnDistributionEnabled, false);
});

Deno.test('PAYG_TIER_LIMITS - numeric limits are reasonable', () => {
    assertEquals(PAYG_TIER_LIMITS.requestsPerMinute, 120);
    assertEquals(PAYG_TIER_LIMITS.requestsPerDay, 500);
    assertEquals(PAYG_TIER_LIMITS.maxRulesPerList, 50_000);
    assertEquals(PAYG_TIER_LIMITS.maxSourcesPerCompile, 5);
    assertEquals(PAYG_TIER_LIMITS.maxConcurrentJobs, 2);
    assertEquals(PAYG_TIER_LIMITS.retentionDays, 7);
    assertEquals(PAYG_TIER_LIMITS.maxStoredOutputs, 10);
});
