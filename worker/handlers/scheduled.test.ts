/**
 * Tests for the Scheduled (CRON) handler.
 *
 * Covers:
 *   - handleScheduled: starts cache warming workflow on '0 *\/6 * * *' pattern
 *   - handleScheduled: logs warning when CACHE_WARMING_WORKFLOW is missing
 *   - handleScheduled: starts health monitoring workflow on '0 * * * *' pattern
 *   - handleScheduled: logs warning when HEALTH_MONITORING_WORKFLOW is missing
 *   - handleScheduled: handles workflow.create() errors gracefully (no throw)
 *   - handleScheduled: does nothing for unknown cron patterns
 *
 * @see worker/handlers/scheduled.ts
 */

import { assertEquals } from '@std/assert';
import { handleScheduled } from './scheduled.ts';
import type { Env, Workflow } from '../types.ts';

// ============================================================================
// Fixtures
// ============================================================================

interface CacheWarmingParams {
    runId: string;
    configurations: unknown[];
    scheduled: boolean;
}

interface HealthMonitoringParams {
    runId: string;
    sources: unknown[];
    alertOnFailure: boolean;
}

function makeWorkflow<T>(): { workflow: Workflow<T>; calls: Array<{ id: string; params: T }> } {
    const calls: Array<{ id: string; params: T }> = [];
    const workflow: Workflow<T> = {
        create: async (options) => {
            calls.push({ id: options?.id ?? '', params: options?.params as T });
            return { id: options?.id ?? 'mock-instance' } as ReturnType<typeof workflow.create> extends Promise<infer U> ? U : never;
        },
        get: async (_id: string) => ({ id: _id } as ReturnType<typeof workflow.get> extends Promise<infer U> ? U : never),
    };
    return { workflow, calls };
}

function makeFailingWorkflow<T>(): Workflow<T> {
    return {
        create: async () => {
            throw new Error('workflow creation failed');
        },
        get: async () => {
            throw new Error('workflow get failed');
        },
    };
}

function makeController(cron: string): ScheduledController {
    return { cron, scheduledTime: Date.now(), noRetry: () => {} } as unknown as ScheduledController;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
        COMPILER_VERSION: '1.0.0-test',
        COMPILATION_CACHE: undefined as unknown as KVNamespace,
        RATE_LIMIT: undefined as unknown as KVNamespace,
        METRICS: undefined as unknown as KVNamespace,
        ASSETS: undefined as unknown as Fetcher,
        ...overrides,
    } as unknown as Env;
}

// ============================================================================
// handleScheduled
// ============================================================================

Deno.test('handleScheduled - starts cache warming workflow on 6h cron', async () => {
    const { workflow, calls } = makeWorkflow<CacheWarmingParams>();
    const env = makeEnv({ CACHE_WARMING_WORKFLOW: workflow as unknown as Env['CACHE_WARMING_WORKFLOW'] });
    const controller = makeController('0 */6 * * *');

    await handleScheduled(controller, env);

    assertEquals(calls.length, 1);
    assertEquals(calls[0].params.scheduled, true);
    assertEquals(typeof calls[0].id, 'string');
    assertEquals(calls[0].id.startsWith('cache-warm-'), true);
});

Deno.test('handleScheduled - does not throw when CACHE_WARMING_WORKFLOW is missing', async () => {
    const env = makeEnv(); // no CACHE_WARMING_WORKFLOW
    const controller = makeController('0 */6 * * *');
    // Should not throw
    await handleScheduled(controller, env);
});

Deno.test('handleScheduled - starts health monitoring workflow on 1h cron', async () => {
    const { workflow, calls } = makeWorkflow<HealthMonitoringParams>();
    const env = makeEnv({
        HEALTH_MONITORING_WORKFLOW: workflow as unknown as Env['HEALTH_MONITORING_WORKFLOW'],
    });
    const controller = makeController('0 * * * *');

    await handleScheduled(controller, env);

    assertEquals(calls.length, 1);
    assertEquals(calls[0].params.alertOnFailure, true);
    assertEquals(calls[0].id.startsWith('health-check-'), true);
});

Deno.test('handleScheduled - does not throw when HEALTH_MONITORING_WORKFLOW is missing', async () => {
    const env = makeEnv(); // no HEALTH_MONITORING_WORKFLOW
    const controller = makeController('0 * * * *');
    await handleScheduled(controller, env);
});

Deno.test('handleScheduled - handles workflow creation error gracefully (no throw)', async () => {
    const env = makeEnv({
        CACHE_WARMING_WORKFLOW: makeFailingWorkflow() as unknown as Env['CACHE_WARMING_WORKFLOW'],
    });
    const controller = makeController('0 */6 * * *');
    // Should not throw even when workflow.create() rejects
    await handleScheduled(controller, env);
});

Deno.test('handleScheduled - does nothing for unknown cron pattern', async () => {
    const { workflow, calls } = makeWorkflow<CacheWarmingParams>();
    const env = makeEnv({
        CACHE_WARMING_WORKFLOW: workflow as unknown as Env['CACHE_WARMING_WORKFLOW'],
        HEALTH_MONITORING_WORKFLOW: workflow as unknown as Env['HEALTH_MONITORING_WORKFLOW'],
    });
    const controller = makeController('0 0 * * *'); // unknown pattern
    await handleScheduled(controller, env);
    assertEquals(calls.length, 0); // neither workflow triggered
});
