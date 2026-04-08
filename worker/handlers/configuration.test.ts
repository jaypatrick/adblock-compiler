/**
 * Unit tests for the configuration handler endpoints.
 *
 * Covers:
 *   GET  /api/configuration/defaults  — returns defaults/limits/supportedSourceTypes
 *   POST /api/configuration/validate  — invalid JSON, missing field, valid, invalid config
 *   POST /api/configuration/resolve   — invalid JSON, missing field, valid, override merge,
 *                                        non-object override, applyEnvOverrides semantics,
 *                                        invalid config → 400 with validation errors
 *   POST /api/configuration/create    — valid config, invalid config, format selection
 *   GET  /api/configuration/download/:id — retrieve stored config, handle expiry, format selection
 *
 * @see worker/handlers/configuration.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { makeEnv, makeInMemoryKv } from '../test-helpers.ts';
import { SourceType } from '../../src/types/index.ts';
import { handleConfigurationCreate, handleConfigurationDefaults, handleConfigurationDownload, handleConfigurationResolve, handleConfigurationValidate } from './configuration.ts';

// ============================================================================
// Fixtures
// ============================================================================

const VALID_CONFIG = {
    name: 'Test List',
    sources: [{ source: 'https://example.com/hosts.txt', type: SourceType.Hosts }],
};

function makeRequest(method: string, body?: unknown, path = 'http://localhost/api/configuration/validate'): Request {
    if (body === undefined) {
        return new Request(path, { method });
    }
    return new Request(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function makeRawRequest(body: string, path = 'http://localhost/api/configuration/validate'): Request {
    return new Request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
    });
}

// ============================================================================
// GET /api/configuration/defaults
// ============================================================================

Deno.test('handleConfigurationDefaults — returns 200 with defaults and limits', async () => {
    const req = makeRequest('GET', undefined, 'http://localhost/api/configuration/defaults');
    const res = await handleConfigurationDefaults(req, makeEnv());
    assertEquals(res.status, 200);
    const body = await res.json() as {
        success: boolean;
        defaults: { compilation: unknown; validation: unknown };
        limits: { maxSources: number; maxExclusions: number };
        supportedSourceTypes: string[];
    };
    assertEquals(body.success, true);
    assertExists(body.defaults.compilation);
    assertExists(body.defaults.validation);
    assertExists(body.limits.maxSources);
    assertExists(body.limits.maxExclusions);
    assertEquals(Array.isArray(body.supportedSourceTypes), true);
    assertEquals(body.supportedSourceTypes.includes('hosts'), true);
    assertEquals(body.supportedSourceTypes.includes('adblock'), true);
});

// ============================================================================
// POST /api/configuration/validate
// ============================================================================

Deno.test('handleConfigurationValidate — valid config returns { valid: true }', async () => {
    const req = makeRequest('POST', { config: VALID_CONFIG });
    const res = await handleConfigurationValidate(req, makeEnv());
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; valid: boolean };
    assertEquals(body.success, true);
    assertEquals(body.valid, true);
});

Deno.test('handleConfigurationValidate — invalid config returns { valid: false, errors }', async () => {
    const req = makeRequest('POST', { config: { name: '' } }); // name too short, no sources
    const res = await handleConfigurationValidate(req, makeEnv());
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; valid: boolean; errors: unknown[] };
    assertEquals(body.success, true);
    assertEquals(body.valid, false);
    assertEquals(Array.isArray(body.errors), true);
    assertEquals((body.errors as unknown[]).length > 0, true);
});

Deno.test('handleConfigurationValidate — returns 400 on invalid JSON body', async () => {
    const req = makeRawRequest('not-valid-json{');
    const res = await handleConfigurationValidate(req, makeEnv());
    assertEquals(res.status, 400);
});

Deno.test('handleConfigurationValidate — returns 400 when "config" field is missing', async () => {
    const req = makeRequest('POST', { other: 'field' });
    const res = await handleConfigurationValidate(req, makeEnv());
    assertEquals(res.status, 400);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertExists(body.error);
});

Deno.test('handleConfigurationValidate — error objects have path/message/code fields', async () => {
    const req = makeRequest('POST', { config: { name: 'ok' } }); // missing sources
    const res = await handleConfigurationValidate(req, makeEnv());
    const body = await res.json() as { valid: boolean; errors: { path: string; message: string; code: string }[] };
    assertEquals(body.valid, false);
    const firstErr = body.errors[0];
    assertExists(firstErr.message);
    assertExists(firstErr.code);
    // path may be empty string for top-level errors, but should be present
    assertEquals(typeof firstErr.path, 'string');
});

// ============================================================================
// POST /api/configuration/resolve
// ============================================================================

Deno.test('handleConfigurationResolve — valid config returns resolved config', async () => {
    const req = makeRequest('POST', { config: VALID_CONFIG }, 'http://localhost/api/configuration/resolve');
    const res = await handleConfigurationResolve(req, makeEnv());
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; config: { name: string } };
    assertEquals(body.success, true);
    assertEquals(body.config.name, 'Test List');
});

Deno.test('handleConfigurationResolve — override object merges at highest priority', async () => {
    const req = makeRequest('POST', {
        config: VALID_CONFIG,
        override: { name: 'Overridden Name' },
        applyEnvOverrides: false,
    }, 'http://localhost/api/configuration/resolve');
    const res = await handleConfigurationResolve(req, makeEnv());
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; config: { name: string } };
    assertEquals(body.success, true);
    assertEquals(body.config.name, 'Overridden Name');
});

Deno.test('handleConfigurationResolve — returns 400 on invalid JSON body', async () => {
    const req = makeRawRequest('not-json', 'http://localhost/api/configuration/resolve');
    const res = await handleConfigurationResolve(req, makeEnv());
    assertEquals(res.status, 400);
});

Deno.test('handleConfigurationResolve — returns 400 when "config" field is missing', async () => {
    const req = makeRequest('POST', { other: 'field' }, 'http://localhost/api/configuration/resolve');
    const res = await handleConfigurationResolve(req, makeEnv());
    assertEquals(res.status, 400);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertExists(body.error);
});

Deno.test('handleConfigurationResolve — invalid config returns 400 with validation errors', async () => {
    const req = makeRequest('POST', {
        config: { name: '' }, // invalid: empty name + no sources
        applyEnvOverrides: false,
    }, 'http://localhost/api/configuration/resolve');
    const res = await handleConfigurationResolve(req, makeEnv());
    assertEquals(res.status, 400);
    const body = await res.json() as { success: boolean; error: string; errors?: unknown[] };
    assertEquals(body.success, false);
    assertExists(body.error);
    // Validation errors include the structured issues array
    assertEquals(Array.isArray(body.errors), true);
});

Deno.test('handleConfigurationResolve — non-object override returns 400', async () => {
    const req = makeRequest('POST', {
        config: VALID_CONFIG,
        override: 'this-is-a-string-not-object',
        applyEnvOverrides: false,
    }, 'http://localhost/api/configuration/resolve');
    const res = await handleConfigurationResolve(req, makeEnv());
    assertEquals(res.status, 400);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertExists(body.error);
});

Deno.test('handleConfigurationResolve — applyEnvOverrides: false does not apply env', async () => {
    // Even if ADBLOCK_CONFIG_NAME is somehow set, we pass false explicitly
    const req = makeRequest('POST', {
        config: VALID_CONFIG,
        applyEnvOverrides: false,
    }, 'http://localhost/api/configuration/resolve');
    const res = await handleConfigurationResolve(req, makeEnv());
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; config: { name: string } };
    assertEquals(body.success, true);
    assertEquals(body.config.name, 'Test List');
});

Deno.test('handleConfigurationResolve — null override returns 400', async () => {
    const req = makeRequest('POST', {
        config: VALID_CONFIG,
        override: null,
        applyEnvOverrides: false,
    }, 'http://localhost/api/configuration/resolve');
    const res = await handleConfigurationResolve(req, makeEnv());
    assertEquals(res.status, 400);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertExists(body.error);
});

Deno.test('handleConfigurationResolve — array override returns 400', async () => {
    const req = makeRequest('POST', {
        config: VALID_CONFIG,
        override: ['not', 'an', 'object'],
        applyEnvOverrides: false,
    }, 'http://localhost/api/configuration/resolve');
    const res = await handleConfigurationResolve(req, makeEnv());
    assertEquals(res.status, 400);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertExists(body.error);
});

Deno.test('handleConfigurationResolve — applyEnvOverrides not provided defaults to true', async () => {
    // Without applyEnvOverrides in the body it should default to true (env applied).
    // In a test environment without ADBLOCK_CONFIG_* vars, the result should be the same.
    const req = makeRequest('POST', {
        config: VALID_CONFIG,
        // applyEnvOverrides intentionally omitted
    }, 'http://localhost/api/configuration/resolve');
    const res = await handleConfigurationResolve(req, makeEnv());
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; config: { name: string } };
    assertEquals(body.success, true);
    assertEquals(body.config.name, 'Test List');
});

Deno.test('handleConfigurationResolve — applyEnvOverrides: true explicitly uses env source', async () => {
    const req = makeRequest('POST', {
        config: VALID_CONFIG,
        applyEnvOverrides: true,
    }, 'http://localhost/api/configuration/resolve');
    const res = await handleConfigurationResolve(req, makeEnv());
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; config: { name: string } };
    assertEquals(body.success, true);
    // Without ADBLOCK_CONFIG_* env vars, name stays as VALID_CONFIG.name
    assertEquals(body.config.name, 'Test List');
});

Deno.test('handleConfigurationValidate — returns 200 with valid: false for empty sources array', async () => {
    const req = makeRequest('POST', { config: { name: 'Valid Name', sources: [] } });
    const res = await handleConfigurationValidate(req, makeEnv());
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; valid: boolean; errors?: unknown[] };
    assertEquals(body.success, true);
    assertEquals(body.valid, false);
    assertEquals(Array.isArray(body.errors), true);
});

Deno.test('handleConfigurationValidate — returns 200 with valid: true for config with optional fields', async () => {
    const req = makeRequest('POST', {
        config: {
            ...VALID_CONFIG,
            description: 'A test list',
            homepage: 'https://example.com',
            license: 'MIT',
            version: '1.0.0',
        },
    });
    const res = await handleConfigurationValidate(req, makeEnv());
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; valid: boolean };
    assertEquals(body.success, true);
    assertEquals(body.valid, true);
});

Deno.test('handleConfigurationResolve — override with multiple fields all applied', async () => {
    const req = makeRequest('POST', {
        config: VALID_CONFIG,
        override: { name: 'Merged Name', description: 'Merged Desc' },
        applyEnvOverrides: false,
    }, 'http://localhost/api/configuration/resolve');
    const res = await handleConfigurationResolve(req, makeEnv());
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; config: { name: string; description: string } };
    assertEquals(body.success, true);
    assertEquals(body.config.name, 'Merged Name');
    assertEquals(body.config.description, 'Merged Desc');
});

Deno.test('handleConfigurationResolve — validation errors include path/message/code', async () => {
    const req = makeRequest('POST', {
        config: { name: '' },
        applyEnvOverrides: false,
    }, 'http://localhost/api/configuration/resolve');
    const res = await handleConfigurationResolve(req, makeEnv());
    assertEquals(res.status, 400);
    const body = await res.json() as {
        success: boolean;
        error: string;
        errors?: { path: string; message: string; code: string }[];
    };
    assertEquals(body.success, false);
    assertExists(body.error);
    assertEquals(Array.isArray(body.errors), true);
    if (body.errors && body.errors.length > 0) {
        assertExists(body.errors[0].message);
        assertExists(body.errors[0].code);
    }
});

Deno.test('handleConfigurationResolve — null config returns 400 with clean error', async () => {
    const req = makeRequest('POST', {
        config: null,
        applyEnvOverrides: false,
    }, 'http://localhost/api/configuration/resolve');
    const res = await handleConfigurationResolve(req, makeEnv());
    assertEquals(res.status, 400);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertExists(body.error);
});

Deno.test('handleConfigurationResolve — scalar config returns 400 with clean error', async () => {
    const req = makeRequest('POST', {
        config: 42,
        applyEnvOverrides: false,
    }, 'http://localhost/api/configuration/resolve');
    const res = await handleConfigurationResolve(req, makeEnv());
    assertEquals(res.status, 400);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertExists(body.error);
});

Deno.test('handleConfigurationResolve — array config returns 400 with clean error', async () => {
    const req = makeRequest('POST', {
        config: ['not', 'an', 'object'],
        applyEnvOverrides: false,
    }, 'http://localhost/api/configuration/resolve');
    const res = await handleConfigurationResolve(req, makeEnv());
    assertEquals(res.status, 400);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertExists(body.error);
});

// ============================================================================
// POST /api/configuration/create
// ============================================================================

Deno.test('handleConfigurationCreate — valid config returns id and format', async () => {
    const req = makeRequest('POST', { config: VALID_CONFIG, format: 'json' }, 'http://localhost/api/configuration/create');
    const env = makeEnv();
    const res = await handleConfigurationCreate(req, env);
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; id: string; format: string; expiresIn: number };
    assertEquals(body.success, true);
    assertExists(body.id);
    assertEquals(body.format, 'json');
    assertEquals(body.expiresIn, 86400);
});

Deno.test('handleConfigurationCreate — defaults to json format when not specified', async () => {
    const req = makeRequest('POST', { config: VALID_CONFIG }, 'http://localhost/api/configuration/create');
    const env = makeEnv();
    const res = await handleConfigurationCreate(req, env);
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; id: string; format: string };
    assertEquals(body.success, true);
    assertEquals(body.format, 'json');
});

Deno.test('handleConfigurationCreate — accepts yaml format', async () => {
    const req = makeRequest('POST', { config: VALID_CONFIG, format: 'yaml' }, 'http://localhost/api/configuration/create');
    const env = makeEnv();
    const res = await handleConfigurationCreate(req, env);
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; id: string; format: string };
    assertEquals(body.success, true);
    assertEquals(body.format, 'yaml');
});

Deno.test('handleConfigurationCreate — invalid config returns validation errors', async () => {
    const req = makeRequest('POST', { config: { name: '' }, format: 'json' }, 'http://localhost/api/configuration/create');
    const env = makeEnv();
    const res = await handleConfigurationCreate(req, env);
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; valid: boolean; errors: unknown[] };
    assertEquals(body.success, true);
    assertEquals(body.valid, false);
    assertEquals(Array.isArray(body.errors), true);
    assertEquals((body.errors as unknown[]).length > 0, true);
});

Deno.test('handleConfigurationCreate — returns 400 on invalid JSON body', async () => {
    const req = makeRawRequest('not-valid-json{', 'http://localhost/api/configuration/create');
    const env = makeEnv();
    const res = await handleConfigurationCreate(req, env);
    assertEquals(res.status, 400);
});

Deno.test('handleConfigurationCreate — validation errors include path/message/code', async () => {
    const req = makeRequest('POST', { config: { name: 'ok' }, format: 'json' }, 'http://localhost/api/configuration/create');
    const env = makeEnv();
    const res = await handleConfigurationCreate(req, env);
    const body = await res.json() as { valid: boolean; errors: { path: string; message: string; code: string }[] };
    assertEquals(body.valid, false);
    const firstErr = body.errors[0];
    assertExists(firstErr.message);
    assertExists(firstErr.code);
    assertEquals(typeof firstErr.path, 'string');
});

Deno.test('handleConfigurationCreate — stores config with extensions field', async () => {
    const configWithExtensions = {
        ...VALID_CONFIG,
        extensions: { customField: 'customValue', anotherField: 42 },
    };
    const req = makeRequest('POST', { config: configWithExtensions, format: 'json' }, 'http://localhost/api/configuration/create');
    const env = makeEnv();
    const res = await handleConfigurationCreate(req, env);
    assertEquals(res.status, 200);
    const body = await res.json() as { success: boolean; id: string };
    assertEquals(body.success, true);
    assertExists(body.id);
});

// ============================================================================
// GET /api/configuration/download/:id
// ============================================================================

Deno.test('handleConfigurationDownload — returns 404 for non-existent config', async () => {
    const env = makeEnv({ COMPILATION_CACHE: makeInMemoryKv() });
    const res = await handleConfigurationDownload('00000000-0000-0000-0000-000000000000', 'json', env);
    assertEquals(res.status, 404);
    const body = await res.json() as { success: boolean; error: string };
    assertEquals(body.success, false);
    assertExists(body.error);
});

Deno.test('handleConfigurationDownload — retrieves stored config in JSON format', async () => {
    const kv = makeInMemoryKv();
    const env = makeEnv({ COMPILATION_CACHE: kv });
    // First create a config
    const createReq = makeRequest('POST', { config: VALID_CONFIG, format: 'json' }, 'http://localhost/api/configuration/create');
    const createRes = await handleConfigurationCreate(createReq, env);
    const createBody = await createRes.json() as { id: string };
    const configId = createBody.id;

    // Now download it
    const res = await handleConfigurationDownload(configId, 'json', env);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get('Content-Type'), 'application/json');
    assertEquals(res.headers.get('Content-Disposition'), `attachment; filename="config-${configId}.json"`);
    const configText = await res.text();
    const config = JSON.parse(configText);
    assertEquals(config.name, 'Test List');
});

Deno.test('handleConfigurationDownload — retrieves stored config in YAML format', async () => {
    const kv = makeInMemoryKv();
    const env = makeEnv({ COMPILATION_CACHE: kv });
    // First create a config with yaml format
    const createReq = makeRequest('POST', { config: VALID_CONFIG, format: 'yaml' }, 'http://localhost/api/configuration/create');
    const createRes = await handleConfigurationCreate(createReq, env);
    const createBody = await createRes.json() as { id: string };
    const configId = createBody.id;

    // Now download it as yaml
    const res = await handleConfigurationDownload(configId, 'yaml', env);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get('Content-Type'), 'application/x-yaml');
    assertEquals(res.headers.get('Content-Disposition'), `attachment; filename="config-${configId}.yaml"`);
    const configText = await res.text();
    // Basic YAML structure check
    assertEquals(configText.includes('name:'), true);
    assertEquals(configText.includes('Test List'), true);
});

Deno.test('handleConfigurationDownload — format parameter overrides stored format', async () => {
    const kv = makeInMemoryKv();
    const env = makeEnv({ COMPILATION_CACHE: kv });
    // Create with JSON format
    const createReq = makeRequest('POST', { config: VALID_CONFIG, format: 'json' }, 'http://localhost/api/configuration/create');
    const createRes = await handleConfigurationCreate(createReq, env);
    const createBody = await createRes.json() as { id: string };
    const configId = createBody.id;

    // Download as YAML
    const res = await handleConfigurationDownload(configId, 'yaml', env);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get('Content-Type'), 'application/x-yaml');
});

Deno.test('handleConfigurationDownload — preserves extensions field in downloaded config', async () => {
    const kv = makeInMemoryKv();
    const env = makeEnv({ COMPILATION_CACHE: kv });
    const configWithExtensions = {
        ...VALID_CONFIG,
        extensions: { customKey: 'customValue' },
    };
    const createReq = makeRequest('POST', { config: configWithExtensions, format: 'json' }, 'http://localhost/api/configuration/create');
    const createRes = await handleConfigurationCreate(createReq, env);
    const createBody = await createRes.json() as { id: string };
    const configId = createBody.id;

    const res = await handleConfigurationDownload(configId, 'json', env);
    assertEquals(res.status, 200);
    const configText = await res.text();
    const config = JSON.parse(configText);
    assertExists(config.extensions);
    assertEquals(config.extensions.customKey, 'customValue');
});
