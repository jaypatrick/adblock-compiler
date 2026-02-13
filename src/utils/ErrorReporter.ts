/**
 * Centralized error reporting for production monitoring.
 * Supports multiple backends including Cloudflare, Sentry, and console logging.
 *
 * @module ErrorReporter
 */

/// <reference types="@cloudflare/workers-types" />

import { BaseError, ErrorUtils } from './ErrorUtils.ts';

/**
 * Context information to attach to error reports.
 * Provides additional metadata for debugging and analysis.
 */
export interface ErrorContext {
    /** Request ID for tracing */
    requestId?: string;
    /** User ID or identifier */
    userId?: string;
    /** HTTP method */
    method?: string;
    /** Request URL or path */
    url?: string;
    /** Additional custom tags */
    tags?: Record<string, string>;
    /** Extra metadata */
    extra?: Record<string, unknown>;
    /** Configuration name for compilations */
    configName?: string;
    /** Source count for compilations */
    sourceCount?: number;
}

/**
 * Severity levels for error reporting.
 * Maps to standard observability severity levels.
 */
export enum ErrorSeverity {
    /** Debug-level errors (verbose) */
    Debug = 'debug',
    /** Informational errors */
    Info = 'info',
    /** Warning-level errors */
    Warning = 'warning',
    /** Error-level (default) */
    Error = 'error',
    /** Critical/fatal errors */
    Fatal = 'fatal',
}

/**
 * Interface for error reporting implementations.
 * All error reporters must implement this interface.
 */
export interface IErrorReporter {
    /**
     * Reports an error with optional context.
     * @param error - The error to report
     * @param context - Additional context information
     * @param severity - Error severity level (defaults to Error)
     */
    report(error: Error, context?: ErrorContext, severity?: ErrorSeverity): void;

    /**
     * Reports an error asynchronously with optional context.
     * Use this when the reporter needs to perform async operations (e.g., network calls).
     * @param error - The error to report
     * @param context - Additional context information
     * @param severity - Error severity level (defaults to Error)
     */
    reportAsync(error: Error, context?: ErrorContext, severity?: ErrorSeverity): Promise<void>;

    /**
     * Flushes any pending error reports.
     * Useful for ensuring all errors are sent before shutdown.
     */
    flush?(): Promise<void>;
}

/**
 * Console-based error reporter for development and fallback.
 * Logs errors to console.error with formatted output.
 */
export class ConsoleErrorReporter implements IErrorReporter {
    /**
     * Creates a new ConsoleErrorReporter.
     * @param verbose - Whether to include full stack traces and context
     */
    constructor(private readonly verbose = false) {}

    /**
     * Reports an error to the console.
     */
    report(error: Error, context?: ErrorContext, severity: ErrorSeverity = ErrorSeverity.Error): void {
        const timestamp = new Date().toISOString();
        const severityLabel = severity.toUpperCase();

        // Format error message
        const errorMessage = ErrorUtils.format(error);

        // Build context string
        const contextParts: string[] = [];
        if (context?.requestId) contextParts.push(`requestId=${context.requestId}`);
        if (context?.configName) contextParts.push(`config=${context.configName}`);
        if (context?.url) contextParts.push(`url=${context.url}`);
        if (context?.method) contextParts.push(`method=${context.method}`);

        const contextStr = contextParts.length > 0 ? ` [${contextParts.join(', ')}]` : '';

        // Log to console
        console.error(`[${timestamp}] ${severityLabel}${contextStr}: ${errorMessage}`);

        // Log additional context in verbose mode
        if (this.verbose && context) {
            if (context.tags) console.error('  Tags:', context.tags);
            if (context.extra) console.error('  Extra:', context.extra);
        }
    }

    /**
     * Reports an error asynchronously (delegates to synchronous report).
     */
    async reportAsync(error: Error, context?: ErrorContext, severity: ErrorSeverity = ErrorSeverity.Error): Promise<void> {
        this.report(error, context, severity);
    }
}

/**
 * Cloudflare-native error reporter.
 * Uses Analytics Engine for aggregation and Tail Worker for real-time monitoring.
 */
export class CloudflareErrorReporter implements IErrorReporter {
    /**
     * Creates a new CloudflareErrorReporter.
     * @param analyticsEngine - Cloudflare Analytics Engine dataset
     * @param options - Configuration options
     */
    constructor(
        private readonly analyticsEngine?: AnalyticsEngineDataset,
        private readonly options: {
            /** Service name for grouping errors */
            serviceName?: string;
            /** Environment (production, staging, development) */
            environment?: string;
            /** Whether to also log to console */
            logToConsole?: boolean;
        } = {},
    ) {}

    /**
     * Reports an error (synchronous - queues for async processing).
     */
    report(error: Error, context?: ErrorContext, severity: ErrorSeverity = ErrorSeverity.Error): void {
        // Log to console if enabled
        if (this.options.logToConsole) {
            console.error(`[${severity}]`, ErrorUtils.format(error), context);
        }

        // Analytics Engine doesn't support synchronous writes, so we skip in sync mode
        // The async version should be used for actual reporting
    }

    /**
     * Reports an error asynchronously to Analytics Engine.
     */
    async reportAsync(error: Error, context?: ErrorContext, severity: ErrorSeverity = ErrorSeverity.Error): Promise<void> {
        // Log to console if enabled
        if (this.options.logToConsole) {
            console.error(`[${severity}]`, ErrorUtils.format(error), context);
        }

        // Skip if Analytics Engine not available
        if (!this.analyticsEngine) {
            return;
        }

        try {
            // Extract error details
            const errorName = error.name;
            const errorMessage = error.message;
            const errorCode = error instanceof BaseError ? error.code : undefined;
            const errorStack = error.stack;

            // Build data point for Analytics Engine
            const dataPoint = {
                // Indexes (for filtering/grouping)
                indexes: [
                    this.options.serviceName || 'adblock-compiler',
                    severity,
                    errorName,
                    errorCode || 'UNKNOWN',
                ],
                // Blobs (searchable text)
                blobs: [
                    errorMessage,
                    errorStack?.slice(0, 500) || '', // Truncate stack to 500 chars
                    context?.requestId || '',
                    context?.configName || '',
                    context?.url || '',
                ],
                // Doubles (numeric values for aggregation)
                doubles: [
                    context?.sourceCount || 0,
                    Date.now(), // timestamp
                ],
            };

            // Write to Analytics Engine
            this.analyticsEngine.writeDataPoint(dataPoint);
        } catch (reportError) {
            // Don't throw if reporting fails - log to console instead
            console.error('Failed to report error to Analytics Engine:', reportError);
        }
    }
}

/**
 * Sentry error reporter for production monitoring.
 * Requires Sentry SDK to be available.
 * Note: This is a placeholder implementation. DSN parameter is reserved for future Sentry SDK integration.
 */
export class SentryErrorReporter implements IErrorReporter {
    /**
     * Creates a new SentryErrorReporter.
     * @param _dsn - Sentry Data Source Name (DSN) - reserved for future Sentry SDK integration
     * @param options - Sentry configuration options
     */
    constructor(
        _dsn: string, // Reserved for future Sentry SDK integration
        private readonly options: {
            /** Environment (production, staging, development) */
            environment?: string;
            /** Release version */
            release?: string;
            /** Sample rate (0.0 to 1.0) */
            sampleRate?: number;
            /** Whether to also log to console */
            logToConsole?: boolean;
        } = {},
    ) {}

    /**
     * Reports an error to Sentry (delegates to async version).
     */
    report(error: Error, context?: ErrorContext, severity: ErrorSeverity = ErrorSeverity.Error): void {
        // Log to console if enabled
        if (this.options.logToConsole) {
            console.error(`[${severity}]`, ErrorUtils.format(error), context);
        }

        // Note: Actual Sentry integration requires the Sentry SDK
        // For now, we log to console with a note about Sentry
        console.warn('SentryErrorReporter: Sentry SDK not available, error not sent');
    }

    /**
     * Reports an error asynchronously to Sentry.
     * Note: This is a placeholder - actual implementation requires Sentry SDK.
     */
    async reportAsync(error: Error, context?: ErrorContext, severity: ErrorSeverity = ErrorSeverity.Error): Promise<void> {
        // Log to console if enabled
        if (this.options.logToConsole) {
            console.error(`[${severity}]`, ErrorUtils.format(error), context);
        }

        // Placeholder for Sentry integration
        // In production, this would use the Sentry SDK:
        // - Sentry.captureException(error, { level: severity, tags: context.tags, extra: context.extra })
        // - Include request ID, user context, etc.
        //
        // Example implementation:
        // if (typeof Sentry !== 'undefined') {
        //     Sentry.withScope((scope) => {
        //         if (context?.requestId) scope.setTag('requestId', context.requestId);
        //         if (context?.configName) scope.setTag('configName', context.configName);
        //         if (context?.tags) Object.entries(context.tags).forEach(([k, v]) => scope.setTag(k, v));
        //         if (context?.extra) scope.setContext('extra', context.extra);
        //         scope.setLevel(severity);
        //         Sentry.captureException(error);
        //     });
        // }

        console.warn('SentryErrorReporter: Sentry SDK not available, error not sent');
    }
}

/**
 * Composite error reporter that forwards errors to multiple reporters.
 * Useful for reporting to both console and a remote service.
 */
export class CompositeErrorReporter implements IErrorReporter {
    /**
     * Creates a new CompositeErrorReporter.
     * @param reporters - Array of error reporters to forward to
     */
    constructor(private readonly reporters: IErrorReporter[]) {}

    /**
     * Reports an error to all configured reporters.
     */
    report(error: Error, context?: ErrorContext, severity: ErrorSeverity = ErrorSeverity.Error): void {
        for (const reporter of this.reporters) {
            try {
                reporter.report(error, context, severity);
            } catch (reportError) {
                // Don't let one reporter failure break others
                console.error('Error reporter failed:', reportError);
            }
        }
    }

    /**
     * Reports an error asynchronously to all configured reporters.
     */
    async reportAsync(error: Error, context?: ErrorContext, severity: ErrorSeverity = ErrorSeverity.Error): Promise<void> {
        const promises = this.reporters.map((reporter) =>
            reporter.reportAsync(error, context, severity).catch((reportError) => {
                console.error('Error reporter failed:', reportError);
            })
        );
        await Promise.all(promises);
    }

    /**
     * Flushes all reporters that support flushing.
     */
    async flush(): Promise<void> {
        const promises = this.reporters
            .filter((r) => r.flush)
            .map((r) => r.flush!().catch((err) => console.error('Error flushing reporter:', err)));
        await Promise.all(promises);
    }
}

/**
 * Factory function to create an error reporter based on configuration.
 * @param config - Configuration object
 * @returns Configured error reporter instance
 */
export function createErrorReporter(config: {
    type?: 'console' | 'cloudflare' | 'sentry' | 'composite';
    verbose?: boolean;
    analyticsEngine?: AnalyticsEngineDataset;
    sentryDsn?: string;
    serviceName?: string;
    environment?: string;
    release?: string;
    logToConsole?: boolean;
}): IErrorReporter {
    const type = config.type || 'console';

    switch (type) {
        case 'console':
            return new ConsoleErrorReporter(config.verbose);

        case 'cloudflare':
            return new CloudflareErrorReporter(config.analyticsEngine, {
                serviceName: config.serviceName,
                environment: config.environment,
                logToConsole: config.logToConsole,
            });

        case 'sentry':
            if (!config.sentryDsn) {
                console.warn('Sentry DSN not provided, falling back to console reporter');
                return new ConsoleErrorReporter(config.verbose);
            }
            return new SentryErrorReporter(config.sentryDsn, {
                environment: config.environment,
                release: config.release,
                logToConsole: config.logToConsole,
            });

        case 'composite': {
            const reporters: IErrorReporter[] = [new ConsoleErrorReporter(config.verbose)];

            if (config.analyticsEngine) {
                reporters.push(
                    new CloudflareErrorReporter(config.analyticsEngine, {
                        serviceName: config.serviceName,
                        environment: config.environment,
                        logToConsole: false, // Console reporter already handles this
                    }),
                );
            }

            if (config.sentryDsn) {
                reporters.push(
                    new SentryErrorReporter(config.sentryDsn, {
                        environment: config.environment,
                        release: config.release,
                        logToConsole: false, // Console reporter already handles this
                    }),
                );
            }

            return new CompositeErrorReporter(reporters);
        }

        default:
            console.warn(`Unknown error reporter type: ${type}, falling back to console`);
            return new ConsoleErrorReporter(config.verbose);
    }
}
