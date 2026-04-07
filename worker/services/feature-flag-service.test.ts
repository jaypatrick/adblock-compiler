/**
 * Tests for the KV-backed feature flag service.
 *
 * Covers:
 *   - KvFeatureFlagService.isEnabled() — enabled flag, disabled flag, missing flag, KV error fallback
 *   - KvFeatureFlagService.getAllEnabled() — returns enabled flags, excludes disabled, handles KV error
 *   - KvFeatureFlagService.setFlag() — writes correct JSON to KV
 *   - NullFeatureFlagService — always returns fallback
 *   - createFeatureFlagService() — returns KvFeatureFlagService when kv present, NullFeatureFlagService when absent
 */

import { assertEquals, assertInstanceOf } from '@std/assert';
import { makeFailingKv, makeInMemoryKv } from '../test-helpers.ts';
import { silentLogger } from '../../src/utils/index.ts';
import { createFeatureFlagService, KvFeatureFlagService, NullFeatureFlagService } from './feature-flag-service.ts';
import type { KvFlagValue } from './feature-flag-service.ts';

// ============================================================================
// Helpers
// ============================================================================

/** Seed a KV with a pre-serialised flag value. */
function seedFlag(store: Map<string, string>, flagKey: string, value: KvFlagValue): void {
    store.set(`flag:${flagKey}`, JSON.stringify(value));
}

// ============================================================================
// KvFeatureFlagService.isEnabled()
// ============================================================================

Deno.test('KvFeatureFlagService.isEnabled() — returns true for an enabled flag', async () => {
    const store = new Map<string, string>();
    seedFlag(store, 'ENABLE_BATCH_STREAMING', { enabled: true, updatedAt: '2025-01-01T00:00:00.000Z' });
    const kv = makeInMemoryKv(store);
    const svc = new KvFeatureFlagService(kv, silentLogger);

    const result = await svc.isEnabled('ENABLE_BATCH_STREAMING');
    assertEquals(result, true);
});

Deno.test('KvFeatureFlagService.isEnabled() — returns false for a disabled flag', async () => {
    const store = new Map<string, string>();
    seedFlag(store, 'ENABLE_R2_CACHE', { enabled: false, updatedAt: '2025-01-01T00:00:00.000Z' });
    const kv = makeInMemoryKv(store);
    const svc = new KvFeatureFlagService(kv, silentLogger);

    const result = await svc.isEnabled('ENABLE_R2_CACHE');
    assertEquals(result, false);
});

Deno.test('KvFeatureFlagService.isEnabled() — returns default fallback (false) when flag is missing', async () => {
    const kv = makeInMemoryKv();
    const svc = new KvFeatureFlagService(kv, silentLogger);

    const result = await svc.isEnabled('ENABLE_VERBOSE_ERRORS');
    assertEquals(result, false);
});

Deno.test('KvFeatureFlagService.isEnabled() — returns custom fallback when flag is missing', async () => {
    const kv = makeInMemoryKv();
    const svc = new KvFeatureFlagService(kv, silentLogger);

    const result = await svc.isEnabled('ENABLE_VERBOSE_ERRORS', true);
    assertEquals(result, true);
});

Deno.test('KvFeatureFlagService.isEnabled() — returns fallback (false) on KV error', async () => {
    const svc = new KvFeatureFlagService(makeFailingKv(), silentLogger);

    const result = await svc.isEnabled('ENABLE_BENCHMARK_HEADERS');
    assertEquals(result, false);
});

Deno.test('KvFeatureFlagService.isEnabled() — returns custom fallback on KV error', async () => {
    const svc = new KvFeatureFlagService(makeFailingKv(), silentLogger);

    const result = await svc.isEnabled('ENABLE_BENCHMARK_HEADERS', true);
    assertEquals(result, true);
});

// ============================================================================
// KvFeatureFlagService.getAllEnabled()
// ============================================================================

Deno.test('KvFeatureFlagService.getAllEnabled() — returns only enabled flags', async () => {
    const store = new Map<string, string>();
    seedFlag(store, 'ENABLE_BATCH_STREAMING', { enabled: true, updatedAt: '2025-01-01T00:00:00.000Z' });
    seedFlag(store, 'ENABLE_R2_CACHE', { enabled: false, updatedAt: '2025-01-01T00:00:00.000Z' });
    seedFlag(store, 'ENABLE_ASYNC_COMPILE', { enabled: true, updatedAt: '2025-01-01T00:00:00.000Z' });
    const kv = makeInMemoryKv(store);
    const svc = new KvFeatureFlagService(kv, silentLogger);

    const enabled = await svc.getAllEnabled();
    assertEquals(enabled.sort(), ['ENABLE_ASYNC_COMPILE', 'ENABLE_BATCH_STREAMING'].sort());
});

Deno.test('KvFeatureFlagService.getAllEnabled() — returns empty array when no flags exist', async () => {
    const kv = makeInMemoryKv();
    const svc = new KvFeatureFlagService(kv, silentLogger);

    const enabled = await svc.getAllEnabled();
    assertEquals(enabled, []);
});

Deno.test('KvFeatureFlagService.getAllEnabled() — excludes all disabled flags', async () => {
    const store = new Map<string, string>();
    seedFlag(store, 'ENABLE_WARMUP_CRON', { enabled: false, updatedAt: '2025-01-01T00:00:00.000Z' });
    seedFlag(store, 'ENABLE_VERBOSE_ERRORS', { enabled: false, updatedAt: '2025-01-01T00:00:00.000Z' });
    const kv = makeInMemoryKv(store);
    const svc = new KvFeatureFlagService(kv, silentLogger);

    const enabled = await svc.getAllEnabled();
    assertEquals(enabled, []);
});

Deno.test('KvFeatureFlagService.getAllEnabled() — returns empty array on KV list error', async () => {
    const svc = new KvFeatureFlagService(makeFailingKv(), silentLogger);

    const enabled = await svc.getAllEnabled();
    assertEquals(enabled, []);
});

// ============================================================================
// KvFeatureFlagService.setFlag()
// ============================================================================

Deno.test('KvFeatureFlagService.setFlag() — writes enabled=true to KV', async () => {
    const kv = makeInMemoryKv();
    const svc = new KvFeatureFlagService(kv, silentLogger);

    await svc.setFlag('ENABLE_WORKFLOW_COMPILE', true);

    const parsed = await kv.get<KvFlagValue>('flag:ENABLE_WORKFLOW_COMPILE', 'json');
    assertEquals(parsed?.enabled, true);
    assertEquals(typeof parsed?.updatedAt, 'string');
});

Deno.test('KvFeatureFlagService.setFlag() — writes enabled=false to KV', async () => {
    const kv = makeInMemoryKv();
    const svc = new KvFeatureFlagService(kv, silentLogger);

    await svc.setFlag('ENABLE_BROWSER_FETCHER', false);

    const parsed = await kv.get<KvFlagValue>('flag:ENABLE_BROWSER_FETCHER', 'json');
    assertEquals(parsed?.enabled, false);
    assertEquals(typeof parsed?.updatedAt, 'string');
});

Deno.test('KvFeatureFlagService.setFlag() — updatedAt is a valid ISO-8601 timestamp', async () => {
    const kv = makeInMemoryKv();
    const svc = new KvFeatureFlagService(kv, silentLogger);

    await svc.setFlag('ENABLE_BENCHMARK_HEADERS', true);

    const parsed = await kv.get<KvFlagValue>('flag:ENABLE_BENCHMARK_HEADERS', 'json');
    const ts = Date.parse(parsed?.updatedAt ?? '');
    assertEquals(isNaN(ts), false);
});

Deno.test('KvFeatureFlagService.setFlag() — isEnabled returns true after setFlag(true)', async () => {
    const store = new Map<string, string>();
    const kv = makeInMemoryKv(store);
    const svc = new KvFeatureFlagService(kv, silentLogger);

    await svc.setFlag('ENABLE_BATCH_STREAMING', true);
    const result = await svc.isEnabled('ENABLE_BATCH_STREAMING');
    assertEquals(result, true);
});

Deno.test('KvFeatureFlagService.setFlag() — isEnabled returns false after setFlag(false)', async () => {
    const store = new Map<string, string>();
    seedFlag(store, 'ENABLE_BATCH_STREAMING', { enabled: true, updatedAt: '2025-01-01T00:00:00.000Z' });
    const kv = makeInMemoryKv(store);
    const svc = new KvFeatureFlagService(kv, silentLogger);

    await svc.setFlag('ENABLE_BATCH_STREAMING', false);
    const result = await svc.isEnabled('ENABLE_BATCH_STREAMING');
    assertEquals(result, false);
});

// ============================================================================
// NullFeatureFlagService
// ============================================================================

Deno.test('NullFeatureFlagService.isEnabled() — always returns false by default', async () => {
    const svc = new NullFeatureFlagService();
    assertEquals(await svc.isEnabled('ENABLE_BATCH_STREAMING'), false);
});

Deno.test('NullFeatureFlagService.isEnabled() — returns custom fallback when provided', async () => {
    const svc = new NullFeatureFlagService();
    assertEquals(await svc.isEnabled('ENABLE_BATCH_STREAMING', true), true);
});

Deno.test('NullFeatureFlagService.getAllEnabled() — always returns empty array', async () => {
    const svc = new NullFeatureFlagService();
    assertEquals(await svc.getAllEnabled(), []);
});

Deno.test('NullFeatureFlagService.setFlag() — is a no-op (does not throw)', async () => {
    const svc = new NullFeatureFlagService();
    // Should not throw
    await svc.setFlag('ENABLE_BATCH_STREAMING', true);
    // Still returns false after the no-op write
    assertEquals(await svc.isEnabled('ENABLE_BATCH_STREAMING'), false);
});

// ============================================================================
// createFeatureFlagService()
// ============================================================================

Deno.test('createFeatureFlagService() — returns KvFeatureFlagService when KV binding is present', () => {
    const kv = makeInMemoryKv();
    const svc = createFeatureFlagService(kv, silentLogger);
    assertInstanceOf(svc, KvFeatureFlagService);
});

Deno.test('createFeatureFlagService() — returns NullFeatureFlagService when KV binding is absent', () => {
    const svc = createFeatureFlagService(undefined, silentLogger);
    assertInstanceOf(svc, NullFeatureFlagService);
});

Deno.test('createFeatureFlagService() — NullFeatureFlagService returned when absent defaults to false', async () => {
    const svc = createFeatureFlagService(undefined, silentLogger);
    assertEquals(await svc.isEnabled('ENABLE_BATCH_STREAMING'), false);
});

Deno.test('createFeatureFlagService() — KvFeatureFlagService correctly reads flags', async () => {
    const store = new Map<string, string>();
    seedFlag(store, 'ENABLE_ASYNC_COMPILE', { enabled: true, updatedAt: '2025-01-01T00:00:00.000Z' });
    const kv = makeInMemoryKv(store);
    const svc = createFeatureFlagService(kv, silentLogger);

    assertEquals(await svc.isEnabled('ENABLE_ASYNC_COMPILE'), true);
});
