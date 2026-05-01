/**
 * Auth-flow integration tests.
 *
 * These tests verify the authentication and authorisation guard rails that
 * sit in front of protected routes.  They use the real Hono app (no mocks)
 * with an in-memory environment stub — no live database or Hyperdrive
 * connection is required because every request below should be rejected by
 * the auth middleware before any DB I/O is attempted.
 *
 * @see worker/middleware/auth.ts
 * @see worker/utils/route-permissions.ts
 */

import { assertEquals } from '@std/assert';
import { makeEnv } from './test-helpers.ts';
import { app } from './hono-app.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal ExecutionContext stub. */
function makeCtx(): ExecutionContext {
    return {
        waitUntil: (_p: Promise<unknown>) => {},
        passThroughOnException: () => {},
    } as unknown as ExecutionContext;
}

/** Send a request through the Hono app and return the Response. */
async function fetchRoute(
    path: string,
    options: RequestInit & { env?: ReturnType<typeof makeEnv> } = {},
): Promise<Response> {
    const { env: envOverride, ...init } = options;
    const env = envOverride ?? makeEnv();
    const request = new Request(`https://worker.example.com${path}`, init);
    return app.fetch(request, env, makeCtx());
}

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test('Auth flow: unauthenticated GET /api/rules is rejected with 401', async () => {
    // No session cookie, no Authorization header — must be rejected before
    // the route handler executes so that no DB access is attempted.
    const res = await fetchRoute('/api/rules');
    assertEquals(
        res.status,
        401,
        'Unauthenticated requests to /api/rules must return 401',
    );
});

Deno.test('Auth flow: invalid API key on GET /api/rules is rejected', async () => {
    // A well-formed "blq_" prefix makes the middleware recognise this as an
    // API key token and attempt DB validation.  In a test env without Hyperdrive
    // that validation fails with 503 rather than the production 401, so we
    // accept both as valid rejection signals.
    const res = await fetchRoute('/api/rules', {
        headers: { Authorization: 'Bearer blq_invalidkeyxxxxxxxxxxxxxxxx' },
    });
    const validStatuses = [401, 503];
    assertEquals(
        validStatuses.includes(res.status),
        true,
        `Requests carrying an invalid API key to /api/rules must be rejected (got ${res.status})`,
    );
});

Deno.test('Auth flow: unauthenticated GET /api/admin/users is rejected with 401', async () => {
    // Admin routes require both authentication and role === 'admin'.
    // An unauthenticated request must be blocked at the auth guard layer.
    const res = await fetchRoute('/api/admin/users');
    assertEquals(
        res.status,
        401,
        'Unauthenticated requests to /api/admin/users must return 401',
    );
});

Deno.test('Auth flow: unauthenticated POST /api/keys is rejected with 401', async () => {
    // API key creation requires an active session.  No credentials → 401.
    const res = await fetchRoute('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test-key' }),
    });
    assertEquals(
        res.status,
        401,
        'Unauthenticated POST /api/keys must return 401',
    );
});

Deno.test('Auth flow: POST /api/keys with invalid API key is rejected', async () => {
    // API key endpoints require a session token, not another API key.
    // Sending a well-formed but invalid blq_ key must be rejected.  In a test
    // env without Hyperdrive the DB validation attempt fails with 503 rather
    // than the production 401, so we accept both as valid rejection signals.
    const res = await fetchRoute('/api/keys', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer blq_invalidkeyxxxxxxxxxxxxxxxx',
        },
        body: JSON.stringify({ name: 'test-key' }),
    });
    const validStatuses = [401, 503];
    assertEquals(
        validStatuses.includes(res.status),
        true,
        `POST /api/keys with an invalid API key must be rejected (got ${res.status})`,
    );
});

Deno.test('Auth flow: POST /api/keys with missing body is rejected with 400 or 401', async () => {
    // Missing required body should either fail auth (401) before parsing,
    // or be rejected at the validation layer (400) after a session is detected.
    const res = await fetchRoute('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    });
    const validStatuses = [400, 401, 422];
    assertEquals(
        validStatuses.includes(res.status),
        true,
        `POST /api/keys with no body must return one of ${validStatuses.join(', ')}, got ${res.status}`,
    );
});

Deno.test('Auth flow: POST /api/keys with API key auth is rejected (session required)', async () => {
    // Key-creation endpoints are session-only; using an API key (even a real-looking
    // one) to call this endpoint must be rejected.  In a test env without Hyperdrive
    // configured the middleware may return 503 before 401/403 — all are valid
    // "not authorised" signals for the purposes of this guard-layer test.
    const res = await fetchRoute('/api/keys', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer blq_validlookingkeyxxxxxxxxxxxxxx',
        },
        body: JSON.stringify({ name: 'test-key' }),
    });
    const validRejectionStatuses = [401, 403, 503];
    assertEquals(
        validRejectionStatuses.includes(res.status),
        true,
        `POST /api/keys with API key auth must be rejected (got ${res.status})`,
    );
});

Deno.test('Auth flow: POST /api/auth/sign-in/email with missing credentials returns 4xx', async () => {
    // Better Auth validates required fields (email, password) and returns a
    // structured error — not a 5xx crash — when they are absent.
    const res = await fetchRoute('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    assertEquals(
        res.status >= 400 && res.status < 500,
        true,
        `POST /api/auth/sign-in/email with empty body must return 4xx; got ${res.status}`,
    );
});

Deno.test('Auth flow: POST /api/auth/sign-in/email with invalid session token returns 4xx', async () => {
    // A non-blq_ bearer token sent to the sign-in endpoint is not a valid
    // credential — Better Auth must reject it with a 4xx error, not crash.
    const res = await fetchRoute('/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer invalid_session_token_xxxxx',
        },
        body: JSON.stringify({ email: 'test@example.com', password: 'wrong' }),
    });
    assertEquals(
        res.status >= 400 && res.status < 500,
        true,
        `POST /api/auth/sign-in/email with invalid token must return 4xx; got ${res.status}`,
    );
});
