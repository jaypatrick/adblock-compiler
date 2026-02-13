/**
 * Tests for ErrorReporter implementations.
 */

import { assertEquals, assertExists } from '@std/assert';
import { BaseError, ErrorCode } from './ErrorUtils.ts';
import {
    CloudflareErrorReporter,
    CompositeErrorReporter,
    ConsoleErrorReporter,
    createErrorReporter,
    type ErrorContext,
    ErrorSeverity,
    type IErrorReporter,
    SentryErrorReporter,
} from './ErrorReporter.ts';

// ============================================================================
// Mock Analytics Engine
// ============================================================================

class MockAnalyticsEngine {
    public dataPoints: Array<{
        indexes: string[];
        blobs: string[];
        doubles: number[];
    }> = [];

    writeDataPoint(data: { indexes: string[]; blobs: string[]; doubles: number[] }): void {
        this.dataPoints.push(data);
    }

    clear(): void {
        this.dataPoints = [];
    }
}

// ============================================================================
// Test Helpers
// ============================================================================

function createTestError(message = 'Test error'): Error {
    return new Error(message);
}

function createTestBaseError(message = 'Test base error'): BaseError {
    return new BaseError(message, ErrorCode.COMPILATION_FAILED);
}

function createTestContext(): ErrorContext {
    return {
        requestId: 'req-123',
        configName: 'test-config',
        url: 'https://example.com/api',
        method: 'POST',
        sourceCount: 5,
        tags: {
            env: 'test',
            version: '1.0.0',
        },
        extra: {
            foo: 'bar',
            count: 42,
        },
    };
}

// ============================================================================
// ConsoleErrorReporter Tests
// ============================================================================

Deno.test('ConsoleErrorReporter - creates instance', () => {
    const reporter = new ConsoleErrorReporter();
    assertExists(reporter);
});

Deno.test('ConsoleErrorReporter - reports error without context', () => {
    const reporter = new ConsoleErrorReporter();
    const error = createTestError('Test error');

    // Should not throw
    reporter.report(error);
});

Deno.test('ConsoleErrorReporter - reports error with context', () => {
    const reporter = new ConsoleErrorReporter();
    const error = createTestError('Test error');
    const context = createTestContext();

    // Should not throw
    reporter.report(error, context);
});

Deno.test('ConsoleErrorReporter - reports error with severity', () => {
    const reporter = new ConsoleErrorReporter();
    const error = createTestError('Test error');

    // Should not throw
    reporter.report(error, undefined, ErrorSeverity.Warning);
    reporter.report(error, undefined, ErrorSeverity.Fatal);
});

Deno.test('ConsoleErrorReporter - reportAsync delegates to report', async () => {
    const reporter = new ConsoleErrorReporter();
    const error = createTestError('Test error');
    const context = createTestContext();

    // Should not throw
    await reporter.reportAsync(error, context, ErrorSeverity.Error);
});

Deno.test('ConsoleErrorReporter - verbose mode', () => {
    const reporter = new ConsoleErrorReporter(true);
    const error = createTestError('Test error');
    const context = createTestContext();

    // Should not throw
    reporter.report(error, context);
});

// ============================================================================
// CloudflareErrorReporter Tests
// ============================================================================

Deno.test('CloudflareErrorReporter - creates instance without analytics', () => {
    const reporter = new CloudflareErrorReporter();
    assertExists(reporter);
});

Deno.test('CloudflareErrorReporter - creates instance with analytics', () => {
    const analytics = new MockAnalyticsEngine();
    const reporter = new CloudflareErrorReporter(analytics as unknown as AnalyticsEngineDataset);
    assertExists(reporter);
});

Deno.test('CloudflareErrorReporter - reports error without analytics', () => {
    const reporter = new CloudflareErrorReporter();
    const error = createTestError('Test error');

    // Should not throw even without analytics
    reporter.report(error);
});

Deno.test('CloudflareErrorReporter - reportAsync writes to analytics', async () => {
    const analytics = new MockAnalyticsEngine();
    const reporter = new CloudflareErrorReporter(analytics as unknown as AnalyticsEngineDataset, {
        serviceName: 'test-service',
        environment: 'test',
    });

    const error = createTestError('Test error');
    const context = createTestContext();

    await reporter.reportAsync(error, context, ErrorSeverity.Warning);

    assertEquals(analytics.dataPoints.length, 1);
    const dataPoint = analytics.dataPoints[0];

    // Check indexes
    assertEquals(dataPoint.indexes[0], 'test-service'); // service name
    assertEquals(dataPoint.indexes[1], 'warning'); // severity
    assertEquals(dataPoint.indexes[2], 'Error'); // error name

    // Check blobs
    assertEquals(dataPoint.blobs[0], 'Test error'); // error message
    assertEquals(dataPoint.blobs[2], 'req-123'); // requestId
    assertEquals(dataPoint.blobs[3], 'test-config'); // configName
    assertEquals(dataPoint.blobs[4], 'https://example.com/api'); // url

    // Check doubles
    assertEquals(dataPoint.doubles[0], 5); // sourceCount
    assertExists(dataPoint.doubles[1]); // timestamp
});

Deno.test('CloudflareErrorReporter - handles BaseError with error code', async () => {
    const analytics = new MockAnalyticsEngine();
    const reporter = new CloudflareErrorReporter(analytics as unknown as AnalyticsEngineDataset);

    const error = createTestBaseError('Compilation failed');
    await reporter.reportAsync(error);

    assertEquals(analytics.dataPoints.length, 1);
    const dataPoint = analytics.dataPoints[0];

    // Should include error code in indexes
    assertEquals(dataPoint.indexes[3], ErrorCode.COMPILATION_FAILED);
});

Deno.test('CloudflareErrorReporter - handles error without context', async () => {
    const analytics = new MockAnalyticsEngine();
    const reporter = new CloudflareErrorReporter(analytics as unknown as AnalyticsEngineDataset);

    const error = createTestError('Test error');
    await reporter.reportAsync(error);

    assertEquals(analytics.dataPoints.length, 1);
    const dataPoint = analytics.dataPoints[0];

    // Should have empty strings for missing context
    assertEquals(dataPoint.blobs[2], ''); // no requestId
    assertEquals(dataPoint.blobs[3], ''); // no configName
    assertEquals(dataPoint.blobs[4], ''); // no url
    assertEquals(dataPoint.doubles[0], 0); // no sourceCount
});

Deno.test('CloudflareErrorReporter - logToConsole option', async () => {
    const analytics = new MockAnalyticsEngine();
    const reporter = new CloudflareErrorReporter(analytics as unknown as AnalyticsEngineDataset, {
        logToConsole: true,
    });

    const error = createTestError('Test error');
    await reporter.reportAsync(error);

    // Should not throw (console output is tested manually)
    assertEquals(analytics.dataPoints.length, 1);
});

Deno.test('CloudflareErrorReporter - handles analytics write failure', async () => {
    // Create a mock that throws on write
    const failingAnalytics = {
        writeDataPoint: () => {
            throw new Error('Analytics write failed');
        },
    };

    const reporter = new CloudflareErrorReporter(
        failingAnalytics as unknown as AnalyticsEngineDataset,
    );

    const error = createTestError('Test error');

    // Should not throw - errors are caught and logged
    await reporter.reportAsync(error);
});

// ============================================================================
// SentryErrorReporter Tests
// ============================================================================

Deno.test('SentryErrorReporter - creates instance', () => {
    const reporter = new SentryErrorReporter('https://sentry.io/dsn');
    assertExists(reporter);
});

Deno.test('SentryErrorReporter - reports error (placeholder)', () => {
    const reporter = new SentryErrorReporter('https://sentry.io/dsn');
    const error = createTestError('Test error');

    // Should not throw (placeholder implementation logs warning)
    reporter.report(error);
});

Deno.test('SentryErrorReporter - reportAsync (placeholder)', async () => {
    const reporter = new SentryErrorReporter('https://sentry.io/dsn', {
        environment: 'test',
        release: '1.0.0',
    });
    const error = createTestError('Test error');
    const context = createTestContext();

    // Should not throw (placeholder implementation logs warning)
    await reporter.reportAsync(error, context, ErrorSeverity.Fatal);
});

Deno.test('SentryErrorReporter - logToConsole option', () => {
    const reporter = new SentryErrorReporter('https://sentry.io/dsn', {
        logToConsole: true,
    });
    const error = createTestError('Test error');

    // Should not throw
    reporter.report(error);
});

// ============================================================================
// CompositeErrorReporter Tests
// ============================================================================

Deno.test('CompositeErrorReporter - creates instance with multiple reporters', () => {
    const reporters = [
        new ConsoleErrorReporter(),
        new CloudflareErrorReporter(),
    ];
    const composite = new CompositeErrorReporter(reporters);
    assertExists(composite);
});

Deno.test('CompositeErrorReporter - reports to all reporters', () => {
    const reporters = [
        new ConsoleErrorReporter(),
        new CloudflareErrorReporter(),
    ];
    const composite = new CompositeErrorReporter(reporters);
    const error = createTestError('Test error');
    const context = createTestContext();

    // Should not throw
    composite.report(error, context);
});

Deno.test('CompositeErrorReporter - reportAsync to all reporters', async () => {
    const analytics = new MockAnalyticsEngine();
    const reporters: IErrorReporter[] = [
        new ConsoleErrorReporter(),
        new CloudflareErrorReporter(analytics as unknown as AnalyticsEngineDataset),
    ];
    const composite = new CompositeErrorReporter(reporters);
    const error = createTestError('Test error');

    await composite.reportAsync(error);

    // Should have written to analytics
    assertEquals(analytics.dataPoints.length, 1);
});

Deno.test('CompositeErrorReporter - handles reporter failure gracefully', () => {
    // Create a reporter that throws
    const failingReporter: IErrorReporter = {
        report: () => {
            throw new Error('Reporter failed');
        },
        reportAsync: async () => {
            throw new Error('Reporter failed');
        },
    };

    const reporters = [
        failingReporter,
        new ConsoleErrorReporter(),
    ];
    const composite = new CompositeErrorReporter(reporters);
    const error = createTestError('Test error');

    // Should not throw - errors are caught
    composite.report(error);
});

Deno.test('CompositeErrorReporter - handles async reporter failure gracefully', async () => {
    const failingReporter: IErrorReporter = {
        report: () => {},
        reportAsync: async () => {
            throw new Error('Async reporter failed');
        },
    };

    const reporters = [
        failingReporter,
        new ConsoleErrorReporter(),
    ];
    const composite = new CompositeErrorReporter(reporters);
    const error = createTestError('Test error');

    // Should not throw - errors are caught
    await composite.reportAsync(error);
});

Deno.test('CompositeErrorReporter - flush calls flush on all reporters', async () => {
    let flushed = false;
    const flushableReporter: IErrorReporter = {
        report: () => {},
        reportAsync: async () => {},
        flush: async () => {
            flushed = true;
        },
    };

    const reporters = [
        flushableReporter,
        new ConsoleErrorReporter(),
    ];
    const composite = new CompositeErrorReporter(reporters);

    await composite.flush?.();
    assertEquals(flushed, true);
});

// ============================================================================
// createErrorReporter Factory Tests
// ============================================================================

Deno.test('createErrorReporter - creates console reporter by default', () => {
    const reporter = createErrorReporter({});
    assertExists(reporter);
    // Should be ConsoleErrorReporter (tested by behavior)
});

Deno.test('createErrorReporter - creates console reporter explicitly', () => {
    const reporter = createErrorReporter({ type: 'console' });
    assertExists(reporter);
});

Deno.test('createErrorReporter - creates cloudflare reporter', () => {
    const analytics = new MockAnalyticsEngine();
    const reporter = createErrorReporter({
        type: 'cloudflare',
        analyticsEngine: analytics as unknown as AnalyticsEngineDataset,
        serviceName: 'test-service',
        environment: 'test',
    });
    assertExists(reporter);
});

Deno.test('createErrorReporter - creates sentry reporter', () => {
    const reporter = createErrorReporter({
        type: 'sentry',
        sentryDsn: 'https://sentry.io/dsn',
        environment: 'production',
        release: '1.0.0',
    });
    assertExists(reporter);
});

Deno.test('createErrorReporter - falls back to console when sentry dsn missing', () => {
    const reporter = createErrorReporter({
        type: 'sentry',
        // no sentryDsn provided
    });
    assertExists(reporter);
    // Should be ConsoleErrorReporter (tested by behavior)
});

Deno.test('createErrorReporter - creates composite reporter', () => {
    const analytics = new MockAnalyticsEngine();
    const reporter = createErrorReporter({
        type: 'composite',
        analyticsEngine: analytics as unknown as AnalyticsEngineDataset,
        sentryDsn: 'https://sentry.io/dsn',
    });
    assertExists(reporter);
});

Deno.test('createErrorReporter - composite reporter without backends', () => {
    const reporter = createErrorReporter({
        type: 'composite',
        // no analyticsEngine or sentryDsn
    });
    assertExists(reporter);
    // Should still create composite with console reporter
});

Deno.test('createErrorReporter - handles unknown type', () => {
    const reporter = createErrorReporter({
        type: 'invalid' as any,
    });
    assertExists(reporter);
    // Should fall back to console reporter
});

// ============================================================================
// Integration Tests
// ============================================================================

Deno.test('Integration - console reporter handles all severity levels', () => {
    const reporter = new ConsoleErrorReporter();
    const error = createTestError('Test error');

    // Should not throw for any severity level
    reporter.report(error, undefined, ErrorSeverity.Debug);
    reporter.report(error, undefined, ErrorSeverity.Info);
    reporter.report(error, undefined, ErrorSeverity.Warning);
    reporter.report(error, undefined, ErrorSeverity.Error);
    reporter.report(error, undefined, ErrorSeverity.Fatal);
});

Deno.test('Integration - cloudflare reporter writes all severity levels', async () => {
    const analytics = new MockAnalyticsEngine();
    const reporter = new CloudflareErrorReporter(analytics as unknown as AnalyticsEngineDataset);
    const error = createTestError('Test error');

    await reporter.reportAsync(error, undefined, ErrorSeverity.Debug);
    await reporter.reportAsync(error, undefined, ErrorSeverity.Info);
    await reporter.reportAsync(error, undefined, ErrorSeverity.Warning);
    await reporter.reportAsync(error, undefined, ErrorSeverity.Error);
    await reporter.reportAsync(error, undefined, ErrorSeverity.Fatal);

    assertEquals(analytics.dataPoints.length, 5);
    assertEquals(analytics.dataPoints[0].indexes[1], 'debug');
    assertEquals(analytics.dataPoints[1].indexes[1], 'info');
    assertEquals(analytics.dataPoints[2].indexes[1], 'warning');
    assertEquals(analytics.dataPoints[3].indexes[1], 'error');
    assertEquals(analytics.dataPoints[4].indexes[1], 'fatal');
});

Deno.test('Integration - composite reporter with full configuration', async () => {
    const analytics = new MockAnalyticsEngine();
    const reporter = createErrorReporter({
        type: 'composite',
        analyticsEngine: analytics as unknown as AnalyticsEngineDataset,
        sentryDsn: 'https://sentry.io/dsn',
        serviceName: 'adblock-compiler',
        environment: 'production',
        release: '1.0.0',
        logToConsole: true,
    });

    const error = createTestBaseError('Compilation failed');
    const context = createTestContext();

    await reporter.reportAsync(error, context, ErrorSeverity.Error);

    // Should have written to analytics
    assertEquals(analytics.dataPoints.length, 1);
    const dataPoint = analytics.dataPoints[0];
    assertEquals(dataPoint.indexes[0], 'adblock-compiler');
    assertEquals(dataPoint.indexes[1], 'error');
    assertEquals(dataPoint.blobs[0], 'Compilation failed');
});
