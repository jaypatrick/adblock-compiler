import { assertEquals, assertRejects } from '@std/assert';
import { CircuitBreaker, CircuitState } from './CircuitBreaker.ts';

// Helper to create a function that fails N times then succeeds
function createFlakeyFunction(failuresBeforeSuccess: number) {
    let attempts = 0;
    return async () => {
        attempts++;
        if (attempts <= failuresBeforeSuccess) {
            throw new Error(`Failure ${attempts}`);
        }
        return 'success';
    };
}

// Helper to create a function that always fails
function createAlwaysFailingFunction() {
    return async () => {
        throw new Error('Always fails');
    };
}

// Helper to create a function that always succeeds
function createAlwaysSucceedingFunction() {
    return async () => 'success';
}

Deno.test('CircuitBreaker - should start in CLOSED state', () => {
    const breaker = new CircuitBreaker();
    assertEquals(breaker.getState(), CircuitState.CLOSED);
    assertEquals(breaker.isClosed(), true);
    assertEquals(breaker.isOpen(), false);
    assertEquals(breaker.isHalfOpen(), false);
});

Deno.test('CircuitBreaker - should allow requests in CLOSED state', async () => {
    const breaker = new CircuitBreaker();
    const result = await breaker.execute(createAlwaysSucceedingFunction());
    assertEquals(result, 'success');
    assertEquals(breaker.getState(), CircuitState.CLOSED);
});

Deno.test('CircuitBreaker - should count failures in CLOSED state', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    // First two failures should keep circuit CLOSED
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));
    assertEquals(breaker.getState(), CircuitState.CLOSED);

    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));
    assertEquals(breaker.getState(), CircuitState.CLOSED);

    const stats = breaker.getStats();
    assertEquals(stats.failureCount, 2);
});

Deno.test('CircuitBreaker - should open circuit after threshold failures', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    // Fail 3 times to reach threshold
    for (let i = 0; i < 3; i++) {
        await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));
    }

    assertEquals(breaker.getState(), CircuitState.OPEN);
    assertEquals(breaker.isOpen(), true);
});

Deno.test('CircuitBreaker - should fail fast when circuit is OPEN', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, timeout: 1000 });

    // Trip the circuit
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));

    assertEquals(breaker.getState(), CircuitState.OPEN);

    // Next request should fail immediately without calling the function
    await assertRejects(
        () => breaker.execute(createAlwaysSucceedingFunction()),
        Error,
        'Circuit breaker is OPEN',
    );

    assertEquals(breaker.getState(), CircuitState.OPEN);
});

Deno.test('CircuitBreaker - should transition to HALF_OPEN after timeout', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, timeout: 100 });

    // Trip the circuit
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));

    assertEquals(breaker.getState(), CircuitState.OPEN);

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Next request should transition to HALF_OPEN
    const result = await breaker.execute(createAlwaysSucceedingFunction());
    assertEquals(result, 'success');
    assertEquals(breaker.getState(), CircuitState.HALF_OPEN);
});

Deno.test('CircuitBreaker - should close circuit after success threshold in HALF_OPEN', async () => {
    const breaker = new CircuitBreaker({
        failureThreshold: 2,
        timeout: 100,
        successThreshold: 2,
    });

    // Trip the circuit
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));

    assertEquals(breaker.getState(), CircuitState.OPEN);

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    // First success should transition to HALF_OPEN
    await breaker.execute(createAlwaysSucceedingFunction());
    assertEquals(breaker.getState(), CircuitState.HALF_OPEN);

    // Second success should close the circuit
    await breaker.execute(createAlwaysSucceedingFunction());
    assertEquals(breaker.getState(), CircuitState.CLOSED);
});

Deno.test('CircuitBreaker - should reopen circuit on failure in HALF_OPEN', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, timeout: 100 });

    // Trip the circuit
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));

    assertEquals(breaker.getState(), CircuitState.OPEN);

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Transition to HALF_OPEN
    await breaker.execute(createAlwaysSucceedingFunction());
    assertEquals(breaker.getState(), CircuitState.HALF_OPEN);

    // Failure in HALF_OPEN should reopen circuit
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));
    assertEquals(breaker.getState(), CircuitState.OPEN);
});

Deno.test('CircuitBreaker - should reset failure count on success in CLOSED state', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    // Two failures
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));

    let stats = breaker.getStats();
    assertEquals(stats.failureCount, 2);

    // Success should reset failure count
    await breaker.execute(createAlwaysSucceedingFunction());

    stats = breaker.getStats();
    assertEquals(stats.failureCount, 0);
    assertEquals(breaker.getState(), CircuitState.CLOSED);
});

Deno.test('CircuitBreaker - should track statistics correctly', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    // Execute mix of successes and failures
    await breaker.execute(createAlwaysSucceedingFunction());
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));
    await breaker.execute(createAlwaysSucceedingFunction());

    const stats = breaker.getStats();
    assertEquals(stats.totalRequests, 3);
    assertEquals(stats.totalSuccesses, 2);
    assertEquals(stats.totalFailures, 1);
    assertEquals(stats.state, CircuitState.CLOSED);
});

Deno.test('CircuitBreaker - should reset to initial state', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });

    // Trip the circuit
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));

    assertEquals(breaker.getState(), CircuitState.OPEN);

    // Reset
    breaker.reset();

    assertEquals(breaker.getState(), CircuitState.CLOSED);
    assertEquals(breaker.getStats().failureCount, 0);
    assertEquals(breaker.getStats().successCount, 0);
});

Deno.test('CircuitBreaker - should preserve total stats after reset', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });

    // Execute some operations
    await breaker.execute(createAlwaysSucceedingFunction());
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));

    const statsBefore = breaker.getStats();
    assertEquals(statsBefore.totalRequests, 2);

    // Reset
    breaker.reset();

    // Total stats should be preserved
    const statsAfter = breaker.getStats();
    assertEquals(statsAfter.totalRequests, 2);
    assertEquals(statsAfter.totalSuccesses, 1);
    assertEquals(statsAfter.totalFailures, 1);
});

Deno.test('CircuitBreaker - should use custom failure threshold', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });

    // Four failures should not trip circuit
    for (let i = 0; i < 4; i++) {
        await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));
    }
    assertEquals(breaker.getState(), CircuitState.CLOSED);

    // Fifth failure should trip circuit
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));
    assertEquals(breaker.getState(), CircuitState.OPEN);
});

Deno.test('CircuitBreaker - should use custom success threshold', async () => {
    const breaker = new CircuitBreaker({
        failureThreshold: 2,
        timeout: 100,
        successThreshold: 3,
    });

    // Trip circuit
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    // First success -> HALF_OPEN
    await breaker.execute(createAlwaysSucceedingFunction());
    assertEquals(breaker.getState(), CircuitState.HALF_OPEN);

    // Second success -> still HALF_OPEN
    await breaker.execute(createAlwaysSucceedingFunction());
    assertEquals(breaker.getState(), CircuitState.HALF_OPEN);

    // Third success -> CLOSED
    await breaker.execute(createAlwaysSucceedingFunction());
    assertEquals(breaker.getState(), CircuitState.CLOSED);
});

Deno.test('CircuitBreaker - should handle custom name', async () => {
    const breaker = new CircuitBreaker({ name: 'TestCircuit' });
    assertEquals(breaker.getState(), CircuitState.CLOSED);
});

Deno.test('CircuitBreaker - should record last failure time', async () => {
    const breaker = new CircuitBreaker();

    const beforeFailure = breaker.getStats().lastFailureTime;
    assertEquals(beforeFailure, undefined);

    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));

    const afterFailure = breaker.getStats().lastFailureTime;
    assertEquals(afterFailure instanceof Date, true);
});

Deno.test('CircuitBreaker - should update last state change time', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2 });

    const initialTime = breaker.getStats().lastStateChange;
    assertEquals(initialTime instanceof Date, true);

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Trip circuit to cause state change
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));

    const afterTrip = breaker.getStats().lastStateChange;
    assertEquals(afterTrip > initialTime, true);
});

Deno.test('CircuitBreaker - should handle rapid successive failures', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    // Rapid failures
    const promises = Array.from({ length: 5 }, () =>
        breaker.execute(createAlwaysFailingFunction()).catch(() => 'failed')
    );

    await Promise.all(promises);

    // Circuit should be open
    assertEquals(breaker.getState(), CircuitState.OPEN);
});

Deno.test('CircuitBreaker - should handle mixed success and failure', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });

    // Pattern: fail, succeed, fail, succeed, fail
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));
    await breaker.execute(createAlwaysSucceedingFunction());
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));
    await breaker.execute(createAlwaysSucceedingFunction());
    await assertRejects(() => breaker.execute(createAlwaysFailingFunction()));

    // Circuit should still be CLOSED (successes reset failure count)
    assertEquals(breaker.getState(), CircuitState.CLOSED);
});

Deno.test('CircuitBreaker - should eventually succeed with recovering resource', async () => {
    const breaker = new CircuitBreaker({
        failureThreshold: 2,
        timeout: 100,
        successThreshold: 1,
    });

    // Create a resource that fails 2 times then recovers
    const fn = createFlakeyFunction(2);

    // First two calls fail and trip circuit
    await assertRejects(() => breaker.execute(fn));
    await assertRejects(() => breaker.execute(fn));

    assertEquals(breaker.getState(), CircuitState.OPEN);

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Next call should succeed and close circuit
    const result = await breaker.execute(fn);
    assertEquals(result, 'success');
    assertEquals(breaker.getState(), CircuitState.CLOSED);
});
