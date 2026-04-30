/**
 * Tests for the shared route helpers in worker/routes/shared.ts.
 */

import { assertEquals, assertExists } from '@std/assert';
import { makeAppContext, makeEnv } from '../test-helpers.ts';
import { verifyTurnstileInline } from './shared.ts';
import { ANONYMOUS_AUTH_CONTEXT, type IAuthContext, UserTier } from '../types.ts';
import { AnalyticsService } from '../../src/services/AnalyticsService.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAnalytics(): AnalyticsService {
    // deno-lint-ignore no-explicit-any
    return new AnalyticsService(undefined as any);
}

function makeApiKeyContext(): IAuthContext {
    return {
        ...ANONYMOUS_AUTH_CONTEXT,
        userId: 'user_api',
        tier: UserTier.Free,
        authMethod: 'api-key',
        apiKeyId: 'key_001',
    };
}

// ── verifyTurnstileInline ─────────────────────────────────────────────────────

Deno.test('verifyTurnstileInline: returns null when TURNSTILE_SECRET_KEY is not set', async () => {
    const env = makeEnv({ TURNSTILE_SECRET_KEY: undefined });
    const req = new Request('https://worker.example.com/api/compile', { method: 'POST' });
    const c = makeAppContext(req, env, ANONYMOUS_AUTH_CONTEXT);

    const result = await verifyTurnstileInline(c, '');
    assertEquals(result, null);
});

Deno.test('verifyTurnstileInline: returns null for api-key auth even when TURNSTILE_SECRET_KEY is set and token is empty', async () => {
    const env = makeEnv({ TURNSTILE_SECRET_KEY: 'test-secret' });
    const req = new Request('https://worker.example.com/api/compile', { method: 'POST' });
    const c = makeAppContext(req, env, makeApiKeyContext());

    // No token passed — must still return null because auth is api-key
    const result = await verifyTurnstileInline(c, '');
    assertEquals(result, null);
});

Deno.test('verifyTurnstileInline: returns null for api-key auth when token is missing', async () => {
    const env = makeEnv({ TURNSTILE_SECRET_KEY: 'test-secret' });
    const req = new Request('https://worker.example.com/api/ast/parse', { method: 'POST' });
    const c = makeAppContext(req, env, makeApiKeyContext());

    const result = await verifyTurnstileInline(c, '');
    assertEquals(result, null);
});

Deno.test('verifyTurnstileInline: returns 403 Response for browser session with missing token when TURNSTILE_SECRET_KEY is set', async () => {
    const env = makeEnv({ TURNSTILE_SECRET_KEY: 'test-secret' });
    const req = new Request('https://worker.example.com/api/compile', { method: 'POST' });
    // deno-lint-ignore no-explicit-any
    const vars: Record<string, any> = {
        authContext: ANONYMOUS_AUTH_CONTEXT,
        ip: '127.0.0.1',
        analytics: makeAnalytics(),
    };
    // Build a minimal AppContext with analytics set (needed by the rejection path)
    // deno-lint-ignore no-explicit-any
    const c: any = {
        req: {
            url: req.url,
            raw: req,
            json: () => req.json(),
            text: () => req.text(),
            header: (name: string) => req.headers.get(name) ?? undefined,
            method: req.method,
            path: new URL(req.url).pathname,
        },
        env,
        get: (key: string) => vars[key],
        set: (key: string, value: unknown) => {
            vars[key] = value;
        },
        json: (body: unknown, status?: number) => new Response(JSON.stringify(body), { status: status ?? 200 }),
    };

    const result = await verifyTurnstileInline(c, '');
    assertExists(result);
    assertEquals(result.status, 403);
    const body = await result.json() as Record<string, unknown>;
    assertEquals(body.success, false);
});
