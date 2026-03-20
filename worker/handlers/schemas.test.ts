/**
 * Unit tests for handleSchemas (GET /api/schemas)
 */

import { assertEquals, assertExists } from '@std/assert';
import { handleSchemas } from './schemas.ts';
import { makeEnv } from '../test-helpers.ts';

Deno.test('handleSchemas - returns 200 with success:true', async () => {
    const req = new Request('http://localhost/api/schemas');
    const env = makeEnv();
    const res = handleSchemas(req, env);
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean };
    assertEquals(body.success, true);
});

Deno.test('handleSchemas - response includes schemas object', async () => {
    const req = new Request('http://localhost/api/schemas');
    const env = makeEnv();
    const res = handleSchemas(req, env);
    const body = await res.json() as { schemas: Record<string, unknown> };
    assertExists(body.schemas);
    assertExists(body.schemas['ConfigurationSchema']);
    assertExists(body.schemas['CompileRequestSchema']);
    assertExists(body.schemas['SourceSchema']);
    assertExists(body.schemas['BenchmarkMetricsSchema']);
});

Deno.test('handleSchemas - each schema has $schema field', async () => {
    const req = new Request('http://localhost/api/schemas');
    const env = makeEnv();
    const res = handleSchemas(req, env);
    const body = await res.json() as { schemas: Record<string, Record<string, unknown>> };
    for (const [_name, schema] of Object.entries(body.schemas)) {
        assertExists(schema['$schema'] ?? schema['type'], `Schema should have $schema or type field`);
    }
});

Deno.test('handleSchemas - Cache-Control header is set to public max-age=3600', () => {
    const req = new Request('http://localhost/api/schemas');
    const env = makeEnv();
    const res = handleSchemas(req, env);
    assertEquals(res.headers.get('Cache-Control'), 'public, max-age=3600');
});
