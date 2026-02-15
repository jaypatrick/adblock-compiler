/**
 * Centralized error reporting for production monitoring.
 *
 * Provides interfaces and implementations for reporting errors to various
 * monitoring services like Cloudflare Analytics Engine, Sentry, or console logging.
 *
 * @module ErrorReporter
 */

import { ErrorUtils } from './ErrorUtils.ts';

/**
 * Context information to attach to error reports.
 * Provides additional metadata about where and why the error occurred.
 */
export interface ErrorContext {
    /** Request ID for tracing */
    requestId?: string;
    /** Configuration name being processed */
    configName?: string;
    /** Source URL being fetched */
    source?: string;
    /** Transformation being applied */
    transformation?: string;
    /** HTTP status code if applicable */
    statusCode?: number;
    /** User ID or identifier */
    userId?: string;
    /** Environment (production, staging, development) */
    environment?: string;
    /** Any additional custom context */
    [key: string]: unknown;
}

/**
 * Interface for error reporting implementations.
 *
 * All error reporters must implement this interface to ensure
 * consistent error reporting across different backends.
 *
 * @example
 * ```typescript
 * class CustomErrorReporter implements IErrorReporter {
 *     report(error: Error, context?: ErrorContext): void {
 *         // Send error to your custom backend
 *     }
 * }
 * ```
 */
export interface IErrorReporter {
    /**
     * Report an error with optional context.
     *
     * @param error - The error to report
     * @param context - Additional context information
     */
    report(error: Error, context?: ErrorContext): void;
}

/**
 * Analytics Engine data point structure for Cloudflare Workers.
 * Used by CloudflareErrorReporter to write error data.
 */
export interface AnalyticsEngineDataPoint {
    /** Array of up to 20 numeric values */
    doubles?: number[];
    /** Array of up to 20 string values */
    blobs?: (string | null)[];
}

/**
 * Minimal Analytics Engine Dataset interface.
 * Represents the Cloudflare Workers Analytics Engine binding.
 */
export interface AnalyticsEngineDataset {
    /**
     * Write a data point to Analytics Engine.
     *
     * @param dataPoint - The data point to write
     */
    writeDataPoint(dataPoint: AnalyticsEngineDataPoint): void;
}

/**
 * Console-based error reporter for development and debugging.
 *
 * Logs errors to the console with formatted output including
 * stack traces and context information.
 *
 * @example
 * ```typescript
 * const reporter = new ConsoleErrorReporter({ verbose: true });
 * reporter.report(new Error('Something went wrong'), {
 *     requestId: '123',
 *     configName: 'my-config'
 * });
 * ```
 */
export class ConsoleErrorReporter implements IErrorReporter {
    private readonly verbose: boolean;

    /**
     * Creates a new console error reporter.
     *
     * @param options - Configuration options
     * @param options.verbose - Whether to include full stack traces
     */
    constructor(options: { verbose?: boolean } = {}) {
        this.verbose = options.verbose ?? true;
    }

    /**
     * Report an error to the console.
     *
     * @param error - The error to report
     * @param context - Additional context information
     */
    report(error: Error, context?: ErrorContext): void {
        const message = this.verbose ? ErrorUtils.format(error) : ErrorUtils.getMessage(error);

        if (context && Object.keys(context).length > 0) {
            console.error('[ERROR]', message, context);
        } else {
            console.error('[ERROR]', message);
        }
    }
}

/**
 * Cloudflare Analytics Engine error reporter.
 *
 * Reports errors to Cloudflare's Analytics Engine for aggregation
 * and analysis. This is the recommended error reporter for production
 * Cloudflare Workers deployments.
 *
 * Data Point Structure:
 * - Index: 'error_report'
 * - doubles[0]: Timestamp (ms since epoch)
 * - doubles[1]: Status code (if applicable)
 * - doubles[2]: Reserved for future use
 * - blobs[0]: Request ID
 * - blobs[1]: Error name
 * - blobs[2]: Error message (truncated to 256 chars)
 * - blobs[3]: Config/Source name
 * - blobs[4]: Transformation name
 * - blobs[5]: Environment
 * - blobs[6]: Error code (if available)
 * - blobs[7]: User ID
 *
 * @example
 * ```typescript
 * // In a Cloudflare Worker
 * const reporter = new CloudflareErrorReporter(env.ANALYTICS_ENGINE);
 * reporter.report(new NetworkError('Fetch failed', 'https://example.com'), {
 *     requestId: '123',
 *     statusCode: 500
 * });
 * ```
 */
export class CloudflareErrorReporter implements IErrorReporter {
    private readonly analyticsEngine: AnalyticsEngineDataset;

    /**
     * Creates a new Cloudflare Analytics Engine error reporter.
     *
     * @param analyticsEngine - The Analytics Engine dataset binding
     */
    constructor(analyticsEngine: AnalyticsEngineDataset) {
        this.analyticsEngine = analyticsEngine;
    }

    /**
     * Report an error to Cloudflare Analytics Engine.
     *
     * @param error - The error to report
     * @param context - Additional context information
     */
    report(error: Error, context?: ErrorContext): void {
        try {
            const doubles: number[] = [];
            const blobs: (string | null)[] = [];

            // doubles[0]: Timestamp
            doubles[0] = Date.now();

            // doubles[1]: Status code (if applicable)
            doubles[1] = context?.statusCode ?? 0;

            // doubles[2]: Reserved
            doubles[2] = 0;

            // blobs[0]: Request ID
            blobs[0] = context?.requestId ?? null;

            // blobs[1]: Error name
            blobs[1] = error.name || 'Error';

            // blobs[2]: Error message (truncated to 256 chars for Analytics Engine)
            const message = ErrorUtils.getMessage(error);
            blobs[2] = message.length > 256 ? message.substring(0, 253) + '...' : message;

            // blobs[3]: Config/Source name
            blobs[3] = context?.configName ?? context?.source ?? null;

            // blobs[4]: Transformation name
            blobs[4] = context?.transformation ?? null;

            // blobs[5]: Environment
            blobs[5] = context?.environment ?? 'production';

            // blobs[6]: Error code (if available from custom error types)
            blobs[6] = (error as any).code ?? null;

            // blobs[7]: User ID
            blobs[7] = context?.userId ?? null;

            this.analyticsEngine.writeDataPoint({
                doubles,
                blobs,
            });
        } catch (reportError) {
            // Fallback to console if Analytics Engine fails
            console.error('Failed to report error to Analytics Engine:', reportError);
            console.error('Original error:', error, context);
        }
    }
}

/**
 * Sentry error reporter for production error tracking.
 *
 * Reports errors to Sentry using their HTTP API. This provides
 * rich error tracking with stack traces, breadcrumbs, and user context.
 *
 * Note: This implementation uses Sentry's Store API endpoint which works
 * in Cloudflare Workers without requiring the full Sentry SDK.
 *
 * @example
 * ```typescript
 * const reporter = new SentryErrorReporter('https://public@sentry.io/project-id', {
 *     environment: 'production',
 *     release: '1.0.0'
 * });
 * reporter.report(new Error('Database connection failed'), {
 *     requestId: '123',
 *     userId: 'user-456'
 * });
 * ```
 */
export class SentryErrorReporter implements IErrorReporter {
    private readonly endpoint: string;
    private readonly publicKey: string;
    private readonly environment: string;
    private readonly release?: string;

    /**
     * Creates a new Sentry error reporter.
     *
     * @param dsn - Sentry DSN (Data Source Name)
     * @param options - Configuration options
     * @param options.environment - Environment name (production, staging, etc.)
     * @param options.release - Release version
     */
    constructor(dsn: string, options: { environment?: string; release?: string } = {}) {
        const sentryUrl = new URL(dsn);
        const projectId = sentryUrl.pathname.substring(1);
        this.publicKey = sentryUrl.username;
        this.endpoint = `https://${sentryUrl.host}/api/${projectId}/store/`;
        this.environment = options.environment ?? 'production';
        this.release = options.release;
    }

    /**
     * Report an error to Sentry.
     *
     * @param error - The error to report
     * @param context - Additional context information
     */
    report(error: Error, context?: ErrorContext): void {
        try {
            const sentryEvent = {
                event_id: crypto.randomUUID().replace(/-/g, ''),
                timestamp: Date.now() / 1000,
                platform: 'javascript',
                level: 'error',
                environment: this.environment,
                release: this.release,
                exception: {
                    values: [
                        {
                            type: error.name || 'Error',
                            value: ErrorUtils.getMessage(error),
                            stacktrace: error.stack
                                ? {
                                    frames: this.parseStackTrace(error.stack),
                                }
                                : undefined,
                        },
                    ],
                },
                tags: {
                    error_code: (error as any).code,
                    config_name: context?.configName,
                    source: context?.source,
                    transformation: context?.transformation,
                },
                user: context?.userId
                    ? {
                        id: context.userId,
                    }
                    : undefined,
                contexts: {
                    error_context: context,
                },
                extra: {
                    request_id: context?.requestId,
                    status_code: context?.statusCode,
                },
            };

            // Send asynchronously without waiting
            fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${this.publicKey}`,
                },
                body: JSON.stringify(sentryEvent),
            }).catch((fetchError) => {
                console.error('Failed to send error to Sentry:', fetchError);
            });
        } catch (reportError) {
            console.error('Failed to report error to Sentry:', reportError);
        }
    }

    /**
     * Parse stack trace into Sentry's frame format.
     * Basic implementation - Sentry SDK provides more sophisticated parsing.
     *
     * @param stack - Stack trace string
     * @returns Array of stack frames
     */
    private parseStackTrace(stack: string): Array<{ filename?: string; function?: string; lineno?: number }> {
        const frames: Array<{ filename?: string; function?: string; lineno?: number }> = [];
        const lines = stack.split('\n').slice(1); // Skip first line (error message)

        for (const line of lines) {
            const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):\d+\)/);
            if (match) {
                frames.push({
                    function: match[1],
                    filename: match[2],
                    lineno: parseInt(match[3], 10),
                });
            }
        }

        return frames.reverse(); // Sentry wants frames in reverse order
    }
}

/**
 * Composite error reporter that forwards errors to multiple reporters.
 *
 * Useful for reporting errors to multiple backends simultaneously,
 * such as both console (for debugging) and Analytics Engine (for production monitoring).
 *
 * @example
 * ```typescript
 * const reporter = new CompositeErrorReporter([
 *     new ConsoleErrorReporter({ verbose: true }),
 *     new CloudflareErrorReporter(env.ANALYTICS_ENGINE),
 *     new SentryErrorReporter(env.SENTRY_DSN)
 * ]);
 *
 * reporter.report(error, context); // Reports to all three
 * ```
 */
export class CompositeErrorReporter implements IErrorReporter {
    private readonly reporters: IErrorReporter[];

    /**
     * Creates a new composite error reporter.
     *
     * @param reporters - Array of error reporters to use
     */
    constructor(reporters: IErrorReporter[]) {
        this.reporters = reporters;
    }

    /**
     * Report an error to all configured reporters.
     *
     * @param error - The error to report
     * @param context - Additional context information
     */
    report(error: Error, context?: ErrorContext): void {
        for (const reporter of this.reporters) {
            try {
                reporter.report(error, context);
            } catch (reportError) {
                // Don't let one reporter failure break others
                console.error('Error reporter failed:', reportError);
            }
        }
    }

    /**
     * Add a reporter to the composite.
     *
     * @param reporter - The reporter to add
     */
    addReporter(reporter: IErrorReporter): void {
        this.reporters.push(reporter);
    }
}

/**
 * No-op error reporter for testing or disabled error reporting.
 *
 * @example
 * ```typescript
 * const reporter = new NoOpErrorReporter();
 * reporter.report(error, context); // Does nothing
 * ```
 */
export class NoOpErrorReporter implements IErrorReporter {
    report(_error: Error, _context?: ErrorContext): void {
        // Do nothing
    }
}
