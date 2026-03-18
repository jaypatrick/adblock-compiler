/**
 * Tests for the source monitor request schema.
 *
 * Since handleSourceMonitor requires a real BROWSER binding and an
 * ExecutionContext, we focus on:
 *   - handleSourceMonitor: returns 503 when BROWSER binding is missing
 *   - handleSourceMonitor: returns 400 on invalid JSON body
 *   - handleSourceMonitor: returns 400 on schema validation failures
 *   - SourceMonitorRequestSchema: validates urls array (min 1, max 10, valid URLs)
 *   - SourceMonitorRequestSchema: validates screenshotPrefix regex
 *   - SourceMonitorRequestSchema: validates timeout range
 *   - SourceMonitorRequestSchema: validates waitUntil enum
 *
 * @see worker/handlers/source-monitor.ts
 */

import { assertEquals } from '@std/assert';
import { handleSourceMonitor, SourceMonitorRequestSchema } from './source-monitor.ts';
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

function makeCtx(): ExecutionContext {
    return {
        waitUntil: (_p: Promise<unknown>) => {},
        passThroughOnException: () => {},
    } as unknown as ExecutionContext;
}

function makeRequest(body: unknown): Request {
    return new Request('http://localhost/api/browser/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

// ============================================================================
// handleSourceMonitor — binding checks
// ============================================================================

Deno.test('handleSourceMonitor - returns 503 when BROWSER binding is missing', async () => {
    const env = makeEnv(); // no BROWSER
    const req = makeRequest({ urls: ['https://example.com'] });
    const res = await handleSourceMonitor(req, env, makeCtx());
    assertEquals(res.status, 503);
    const body = await res.json() as { success: boolean };
    assertEquals(body.success, false);
});

Deno.test('handleSourceMonitor - returns 400 on invalid JSON body', async () => {
    const env = makeEnv({ BROWSER: {} as unknown as Env['BROWSER'] });
    const req = new Request('http://localhost/api/browser/monitor', {
        method: 'POST',
        body: 'not-json',
    });
    const res = await handleSourceMonitor(req, env, makeCtx());
    assertEquals(res.status, 400);
});

Deno.test('handleSourceMonitor - returns 400 when urls array is empty', async () => {
    const env = makeEnv({ BROWSER: {} as unknown as Env['BROWSER'] });
    const req = makeRequest({ urls: [] });
    const res = await handleSourceMonitor(req, env, makeCtx());
    assertEquals(res.status, 400);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
});

Deno.test('handleSourceMonitor - returns 400 when urls array has invalid URL', async () => {
    const env = makeEnv({ BROWSER: {} as unknown as Env['BROWSER'] });
    const req = makeRequest({ urls: ['not-a-url'] });
    const res = await handleSourceMonitor(req, env, makeCtx());
    assertEquals(res.status, 400);
});

Deno.test('handleSourceMonitor - returns 400 when urls array exceeds 10 items', async () => {
    const env = makeEnv({ BROWSER: {} as unknown as Env['BROWSER'] });
    const urls = Array.from({ length: 11 }, (_, i) => `https://site${i}.example.com`);
    const req = makeRequest({ urls });
    const res = await handleSourceMonitor(req, env, makeCtx());
    assertEquals(res.status, 400);
});

// ============================================================================
// SourceMonitorRequestSchema — schema-level validation
// ============================================================================

Deno.test('SourceMonitorRequestSchema - accepts single valid URL', () => {
    const result = SourceMonitorRequestSchema.safeParse({ urls: ['https://example.com'] });
    assertEquals(result.success, true);
});

Deno.test('SourceMonitorRequestSchema - accepts up to 10 URLs', () => {
    const urls = Array.from({ length: 10 }, (_, i) => `https://site${i}.example.com`);
    const result = SourceMonitorRequestSchema.safeParse({ urls });
    assertEquals(result.success, true);
});

Deno.test('SourceMonitorRequestSchema - rejects empty urls array', () => {
    const result = SourceMonitorRequestSchema.safeParse({ urls: [] });
    assertEquals(result.success, false);
});

Deno.test('SourceMonitorRequestSchema - rejects more than 10 URLs', () => {
    const urls = Array.from({ length: 11 }, (_, i) => `https://site${i}.example.com`);
    const result = SourceMonitorRequestSchema.safeParse({ urls });
    assertEquals(result.success, false);
});

Deno.test('SourceMonitorRequestSchema - rejects non-URL strings in urls array', () => {
    const result = SourceMonitorRequestSchema.safeParse({ urls: ['not-a-url'] });
    assertEquals(result.success, false);
});

Deno.test('SourceMonitorRequestSchema - accepts optional captureScreenshots boolean', () => {
    const result = SourceMonitorRequestSchema.safeParse({
        urls: ['https://example.com'],
        captureScreenshots: true,
    });
    assertEquals(result.success, true);
});

Deno.test('SourceMonitorRequestSchema - accepts valid screenshotPrefix', () => {
    const result = SourceMonitorRequestSchema.safeParse({
        urls: ['https://example.com'],
        screenshotPrefix: 'my-prefix_v1',
    });
    assertEquals(result.success, true);
});

Deno.test('SourceMonitorRequestSchema - rejects screenshotPrefix with spaces', () => {
    const result = SourceMonitorRequestSchema.safeParse({
        urls: ['https://example.com'],
        screenshotPrefix: 'my prefix',
    });
    assertEquals(result.success, false);
});

Deno.test('SourceMonitorRequestSchema - accepts timeout within 1000-60000', () => {
    const result = SourceMonitorRequestSchema.safeParse({
        urls: ['https://example.com'],
        timeout: 10000,
    });
    assertEquals(result.success, true);
});

Deno.test('SourceMonitorRequestSchema - rejects timeout below 1000', () => {
    const result = SourceMonitorRequestSchema.safeParse({
        urls: ['https://example.com'],
        timeout: 500,
    });
    assertEquals(result.success, false);
});

Deno.test('SourceMonitorRequestSchema - accepts waitUntil "networkidle"', () => {
    const result = SourceMonitorRequestSchema.safeParse({
        urls: ['https://example.com'],
        waitUntil: 'networkidle',
    });
    assertEquals(result.success, true);
});

Deno.test('SourceMonitorRequestSchema - rejects invalid waitUntil value', () => {
    const result = SourceMonitorRequestSchema.safeParse({
        urls: ['https://example.com'],
        waitUntil: 'notreal',
    });
    assertEquals(result.success, false);
});
