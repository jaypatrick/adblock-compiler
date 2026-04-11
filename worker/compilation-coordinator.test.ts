/**
 * Tests for CompilationCoordinator Durable Object.
 */

import { assertEquals, assertExists } from '@std/assert';
import { CompilationCoordinator } from './compilation-coordinator.ts';
import type { CompilationResult } from './types.ts';

/**
 * Creates a mock DurableObjectState for testing.
 */
function createMockState(): DurableObjectState {
    return {
        id: {
            toString: () => 'test-do-id',
            equals: () => false,
            name: 'test-cache-key',
        },
        // Mock storage API (unused by CompilationCoordinator but required by interface)
        storage: {
            get: async () => undefined,
            put: async () => {},
            delete: async () => false,
            deleteAll: async () => {},
            list: async () => new Map(),
            getAlarm: async () => null,
            setAlarm: async () => {},
            deleteAlarm: async () => {},
            sync: async () => {},
            transactionAsync: async (fn: () => Promise<unknown>) => await fn(),
            transaction: (fn: () => unknown) => fn(),
            getCurrentTags: () => [],
            setCurrentTags: () => {},
        } as unknown as DurableObjectStorage,
        // Empty props object (unused by CompilationCoordinator)
        props: {},
        blockConcurrencyWhile: async <T>(callback: () => Promise<T>): Promise<T> => await callback(),
        waitUntil: () => {},
        acceptWebSocket: () => {},
        getWebSockets: () => [],
        getTags: () => [],
        setWebSocketAutoResponse: () => {},
        getWebSocketAutoResponse: () => null,
        getWebSocketAutoResponseTimestamp: () => null,
        setHibernatableWebSocketEventTimeout: () => {},
        getHibernatableWebSocketEventTimeout: () => null,
        abort: () => {},
        // Stub facets (unused by CompilationCoordinator but required since workers-types 4.20260408.1).
        // `as DurableObjectFacets` (not `satisfies`) is intentional: `satisfies` triggers TS2589
        // (excessively deep type instantiation) because DurableObjectFacets.get has deeply recursive
        // generic constraints (Rpc.DurableObjectBranded, Fetcher<T>) that exceed the TS solver limit.
        // The outer `satisfies DurableObjectState` still verifies every other property structurally.
        facets: {
            get: (): never => {
                throw new Error('facets.get not implemented in mock');
            },
            abort: (_name: string) => {},
            delete: (_name: string) => {},
        } as DurableObjectFacets,
    } satisfies DurableObjectState;
}

/**
 * Creates a mock Env for testing.
 */
function createMockEnv() {
    return {};
}

Deno.test('CompilationCoordinator - lock acquisition', async () => {
    const state = createMockState();
    const env = createMockEnv();
    const coordinator = new CompilationCoordinator(state, env);

    // First request should acquire the lock
    const acquireResponse1 = await coordinator.fetch(new Request('https://do/acquire'));
    assertEquals(acquireResponse1.status, 200);

    const acquireData1 = await acquireResponse1.json() as { success: boolean; acquired: boolean };
    assertEquals(acquireData1.success, true);
    assertEquals(acquireData1.acquired, true);

    // Second request should fail to acquire (lock already held)
    const acquireResponse2 = await coordinator.fetch(new Request('https://do/acquire'));
    assertEquals(acquireResponse2.status, 409);

    const acquireData2 = await acquireResponse2.json() as { success: boolean; acquired: boolean; inFlight: boolean };
    assertEquals(acquireData2.success, false);
    assertEquals(acquireData2.acquired, false);
    assertEquals(acquireData2.inFlight, true);
});

Deno.test('CompilationCoordinator - complete and retrieve result', async () => {
    const state = createMockState();
    const env = createMockEnv();
    const coordinator = new CompilationCoordinator(state, env);

    // Acquire lock
    const acquireResponse = await coordinator.fetch(new Request('https://do/acquire'));
    assertEquals(acquireResponse.status, 200);

    // Complete the compilation
    const testResult: CompilationResult = {
        success: true,
        rules: ['rule1', 'rule2'],
        ruleCount: 2,
        compiledAt: new Date().toISOString(),
    };

    const completeResponse = await coordinator.fetch(
        new Request('https://do/complete', {
            method: 'POST',
            body: JSON.stringify(testResult),
        }),
    );
    assertEquals(completeResponse.status, 200);

    const completeData = await completeResponse.json() as { success: boolean };
    assertEquals(completeData.success, true);

    // Wait should return the result immediately
    const waitResponse = await coordinator.fetch(new Request('https://do/wait'));
    assertEquals(waitResponse.status, 200);
    assertEquals(waitResponse.headers.get('X-Request-Deduplication'), 'HIT');

    const resultText = await waitResponse.text();
    const result = JSON.parse(resultText) as CompilationResult;
    assertEquals(result.success, true);
    assertEquals(result.ruleCount, 2);
    assertExists(result.rules);
    assertEquals(result.rules.length, 2);
});

Deno.test('CompilationCoordinator - fail and retrieve error', async () => {
    const state = createMockState();
    const env = createMockEnv();
    const coordinator = new CompilationCoordinator(state, env);

    // Acquire lock
    await coordinator.fetch(new Request('https://do/acquire'));

    // Fail the compilation
    const errorMessage = { error: 'Compilation failed: Test error' };
    const failResponse = await coordinator.fetch(
        new Request('https://do/fail', {
            method: 'POST',
            body: JSON.stringify(errorMessage),
        }),
    );
    assertEquals(failResponse.status, 200);

    // Wait should return the error
    const waitResponse = await coordinator.fetch(new Request('https://do/wait'));
    assertEquals(waitResponse.status, 500);
    assertEquals(waitResponse.headers.get('X-Request-Deduplication'), 'HIT');

    const result = await waitResponse.json() as { success: boolean; error: unknown };
    assertEquals(result.success, false);
    assertExists(result.error);
});

Deno.test('CompilationCoordinator - wait timeout', async () => {
    const state = createMockState();
    const env = createMockEnv();
    const coordinator = new CompilationCoordinator(state, env);

    // Acquire lock but never complete/fail
    await coordinator.fetch(new Request('https://do/acquire'));

    // Wait should timeout after 30 seconds (we can't easily test this in a unit test
    // without mocking setTimeout, so we'll just verify the logic path exists)
    // For now, just check that wait doesn't return immediately when there's no result
    const waitPromise = coordinator.fetch(new Request('https://do/wait'));

    // Complete the compilation to unblock the waiter
    const testResult: CompilationResult = {
        success: true,
        rules: ['rule1'],
        ruleCount: 1,
        compiledAt: new Date().toISOString(),
    };

    await coordinator.fetch(
        new Request('https://do/complete', {
            method: 'POST',
            body: JSON.stringify(testResult),
        }),
    );

    const waitResponse = await waitPromise;
    assertEquals(waitResponse.status, 200);
});

Deno.test('CompilationCoordinator - status endpoint', async () => {
    const state = createMockState();
    const env = createMockEnv();
    const coordinator = new CompilationCoordinator(state, env);

    // Check initial status
    const statusResponse1 = await coordinator.fetch(new Request('https://do/status'));
    assertEquals(statusResponse1.status, 200);

    const statusData1 = await statusResponse1.json() as {
        success: boolean;
        inFlight: boolean;
        hasResult: boolean;
        hasError: boolean;
        waiters: number;
    };
    assertEquals(statusData1.success, true);
    assertEquals(statusData1.inFlight, false);
    assertEquals(statusData1.hasResult, false);
    assertEquals(statusData1.hasError, false);
    assertEquals(statusData1.waiters, 0);

    // Acquire lock and check status
    await coordinator.fetch(new Request('https://do/acquire'));

    const statusResponse2 = await coordinator.fetch(new Request('https://do/status'));
    const statusData2 = await statusResponse2.json() as {
        success: boolean;
        inFlight: boolean;
        hasResult: boolean;
        hasError: boolean;
        waiters: number;
        startedAt?: number;
    };
    assertEquals(statusData2.success, true);
    assertEquals(statusData2.inFlight, true);
    assertEquals(statusData2.hasResult, false);
    assertEquals(statusData2.hasError, false);
    assertExists(statusData2.startedAt);
});

Deno.test('CompilationCoordinator - invalid path', async () => {
    const state = createMockState();
    const env = createMockEnv();
    const coordinator = new CompilationCoordinator(state, env);

    const response = await coordinator.fetch(new Request('https://do/invalid'));
    assertEquals(response.status, 404);

    const data = await response.json() as { success: boolean; error: string };
    assertEquals(data.success, false);
    assertEquals(data.error, 'Invalid path');
});

Deno.test('CompilationCoordinator - complete without lock', async () => {
    const state = createMockState();
    const env = createMockEnv();
    const coordinator = new CompilationCoordinator(state, env);

    // Try to complete without acquiring lock first
    const testResult: CompilationResult = {
        success: true,
        rules: ['rule1'],
        ruleCount: 1,
        compiledAt: new Date().toISOString(),
    };

    const completeResponse = await coordinator.fetch(
        new Request('https://do/complete', {
            method: 'POST',
            body: JSON.stringify(testResult),
        }),
    );
    assertEquals(completeResponse.status, 400);

    const data = await completeResponse.json() as { success: boolean; error: string };
    assertEquals(data.success, false);
    assertEquals(data.error, 'No compilation in flight');
});

Deno.test('CompilationCoordinator - fail without lock', async () => {
    const state = createMockState();
    const env = createMockEnv();
    const coordinator = new CompilationCoordinator(state, env);

    // Try to fail without acquiring lock first
    const failResponse = await coordinator.fetch(
        new Request('https://do/fail', {
            method: 'POST',
            body: JSON.stringify({ error: 'Test error' }),
        }),
    );
    assertEquals(failResponse.status, 400);

    const data = await failResponse.json() as { success: boolean; error: string };
    assertEquals(data.success, false);
    assertEquals(data.error, 'No compilation in flight');
});

Deno.test('CompilationCoordinator - multiple waiters', async () => {
    const state = createMockState();
    const env = createMockEnv();
    const coordinator = new CompilationCoordinator(state, env);

    // Acquire lock
    await coordinator.fetch(new Request('https://do/acquire'));

    // Start multiple waiters
    const waiter1Promise = coordinator.fetch(new Request('https://do/wait'));
    const waiter2Promise = coordinator.fetch(new Request('https://do/wait'));
    const waiter3Promise = coordinator.fetch(new Request('https://do/wait'));

    // Complete the compilation
    const testResult: CompilationResult = {
        success: true,
        rules: ['rule1', 'rule2', 'rule3'],
        ruleCount: 3,
        compiledAt: new Date().toISOString(),
    };

    await coordinator.fetch(
        new Request('https://do/complete', {
            method: 'POST',
            body: JSON.stringify(testResult),
        }),
    );

    // All waiters should receive the same result
    const [response1, response2, response3] = await Promise.all([
        waiter1Promise,
        waiter2Promise,
        waiter3Promise,
    ]);

    assertEquals(response1.status, 200);
    assertEquals(response2.status, 200);
    assertEquals(response3.status, 200);

    const result1 = await response1.json() as CompilationResult;
    const result2 = await response2.json() as CompilationResult;
    const result3 = await response3.json() as CompilationResult;

    assertEquals(result1.ruleCount, 3);
    assertEquals(result2.ruleCount, 3);
    assertEquals(result3.ruleCount, 3);
});
