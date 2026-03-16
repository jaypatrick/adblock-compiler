/**
 * Factory functions for creating test IConfiguration and CompileRequest objects.
 *
 * Provides sensible defaults with easy overrides for common test scenarios.
 *
 * Usage:
 *   import { createTestConfig, createTestSource, createCompileRequest } from '../../tests/fixtures/factories/compiler-config.ts';
 */

import { type IConfiguration, type ISource, SourceType } from '../../../src/types/index.ts';

// ============================================================================
// Source factory
// ============================================================================

/**
 * Creates a test ISource with sensible defaults.
 *
 * @example
 *   const source = createTestSource();
 *   const hostsSource = createTestSource({ source: 'https://hosts.example.com/list.txt', type: 'hosts' });
 */
export function createTestSource(overrides?: Partial<ISource>): ISource {
    return {
        source: 'https://example.com/filters.txt',
        name: 'Test Source',
        type: SourceType.Adblock,
        ...overrides,
    };
}

// ============================================================================
// Configuration factory
// ============================================================================

/**
 * Creates a test IConfiguration with sensible defaults.
 *
 * @example
 *   const config = createTestConfig();
 *   const multiSource = createTestConfig({
 *     sources: [
 *       createTestSource({ source: 'https://a.com/1.txt' }),
 *       createTestSource({ source: 'https://b.com/2.txt', type: 'hosts' }),
 *     ],
 *   });
 */
export function createTestConfig(overrides?: Partial<IConfiguration>): IConfiguration {
    return {
        name: 'Test Filter List',
        description: 'A test filter list for unit testing',
        homepage: 'https://example.com',
        version: '1.0.0',
        sources: [createTestSource()],
        ...overrides,
    };
}

// ============================================================================
// CompileRequest factory
// ============================================================================

/**
 * Shape of the compile request body sent to /compile endpoint.
 */
export interface CompileRequestBody {
    configuration: IConfiguration;
    preFetchedContent?: Record<string, string>;
    benchmark?: boolean;
    priority?: 'standard' | 'high';
    turnstileToken?: string;
}

/**
 * Creates a test compile request body with sensible defaults.
 *
 * @example
 *   const body = createCompileRequest();
 *   const withContent = createCompileRequest({
 *     preFetchedContent: { 'https://example.com/filters.txt': '||ads.example.com^\n||tracking.org^' },
 *   });
 */
export function createCompileRequest(
    overrides?: Partial<CompileRequestBody>,
): CompileRequestBody {
    return {
        configuration: createTestConfig(),
        benchmark: false,
        priority: 'standard',
        ...overrides,
    };
}

// ============================================================================
// Sample rule content constants
// ============================================================================

/** Standard adblock filter rules for test fixtures */
export const SAMPLE_ADBLOCK_RULES = [
    '||ads.example.com^',
    '||tracking.example.org^',
    '||telemetry.test.net^$third-party',
    '@@||safe-ads.example.com^',
    'example.com##.ad-banner',
] as const;

/** Standard hosts file entries for test fixtures */
export const SAMPLE_HOSTS_RULES = [
    '0.0.0.0 ads.example.com',
    '0.0.0.0 tracking.example.org',
    '0.0.0.0 telemetry.test.net',
    '127.0.0.1 malware.bad-domain.com',
] as const;

/** Combined adblock rules as a single string (for fetch mocking) */
export const SAMPLE_ADBLOCK_CONTENT = SAMPLE_ADBLOCK_RULES.join('\n');

/** Combined hosts rules as a single string (for fetch mocking) */
export const SAMPLE_HOSTS_CONTENT = SAMPLE_HOSTS_RULES.join('\n');
