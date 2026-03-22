import { assertEquals } from '@std/assert';
import { D1StorageConfigSchema } from './prisma-d1-config.ts';

// ---------------------------------------------------------------------------
// D1StorageConfigSchema — happy paths
// ---------------------------------------------------------------------------

Deno.test('D1StorageConfigSchema applies defaults when no input provided', () => {
    const result = D1StorageConfigSchema.safeParse({});
    assertEquals(result.success, true);
    if (result.success) {
        assertEquals(result.data.defaultTtlMs, 3_600_000);
        assertEquals(result.data.enableLogging, false);
    }
});

Deno.test('D1StorageConfigSchema accepts valid custom TTL', () => {
    const result = D1StorageConfigSchema.safeParse({ defaultTtlMs: 7_200_000 });
    assertEquals(result.success, true);
    if (result.success) {
        assertEquals(result.data.defaultTtlMs, 7_200_000);
    }
});

Deno.test('D1StorageConfigSchema accepts zero TTL (no expiry)', () => {
    const result = D1StorageConfigSchema.safeParse({ defaultTtlMs: 0 });
    assertEquals(result.success, true);
    if (result.success) {
        assertEquals(result.data.defaultTtlMs, 0);
    }
});

Deno.test('D1StorageConfigSchema accepts enableLogging true', () => {
    const result = D1StorageConfigSchema.safeParse({ enableLogging: true });
    assertEquals(result.success, true);
    if (result.success) {
        assertEquals(result.data.enableLogging, true);
    }
});

Deno.test('D1StorageConfigSchema accepts full config', () => {
    const result = D1StorageConfigSchema.safeParse({
        defaultTtlMs: 300_000,
        enableLogging: true,
    });
    assertEquals(result.success, true);
    if (result.success) {
        assertEquals(result.data.defaultTtlMs, 300_000);
        assertEquals(result.data.enableLogging, true);
    }
});

// ---------------------------------------------------------------------------
// D1StorageConfigSchema — rejection paths
// ---------------------------------------------------------------------------

Deno.test('D1StorageConfigSchema rejects negative TTL', () => {
    const result = D1StorageConfigSchema.safeParse({ defaultTtlMs: -1 });
    assertEquals(result.success, false);
});

Deno.test('D1StorageConfigSchema rejects fractional TTL', () => {
    const result = D1StorageConfigSchema.safeParse({ defaultTtlMs: 1.5 });
    assertEquals(result.success, false);
});

Deno.test('D1StorageConfigSchema rejects non-boolean enableLogging', () => {
    const result = D1StorageConfigSchema.safeParse({ enableLogging: 'yes' });
    assertEquals(result.success, false);
});

Deno.test('D1StorageConfigSchema rejects non-number TTL', () => {
    const result = D1StorageConfigSchema.safeParse({ defaultTtlMs: '3600000' });
    assertEquals(result.success, false);
});
