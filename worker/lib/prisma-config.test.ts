import { assertEquals } from '@std/assert';
import { PrismaClientConfigSchema } from './prisma-config.ts';

// ---------------------------------------------------------------------------
// PrismaClientConfigSchema — happy paths
// ---------------------------------------------------------------------------

Deno.test('PrismaClientConfigSchema validates valid PostgreSQL URL', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'postgresql://user:pass@host:5432/db',
    });
    assertEquals(result.success, true);
});

Deno.test('PrismaClientConfigSchema validates URL with query parameters', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'postgresql://user:pass@host:5432/db?sslmode=require',
    });
    assertEquals(result.success, true);
});

Deno.test('PrismaClientConfigSchema validates URL with multiple query params', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'postgresql://user:pass@host:5432/db?sslmode=require&connection_limit=5',
    });
    assertEquals(result.success, true);
});

Deno.test('PrismaClientConfigSchema validates URL without port', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'postgresql://user:pass@host/db',
    });
    assertEquals(result.success, true);
});

Deno.test('PrismaClientConfigSchema validates URL without credentials', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'postgresql://host:5432/db',
    });
    assertEquals(result.success, true);
});

Deno.test('PrismaClientConfigSchema validates URL without credentials or port', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'postgresql://host/db',
    });
    assertEquals(result.success, true);
});

Deno.test('PrismaClientConfigSchema validates localhost URL', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'postgresql://localhost:5432/mydb',
    });
    assertEquals(result.success, true);
});

Deno.test('PrismaClientConfigSchema validates URL with password-only auth', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'postgresql://user:p%40ssword@host:5432/db',
    });
    assertEquals(result.success, true);
});

Deno.test('PrismaClientConfigSchema returns parsed data on success', () => {
    const url = 'postgresql://user:pass@host:5432/db';
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: url,
    });
    assertEquals(result.success, true);
    if (result.success) {
        assertEquals(result.data.connectionString, url);
    }
});

// ---------------------------------------------------------------------------
// PrismaClientConfigSchema — rejection paths: protocol
// ---------------------------------------------------------------------------

Deno.test('PrismaClientConfigSchema validates postgres:// shorthand (Hyperdrive scheme)', () => {
    // Cloudflare Hyperdrive returns postgres:// from its .connectionString property.
    // Both postgres:// and postgresql:// are valid PostgreSQL DSNs and must be accepted.
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'postgres://user:pass@host:5432/db',
    });
    assertEquals(result.success, true);
});

Deno.test('PrismaClientConfigSchema validates postgres:// with SSL query param (Hyperdrive + Neon)', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'postgres://user:pass@ep-xxx-pooler.eastus2.azure.neon.tech:5432/bloqr-backend?sslmode=require',
    });
    assertEquals(result.success, true);
});

Deno.test('PrismaClientConfigSchema validates postgres:// without port', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'postgres://user:pass@host/db',
    });
    assertEquals(result.success, true);
});

Deno.test('PrismaClientConfigSchema validates postgres:// localhost URL', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'postgres://localhost:5432/mydb',
    });
    assertEquals(result.success, true);
});

Deno.test('PrismaClientConfigSchema rejects mysql:// protocol', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'mysql://user:pass@host:3306/db',
    });
    assertEquals(result.success, false);
});

Deno.test('PrismaClientConfigSchema rejects http:// protocol', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'http://user:pass@host:5432/db',
    });
    assertEquals(result.success, false);
});

Deno.test('PrismaClientConfigSchema rejects mongodb:// protocol', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'mongodb://user:pass@host:27017/db',
    });
    assertEquals(result.success, false);
});

// ---------------------------------------------------------------------------
// PrismaClientConfigSchema — rejection paths: missing / empty
// ---------------------------------------------------------------------------

Deno.test('PrismaClientConfigSchema rejects empty connection string', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: '',
    });
    assertEquals(result.success, false);
});

Deno.test('PrismaClientConfigSchema rejects missing connectionString key', () => {
    const result = PrismaClientConfigSchema.safeParse({});
    assertEquals(result.success, false);
});

Deno.test('PrismaClientConfigSchema rejects undefined connectionString', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: undefined,
    });
    assertEquals(result.success, false);
});

Deno.test('PrismaClientConfigSchema rejects null connectionString', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: null,
    });
    assertEquals(result.success, false);
});

Deno.test('PrismaClientConfigSchema rejects null input', () => {
    const result = PrismaClientConfigSchema.safeParse(null);
    assertEquals(result.success, false);
});

Deno.test('PrismaClientConfigSchema rejects undefined input', () => {
    const result = PrismaClientConfigSchema.safeParse(undefined);
    assertEquals(result.success, false);
});

// ---------------------------------------------------------------------------
// PrismaClientConfigSchema — rejection paths: wrong types
// ---------------------------------------------------------------------------

Deno.test('PrismaClientConfigSchema rejects plain string (not URL)', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'not-a-url',
    });
    assertEquals(result.success, false);
});

Deno.test('PrismaClientConfigSchema rejects numeric connectionString', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 12345,
    });
    assertEquals(result.success, false);
});

Deno.test('PrismaClientConfigSchema rejects boolean connectionString', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: true,
    });
    assertEquals(result.success, false);
});

Deno.test('PrismaClientConfigSchema rejects bare string input instead of object', () => {
    const result = PrismaClientConfigSchema.safeParse(
        'postgresql://user:pass@host:5432/db',
    );
    assertEquals(result.success, false);
});

// ---------------------------------------------------------------------------
// PrismaClientConfigSchema — rejection paths: malformed URLs
// ---------------------------------------------------------------------------

Deno.test('PrismaClientConfigSchema accepts URL with protocol only (Zod url() allows it)', () => {
    // Zod's url() validator considers "postgresql://" a valid URL, so the
    // schema accepts it.  A runtime connection attempt would still fail, but
    // that is beyond the scope of input validation.
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: 'postgresql://',
    });
    assertEquals(result.success, true);
});

Deno.test('PrismaClientConfigSchema rejects whitespace-only string', () => {
    const result = PrismaClientConfigSchema.safeParse({
        connectionString: '   ',
    });
    assertEquals(result.success, false);
});
