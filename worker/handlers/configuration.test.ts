/**
 * Unit tests for the configuration handler endpoints.
 *
 * Covers:
 *   GET  /api/configuration/defaults  — returns defaults/limits/supportedSourceTypes
 *   POST /api/configuration/validate  — invalid JSON, missing field, valid, invalid config
 *   POST /api/configuration/resolve   — invalid JSON, missing field, valid, override merge,
 *                                        non-object override, applyEnvOverrides semantics,
 *                                        invalid config → 400 with validation errors
 *
 * @see worker/handlers/configuration.ts
 */

import { assertEquals, assertExists } from '@std/assert';
import { makeEnv } from '../test-helpers.ts';
import { SourceType } from '../../src/types/index.ts';
import { handleConfigurationDefaults, handleConfigurationResolve, handleConfigurationValidate } from './configuration.ts';

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
