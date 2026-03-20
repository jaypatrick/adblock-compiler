/**
 * Unit tests for ConfigurationManager.
 *
 * Run with:
 *   deno task test:src
 * or:
 *   deno test --allow-read --allow-write --allow-net --allow-env src/configuration/ConfigurationManager.test.ts
 */

import { assertEquals, assertInstanceOf, assertRejects } from '@std/assert';
import { ConfigurationManager, ConfigurationValidationError } from './ConfigurationManager.ts';
import { EnvConfigurationSource, ObjectConfigurationSource, OverrideConfigurationSource } from './sources/index.ts';
import type { IConfiguration } from '../types/index.ts';
import { SourceType, TransformationType } from '../types/index.ts';
import { VALIDATION_DEFAULTS } from '../config/defaults.ts';

// ── Helpers ─────────────────────────────────────────────────────────────────

const minimalConfig = (): Partial<IConfiguration> => ({
    name: 'Test List',
    sources: [{ source: 'https://example.com/hosts.txt', type: SourceType.Hosts }],
});

// ── fromObject ───────────────────────────────────────────────────────────────

Deno.test('fromObject: valid object returns IConfiguration', async () => {
    const cfg = await ConfigurationManager.fromObject(minimalConfig(), { applyEnvOverrides: false }).load();
    assertEquals(cfg.name, 'Test List');
    assertEquals(cfg.sources.length, 1);
});

Deno.test('fromObject: missing required field throws ConfigurationValidationError', async () => {
    await assertRejects(
        () => ConfigurationManager.fromObject({ name: 'No Sources' }, { applyEnvOverrides: false }).load(),
        ConfigurationValidationError,
    );
});

// ── getValidationErrors / getEffectiveConfig ─────────────────────────────────

Deno.test('getValidationErrors: null after successful load', async () => {
    const mgr = ConfigurationManager.fromObject(minimalConfig(), { applyEnvOverrides: false });
    await mgr.load();
    assertEquals(mgr.getValidationErrors(), null);
});

Deno.test('getEffectiveConfig: null before any load', () => {
    const mgr = ConfigurationManager.fromObject(minimalConfig(), { applyEnvOverrides: false });
    assertEquals(mgr.getEffectiveConfig(), null);
});

Deno.test('getEffectiveConfig: returns resolved config after load', async () => {
    const mgr = ConfigurationManager.fromObject(minimalConfig(), { applyEnvOverrides: false });
    const loaded = await mgr.load();
    assertEquals(mgr.getEffectiveConfig(), loaded);
});

// ── deepMerge ────────────────────────────────────────────────────────────────

Deno.test('deepMerge: later scalar wins', () => {
    const result = ConfigurationManager.deepMerge([
        { name: 'First' },
        { name: 'Second' },
    ]);
    assertEquals(result.name, 'Second');
});

Deno.test('deepMerge: undefined in later source does not override', () => {
    const result = ConfigurationManager.deepMerge([
        { name: 'First', description: 'My list' },
        { name: 'Second', description: undefined },
    ]);
    assertEquals(result.description, 'My list');
});

Deno.test('deepMerge: later array fully replaces earlier array', () => {
    const src1 = [{ source: 'a', type: SourceType.Hosts }];
    const src2 = [{ source: 'b', type: SourceType.Hosts }];
    const result = ConfigurationManager.deepMerge([
        { sources: src1 },
        { sources: src2 },
    ]);
    assertEquals(result.sources, src2);
});

// ── Layered merge ─────────────────────────────────────────────────────────────

Deno.test('fromSources: second source overrides first scalar', async () => {
    const cfg = await ConfigurationManager.fromSources([
        new ObjectConfigurationSource({ ...minimalConfig(), name: 'Base' }),
        new ObjectConfigurationSource({ name: 'Override' }),
    ], { applyEnvOverrides: false }).load();
    assertEquals(cfg.name, 'Override');
});

// ── OverrideConfigurationSource ───────────────────────────────────────────────

Deno.test('OverrideConfigurationSource: applies JSON overlay as highest priority', async () => {
    const cfg = await ConfigurationManager.fromSources([
        new ObjectConfigurationSource(minimalConfig()),
        new OverrideConfigurationSource('{"name":"CI Build"}'),
    ], { applyEnvOverrides: false }).load();
    assertEquals(cfg.name, 'CI Build');
});

Deno.test('OverrideConfigurationSource: throws on invalid JSON', () => {
    assertInstanceOf(
        (() => {
            try {
                new OverrideConfigurationSource('not-json');
                return null;
            } catch (e) {
                return e;
            }
        })(),
        Error,
    );
});

// ── EnvConfigurationSource ────────────────────────────────────────────────────

Deno.test('EnvConfigurationSource: reads ADBLOCK_CONFIG_NAME from injected reader', async () => {
    const cfg = await ConfigurationManager.fromSources([
        new ObjectConfigurationSource(minimalConfig()),
        new EnvConfigurationSource((k) => k === 'ADBLOCK_CONFIG_NAME' ? 'Env Name' : undefined),
    ], { applyEnvOverrides: false }).load();
    assertEquals(cfg.name, 'Env Name');
});

Deno.test('applyEnvOverrides: false skips env source', async () => {
    // Even if env provides a name, applyEnvOverrides:false should not add EnvConfigurationSource
    const mgr = new ConfigurationManager(
        [new ObjectConfigurationSource({ ...minimalConfig(), name: 'From Object' })],
        { applyEnvOverrides: false },
    );
    const cfg = await mgr.load();
    assertEquals(cfg.name, 'From Object');
});

// ── Limit enforcement ─────────────────────────────────────────────────────────

Deno.test('enforceSourceLimit: truncates sources array to MAX_SOURCES', async () => {
    const tooManySources = Array.from({ length: VALIDATION_DEFAULTS.MAX_SOURCES + 10 }, (_, i) => ({
        source: `https://example.com/${i}.txt`,
        type: SourceType.Hosts,
    }));
    const cfg = await ConfigurationManager.fromObject(
        { name: 'Limits Test', sources: tooManySources },
        { applyEnvOverrides: false, enforceSourceLimit: true },
    ).load();
    assertEquals(cfg.sources.length, VALIDATION_DEFAULTS.MAX_SOURCES);
});

Deno.test('enforceExclusionLimit: truncates exclusions to MAX_EXCLUSIONS', async () => {
    const tooManyExclusions = Array.from({ length: VALIDATION_DEFAULTS.MAX_EXCLUSIONS + 5 }, (_, i) => `exclusion${i}`);
    const cfg = await ConfigurationManager.fromObject(
        { name: 'Exclusion Test', sources: minimalConfig().sources!, exclusions: tooManyExclusions },
        { applyEnvOverrides: false, enforceExclusionLimit: true },
    ).load();
    assertEquals(cfg.exclusions!.length, VALIDATION_DEFAULTS.MAX_EXCLUSIONS);
});

// ── validateOnly ─────────────────────────────────────────────────────────────

Deno.test('validateOnly: returns valid: true for valid config', () => {
    const result = ConfigurationManager.validateOnly(minimalConfig());
    assertEquals(result.valid, true);
    if (result.valid) {
        assertEquals(result.config.name, 'Test List');
    }
});

Deno.test('validateOnly: returns valid: false with errors for invalid config', () => {
    const result = ConfigurationManager.validateOnly({ name: '' });
    assertEquals(result.valid, false);
    if (!result.valid) {
        assertInstanceOf(result.errors.issues, Array);
    }
});

// ── resolveObject ─────────────────────────────────────────────────────────────

Deno.test('resolveObject: resolves plain object with override applied', async () => {
    const cfg = await ConfigurationManager.resolveObject(
        minimalConfig(),
        '{"name":"Resolved"}',
        { applyEnvOverrides: false },
    );
    assertEquals(cfg.name, 'Resolved');
});

// ── transformations ───────────────────────────────────────────────────────────

Deno.test('fromObject: respects transformations field', async () => {
    const cfg = await ConfigurationManager.fromObject({
        ...minimalConfig(),
        transformations: [TransformationType.Deduplicate],
    }, { applyEnvOverrides: false }).load();
    assertEquals(cfg.transformations, [TransformationType.Deduplicate]);
});
