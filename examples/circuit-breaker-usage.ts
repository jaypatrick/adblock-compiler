/**
 * Example: Using Circuit Breaker for Resilient Downloads
 *
 * This example demonstrates how to use the circuit breaker pattern
 * to protect against cascading failures when downloading filter lists.
 */

import { CircuitBreaker, CircuitBreakerError, FilterDownloader } from '../src/index.ts';
import { createLogger, LogLevel } from '../src/utils/logger.ts';

/**
 * Example 1: Circuit breaker with FilterDownloader
 */
async function filterDownloaderExample() {
    console.log('=== Example 1: Circuit Breaker with FilterDownloader ===\n');

    const logger = createLogger({ level: LogLevel.Info });

    // Create downloader with circuit breaker enabled
    const downloader = new FilterDownloader(
        {
            enableCircuitBreaker: true,
            circuitBreakerThreshold: 3, // Open after 3 failures
            circuitBreakerTimeout: 30000, // Retry after 30 seconds
            maxRetries: 2, // Retry each request up to 2 times
        },
        logger,
    );

    // Try downloading from a potentially unreliable source
    const sources = [
        'https://example.com/filter1.txt', // This might fail
        'https://example.com/filter2.txt', // This might fail
        'https://example.com/filter3.txt', // This might fail
    ];

    for (const source of sources) {
        try {
            const rules = await downloader.download(source);
            console.log(`✓ Downloaded ${rules.length} rules from ${source}`);
        } catch (error) {
            if (error instanceof CircuitBreakerError) {
                console.error(`✗ Circuit is open for ${source}`);
                console.log(`  Next attempt available at: ${error.nextAttempt}`);
            } else {
                console.error(`✗ Download failed: ${error instanceof Error ? error.message : error}`);
            }
        }
    }

    // Check circuit breaker statuses
    console.log('\n--- Circuit Breaker Status ---');
    const statuses = downloader.getCircuitBreakerStatuses();
    for (const [url, status] of statuses) {
        console.log(`${url}: ${status.state} (failures: ${status.failureCount})`);
    }
}

/**
 * Example 2: Using CircuitBreaker independently
 */
async function standaloneCircuitBreakerExample() {
    console.log('\n=== Example 2: Standalone Circuit Breaker ===\n');

    const logger = createLogger({ level: LogLevel.Debug });

    // Create a circuit breaker for an external API
    const apiBreaker = new CircuitBreaker({
        failureThreshold: 5,
        resetTimeout: 60000,
        logger,
        name: 'external-api',
    });

    // Simulate API calls that might fail
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < 10; i++) {
        try {
            const result = await apiBreaker.execute(async () => {
                // Simulate a flaky API (50% failure rate)
                if (Math.random() < 0.5) {
                    throw new Error('API request failed');
                }
                return { data: 'success', timestamp: Date.now() };
            });

            console.log(`✓ Request ${i + 1} succeeded:`, result.data);
            successCount++;
        } catch (error) {
            if (error instanceof CircuitBreakerError) {
                console.log(`⊘ Request ${i + 1} rejected by circuit breaker`);
                console.log(`  State: ${error.state}, Next attempt: ${error.nextAttempt}`);
            } else {
                console.log(`✗ Request ${i + 1} failed:`, error instanceof Error ? error.message : error);
            }
            failureCount++;
        }

        // Small delay between requests
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log(`\nResults: ${successCount} succeeded, ${failureCount} failed`);

    // Get final status
    const status = apiBreaker.getStatus();
    console.log('\nFinal Circuit Breaker Status:');
    console.log(`  State: ${status.state}`);
    console.log(`  Failures: ${status.failureCount}`);
    console.log(`  Last Failure: ${status.lastFailureTime?.toISOString() || 'N/A'}`);
    console.log(`  Last Success: ${status.lastSuccessTime?.toISOString() || 'N/A'}`);
}

/**
 * Example 3: Circuit breaker with manual recovery
 */
async function manualRecoveryExample() {
    console.log('\n=== Example 3: Manual Recovery ===\n');

    const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 60000,
        name: 'service-with-manual-recovery',
    });

    // Cause failures to open the circuit
    console.log('Causing failures to open circuit...');
    for (let i = 0; i < 2; i++) {
        try {
            await breaker.execute(async () => {
                throw new Error('Service unavailable');
            });
        } catch (error) {
            console.log(`  Failure ${i + 1} recorded`);
        }
    }

    console.log(`Circuit state: ${breaker.getStatus().state}\n`);

    // Try to execute - should fail immediately
    try {
        await breaker.execute(async () => 'success');
    } catch (error) {
        if (error instanceof CircuitBreakerError) {
            console.log('✗ Circuit is open, request rejected immediately');
        }
    }

    // Manually reset the circuit
    console.log('\nManually resetting circuit...');
    breaker.reset();
    console.log(`Circuit state: ${breaker.getStatus().state}\n`);

    // Now the request should work
    try {
        const result = await breaker.execute(async () => 'success');
        console.log(`✓ Request succeeded after manual reset: ${result}`);
    } catch (error) {
        console.log('✗ Request failed');
    }
}

/**
 * Example 4: Monitoring multiple circuit breakers
 */
async function monitoringExample() {
    console.log('\n=== Example 4: Monitoring Multiple Circuit Breakers ===\n');

    const services = new Map<string, CircuitBreaker>();

    // Create circuit breakers for different services
    ['api-service', 'database', 'cache', 'external-api'].forEach((serviceName) => {
        services.set(
            serviceName,
            new CircuitBreaker({
                failureThreshold: 3,
                resetTimeout: 30000,
                name: serviceName,
            }),
        );
    });

    // Simulate some operations with different success rates
    const serviceFailureRates = {
        'api-service': 0.1, // 10% failure
        'database': 0.05, // 5% failure
        'cache': 0.8, // 80% failure (will open circuit)
        'external-api': 0.3, // 30% failure
    };

    // Run 10 requests for each service
    for (let i = 0; i < 10; i++) {
        for (const [serviceName, breaker] of services) {
            try {
                await breaker.execute(async () => {
                    if (Math.random() < serviceFailureRates[serviceName]) {
                        throw new Error('Service error');
                    }
                    return 'ok';
                });
            } catch (_error) {
                // Silent catch for demo
            }
        }
    }

    // Print monitoring dashboard
    console.log('=== Circuit Breaker Dashboard ===\n');
    console.log('Service          | State       | Failures | Last Failure');
    console.log('-'.repeat(65));

    for (const [serviceName, breaker] of services) {
        const status = breaker.getStatus();
        const lastFailure = status.lastFailureTime ? status.lastFailureTime.toLocaleTimeString() : 'N/A';

        console.log(
            `${serviceName.padEnd(16)} | ${status.state.padEnd(11)} | ${
                String(status.failureCount).padEnd(8)
            } | ${lastFailure}`,
        );
    }
}

// Run all examples
if (import.meta.main) {
    try {
        await filterDownloaderExample();
        await standaloneCircuitBreakerExample();
        await manualRecoveryExample();
        await monitoringExample();
    } catch (error) {
        console.error('Example failed:', error);
        Deno.exit(1);
    }
}
