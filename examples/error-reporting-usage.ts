/**
 * Error Reporting Usage Example
 *
 * Demonstrates how to use the centralized error reporting system
 * with different backends and configuration options.
 */

import {
    CloudflareErrorReporter,
    CompositeErrorReporter,
    ConsoleErrorReporter,
    createErrorReporter,
    ErrorSeverity,
    type IErrorReporter,
    SentryErrorReporter,
} from '../src/utils/ErrorReporter.ts';

// ============================================================================
// Example 1: Console Reporter (Development)
// ============================================================================

console.log('\n=== Example 1: Console Reporter ===\n');

const consoleReporter = new ConsoleErrorReporter(true); // verbose mode

try {
    throw new Error('Something went wrong in development');
} catch (error) {
    consoleReporter.report(error as Error, {
        requestId: 'dev-req-123',
        configName: 'test-config',
        tags: { environment: 'development' },
    }, ErrorSeverity.Error);
}

// ============================================================================
// Example 2: Cloudflare Reporter (Production)
// ============================================================================

console.log('\n=== Example 2: Cloudflare Reporter (Mock) ===\n');

// Mock Analytics Engine for demonstration
class MockAnalyticsEngine {
    writeDataPoint(data: { indexes: string[]; blobs: string[]; doubles: number[] }): void {
        console.log('Analytics Engine Data Point:');
        console.log('  Indexes:', data.indexes);
        console.log('  Blobs:', data.blobs);
        console.log('  Doubles:', data.doubles);
    }
}

const mockAnalytics = new MockAnalyticsEngine() as unknown as AnalyticsEngineDataset;

const cloudflareReporter = new CloudflareErrorReporter(mockAnalytics, {
    serviceName: 'adblock-compiler',
    environment: 'production',
    logToConsole: true,
});

try {
    throw new Error('Compilation failed in production');
} catch (error) {
    await cloudflareReporter.reportAsync(error as Error, {
        requestId: 'prod-req-456',
        configName: 'production-config',
        sourceCount: 10,
        url: 'https://api.example.com/compile',
        method: 'POST',
        tags: {
            operation: 'compilation',
            environment: 'production',
        },
        extra: {
            ruleCount: 1000,
            duration: 234,
        },
    }, ErrorSeverity.Error);
}

// ============================================================================
// Example 3: Composite Reporter (Multiple Backends)
// ============================================================================

console.log('\n=== Example 3: Composite Reporter ===\n');

const compositeReporter = new CompositeErrorReporter([
    new ConsoleErrorReporter(false),
    new CloudflareErrorReporter(mockAnalytics, {
        serviceName: 'adblock-compiler',
        environment: 'production',
        logToConsole: false, // console reporter already logs
    }),
]);

try {
    throw new Error('Network timeout');
} catch (error) {
    await compositeReporter.reportAsync(error as Error, {
        requestId: 'req-789',
        url: 'https://example.com/filters.txt',
        tags: { operation: 'download', retryable: 'true' },
    }, ErrorSeverity.Warning);
}

// ============================================================================
// Example 4: Factory Pattern
// ============================================================================

console.log('\n=== Example 4: Factory Pattern ===\n');

// Development configuration
const devReporter = createErrorReporter({
    type: 'console',
    verbose: true,
});

// Production configuration
const prodReporter = createErrorReporter({
    type: 'cloudflare',
    analyticsEngine: mockAnalytics,
    serviceName: 'adblock-compiler',
    environment: 'production',
    logToConsole: true,
});

// Composite configuration (console + cloudflare)
const hybridReporter = createErrorReporter({
    type: 'composite',
    analyticsEngine: mockAnalytics,
    serviceName: 'adblock-compiler',
    environment: 'staging',
});

try {
    throw new Error('Example error for factory pattern');
} catch (error) {
    devReporter.report(error as Error, {
        tags: { source: 'factory-example' },
    });
}

// ============================================================================
// Example 5: Severity Levels
// ============================================================================

console.log('\n=== Example 5: Severity Levels ===\n');

const reporter: IErrorReporter = new ConsoleErrorReporter(true);

// Debug level
reporter.report(new Error('Debug information'), undefined, ErrorSeverity.Debug);

// Info level
reporter.report(new Error('Informational message'), undefined, ErrorSeverity.Info);

// Warning level
reporter.report(new Error('Warning: Cache miss'), undefined, ErrorSeverity.Warning);

// Error level (default)
reporter.report(new Error('Error: Compilation failed'));

// Fatal level
reporter.report(new Error('Fatal: System shutdown'), undefined, ErrorSeverity.Fatal);

// ============================================================================
// Example 6: Worker Integration
// ============================================================================

console.log('\n=== Example 6: Worker Integration Pattern ===\n');

// This is how you would use it in a Cloudflare Worker
const workerExample = `
import { createWorkerErrorReporter } from './worker/utils/index.ts';
import type { Env } from './worker/types.ts';

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        // Initialize error reporter
        const errorReporter = createWorkerErrorReporter(env);
        
        try {
            // Your worker logic here
            const result = await compileFilters(request, env);
            return new Response(JSON.stringify(result));
        } catch (error) {
            // Report the error
            await errorReporter.reportAsync(error as Error, {
                requestId: crypto.randomUUID(),
                url: request.url,
                method: request.method,
                tags: { operation: 'compilation' },
            });
            
            // Return error response
            return new Response(
                JSON.stringify({ error: error.message }),
                { status: 500 }
            );
        }
    }
};
`;

console.log('Worker Integration Example:');
console.log(workerExample);

console.log('\n=== All Examples Complete ===\n');
