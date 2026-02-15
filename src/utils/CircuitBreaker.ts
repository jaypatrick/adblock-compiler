/**
 * Circuit Breaker Implementation
 *
 * Prevents cascading failures by failing fast when a resource is consistently unreliable.
 * Implements the three-state circuit breaker pattern: CLOSED, OPEN, HALF_OPEN
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit is tripped, requests fail immediately
 * - HALF_OPEN: Testing if the resource has recovered
 *
 * @see https://martinfowler.com/bliki/CircuitBreaker.html
 */

import type { ILogger } from '../types/index.ts';
import { silentLogger } from './logger.ts';

/**
 * Circuit breaker states
 */
export enum CircuitState {
    /** Normal operation - requests pass through */
    CLOSED = 'CLOSED',
    /** Circuit tripped - requests fail immediately */
    OPEN = 'OPEN',
    /** Testing recovery - single request allowed */
    HALF_OPEN = 'HALF_OPEN',
}

/**
 * Options for configuring the circuit breaker
 */
export interface CircuitBreakerOptions {
    /** Number of consecutive failures before opening the circuit */
    failureThreshold?: number;
    /** Time in milliseconds to wait before attempting recovery (OPEN -> HALF_OPEN) */
    timeout?: number;
    /** Number of consecutive successes in HALF_OPEN before closing */
    successThreshold?: number;
    /** Logger for circuit state changes */
    logger?: ILogger;
    /** Optional name for this circuit (for logging/monitoring) */
    name?: string;
}

/**
 * Circuit breaker statistics
 */
export interface CircuitBreakerStats {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime?: Date;
    lastStateChange: Date;
    totalRequests: number;
    totalFailures: number;
    totalSuccesses: number;
}

/**
 * Circuit Breaker for resilient operations
 *
 * Tracks failure rates and automatically trips (opens) when failures exceed threshold.
 * After a timeout period, allows a test request (half-open) to check if the resource has recovered.
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker({ failureThreshold: 5, timeout: 60000 });
 *
 * try {
 *   const result = await breaker.execute(async () => {
 *     return await fetch('https://unreliable-api.com');
 *   });
 * } catch (error) {
 *   // Handle circuit open or actual failure
 * }
 * ```
 */
export class CircuitBreaker {
    private state: CircuitState = CircuitState.CLOSED;
    private failureCount = 0;
    private successCount = 0;
    private lastFailureTime?: Date;
    private lastStateChange: Date = new Date();
    private totalRequests = 0;
    private totalFailures = 0;
    private totalSuccesses = 0;

    private readonly failureThreshold: number;
    private readonly timeout: number;
    private readonly successThreshold: number;
    private readonly logger: ILogger;
    private readonly name: string;

    /**
     * Creates a new circuit breaker
     *
     * @param options - Configuration options
     */
    constructor(options: CircuitBreakerOptions = {}) {
        this.failureThreshold = options.failureThreshold ?? 5;
        this.timeout = options.timeout ?? 60000; // 60 seconds default
        this.successThreshold = options.successThreshold ?? 2;
        this.logger = options.logger ?? silentLogger;
        this.name = options.name ?? 'CircuitBreaker';
    }

    /**
     * Executes a function with circuit breaker protection
     *
     * @param fn - The async function to execute
     * @returns The result of the function
     * @throws Error if circuit is OPEN or if the function fails
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        this.totalRequests++;

        // Check if circuit should transition from OPEN to HALF_OPEN
        if (this.state === CircuitState.OPEN) {
            const timeSinceLastFailure = this.lastFailureTime ? Date.now() - this.lastFailureTime.getTime() : 0;

            if (timeSinceLastFailure > this.timeout) {
                this.transitionTo(CircuitState.HALF_OPEN);
            } else {
                this.logger.debug(`[${this.name}] Circuit is OPEN, failing fast`);
                throw new Error(`Circuit breaker is OPEN for ${this.name}`);
            }
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    /**
     * Handles successful execution
     */
    private onSuccess(): void {
        this.totalSuccesses++;

        if (this.state === CircuitState.HALF_OPEN) {
            this.successCount++;
            this.logger.debug(`[${this.name}] Success in HALF_OPEN (${this.successCount}/${this.successThreshold})`);

            if (this.successCount >= this.successThreshold) {
                this.transitionTo(CircuitState.CLOSED);
                this.failureCount = 0;
                this.successCount = 0;
            }
        } else if (this.state === CircuitState.CLOSED) {
            // Reset failure count on success in CLOSED state
            this.failureCount = 0;
        }
    }

    /**
     * Handles failed execution
     */
    private onFailure(): void {
        this.totalFailures++;
        this.lastFailureTime = new Date();

        if (this.state === CircuitState.HALF_OPEN) {
            // Any failure in HALF_OPEN reopens the circuit
            this.logger.debug(`[${this.name}] Failure in HALF_OPEN, reopening circuit`);
            this.transitionTo(CircuitState.OPEN);
            this.successCount = 0;
        } else if (this.state === CircuitState.CLOSED) {
            this.failureCount++;
            this.logger.debug(`[${this.name}] Failure in CLOSED (${this.failureCount}/${this.failureThreshold})`);

            if (this.failureCount >= this.failureThreshold) {
                this.transitionTo(CircuitState.OPEN);
            }
        }
    }

    /**
     * Transitions the circuit to a new state
     */
    private transitionTo(newState: CircuitState): void {
        const oldState = this.state;
        this.state = newState;
        this.lastStateChange = new Date();

        this.logger.info(`[${this.name}] Circuit state changed: ${oldState} -> ${newState}`);
    }

    /**
     * Gets the current state of the circuit
     */
    getState(): CircuitState {
        return this.state;
    }

    /**
     * Gets statistics about the circuit breaker
     */
    getStats(): CircuitBreakerStats {
        return {
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            lastFailureTime: this.lastFailureTime,
            lastStateChange: this.lastStateChange,
            totalRequests: this.totalRequests,
            totalFailures: this.totalFailures,
            totalSuccesses: this.totalSuccesses,
        };
    }

    /**
     * Resets the circuit breaker to initial state
     */
    reset(): void {
        this.logger.info(`[${this.name}] Circuit breaker reset`);
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = undefined;
        this.lastStateChange = new Date();
        // Note: Total counters are not reset to preserve historical data
    }

    /**
     * Checks if the circuit is currently open (blocking requests)
     */
    isOpen(): boolean {
        return this.state === CircuitState.OPEN;
    }

    /**
     * Checks if the circuit is currently closed (normal operation)
     */
    isClosed(): boolean {
        return this.state === CircuitState.CLOSED;
    }

    /**
     * Checks if the circuit is currently half-open (testing recovery)
     */
    isHalfOpen(): boolean {
        return this.state === CircuitState.HALF_OPEN;
    }
}
