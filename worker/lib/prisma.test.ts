import { assertEquals } from '@std/assert';
import { PrismaClientConfigSchema } from './prisma-config.ts';

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
