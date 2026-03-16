/**
 * Shared test fixtures barrel export.
 *
 * Import everything you need from here:
 *   import { createMockEnv, createTestConfig, mockPage } from '../../tests/fixtures/mod.ts';
 */

export { createMockCtx, createMockEnv, createMockEnvWithAnalytics, createMockRequest, MockAnalyticsEngine, MockKVNamespace } from './mocks/MockEnv.ts';
export type { CapturedDataPoint } from './mocks/MockEnv.ts';

export { MOCK_BROWSER_BINDING, mockBrowser, mockPage } from './mocks/MockBrowser.ts';
export type { IBrowserWorker, IPlaywrightBrowser, IPlaywrightPage } from './mocks/MockBrowser.ts';

export {
    createCompileRequest,
    createTestConfig,
    createTestSource,
    SAMPLE_ADBLOCK_CONTENT,
    SAMPLE_ADBLOCK_RULES,
    SAMPLE_HOSTS_CONTENT,
    SAMPLE_HOSTS_RULES,
} from './factories/compiler-config.ts';
export type { CompileRequestBody } from './factories/compiler-config.ts';
