/**
 * Tests for worker/middleware/index.ts
 *
 * Covers functions NOT already tested by request-size.test.ts:
 *   - checkRateLimitTiered: Admin tier bypasses KV entirely
 *   - checkRateLimitTiered: First request starts new window
 *   - checkRateLimitTiered: Over limit → allowed: false
 *   - checkRateLimitTiered: Authenticated user keyed by userId
 *   - checkRateLimit: Delegates to tiered (anonymous)
 *   - getRateLimitConfig: Returns correct config for tier
 *   - verifyTurnstileToken: No TURNSTILE_SECRET_KEY → success (skip)
 *   - verifyTurnstileToken: Empty token → failure
 *   - verifyTurnstileToken: Successful verification (mock fetch)
 *   - verifyTurnstileToken: Failed verification (mock fetch, error codes)
 *   - verifyTurnstileToken: Network error → failure
 *   - isTurnstileEnabled: true when key present, false when absent
 *   - getClientIp: Returns CF-Connecting-IP header value
 *   - getClientIp: Returns 'unknown' when header absent
 *   - parseJsonBody: Parses valid JSON successfully
 *   - parseJsonBody: Returns error on invalid JSON
 *   - cloneAndParseBody: Parses body without consuming original
 */

import { assertEquals, assertExists } from '@std/assert';
import { ANONYMOUS_AUTH_CONTEXT, type IAuthContext, UserTier } from '../types.ts';
import { checkRateLimit, checkRateLimitTiered, cloneAndParseBody, getClientIp, getRateLimitConfig, isTurnstileEnabled, parseJsonBody, verifyTurnstileToken } from './index.ts';
import type { Env } from '../types.ts';

// ============================================================================
// KV mock helpers
// ============================================================================

type KVData = Map<string, unknown>;

function makeKvNamespace(data: KVData = new Map()): KVNamespace {
    return {
        get: async (key: string, type?: string) => {
            const value = data.get(key);
            if (value === undefined) return null;
            if (type === 'json') return value;
            return JSON.stringify(value);
        },
        put: async (key: string, value: string | unknown, _opts?: unknown) => {
            try {
                data.set(key, JSON.parse(value as string));
            } catch {
                data.set(key, value);
            }
        },
        delete: async (key: string) => {
            data.delete(key);
        },
        list: async () => ({ keys: [], list_complete: true, cursor: '' }),
        getWithMetadata: async () => ({ value: null, metadata: null }),
    } as unknown as KVNamespace;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
        RATE_LIMIT: makeKvNamespace(),
        ...overrides,
    } as unknown as Env;
}

function makeAnonymousCtx(): IAuthContext {
    return { ...ANONYMOUS_AUTH_CONTEXT };
}

function makeUserCtx(tier: UserTier = UserTier.Free, userId = 'user_001'): IAuthContext {
    return {
        ...ANONYMOUS_AUTH_CONTEXT,
        userId,
        tier,
        role: 'user',
        authMethod: 'better-auth',
    };
}

// ============================================================================
// checkRateLimitTiered — Admin tier bypasses KV
// ============================================================================

Deno.test('checkRateLimitTiered - Admin tier is always allowed without KV access', async () => {
    const env = makeEnv({ RATE_LIMIT: undefined as unknown as KVNamespace });
    const ctx = makeUserCtx(UserTier.Admin);

    const result = await checkRateLimitTiered(env, '1.2.3.4', ctx);
    assertEquals(result.allowed, true);
    assertEquals(result.limit, Infinity);
    assertEquals(result.remaining, Infinity);
});

// ============================================================================
// checkRateLimitTiered — First request starts new window
// ============================================================================

Deno.test('checkRateLimitTiered - first request is allowed and initialises window', async () => {
    const kv: KVData = new Map();
    const env = makeEnv({ RATE_LIMIT: makeKvNamespace(kv) });
    const ctx = makeAnonymousCtx();

    const result = await checkRateLimitTiered(env, '1.2.3.4', ctx);
    assertEquals(result.allowed, true);
    assertEquals(result.remaining >= 0, true);
    assertEquals(result.resetAt > Date.now() - 1000, true);
});

// ============================================================================
// checkRateLimitTiered — Expired window triggers a new one
// ============================================================================

Deno.test('checkRateLimitTiered - expired window resets count', async () => {
    const kv: KVData = new Map();
    const key = 'ratelimit:ip:1.2.3.4';
    // Simulate an expired window (resetAt in the past)
    kv.set(key, { count: 99, resetAt: Date.now() - 5000 });

    const env = makeEnv({ RATE_LIMIT: makeKvNamespace(kv) });
    const ctx = makeAnonymousCtx();

    const result = await checkRateLimitTiered(env, '1.2.3.4', ctx);
    assertEquals(result.allowed, true);
    // Count should have been reset to 1
    assertEquals(result.remaining + 1 > 0, true);
});

// ============================================================================
// checkRateLimitTiered — Over limit
// ============================================================================

Deno.test('checkRateLimitTiered - over limit returns allowed:false', async () => {
    const kv: KVData = new Map();
    const key = 'ratelimit:ip:5.6.7.8';
    // Anonymous limit from TIER_RATE_LIMITS; set count at the limit
    kv.set(key, { count: 99999, resetAt: Date.now() + 60000 });

    const env = makeEnv({ RATE_LIMIT: makeKvNamespace(kv) });
    const ctx = makeAnonymousCtx();

    const result = await checkRateLimitTiered(env, '5.6.7.8', ctx);
    assertEquals(result.allowed, false);
    assertEquals(result.remaining, 0);
});

// ============================================================================
// checkRateLimitTiered — Authenticated users keyed by userId
// ============================================================================

Deno.test('checkRateLimitTiered - authenticated user keyed by userId not IP', async () => {
    const kv: KVData = new Map();
    const env = makeEnv({ RATE_LIMIT: makeKvNamespace(kv) });
    const ctx = makeUserCtx(UserTier.Free, 'user_abc123');

    await checkRateLimitTiered(env, '1.1.1.1', ctx);

    // Key should be user-based, not IP-based
    const userKey = 'ratelimit:user:user_abc123';
    const ipKey = 'ratelimit:ip:1.1.1.1';
    assertEquals(kv.has(userKey), true);
    assertEquals(kv.has(ipKey), false);
});

// ============================================================================
// checkRateLimit — delegates to tiered (anonymous path)
// ============================================================================

Deno.test('checkRateLimit - delegates to tiered check and returns boolean', async () => {
    const env = makeEnv();
    const result = await checkRateLimit(env, '9.9.9.9');
    assertEquals(typeof result, 'boolean');
    assertEquals(result, true); // first request always allowed
});

// ============================================================================
// getRateLimitConfig
// ============================================================================

Deno.test('getRateLimitConfig - returns config for Anonymous tier by default', () => {
    const config = getRateLimitConfig();
    assertExists(config.window);
    assertExists(config.maxRequests);
    assertEquals(typeof config.window, 'number');
    assertEquals(typeof config.maxRequests, 'number');
});

Deno.test('getRateLimitConfig - returns config for specified tier', () => {
    const anon = getRateLimitConfig(UserTier.Anonymous);
    const free = getRateLimitConfig(UserTier.Free);
    const admin = getRateLimitConfig(UserTier.Admin);

    // Admin should have Infinity limit
    assertEquals(admin.maxRequests, Infinity);
    // Free should have more capacity than Anonymous
    assertEquals(free.maxRequests > anon.maxRequests, true);
});

// ============================================================================
// verifyTurnstileToken
// ============================================================================

Deno.test('verifyTurnstileToken - succeeds when TURNSTILE_SECRET_KEY not configured', async () => {
    const env = makeEnv(); // no TURNSTILE_SECRET_KEY
    const result = await verifyTurnstileToken(env, 'any-token', '1.2.3.4');
    assertEquals(result.success, true);
});

Deno.test('verifyTurnstileToken - fails when token is empty string', async () => {
    const env = makeEnv({ TURNSTILE_SECRET_KEY: 'secret_test' });
    const result = await verifyTurnstileToken(env, '', '1.2.3.4');
    assertEquals(result.success, false);
    assertExists(result.error);
});

Deno.test('verifyTurnstileToken with Cloudflare API (fetch-serialized)', async (t) => {
    // All steps patch globalThis.fetch and are serialised via t.step() to prevent
    // parallel Deno.test races on the global fetch mock.

    await t.step('succeeds when Cloudflare returns success:true', async () => {
        const env = makeEnv({ TURNSTILE_SECRET_KEY: 'secret_test' });
        const originalFetch = globalThis.fetch;
        // deno-lint-ignore no-explicit-any
        (globalThis as any).fetch = async () => new Response(JSON.stringify({ success: true }), { status: 200 });

        try {
            const result = await verifyTurnstileToken(env, 'valid-token', '1.2.3.4');
            assertEquals(result.success, true);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    await t.step('fails when Cloudflare returns success:false with error codes', async () => {
        const env = makeEnv({ TURNSTILE_SECRET_KEY: 'secret_test' });
        const originalFetch = globalThis.fetch;
        // deno-lint-ignore no-explicit-any
        (globalThis as any).fetch = async () =>
            new Response(
                JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }),
                { status: 200 },
            );

        try {
            const result = await verifyTurnstileToken(env, 'bad-token', '1.2.3.4');
            assertEquals(result.success, false);
            assertExists(result.error);
            assertEquals(result.error!.includes('invalid-input-response'), true);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    await t.step('fails when network error occurs', async () => {
        const env = makeEnv({ TURNSTILE_SECRET_KEY: 'secret_test' });
        const originalFetch = globalThis.fetch;
        // deno-lint-ignore no-explicit-any
        (globalThis as any).fetch = async () => {
            throw new Error('Network error');
        };

        try {
            const result = await verifyTurnstileToken(env, 'token', '1.2.3.4');
            assertEquals(result.success, false);
            assertExists(result.error);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    await t.step('fails when Cloudflare returns no error-codes', async () => {
        const env = makeEnv({ TURNSTILE_SECRET_KEY: 'secret_test' });
        const originalFetch = globalThis.fetch;
        // deno-lint-ignore no-explicit-any
        (globalThis as any).fetch = async () => new Response(JSON.stringify({ success: false }), { status: 200 });

        try {
            const result = await verifyTurnstileToken(env, 'bad-token', '1.2.3.4');
            assertEquals(result.success, false);
            assertExists(result.error);
            assertEquals(result.error!.includes('unknown error'), true);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

// ============================================================================
// isTurnstileEnabled
// ============================================================================

Deno.test('isTurnstileEnabled - returns false when TURNSTILE_SECRET_KEY not set', () => {
    const env = makeEnv();
    assertEquals(isTurnstileEnabled(env), false);
});

Deno.test('isTurnstileEnabled - returns true when TURNSTILE_SECRET_KEY is set', () => {
    const env = makeEnv({ TURNSTILE_SECRET_KEY: 'some-secret' });
    assertEquals(isTurnstileEnabled(env), true);
});

// ============================================================================
// getClientIp
// ============================================================================

Deno.test('getClientIp - returns CF-Connecting-IP header value', () => {
    const req = new Request('https://api.example.com/', {
        headers: { 'CF-Connecting-IP': '203.0.113.42' },
    });
    assertEquals(getClientIp(req), '203.0.113.42');
});

Deno.test('getClientIp - returns "unknown" when header is absent', () => {
    const req = new Request('https://api.example.com/');
    assertEquals(getClientIp(req), 'unknown');
});

// ============================================================================
// parseJsonBody
// ============================================================================

Deno.test('parseJsonBody - returns parsed data for valid JSON', async () => {
    const req = new Request('https://api.example.com/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'value', count: 42 }),
    });
    const result = await parseJsonBody<{ key: string; count: number }>(req);
    assertEquals(result.error, undefined);
    assertExists(result.data);
    assertEquals(result.data!.key, 'value');
    assertEquals(result.data!.count, 42);
});

Deno.test('parseJsonBody - returns error for invalid JSON', async () => {
    const req = new Request('https://api.example.com/', {
        method: 'POST',
        body: 'this is not json',
    });
    const result = await parseJsonBody(req);
    assertEquals(result.data, undefined);
    assertExists(result.error);
    assertEquals(result.error!.startsWith('Invalid JSON'), true);
});

// ============================================================================
// cloneAndParseBody
// ============================================================================

Deno.test('cloneAndParseBody - parses body without consuming original request', async () => {
    const req = new Request('https://api.example.com/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hello: 'world' }),
    });
    const result = await cloneAndParseBody<{ hello: string }>(req);
    assertEquals(result.error, undefined);
    assertExists(result.data);
    assertEquals(result.data!.hello, 'world');
});

// ============================================================================
// checkRateLimitTiered — Per-API-key rate limit override (#1275)
// ============================================================================

Deno.test('checkRateLimitTiered - per-API-key rate limit uses stricter of tier and key limit', async () => {
    const kv: KVData = new Map();
    const env = makeEnv({ RATE_LIMIT: makeKvNamespace(kv) });
    // Free-tier user with a low per-key rate limit
    const ctx: IAuthContext = {
        ...ANONYMOUS_AUTH_CONTEXT,
        userId: 'user_lowkey',
        tier: UserTier.Free,
        role: 'user',
        authMethod: 'api-key',
        apiKeyRateLimit: 5, // much lower than Free tier default
    };

    const result = await checkRateLimitTiered(env, '1.2.3.4', ctx);
    assertEquals(result.allowed, true);
    // The effective limit should be the per-key limit (5), not the tier default
    assertEquals(result.limit, 5);
});

Deno.test('checkRateLimitTiered - apiKeyRateLimit=0 blocks request immediately', async () => {
    const kv: KVData = new Map();
    const env = makeEnv({ RATE_LIMIT: makeKvNamespace(kv) });
    const ctx: IAuthContext = {
        ...ANONYMOUS_AUTH_CONTEXT,
        userId: 'user_disabled',
        tier: UserTier.Free,
        role: 'user',
        authMethod: 'api-key',
        apiKeyRateLimit: 0, // disabled key
    };

    const result = await checkRateLimitTiered(env, '1.2.3.4', ctx);
    assertEquals(result.allowed, false);
    assertEquals(result.limit, 0);
    assertEquals(result.remaining, 0);
    // KV should NOT have been touched (early return)
    assertEquals(kv.size, 0);
});

Deno.test('checkRateLimitTiered - apiKeyRateLimit=null uses tier default', async () => {
    const kv: KVData = new Map();
    const env = makeEnv({ RATE_LIMIT: makeKvNamespace(kv) });
    const ctx: IAuthContext = {
        ...ANONYMOUS_AUTH_CONTEXT,
        userId: 'user_nullkey',
        tier: UserTier.Free,
        role: 'user',
        authMethod: 'api-key',
        apiKeyRateLimit: null, // no per-key override
    };

    const result = await checkRateLimitTiered(env, '1.2.3.4', ctx);
    assertEquals(result.allowed, true);
    // Should use the Free tier default, not 0 or null
    const freeConfig = getRateLimitConfig(UserTier.Free);
    assertEquals(result.limit, freeConfig.maxRequests);
});

// ============================================================================
// checkRateLimitTiered — RATE_LIMITER_DO path
// ============================================================================

Deno.test('checkRateLimitTiered - uses RATE_LIMITER_DO when bound (DO path returns allowed:true)', async () => {
    // Stub a DO namespace that returns allowed:true on the first increment
    let doCallCount = 0;
    const stubDo = {
        idFromName: (_name: string) => ({ toString: () => 'stub-id' }),
        get: (_id: unknown) => ({
            fetch: async (_req: Request) => {
                doCallCount++;
                return new Response(
                    JSON.stringify({ allowed: true, limit: 60, remaining: 59, resetAt: Date.now() + 60_000 }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } },
                );
            },
        }),
    };

    const env = makeEnv({ RATE_LIMITER_DO: stubDo as unknown as DurableObjectNamespace });
    const result = await checkRateLimitTiered(env, '10.0.0.1', makeAnonymousCtx());

    assertEquals(result.allowed, true);
    assertEquals(result.limit, 60);
    assertEquals(doCallCount, 1);
});

Deno.test('checkRateLimitTiered - falls back to KV when RATE_LIMITER_DO returns non-OK', async () => {
    // DO returns 500 — should fall back to KV
    const stubDo = {
        idFromName: (_name: string) => ({ toString: () => 'stub-id' }),
        get: (_id: unknown) => ({
            fetch: async (_req: Request) => new Response('error', { status: 500 }),
        }),
    };

    const kv: KVData = new Map();
    const env = makeEnv({
        RATE_LIMIT: makeKvNamespace(kv),
        RATE_LIMITER_DO: stubDo as unknown as DurableObjectNamespace,
    });

    const result = await checkRateLimitTiered(env, '10.0.0.2', makeAnonymousCtx());
    // KV fallback succeeds
    assertEquals(result.allowed, true);
    // KV should have a new entry
    assertEquals(kv.size > 0, true);
});
