/**
 * Tests for Zod schemas used in request validation
 */

import { assertEquals } from '@std/assert';
import {
    BatchRequestAsyncSchema,
    BatchRequestSyncSchema,
    CompileRequestSchema,
    ConfigurationSchema,
    SourceSchema,
} from './schemas.ts';
import { SourceType, TransformationType } from '../types/index.ts';

// SourceSchema tests
Deno.test('SourceSchema - should validate minimal source', () => {
    const source = { source: 'https://example.com/list.txt' };
    const result = SourceSchema.safeParse(source);
    assertEquals(result.success, true);
});

Deno.test('SourceSchema - should validate full source', () => {
    const source = {
        source: 'https://example.com/list.txt',
        name: 'Example List',
        type: SourceType.Adblock,
        transformations: [TransformationType.RemoveComments],
    };
    const result = SourceSchema.safeParse(source);
    assertEquals(result.success, true);
});

Deno.test('SourceSchema - should reject empty source string', () => {
    const source = { source: '' };
    const result = SourceSchema.safeParse(source);
    assertEquals(result.success, false);
});

Deno.test('SourceSchema - should reject unknown property', () => {
    const source = {
        source: 'https://example.com/list.txt',
        unknownProp: 'value',
    };
    const result = SourceSchema.safeParse(source);
    assertEquals(result.success, false);
});

// ConfigurationSchema tests
Deno.test('ConfigurationSchema - should validate minimal configuration', () => {
    const config = {
        name: 'Test Config',
        sources: [{ source: 'https://example.com/list.txt' }],
    };
    const result = ConfigurationSchema.safeParse(config);
    assertEquals(result.success, true);
});

Deno.test('ConfigurationSchema - should reject empty sources', () => {
    const config = {
        name: 'Test Config',
        sources: [],
    };
    const result = ConfigurationSchema.safeParse(config);
    assertEquals(result.success, false);
});

// CompileRequestSchema tests
Deno.test('CompileRequestSchema - should validate request', () => {
    const request = {
        configuration: {
            name: 'Test',
            sources: [{ source: 'https://example.com/list.txt' }],
        },
    };
    const result = CompileRequestSchema.safeParse(request);
    assertEquals(result.success, true);
});

Deno.test('CompileRequestSchema - should validate with all fields', () => {
    const request = {
        configuration: {
            name: 'Test',
            sources: [{ source: 'https://example.com/list.txt' }],
        },
        preFetchedContent: { 'https://example.com/list.txt': 'content' },
        benchmark: true,
        priority: 'high' as const,
        turnstileToken: 'token123',
    };
    const result = CompileRequestSchema.safeParse(request);
    assertEquals(result.success, true);
});

// BatchRequestSyncSchema tests
Deno.test('BatchRequestSyncSchema - should validate batch with unique IDs', () => {
    const batch = {
        requests: [
            { id: '1', configuration: { name: 'Test', sources: [{ source: 'https://example.com/1.txt' }] } },
            { id: '2', configuration: { name: 'Test', sources: [{ source: 'https://example.com/2.txt' }] } },
        ],
    };
    const result = BatchRequestSyncSchema.safeParse(batch);
    assertEquals(result.success, true);
});

Deno.test('BatchRequestSyncSchema - should reject duplicate IDs', () => {
    const batch = {
        requests: [
            { id: '1', configuration: { name: 'Test', sources: [{ source: 'https://example.com/1.txt' }] } },
            { id: '1', configuration: { name: 'Test', sources: [{ source: 'https://example.com/2.txt' }] } },
        ],
    };
    const result = BatchRequestSyncSchema.safeParse(batch);
    assertEquals(result.success, false);
});

Deno.test('BatchRequestSyncSchema - should reject more than 10 requests', () => {
    const requests = Array.from({ length: 11 }, (_, i) => ({
        id: String(i),
        configuration: { name: 'Test', sources: [{ source: `https://example.com/${i}.txt` }] },
    }));
    const batch = { requests };
    const result = BatchRequestSyncSchema.safeParse(batch);
    assertEquals(result.success, false);
});

Deno.test('BatchRequestSyncSchema - should accept 10 requests', () => {
    const requests = Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        configuration: { name: 'Test', sources: [{ source: `https://example.com/${i}.txt` }] },
    }));
    const batch = { requests };
    const result = BatchRequestSyncSchema.safeParse(batch);
    assertEquals(result.success, true);
});

// BatchRequestAsyncSchema tests
Deno.test('BatchRequestAsyncSchema - should reject more than 100 requests', () => {
    const requests = Array.from({ length: 101 }, (_, i) => ({
        id: String(i),
        configuration: { name: 'Test', sources: [{ source: `https://example.com/${i}.txt` }] },
    }));
    const batch = { requests };
    const result = BatchRequestAsyncSchema.safeParse(batch);
    assertEquals(result.success, false);
});

Deno.test('BatchRequestAsyncSchema - should accept 100 requests', () => {
    const requests = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        configuration: { name: 'Test', sources: [{ source: `https://example.com/${i}.txt` }] },
    }));
    const batch = { requests };
    const result = BatchRequestAsyncSchema.safeParse(batch);
    assertEquals(result.success, true);
});

Deno.test('BatchRequestAsyncSchema - should validate with priority', () => {
    const batch = {
        requests: [
            { id: '1', configuration: { name: 'Test', sources: [{ source: 'https://example.com/1.txt' }] } },
        ],
        priority: 'high' as const,
    };
    const result = BatchRequestAsyncSchema.safeParse(batch);
    assertEquals(result.success, true);
});
