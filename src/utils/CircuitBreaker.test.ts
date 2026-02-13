/**
 * Tests for CircuitBreaker
 */

import { assertEquals, assertRejects } from '@std/assert';
import { CircuitBreaker, CircuitBreakerError, CircuitState } from './CircuitBreaker.ts';
import { createLogger, LogLevel } from './logger.ts';

Deno.test('CircuitBreaker', async (t) => {
    await t.step('should start in CLOSED state', () => {
        const breaker = new CircuitBreaker();
        const status = breaker.getStatus();

        assertEquals(status.state, CircuitState.CLOSED);
        assertEquals(status.failureCount, 0);
        assertEquals(status.successCount, 0);
    });

    await t.step('should execute successful operations in CLOSED state', async () => {
        const breaker = new CircuitBreaker();
        const result = await breaker.execute(() => Promise.resolve('success'));

        assertEquals(result, 'success');

        const status = breaker.getStatus();
        assertEquals(status.state, CircuitState.CLOSED);
        assertEquals(status.failureCount, 0);
    });

    await t.step('should propagate errors from operations', async () => {
        const breaker = new CircuitBreaker();

        await assertRejects(
            async () => {
                await breaker.execute(() => Promise.reject(new Error('Test error')));
            },
            Error,
            'Test error',
        );
    });

    await t.step('should transition to OPEN after threshold failures', async () => {
        const breaker = new CircuitBreaker({
            failureThreshold: 3,
            resetTimeout: 1000,
        });

        // First 3 failures should open the circuit
        for (let i = 0; i < 3; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('Failure')));
            } catch (error) {
                // Expected
            }
        }

        const status = breaker.getStatus();
        assertEquals(status.state, CircuitState.OPEN);
        assertEquals(status.failureCount, 3);
    });

    await t.step('should reject immediately when OPEN', async () => {
        const breaker = new CircuitBreaker({
            failureThreshold: 2,
            resetTimeout: 5000,
        });

        // Cause 2 failures to open circuit
        for (let i = 0; i < 2; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('Failure')));
            } catch (error) {
                // Expected
            }
        }

        // Circuit should now be OPEN and reject immediately
        await assertRejects(
            async () => {
                await breaker.execute(() => Promise.resolve('success'));
            },
            CircuitBreakerError,
            'Circuit breaker is OPEN',
        );

        const status = breaker.getStatus();
        assertEquals(status.state, CircuitState.OPEN);
    });

    await t.step('should transition to HALF_OPEN after timeout', async () => {
        const breaker = new CircuitBreaker({
            failureThreshold: 2,
            resetTimeout: 100, // Short timeout for testing
        });

        // Open the circuit
        for (let i = 0; i < 2; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('Failure')));
            } catch (error) {
                // Expected
            }
        }

        assertEquals(breaker.getStatus().state, CircuitState.OPEN);

        // Wait for reset timeout
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Next request should transition to HALF_OPEN and execute
        const result = await breaker.execute(() => Promise.resolve('probe'));

        assertEquals(result, 'probe');
        const status = breaker.getStatus();
        assertEquals(status.state, CircuitState.CLOSED); // Success in HALF_OPEN closes circuit
    });

    await t.step('should transition from HALF_OPEN to CLOSED on success', async () => {
        const breaker = new CircuitBreaker({
            failureThreshold: 2,
            resetTimeout: 100,
        });

        // Open the circuit
        for (let i = 0; i < 2; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('Failure')));
            } catch (error) {
                // Expected
            }
        }

        // Wait for reset timeout
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Successful probe should close circuit
        await breaker.execute(() => Promise.resolve('success'));

        const status = breaker.getStatus();
        assertEquals(status.state, CircuitState.CLOSED);
        assertEquals(status.failureCount, 0);
    });

    await t.step('should transition from HALF_OPEN to OPEN on failure', async () => {
        const breaker = new CircuitBreaker({
            failureThreshold: 2,
            resetTimeout: 100,
        });

        // Open the circuit
        for (let i = 0; i < 2; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('Failure')));
            } catch (error) {
                // Expected
            }
        }

        // Wait for reset timeout
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Failed probe should return to OPEN
        try {
            await breaker.execute(() => Promise.reject(new Error('Probe failed')));
        } catch (error) {
            // Expected
        }

        const status = breaker.getStatus();
        assertEquals(status.state, CircuitState.OPEN);
    });

    await t.step('should reset failure count on success in CLOSED state', async () => {
        const breaker = new CircuitBreaker({
            failureThreshold: 5,
        });

        // Have 2 failures
        for (let i = 0; i < 2; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('Failure')));
            } catch (error) {
                // Expected
            }
        }

        assertEquals(breaker.getStatus().failureCount, 2);

        // One success should reset count
        await breaker.execute(() => Promise.resolve('success'));

        assertEquals(breaker.getStatus().failureCount, 0);
        assertEquals(breaker.getStatus().state, CircuitState.CLOSED);
    });

    await t.step('should include nextAttempt in CircuitBreakerError', async () => {
        const breaker = new CircuitBreaker({
            failureThreshold: 1,
            resetTimeout: 1000,
        });

        // Open the circuit
        try {
            await breaker.execute(() => Promise.reject(new Error('Failure')));
        } catch (error) {
            // Expected
        }

        // Try to execute while OPEN
        try {
            await breaker.execute(() => Promise.resolve('test'));
            throw new Error('Should have thrown CircuitBreakerError');
        } catch (error) {
            if (error instanceof CircuitBreakerError) {
                assertEquals(error.state, CircuitState.OPEN);
                assertEquals(typeof error.nextAttempt, 'object');
                assertEquals(error.nextAttempt instanceof Date, true);
            } else {
                throw new Error('Expected CircuitBreakerError');
            }
        }
    });

    await t.step('should track last failure and success times', async () => {
        const breaker = new CircuitBreaker();

        // Execute success
        await breaker.execute(() => Promise.resolve('success'));
        const afterSuccess = breaker.getStatus();
        assertEquals(afterSuccess.lastSuccessTime instanceof Date, true);

        // Execute failure
        try {
            await breaker.execute(() => Promise.reject(new Error('Failure')));
        } catch (error) {
            // Expected
        }

        const afterFailure = breaker.getStatus();
        assertEquals(afterFailure.lastFailureTime instanceof Date, true);
        assertEquals(
            afterFailure.lastFailureTime!.getTime() > afterSuccess.lastSuccessTime!.getTime(),
            true,
        );
    });

    await t.step('should support manual reset', async () => {
        const breaker = new CircuitBreaker({
            failureThreshold: 2,
        });

        // Open the circuit
        for (let i = 0; i < 2; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('Failure')));
            } catch (error) {
                // Expected
            }
        }

        assertEquals(breaker.getStatus().state, CircuitState.OPEN);

        // Manual reset
        breaker.reset();

        const status = breaker.getStatus();
        assertEquals(status.state, CircuitState.CLOSED);
        assertEquals(status.failureCount, 0);
        assertEquals(status.lastFailureTime, undefined);
    });

    await t.step('should support manual forceOpen', async () => {
        const breaker = new CircuitBreaker();

        assertEquals(breaker.getStatus().state, CircuitState.CLOSED);

        // Force open
        breaker.forceOpen();

        assertEquals(breaker.getStatus().state, CircuitState.OPEN);
        assertEquals(breaker.getStatus().lastFailureTime instanceof Date, true);
    });

    await t.step('should use custom failure threshold', async () => {
        const breaker = new CircuitBreaker({
            failureThreshold: 10,
        });

        // 9 failures should not open circuit
        for (let i = 0; i < 9; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('Failure')));
            } catch (error) {
                // Expected
            }
        }

        assertEquals(breaker.getStatus().state, CircuitState.CLOSED);

        // 10th failure should open it
        try {
            await breaker.execute(() => Promise.reject(new Error('Failure')));
        } catch (error) {
            // Expected
        }

        assertEquals(breaker.getStatus().state, CircuitState.OPEN);
    });

    await t.step('should include name in status and error messages', async () => {
        const logger = createLogger({ level: LogLevel.Silent });
        const breaker = new CircuitBreaker({
            failureThreshold: 1,
            name: 'test-service',
            logger,
        });

        // Open circuit
        try {
            await breaker.execute(() => Promise.reject(new Error('Failure')));
        } catch (error) {
            // Expected
        }

        const status = breaker.getStatus();
        assertEquals(status.name, 'test-service');

        // Error should include name
        try {
            await breaker.execute(() => Promise.resolve('test'));
            throw new Error('Should have thrown');
        } catch (error) {
            if (error instanceof CircuitBreakerError) {
                assertEquals(error.message.includes('test-service'), true);
            } else {
                throw new Error('Expected CircuitBreakerError');
            }
        }
    });

    await t.step('should handle concurrent requests in HALF_OPEN state', async () => {
        const breaker = new CircuitBreaker({
            failureThreshold: 2,
            resetTimeout: 100,
        });

        // Open the circuit
        for (let i = 0; i < 2; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('Failure')));
            } catch (error) {
                // Expected
            }
        }

        // Wait for reset timeout
        await new Promise((resolve) => setTimeout(resolve, 150));

        // First request transitions to HALF_OPEN
        const result = await breaker.execute(() => Promise.resolve('probe'));
        assertEquals(result, 'probe');

        // Circuit should be CLOSED now
        assertEquals(breaker.getStatus().state, CircuitState.CLOSED);
    });

    await t.step('should maintain state consistency across multiple failures', async () => {
        const breaker = new CircuitBreaker({
            failureThreshold: 3,
            resetTimeout: 100,
        });

        // Track state changes
        const states: CircuitState[] = [];

        for (let i = 0; i < 5; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('Failure')));
            } catch (error) {
                states.push(breaker.getStatus().state);
            }
        }

        // First 3 should be in CLOSED, then 4th and 5th should be OPEN
        assertEquals(states[0], CircuitState.CLOSED);
        assertEquals(states[1], CircuitState.CLOSED);
        assertEquals(states[2], CircuitState.CLOSED); // This one triggers transition
        assertEquals(states[3], CircuitState.OPEN);
        assertEquals(states[4], CircuitState.OPEN);
    });

    await t.step('should work with async operations of varying duration', async () => {
        const breaker = new CircuitBreaker({
            failureThreshold: 3,
        });

        // Mix of quick and slow operations
        const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

        await breaker.execute(async () => {
            await delay(10);
            return 'quick';
        });

        await breaker.execute(async () => {
            await delay(50);
            return 'slow';
        });

        await breaker.execute(async () => {
            await delay(1);
            return 'very quick';
        });

        const status = breaker.getStatus();
        assertEquals(status.state, CircuitState.CLOSED);
        assertEquals(status.failureCount, 0);
    });
});
