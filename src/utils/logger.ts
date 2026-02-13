// deno-lint-ignore-file no-console
/**
 * Deno-native logger implementation
 * Replaces consola for Deno compatibility
 */

import type { ILogger } from '../types/index.ts';

/**
 * Log levels for filtering output
 */
export enum LogLevel {
    Trace = -1,
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
    Silent = 4,
}

/**
 * ANSI color codes for terminal output
 */
const Colors = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    blue: '\x1b[34m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    cyan: '\x1b[36m',
} as const;

/**
 * Logger configuration options
 */
export interface LoggerOptions {
    level?: LogLevel;
    prefix?: string;
    timestamps?: boolean;
    colors?: boolean;
    /** Enable structured JSON output for production observability */
    structured?: boolean;
    /** Correlation ID for grouping related logs */
    correlationId?: string;
    /** Trace ID for distributed tracing */
    traceId?: string;
}

/**
 * Creates a formatted timestamp string
 */
function getTimestamp(): string {
    return new Date().toISOString();
}

/**
 * Console-based logger implementation for Deno
 */
export class Logger implements ILogger {
    protected level: LogLevel;
    protected prefix: string;
    protected timestamps: boolean;
    protected colors: boolean;

    constructor(options: LoggerOptions = {}) {
        this.level = options.level ?? LogLevel.Info;
        this.prefix = options.prefix ?? '';
        this.timestamps = options.timestamps ?? false;
        this.colors = options.colors ?? true;
    }

    /**
     * Formats a log message with optional prefix and timestamp
     */
    private format(levelName: string, color: string, message: string): string {
        const parts: string[] = [];

        if (this.timestamps) {
            parts.push(
                this.colors ? `${Colors.dim}${getTimestamp()}${Colors.reset}` : getTimestamp(),
            );
        }

        if (this.prefix) {
            parts.push(
                this.colors ? `${Colors.cyan}[${this.prefix}]${Colors.reset}` : `[${this.prefix}]`,
            );
        }

        parts.push(
            this.colors ? `${color}${levelName}${Colors.reset}` : levelName,
        );

        parts.push(message);

        return parts.join(' ');
    }

    /**
     * Logs a trace message (most verbose)
     */
    trace(message: string): void {
        if (this.level <= LogLevel.Trace) {
            console.debug(this.format('TRACE', Colors.dim, message));
        }
    }

    /**
     * Logs a debug message
     */
    debug(message: string): void {
        if (this.level <= LogLevel.Debug) {
            console.debug(this.format('DEBUG', Colors.dim, message));
        }
    }

    /**
     * Logs an info message
     */
    info(message: string): void {
        if (this.level <= LogLevel.Info) {
            console.info(this.format('INFO', Colors.blue, message));
        }
    }

    /**
     * Logs a warning message
     */
    warn(message: string): void {
        if (this.level <= LogLevel.Warn) {
            console.warn(this.format('WARN', Colors.yellow, message));
        }
    }

    /**
     * Logs an error message
     */
    error(message: string): void {
        if (this.level <= LogLevel.Error) {
            console.error(this.format('ERROR', Colors.red, message));
        }
    }

    /**
     * Logs a success message (info level)
     */
    success(message: string): void {
        if (this.level <= LogLevel.Info) {
            console.info(this.format('SUCCESS', Colors.green, message));
        }
    }

    /**
     * Creates a child logger with an additional prefix
     */
    child(prefix: string): Logger {
        const childPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
        return new Logger({
            level: this.level,
            prefix: childPrefix,
            timestamps: this.timestamps,
            colors: this.colors,
        });
    }

    /**
     * Sets the log level
     */
    setLevel(level: LogLevel): void {
        this.level = level;
    }
}

/**
 * Default logger instance
 */
export const logger = new Logger();

/**
 * Creates a new logger with the given options
 * @param options - Logger configuration options
 * @returns A Logger or StructuredLogger instance based on options.structured
 */
export function createLogger(options?: LoggerOptions): Logger {
    if (options?.structured) {
        return new StructuredLogger(options);
    }
    return new Logger(options);
}

/**
 * Silent logger that discards all output (useful for testing)
 */
export const silentLogger: ILogger = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};

/**
 * Map LogLevel enum to string representation for structured logs
 */
function logLevelToString(level: LogLevel): string {
    switch (level) {
        case LogLevel.Trace:
            return 'trace';
        case LogLevel.Debug:
            return 'debug';
        case LogLevel.Info:
            return 'info';
        case LogLevel.Warn:
            return 'warn';
        case LogLevel.Error:
            return 'error';
        case LogLevel.Silent:
            return 'silent';
        default:
            return 'info';
    }
}

/**
 * Structured logger implementation for production observability
 * Outputs JSON-formatted logs compatible with log aggregation systems
 * (CloudWatch, Datadog, Splunk, etc.)
 *
 * @example
 * ```typescript
 * const logger = new StructuredLogger({
 *     level: LogLevel.Info,
 *     correlationId: 'abc-123',
 *     traceId: 'trace-456'
 * });
 * logger.info('Processing started', { itemCount: 42 });
 * // Output: {"timestamp":"2024-01-01T12:00:00.000Z","level":"info","message":"Processing started","context":{"itemCount":42},"correlationId":"abc-123","traceId":"trace-456"}
 * ```
 */
export class StructuredLogger extends Logger {
    private correlationId?: string;
    private traceId?: string;

    constructor(options: LoggerOptions = {}) {
        // Pass non-structured options to parent
        super({
            level: options.level,
            prefix: options.prefix,
            timestamps: false, // Don't use parent's timestamp formatting
            colors: false, // JSON doesn't need colors
        });
        this.correlationId = options.correlationId;
        this.traceId = options.traceId;
    }

    /**
     * Creates a structured log entry
     */
    private createLogEntry(
        level: LogLevel,
        message: string,
        context?: Record<string, unknown>,
    ): string {
        const entry: {
            timestamp: string;
            level: string;
            message: string;
            prefix?: string;
            context?: Record<string, unknown>;
            correlationId?: string;
            traceId?: string;
        } = {
            timestamp: new Date().toISOString(),
            level: logLevelToString(level),
            message,
        };

        // Only include prefix if set
        if (this.prefix) {
            entry.prefix = this.prefix;
        }

        // Only include context if provided
        if (context && Object.keys(context).length > 0) {
            entry.context = context;
        }

        // Only include correlationId if set
        if (this.correlationId) {
            entry.correlationId = this.correlationId;
        }

        // Only include traceId if set
        if (this.traceId) {
            entry.traceId = this.traceId;
        }

        return JSON.stringify(entry);
    }

    /**
     * Logs a trace message with optional context
     */
    override trace(message: string, context?: Record<string, unknown>): void {
        if (this.level <= LogLevel.Trace) {
            console.debug(this.createLogEntry(LogLevel.Trace, message, context));
        }
    }

    /**
     * Logs a debug message with optional context
     */
    override debug(message: string, context?: Record<string, unknown>): void {
        if (this.level <= LogLevel.Debug) {
            console.debug(this.createLogEntry(LogLevel.Debug, message, context));
        }
    }

    /**
     * Logs an info message with optional context
     */
    override info(message: string, context?: Record<string, unknown>): void {
        if (this.level <= LogLevel.Info) {
            console.info(this.createLogEntry(LogLevel.Info, message, context));
        }
    }

    /**
     * Logs a warning message with optional context
     */
    override warn(message: string, context?: Record<string, unknown>): void {
        if (this.level <= LogLevel.Warn) {
            console.warn(this.createLogEntry(LogLevel.Warn, message, context));
        }
    }

    /**
     * Logs an error message with optional context
     */
    override error(message: string, context?: Record<string, unknown>): void {
        if (this.level <= LogLevel.Error) {
            console.error(this.createLogEntry(LogLevel.Error, message, context));
        }
    }

    /**
     * Logs a success message (info level) with optional context
     */
    override success(message: string, context?: Record<string, unknown>): void {
        if (this.level <= LogLevel.Info) {
            // Success is logged at info level with 'success' in the message or context
            const successContext = { ...context, type: 'success' };
            console.info(this.createLogEntry(LogLevel.Info, message, successContext));
        }
    }

    /**
     * Creates a child logger with an additional prefix
     */
    override child(prefix: string): StructuredLogger {
        const childPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
        return new StructuredLogger({
            level: this.level,
            prefix: childPrefix,
            correlationId: this.correlationId,
            traceId: this.traceId,
            structured: true,
        });
    }

    /**
     * Sets the correlation ID for grouping related logs
     */
    setCorrelationId(correlationId: string): void {
        this.correlationId = correlationId;
    }

    /**
     * Sets the trace ID for distributed tracing
     */
    setTraceId(traceId: string): void {
        this.traceId = traceId;
    }
}
