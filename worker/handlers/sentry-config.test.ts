/**
 * Tests for the Sentry config handler.
 *
 * Covers:
 *  - Returns { dsn: null, release: null } when SENTRY_DSN and SENTRY_RELEASE are unset
 *  - Returns the correct DSN when SENTRY_DSN is set
 *  - Returns the correct release when SENTRY_RELEASE is set
 *  - Content-Type header is application/json
 *  - Cache-Control header is set correctly
 */

import { assertEquals } from '@std/assert';
import type { Env } from '../types.ts';
import { handleSentryConfig } from './sentry-config.ts';

// ---------------------------------------------------------------------------
// Minimal env stub
// ---------------------------------------------------------------------------

function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
        ADMIN_KEY: 'secret-admin-key',
        COMPILER_VERSION: '1.0.0-test',
        ...overrides,
    } as unknown as Env;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test('handleSentryConfig — returns { dsn: null, release: null } when env vars are unset', async () => {
    const env = makeEnv(); // no SENTRY_DSN, no SENTRY_RELEASE
    const response = handleSentryConfig(env);
    const body = await response.json() as { dsn: string | null; release: string | null };
    assertEquals(body.dsn, null);
    assertEquals(body.release, null);
});

Deno.test('handleSentryConfig — returns the correct DSN when SENTRY_DSN is set', async () => {
    const dsn = 'https://abc123@o999.ingest.sentry.io/12345';
    const env = makeEnv({ SENTRY_DSN: dsn });
    const response = handleSentryConfig(env);
    const body = await response.json() as { dsn: string | null; release: string | null };
    assertEquals(body.dsn, dsn);
});

Deno.test('handleSentryConfig — returns the correct release when SENTRY_RELEASE is set', async () => {
    const release = 'abc1234def5678';
    const env = makeEnv({ SENTRY_RELEASE: release });
    const response = handleSentryConfig(env);
    const body = await response.json() as { dsn: string | null; release: string | null };
    assertEquals(body.release, release);
});

Deno.test('handleSentryConfig — Content-Type is application/json', () => {
    const env = makeEnv();
    const response = handleSentryConfig(env);
    assertEquals(response.headers.get('Content-Type'), 'application/json');
});

Deno.test('handleSentryConfig — Cache-Control is set for CDN caching', () => {
    const env = makeEnv();
    const response = handleSentryConfig(env);
    assertEquals(response.headers.get('Cache-Control'), 'public, max-age=300');
});
