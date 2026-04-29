import { assertEquals, assertExists, assertMatch } from '@std/assert';
import { PrismaClientConfigSchema } from './prisma-config.ts';
import { _enforceUuidOnCreateData, UUID_REGEX } from './prisma.ts';

Deno.test('PrismaClientConfigSchema validates postgres:// shorthand (Hyperdrive)', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'postgres://user:pass@localhost:5432/db',
    });
    assertEquals(result.success, true);
});

Deno.test('PrismaClientConfigSchema validates valid PostgreSQL URL', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'postgresql://user:pass@localhost:5432/db',
    });
    assertEquals(result.success, true);
});

Deno.test('PrismaClientConfigSchema rejects empty string', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: '',
    });
    assertEquals(result.success, false);
});

Deno.test('PrismaClientConfigSchema rejects non-postgresql URL', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'mysql://user:pass@localhost:3306/db',
    });
    assertEquals(result.success, false);
});

Deno.test('PrismaClientConfigSchema rejects missing connectionString', () => {
    const result = PrismaClientConfigSchema.safeParse({});
    assertEquals(result.success, false);
});

Deno.test('PrismaClientConfigSchema rejects plain string (not URL)', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'not-a-url',
    });
    assertEquals(result.success, false);
});

Deno.test('PrismaClientConfigSchema validates URL with query params', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'postgresql://user:pass@host:5432/db?sslmode=require',
    });
    assertEquals(result.success, true);
});

// ============================================================================
// UUID_REGEX — Better Auth non-UUID ID detection
//
// Better Auth 1.5.x does not reliably call advanced.generateId before passing
// IDs to Prisma. All model id columns are @db.Uuid in PostgreSQL, so any
// non-UUID string causes "invalid input syntax for type uuid".
//
// The createPrismaClient() $extends query extension uses UUID_REGEX to detect
// non-UUID ids and replace them with crypto.randomUUID() before the query
// reaches the database.
//
// These tests guard against regressions in UUID detection:
//   - UUID_REGEX must be exported (import fails if removed)
//   - UUID_REGEX must accept canonical UUID strings (crypto.randomUUID() output)
//   - UUID_REGEX must reject Better Auth opaque IDs (no dashes, wrong length)
//   - UUID_REGEX must reject empty / null-like strings
// ============================================================================

Deno.test('UUID_REGEX is exported from prisma module', () => {
    assertExists(UUID_REGEX);
    assertEquals(UUID_REGEX instanceof RegExp, true);
});

Deno.test('UUID_REGEX accepts a canonical UUID v4', () => {
    // Hardcoded UUIDs from RFC 4122 test vectors — deterministic and always valid.
    assertEquals(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000'), true);
    assertEquals(UUID_REGEX.test('6ba7b810-9dad-11d1-80b4-00c04fd430c8'), true);
});

Deno.test('UUID_REGEX accepts uppercase UUID', () => {
    assertEquals(UUID_REGEX.test('550E8400-E29B-41D4-A716-446655440000'), true);
});

Deno.test('UUID_REGEX rejects Better Auth opaque ID (no dashes, 32 chars)', () => {
    assertEquals(UUID_REGEX.test('NqEqNgrxWWaQnyBqb9SLtbGG0ODl2TK2'), false, 'Better Auth opaque IDs must be detected and replaced');
});

Deno.test('UUID_REGEX rejects Better Auth opaque ID (alternative format)', () => {
    assertEquals(UUID_REGEX.test('9hrbjIfqhl2sTXOhzrWSNwL9i2kipz51'), false, 'Better Auth opaque IDs must be detected and replaced');
});

Deno.test('UUID_REGEX rejects empty string', () => {
    assertEquals(UUID_REGEX.test(''), false);
});

Deno.test('UUID_REGEX rejects UUID with wrong segment lengths', () => {
    // 8-4-3-4-12 (missing one char in 3rd segment)
    assertEquals(UUID_REGEX.test('550e8400-e29b-41d-a716-446655440000'), false);
});

Deno.test('UUID_REGEX rejects UUID missing dashes', () => {
    assertEquals(UUID_REGEX.test('550e8400e29b41d4a716446655440000'), false);
});

// ============================================================================
// _enforceUuidOnCreateData — create operation interceptor
//
// These tests verify the replacement logic used by the $extends query
// extension in createPrismaClient(). Tests run without a database connection.
// ============================================================================

Deno.test('_enforceUuidOnCreateData replaces non-UUID id with a valid UUID', () => {
    const data: Record<string, unknown> = { id: 'NqEqNgrxWWaQnyBqb9SLtbGG0ODl2TK2', name: 'Alice' };
    _enforceUuidOnCreateData(data);
    assertMatch(data.id as string, UUID_REGEX);
    assertEquals(data.name, 'Alice'); // other fields are untouched
});

Deno.test('_enforceUuidOnCreateData preserves a valid UUID id unchanged', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const data: Record<string, unknown> = { id: uuid };
    _enforceUuidOnCreateData(data);
    assertEquals(data.id, uuid);
});

Deno.test('_enforceUuidOnCreateData leaves data without id property unchanged', () => {
    const data: Record<string, unknown> = { name: 'Alice' };
    _enforceUuidOnCreateData(data);
    assertEquals(data.id, undefined);
    assertEquals(data.name, 'Alice');
});

Deno.test('_enforceUuidOnCreateData does not replace an empty string id', () => {
    // Empty string ids are not a Better Auth pattern, but the guard ensures
    // only non-empty, non-UUID strings are replaced (PostgreSQL will still
    // reject an empty string — that should surface to the caller unchanged).
    const data: Record<string, unknown> = { id: '' };
    _enforceUuidOnCreateData(data);
    assertEquals(data.id, '');
});

Deno.test('_enforceUuidOnCreateData replaces the second Better Auth opaque ID format', () => {
    const data: Record<string, unknown> = { id: '9hrbjIfqhl2sTXOhzrWSNwL9i2kipz51' };
    _enforceUuidOnCreateData(data);
    assertMatch(data.id as string, UUID_REGEX);
});
