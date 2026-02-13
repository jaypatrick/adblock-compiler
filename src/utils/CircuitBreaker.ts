/**
 * Circuit breaker implementation for handling failing operations.
 * Prevents cascading failures by "opening" the circuit after a threshold of failures,
 * allowing the system to fail fast and recover gracefully.
 *
 * States:
 * - CLOSED: Normal operation, requests are allowed
 * - OPEN: Too many failures, all requests fail immediately
 * - HALF_OPEN: Testing if service has recovered, allow one request through
 */

import type { ILogger } from '../types/index.ts';
import { silentLogger } from './logger.ts';

/**
 * Circuit breaker states
 */
export enum CircuitState {
    /** Normal operation - requests pass through */
    CLOSED = 'CLOSED',
    /** Circuit is open - requests fail immediately */
    OPEN = 'OPEN',
    /** Testing recovery - allow single probe request */
    HALF_OPEN = 'HALF_OPEN',
}

/**
 * Options for configuring circuit breaker behavior
 */
export interface CircuitBreakerOptions {
    /** Number of consecutive failures before opening circuit (default: 5) */
    failureThreshold?: number;
    /** Time in milliseconds to wait before attempting recovery (default: 60000) */
    resetTimeout?: number;
    /** Optional logger for monitoring state changes */
    logger?: ILogger;
    /** Optional name for identifying the circuit breaker in logs */
    name?: string;
}

/**
 * Circuit breaker status information
 */
export interface CircuitBreakerStatus {
    /** Current state of the circuit */
    state: CircuitState;
    /** Number of consecutive failures */
    failureCount: number;
    /** Number of consecutive successes (in HALF_OPEN state) */
    successCount: number;
    /** Timestamp of last failure */
    lastFailureTime?: Date;
    /** Timestamp of last success */
    lastSuccessTime?: Date;
    /** Timestamp of last state change */
    lastStateChange: Date;
    /** Optional name of the circuit breaker */
    name?: string;
}

/**
 * Error thrown when circuit breaker is open
 */
export class CircuitBreakerError extends Error {
    public readonly state: CircuitState;
    public readonly nextAttempt?: Date;

    constructor(message: string, state: CircuitState, nextAttempt?: Date) {
        super(message);
        this.name = 'CircuitBreakerError';
        this.state = state;
        this.nextAttempt = nextAttempt;
    }
}

/**
 * Circuit breaker for protecting against cascading failures.
 * Implements the circuit breaker pattern with three states: CLOSED, OPEN, and HALF_OPEN.
 *
 * @example
 * ```ts
 * const breaker = new CircuitBreaker({
 *   failureThreshold: 5,
 *   resetTimeout: 60000,
 *   name: 'api-service'
 * });
 *
 * try {
 *   const result = await breaker.execute(() => fetchData());
 *   console.log('Success:', result);
 * } catch (error) {
 *   if (error instanceof CircuitBreakerError) {
 *     console.log('Circuit is open, try again at:', error.nextAttempt);
 *   }
 * }
 * ```
 */
export class CircuitBreaker {
    private state: CircuitState = CircuitState.CLOSED;
    private failureCount = 0;
    private successCount = 0;
    private lastFailureTime?: Date;
    private lastSuccessTime?: Date;
    private lastStateChange: Date = new Date();
    private readonly failureThreshold: number;
    private readonly resetTimeout: number;
    private readonly logger: ILogger;
    private readonly name?: string;

    /**
     * Creates a new CircuitBreaker instance
     * @param options - Configuration options
     */
    constructor(options: CircuitBreakerOptions = {}) {
        this.failureThreshold = options.failureThreshold ?? 5;
        this.resetTimeout = options.resetTimeout ?? 60000;
        this.logger = options.logger ?? silentLogger;
        this.name = options.name;
    }

    /**
     * Executes an async operation through the circuit breaker.
     * @param fn - The async operation to execute
     * @returns Promise resolving to the operation result
     * @throws CircuitBreakerError if circuit is open
     * @throws The original error if operation fails
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        // Check if circuit should transition from OPEN to HALF_OPEN
        if (this.state === CircuitState.OPEN) {
            const now = Date.now();
            const timeSinceLastFailure = this.lastFailureTime ? now - this.lastFailureTime.getTime() : this.resetTimeout + 1;

            if (timeSinceLastFailure >= this.resetTimeout) {
                this.transitionTo(CircuitState.HALF_OPEN);
            } else {
                const nextAttempt = new Date(this.lastFailureTime!.getTime() + this.resetTimeout);
                throw new CircuitBreakerError(
                    `Circuit breaker is OPEN${this.name ? ` for ${this.name}` : ''}. Try again after ${nextAttempt.toISOString()}`,
                    CircuitState.OPEN,
                    nextAttempt,
                );
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
     * Handles successful operation completion
     */
    private onSuccess(): void {
        this.lastSuccessTime = new Date();

        if (this.state === CircuitState.HALF_OPEN) {
            // Success in HALF_OPEN state means we can close the circuit
            this.transitionTo(CircuitState.CLOSED);
            this.failureCount = 0;
            this.successCount = 0;
            this.logger.info(
                `Circuit breaker${this.name ? ` ${this.name}` : ''} recovered - transitioning to CLOSED`,
            );
        } else if (this.state === CircuitState.CLOSED) {
            // Reset failure count on success in CLOSED state
            this.failureCount = 0;
        }
    }

    /**
     * Handles operation failure
     */
    private onFailure(): void {
        this.lastFailureTime = new Date();
        this.failureCount++;

        if (this.state === CircuitState.HALF_OPEN) {
            // Failure in HALF_OPEN means we go back to OPEN
            this.transitionTo(CircuitState.OPEN);
            this.logger.warn(
                `Circuit breaker${this.name ? ` ${this.name}` : ''} probe failed - returning to OPEN state`,
            );
        } else if (this.state === CircuitState.CLOSED && this.failureCount >= this.failureThreshold) {
            // Too many failures in CLOSED state, open the circuit
            this.transitionTo(CircuitState.OPEN);
            this.logger.error(
                `Circuit breaker${this.name ? ` ${this.name}` : ''} threshold reached (${this.failureCount}/${this.failureThreshold}) - transitioning to OPEN`,
            );
        }
    }

    /**
     * Transitions to a new state
     */
    private transitionTo(newState: CircuitState): void {
        const oldState = this.state;
        this.state = newState;
        this.lastStateChange = new Date();

        this.logger.debug(
            `Circuit breaker${this.name ? ` ${this.name}` : ''} state transition: ${oldState} -> ${newState}`,
        );
    }

    /**
     * Gets the current status of the circuit breaker
     * @returns Current circuit breaker status
     */
    getStatus(): CircuitBreakerStatus {
        return {
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            lastFailureTime: this.lastFailureTime,
            lastSuccessTime: this.lastSuccessTime,
            lastStateChange: this.lastStateChange,
            name: this.name,
        };
    }

    /**
     * Manually resets the circuit breaker to CLOSED state.
     * Use with caution - typically the circuit should recover automatically.
     */
    reset(): void {
        this.logger.info(`Circuit breaker${this.name ? ` ${this.name}` : ''} manually reset`);
        this.transitionTo(CircuitState.CLOSED);
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = undefined;
    }

    /**
     * Forces the circuit breaker to OPEN state.
     * Useful for manual intervention or testing.
     */
    forceOpen(): void {
        this.logger.warn(`Circuit breaker${this.name ? ` ${this.name}` : ''} manually opened`);
        this.transitionTo(CircuitState.OPEN);
        this.lastFailureTime = new Date();
    }
}
