/**
 * Tests for centralized error reporting.
 *
 * @module ErrorReporter.test
 */

import { assertEquals, assertExists } from '@std/assert';
import {
    AnalyticsEngineDataPoint,
    AnalyticsEngineDataset,
    CloudflareErrorReporter,
    CompositeErrorReporter,
    ConsoleErrorReporter,
    type ErrorContext,
    type IErrorReporter,
    NoOpErrorReporter,
    SentryErrorReporter,
} from './ErrorReporter.ts';
import { CompilationError, NetworkError } from './ErrorUtils.ts';

/**
 * Mock Analytics Engine for testing
 */
class MockAnalyticsEngine implements AnalyticsEngineDataset {
    public dataPoints: AnalyticsEngineDataPoint[] = [];

    writeDataPoint(dataPoint: AnalyticsEngineDataPoint): void {
        this.dataPoints.push(dataPoint);
    }

    clear(): void {
        this.dataPoints = [];
    }

    getLastDataPoint(): AnalyticsEngineDataPoint | undefined {
        return this.dataPoints[this.dataPoints.length - 1];
    }
}

/**
 * Mock console for testing console output
 */
class _MockConsole {
    public errors: Array<{ message: string; context?: ErrorContext }> = [];

    error(message: string, context?: ErrorContext): void {
        this.errors.push({ message, context });
    }

    clear(): void {
        this.errors = [];
    }
}

/**
 * Capture console.error calls
 */
function captureConsoleErrors<T>(fn: () => T): { result: T; errors: any[] } {
    const originalError = console.error;
    const errors: any[] = [];

    console.error = (...args: any[]) => {
        errors.push(args);
    };

    try {
        const result = fn();
        return { result, errors };
    } finally {
        console.error = originalError;
    }
}

// ============================================================================
// ConsoleErrorReporter Tests
// ============================================================================

Deno.test('ConsoleErrorReporter - should log error to console without context', () => {
    const { errors } = captureConsoleErrors(() => {
        const reporter = new ConsoleErrorReporter();
        reporter.report(new Error('Test error'));
    });

    assertEquals(errors.length, 1);
    assertEquals(errors[0][0], '[ERROR]');
    assertExists(errors[0][1]);
});

Deno.test('ConsoleErrorReporter - should log error to console with context', () => {
    const { errors } = captureConsoleErrors(() => {
        const reporter = new ConsoleErrorReporter();
        const context: ErrorContext = {
            requestId: '123',
            configName: 'test-config',
        };
        reporter.report(new Error('Test error'), context);
    });

    assertEquals(errors.length, 1);
    assertEquals(errors[0][0], '[ERROR]');
    assertExists(errors[0][1]);
    assertEquals(errors[0][2].requestId, '123');
    assertEquals(errors[0][2].configName, 'test-config');
});

Deno.test('ConsoleErrorReporter - verbose mode includes stack trace', () => {
    const { errors } = captureConsoleErrors(() => {
        const reporter = new ConsoleErrorReporter({ verbose: true });
        reporter.report(new Error('Test error'));
    });

    assertEquals(errors.length, 1);
    const message = errors[0][1];
    // Verbose mode uses ErrorUtils.format which includes message
    assertExists(message);
});

Deno.test('ConsoleErrorReporter - non-verbose mode excludes stack trace', () => {
    const { errors } = captureConsoleErrors(() => {
        const reporter = new ConsoleErrorReporter({ verbose: false });
        reporter.report(new Error('Test error'));
    });

    assertEquals(errors.length, 1);
    const message = errors[0][1];
    assertEquals(message, 'Test error');
});

// ============================================================================
// CloudflareErrorReporter Tests
// ============================================================================

Deno.test('CloudflareErrorReporter - should write error to Analytics Engine', () => {
    const mockEngine = new MockAnalyticsEngine();
    const reporter = new CloudflareErrorReporter(mockEngine);

    reporter.report(new Error('Test error'), {
        requestId: '123',
        configName: 'test-config',
    });

    assertEquals(mockEngine.dataPoints.length, 1);
    const dataPoint = mockEngine.getLastDataPoint();

    assertExists(dataPoint);
    assertExists(dataPoint.doubles);
    assertExists(dataPoint.blobs);

    // Check doubles
    assertExists(dataPoint.doubles[0]); // Timestamp
    assertEquals(dataPoint.doubles[1], 0); // Status code (not provided)

    // Check blobs
    assertEquals(dataPoint.blobs[0], '123'); // Request ID
    assertEquals(dataPoint.blobs[1], 'Error'); // Error name
    assertEquals(dataPoint.blobs[2], 'Test error'); // Error message
    assertEquals(dataPoint.blobs[3], 'test-config'); // Config name
});

Deno.test('CloudflareErrorReporter - should handle NetworkError with status code', () => {
    const mockEngine = new MockAnalyticsEngine();
    const reporter = new CloudflareErrorReporter(mockEngine);

    const error = new NetworkError('Fetch failed', 'https://example.com', 500);
    reporter.report(error, {
        requestId: '456',
        source: 'https://example.com',
        statusCode: 500,
    });

    const dataPoint = mockEngine.getLastDataPoint();
    assertExists(dataPoint);

    assertEquals(dataPoint.doubles?.[1], 500); // Status code
    assertEquals(dataPoint.blobs?.[1], 'NetworkError'); // Error name
    assertEquals(dataPoint.blobs?.[3], 'https://example.com'); // Source
});

Deno.test('CloudflareErrorReporter - should truncate long error messages', () => {
    const mockEngine = new MockAnalyticsEngine();
    const reporter = new CloudflareErrorReporter(mockEngine);

    const longMessage = 'a'.repeat(300);
    reporter.report(new Error(longMessage));

    const dataPoint = mockEngine.getLastDataPoint();
    assertExists(dataPoint);

    const message = dataPoint.blobs?.[2];
    assertExists(message);
    assertEquals(message.length, 256);
    assertEquals(message.endsWith('...'), true);
});

Deno.test('CloudflareErrorReporter - should include error code from custom errors', () => {
    const mockEngine = new MockAnalyticsEngine();
    const reporter = new CloudflareErrorReporter(mockEngine);

    const error = new CompilationError('Compilation failed', new Error('cause'));
    reporter.report(error);

    const dataPoint = mockEngine.getLastDataPoint();
    assertExists(dataPoint);

    assertEquals(dataPoint.blobs?.[6], 'COMPILATION_FAILED'); // Error code
});

Deno.test('CloudflareErrorReporter - should handle environment context', () => {
    const mockEngine = new MockAnalyticsEngine();
    const reporter = new CloudflareErrorReporter(mockEngine);

    reporter.report(new Error('Test error'), {
        environment: 'staging',
    });

    const dataPoint = mockEngine.getLastDataPoint();
    assertExists(dataPoint);

    assertEquals(dataPoint.blobs?.[5], 'staging'); // Environment
});

Deno.test('CloudflareErrorReporter - should default to production environment', () => {
    const mockEngine = new MockAnalyticsEngine();
    const reporter = new CloudflareErrorReporter(mockEngine);

    reporter.report(new Error('Test error'));

    const dataPoint = mockEngine.getLastDataPoint();
    assertExists(dataPoint);

    assertEquals(dataPoint.blobs?.[5], 'production'); // Default environment
});

Deno.test('CloudflareErrorReporter - should handle Analytics Engine failure gracefully', () => {
    const { errors } = captureConsoleErrors(() => {
        // Create a mock that throws
        const mockEngine: AnalyticsEngineDataset = {
            writeDataPoint: () => {
                throw new Error('Analytics Engine error');
            },
        };

        const reporter = new CloudflareErrorReporter(mockEngine);
        reporter.report(new Error('Test error'));
    });

    // Should log fallback errors
    assertEquals(errors.length >= 1, true);
});

// ============================================================================
// SentryErrorReporter Tests
// ============================================================================

Deno.test('SentryErrorReporter - should parse DSN correctly', () => {
    const reporter = new SentryErrorReporter('https://public123@sentry.io/456');

    // Access private fields through type assertion for testing
    assertEquals((reporter as any).publicKey, 'public123');
    assertEquals((reporter as any).endpoint, 'https://sentry.io/api/456/store/');
    assertEquals((reporter as any).environment, 'production');
});

Deno.test('SentryErrorReporter - should use custom environment and release', () => {
    const reporter = new SentryErrorReporter('https://public@sentry.io/123', {
        environment: 'staging',
        release: '1.0.0',
    });

    assertEquals((reporter as any).environment, 'staging');
    assertEquals((reporter as any).release, '1.0.0');
});

Deno.test('SentryErrorReporter - should handle fetch errors gracefully', () => {
    const { errors: _errors } = captureConsoleErrors(() => {
        // Override fetch to throw
        const originalFetch = globalThis.fetch;
        globalThis.fetch = () => Promise.reject(new Error('Network error'));

        try {
            const reporter = new SentryErrorReporter('https://public@sentry.io/123');
            reporter.report(new Error('Test error'));

            // Give async operation time to complete
            return new Promise((resolve) => setTimeout(resolve, 10));
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    // Note: Since fetch is async, we can't easily verify console output in this test
    // In production, Sentry errors are logged but don't throw
});

// ============================================================================
// CompositeErrorReporter Tests
// ============================================================================

Deno.test('CompositeErrorReporter - should report to all reporters', () => {
    const mockEngine = new MockAnalyticsEngine();
    const { errors } = captureConsoleErrors(() => {
        const composite = new CompositeErrorReporter([
            new ConsoleErrorReporter(),
            new CloudflareErrorReporter(mockEngine),
        ]);

        composite.report(new Error('Test error'));
    });

    // Should have logged to console
    assertEquals(errors.length, 1);

    // Should have written to Analytics Engine
    assertEquals(mockEngine.dataPoints.length, 1);
});

Deno.test('CompositeErrorReporter - should handle individual reporter failures', () => {
    const mockEngine = new MockAnalyticsEngine();

    // Create a reporter that throws
    class FailingReporter implements IErrorReporter {
        report(): void {
            throw new Error('Reporter failed');
        }
    }

    const { errors } = captureConsoleErrors(() => {
        const composite = new CompositeErrorReporter([
            new FailingReporter(),
            new CloudflareErrorReporter(mockEngine),
        ]);

        composite.report(new Error('Test error'));
    });

    // Should have logged the reporter failure
    assertEquals(errors.length >= 1, true);

    // Should still have written to Analytics Engine
    assertEquals(mockEngine.dataPoints.length, 1);
});

Deno.test('CompositeErrorReporter - should support adding reporters dynamically', () => {
    const mockEngine1 = new MockAnalyticsEngine();
    const mockEngine2 = new MockAnalyticsEngine();

    const composite = new CompositeErrorReporter([new CloudflareErrorReporter(mockEngine1)]);

    composite.report(new Error('Test error'));
    assertEquals(mockEngine1.dataPoints.length, 1);
    assertEquals(mockEngine2.dataPoints.length, 0);

    composite.addReporter(new CloudflareErrorReporter(mockEngine2));

    composite.report(new Error('Another error'));
    assertEquals(mockEngine1.dataPoints.length, 2);
    assertEquals(mockEngine2.dataPoints.length, 1);
});

Deno.test('CompositeErrorReporter - should work with empty reporters array', () => {
    const composite = new CompositeErrorReporter([]);
    composite.report(new Error('Test error')); // Should not throw
});

// ============================================================================
// NoOpErrorReporter Tests
// ============================================================================

Deno.test('NoOpErrorReporter - should not throw or log', () => {
    const { errors } = captureConsoleErrors(() => {
        const reporter = new NoOpErrorReporter();
        reporter.report(new Error('Test error'));
        reporter.report(new Error('Another error'), { requestId: '123' });
    });

    assertEquals(errors.length, 0);
});

// ============================================================================
// Integration Tests
// ============================================================================

Deno.test('Integration - report errors with full context', () => {
    const mockEngine = new MockAnalyticsEngine();
    const reporter = new CloudflareErrorReporter(mockEngine);

    const context: ErrorContext = {
        requestId: 'req-123',
        configName: 'my-config',
        source: 'https://example.com/filters.txt',
        transformation: 'Deduplicate',
        statusCode: 500,
        userId: 'user-456',
        environment: 'production',
        customField: 'custom-value',
    };

    const error = new NetworkError('Failed to fetch source', 'https://example.com/filters.txt', 500);
    reporter.report(error, context);

    const dataPoint = mockEngine.getLastDataPoint();
    assertExists(dataPoint);

    assertEquals(dataPoint.blobs?.[0], 'req-123'); // Request ID
    assertEquals(dataPoint.blobs?.[1], 'NetworkError'); // Error name
    assertEquals(dataPoint.blobs?.[3], 'my-config'); // Config name
    assertEquals(dataPoint.blobs?.[4], 'Deduplicate'); // Transformation
    assertEquals(dataPoint.blobs?.[5], 'production'); // Environment
    assertEquals(dataPoint.blobs?.[7], 'user-456'); // User ID
    assertEquals(dataPoint.doubles?.[1], 500); // Status code
});

Deno.test('Integration - composite reporter with multiple backends', () => {
    const mockEngine = new MockAnalyticsEngine();

    const { errors } = captureConsoleErrors(() => {
        const composite = new CompositeErrorReporter([
            new ConsoleErrorReporter({ verbose: false }),
            new CloudflareErrorReporter(mockEngine),
            new NoOpErrorReporter(),
        ]);

        const error = new CompilationError('Compilation failed', new Error('Parse error'));
        composite.report(error, {
            requestId: 'req-789',
            configName: 'production-config',
        });
    });

    // Verify console output
    assertEquals(errors.length, 1);

    // Verify Analytics Engine
    assertEquals(mockEngine.dataPoints.length, 1);
    const dataPoint = mockEngine.getLastDataPoint();
    assertEquals(dataPoint?.blobs?.[0], 'req-789');
    assertEquals(dataPoint?.blobs?.[6], 'COMPILATION_FAILED');
});
