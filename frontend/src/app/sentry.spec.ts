/**
 * Unit tests for sentry.ts — Sentry Browser SDK initialisation helpers.
 *
 * Covers:
 *  - SentryConfigResponseSchema Zod validation (trust-boundary parsing)
 *  - initSentry() guard logic (early return when no DSN, Sentry.init call when DSN present)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SentryConfigResponseSchema, initSentry } from './sentry';

// ---------------------------------------------------------------------------
// Mock @sentry/angular so initSentry() can be tested without a real DOM +
// Sentry SDK loaded.  We only need to assert that `Sentry.init` is called
// with the expected shape when a DSN is supplied.
// ---------------------------------------------------------------------------

vi.mock('@sentry/angular', () => ({
    init: vi.fn(),
    browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
    replayIntegration: vi.fn(() => ({ name: 'Replay' })),
}));

import * as SentryMod from '@sentry/angular';

// ---------------------------------------------------------------------------
// SentryConfigResponseSchema
// ---------------------------------------------------------------------------

describe('SentryConfigResponseSchema', () => {
    it('accepts a fully populated valid shape', () => {
        const result = SentryConfigResponseSchema.safeParse({
            dsn: 'https://abc@o0.ingest.sentry.io/1',
            release: 'abc1234',
            environment: 'staging',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.dsn).toBe('https://abc@o0.ingest.sentry.io/1');
            expect(result.data.release).toBe('abc1234');
            expect(result.data.environment).toBe('staging');
        }
    });

    it('accepts null dsn and release', () => {
        const result = SentryConfigResponseSchema.safeParse({
            dsn: null,
            release: null,
            environment: 'production',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.dsn).toBeNull();
            expect(result.data.release).toBeNull();
        }
    });

    it('defaults environment to "production" when field is absent (backward-compatibility)', () => {
        // Older Worker responses omit the environment field.
        // The schema must accept them and default to 'production'.
        const result = SentryConfigResponseSchema.safeParse({
            dsn: 'https://abc@o0.ingest.sentry.io/1',
            release: null,
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.environment).toBe('production');
        }
    });

    it('defaults environment to "production" when field is undefined', () => {
        const result = SentryConfigResponseSchema.safeParse({
            dsn: null,
            release: null,
            environment: undefined,
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.environment).toBe('production');
        }
    });

    it('rejects a shape where dsn is a number', () => {
        const result = SentryConfigResponseSchema.safeParse({
            dsn: 12345,
            release: null,
        });
        expect(result.success).toBe(false);
    });

    it('rejects a shape where release is a boolean', () => {
        const result = SentryConfigResponseSchema.safeParse({
            dsn: null,
            release: true,
        });
        expect(result.success).toBe(false);
    });

    it('rejects an empty object (missing required dsn and release fields)', () => {
        const result = SentryConfigResponseSchema.safeParse({});
        expect(result.success).toBe(false);
    });

    it('rejects null as the entire input', () => {
        const result = SentryConfigResponseSchema.safeParse(null);
        expect(result.success).toBe(false);
    });

    it('accepts environment set to an arbitrary string (e.g. "development")', () => {
        const result = SentryConfigResponseSchema.safeParse({
            dsn: null,
            release: null,
            environment: 'development',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.environment).toBe('development');
        }
    });
});

// ---------------------------------------------------------------------------
// initSentry()
// ---------------------------------------------------------------------------

describe('initSentry()', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns without calling Sentry.init when dsn is null', async () => {
        await initSentry(null);
        expect(SentryMod.init).not.toHaveBeenCalled();
    });

    it('returns without calling Sentry.init when dsn is undefined', async () => {
        await initSentry(undefined);
        expect(SentryMod.init).not.toHaveBeenCalled();
    });

    it('returns without calling Sentry.init when dsn is empty string', async () => {
        await initSentry('');
        expect(SentryMod.init).not.toHaveBeenCalled();
    });

    it('calls Sentry.init with dsn when dsn is provided', async () => {
        const dsn = 'https://key@o0.ingest.sentry.io/1';
        await initSentry(dsn);
        expect(SentryMod.init).toHaveBeenCalledOnce();
        const call = (SentryMod.init as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
        expect(call['dsn']).toBe(dsn);
    });

    it('includes release in Sentry.init config when provided', async () => {
        await initSentry('https://key@o0.ingest.sentry.io/1', 'abc123');
        const call = (SentryMod.init as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
        expect(call['release']).toBe('abc123');
    });

    it('omits release key when release is null', async () => {
        await initSentry('https://key@o0.ingest.sentry.io/1', null);
        const call = (SentryMod.init as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
        // release should not be included when null
        expect(call).not.toHaveProperty('release');
    });

    it('uses provided environment in Sentry.init config', async () => {
        await initSentry('https://key@o0.ingest.sentry.io/1', null, 'staging');
        const call = (SentryMod.init as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
        expect(call['environment']).toBe('staging');
    });

    it('defaults environment to "production" when environment is null', async () => {
        await initSentry('https://key@o0.ingest.sentry.io/1', null, null);
        const call = (SentryMod.init as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
        expect(call['environment']).toBe('production');
    });

    it('defaults environment to "production" when environment is undefined', async () => {
        await initSentry('https://key@o0.ingest.sentry.io/1', null, undefined);
        const call = (SentryMod.init as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
        expect(call['environment']).toBe('production');
    });

    it('sets tracesSampleRate in Sentry.init config', async () => {
        await initSentry('https://key@o0.ingest.sentry.io/1');
        const call = (SentryMod.init as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
        expect(typeof call['tracesSampleRate']).toBe('number');
    });
});
