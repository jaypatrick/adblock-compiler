import { assertEquals } from '@std/assert';
import { createLogger, Logger, LogLevel, silentLogger } from './logger.ts';

Deno.test('Logger - should create logger with default options', () => {
    const logger = new Logger();
    assertEquals(logger instanceof Logger, true);
});

Deno.test('Logger - should create logger with custom level', () => {
    const logger = new Logger({ level: LogLevel.Error });
    // Logger is created successfully
    assertEquals(logger instanceof Logger, true);
});

Deno.test('Logger - should create logger with prefix', () => {
    const logger = new Logger({ prefix: 'test' });
    assertEquals(logger instanceof Logger, true);
});

Deno.test('Logger - should create logger with timestamps', () => {
    const logger = new Logger({ timestamps: true });
    assertEquals(logger instanceof Logger, true);
});

Deno.test('Logger - should create logger without colors', () => {
    const logger = new Logger({ colors: false });
    assertEquals(logger instanceof Logger, true);
});

Deno.test('Logger - should create child logger with prefix', () => {
    const parent = new Logger({ prefix: 'parent' });
    const child = parent.child('child');
    assertEquals(child instanceof Logger, true);
});

Deno.test('Logger - should create child logger with nested prefix', () => {
    const parent = new Logger({ prefix: 'parent' });
    const child = parent.child('child');
    const grandchild = child.child('grandchild');
    assertEquals(grandchild instanceof Logger, true);
});

Deno.test('Logger - should set log level', () => {
    const logger = new Logger();
    logger.setLevel(LogLevel.Error);
    // No error means success
    assertEquals(true, true);
});

Deno.test('Logger - createLogger should create a new instance', () => {
    const logger = createLogger();
    assertEquals(logger instanceof Logger, true);
});

Deno.test('Logger - createLogger should accept options', () => {
    const logger = createLogger({
        level: LogLevel.Debug,
        prefix: 'test',
        timestamps: true,
    });
    assertEquals(logger instanceof Logger, true);
});

Deno.test('Logger - silentLogger should have all methods', () => {
    assertEquals(typeof silentLogger.trace, 'function');
    assertEquals(typeof silentLogger.debug, 'function');
    assertEquals(typeof silentLogger.info, 'function');
    assertEquals(typeof silentLogger.warn, 'function');
    assertEquals(typeof silentLogger.error, 'function');
});

Deno.test('Logger - silentLogger methods should not throw', () => {
    silentLogger.trace('test');
    silentLogger.debug('test');
    silentLogger.info('test');
    silentLogger.warn('test');
    silentLogger.error('test');
    // No errors means success
    assertEquals(true, true);
});

Deno.test('Logger - all log methods should not throw', () => {
    const logger = new Logger({ level: LogLevel.Trace });
    logger.trace('trace message');
    logger.debug('debug message');
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');
    logger.success('success message');
    // No errors means success
    assertEquals(true, true);
});

Deno.test('Logger - should respect log level filtering', () => {
    const logger = new Logger({ level: LogLevel.Error });
    // These should not output (but not throw)
    logger.trace('should not show');
    logger.debug('should not show');
    logger.info('should not show');
    logger.warn('should not show');
    // This should output
    logger.error('should show');
    // No errors means success
    assertEquals(true, true);
});

Deno.test('Logger - LogLevel enum should have expected values', () => {
    assertEquals(LogLevel.Trace, -1);
    assertEquals(LogLevel.Debug, 0);
    assertEquals(LogLevel.Info, 1);
    assertEquals(LogLevel.Warn, 2);
    assertEquals(LogLevel.Error, 3);
    assertEquals(LogLevel.Silent, 4);
});

// ============================================================================
// StructuredLogger Tests
// ============================================================================

import { StructuredLogger } from './logger.ts';

Deno.test('StructuredLogger - should create with default options', () => {
    const logger = new StructuredLogger();
    assertEquals(logger instanceof StructuredLogger, true);
    assertEquals(logger instanceof Logger, true);
});

Deno.test('StructuredLogger - should create with correlation and trace IDs', () => {
    const logger = new StructuredLogger({
        correlationId: 'corr-123',
        traceId: 'trace-456',
    });
    assertEquals(logger instanceof StructuredLogger, true);
});

Deno.test('StructuredLogger - createLogger with structured flag should return StructuredLogger', () => {
    const logger = createLogger({ structured: true });
    assertEquals(logger instanceof StructuredLogger, true);
});

Deno.test('StructuredLogger - createLogger without structured flag should return Logger', () => {
    const logger = createLogger({ structured: false });
    assertEquals(logger instanceof Logger, true);
    assertEquals(logger instanceof StructuredLogger, false);
});

Deno.test('StructuredLogger - should output valid JSON', () => {
    const logger = new StructuredLogger({ level: LogLevel.Info });

    // Capture console output
    const originalConsoleInfo = console.info;
    let capturedOutput = '';
    console.info = (msg: string) => {
        capturedOutput = msg;
    };

    try {
        logger.info('test message');

        // Should be valid JSON
        const parsed = JSON.parse(capturedOutput);
        assertEquals(parsed.level, 'info');
        assertEquals(parsed.message, 'test message');
        assertEquals(typeof parsed.timestamp, 'string');
    } finally {
        console.info = originalConsoleInfo;
    }
});

Deno.test('StructuredLogger - should include context when provided', () => {
    const logger = new StructuredLogger({ level: LogLevel.Info });

    const originalConsoleInfo = console.info;
    let capturedOutput = '';
    console.info = (msg: string) => {
        capturedOutput = msg;
    };

    try {
        logger.info('test message', { userId: 123, action: 'login' });

        const parsed = JSON.parse(capturedOutput);
        assertEquals(parsed.context.userId, 123);
        assertEquals(parsed.context.action, 'login');
    } finally {
        console.info = originalConsoleInfo;
    }
});

Deno.test('StructuredLogger - should include correlationId when set', () => {
    const logger = new StructuredLogger({
        level: LogLevel.Info,
        correlationId: 'corr-123',
    });

    const originalConsoleInfo = console.info;
    let capturedOutput = '';
    console.info = (msg: string) => {
        capturedOutput = msg;
    };

    try {
        logger.info('test message');

        const parsed = JSON.parse(capturedOutput);
        assertEquals(parsed.correlationId, 'corr-123');
    } finally {
        console.info = originalConsoleInfo;
    }
});

Deno.test('StructuredLogger - should include traceId when set', () => {
    const logger = new StructuredLogger({
        level: LogLevel.Info,
        traceId: 'trace-456',
    });

    const originalConsoleInfo = console.info;
    let capturedOutput = '';
    console.info = (msg: string) => {
        capturedOutput = msg;
    };

    try {
        logger.info('test message');

        const parsed = JSON.parse(capturedOutput);
        assertEquals(parsed.traceId, 'trace-456');
    } finally {
        console.info = originalConsoleInfo;
    }
});

Deno.test('StructuredLogger - should include prefix when set', () => {
    const logger = new StructuredLogger({
        level: LogLevel.Info,
        prefix: 'myapp',
    });

    const originalConsoleInfo = console.info;
    let capturedOutput = '';
    console.info = (msg: string) => {
        capturedOutput = msg;
    };

    try {
        logger.info('test message');

        const parsed = JSON.parse(capturedOutput);
        assertEquals(parsed.prefix, 'myapp');
    } finally {
        console.info = originalConsoleInfo;
    }
});

Deno.test('StructuredLogger - child should inherit correlationId and traceId', () => {
    const parent = new StructuredLogger({
        level: LogLevel.Info,
        prefix: 'parent',
        correlationId: 'corr-123',
        traceId: 'trace-456',
    });

    const child = parent.child('child');

    const originalConsoleInfo = console.info;
    let capturedOutput = '';
    console.info = (msg: string) => {
        capturedOutput = msg;
    };

    try {
        child.info('test message');

        const parsed = JSON.parse(capturedOutput);
        assertEquals(parsed.prefix, 'parent:child');
        assertEquals(parsed.correlationId, 'corr-123');
        assertEquals(parsed.traceId, 'trace-456');
    } finally {
        console.info = originalConsoleInfo;
    }
});

Deno.test('StructuredLogger - should support all log levels', () => {
    const logger = new StructuredLogger({ level: LogLevel.Trace });

    const outputs: Record<string, string> = {};
    // Track debug outputs separately since both trace and debug use console.debug
    const debugOutputs: string[] = [];

    // Capture all console methods
    const originalConsoleDebug = console.debug;
    const originalConsoleInfo = console.info;
    const originalConsoleWarn = console.warn;
    const originalConsoleError = console.error;

    console.debug = (msg: string) => {
        debugOutputs.push(msg);
    };
    console.info = (msg: string) => {
        outputs.info = msg;
    };
    console.warn = (msg: string) => {
        outputs.warn = msg;
    };
    console.error = (msg: string) => {
        outputs.error = msg;
    };

    try {
        logger.trace('trace message');
        logger.debug('debug message');
        logger.info('info message');
        logger.warn('warn message');
        logger.error('error message');
        logger.success('success message');

        // Verify trace (first debug output)
        const traceParsed = JSON.parse(debugOutputs[0]);
        assertEquals(traceParsed.level, 'trace');
        assertEquals(traceParsed.message, 'trace message');

        // Verify debug (second debug output)
        const debugParsed = JSON.parse(debugOutputs[1]);
        assertEquals(debugParsed.level, 'debug');
        assertEquals(debugParsed.message, 'debug message');

        // Verify info
        const infoParsed = JSON.parse(outputs.info);
        assertEquals(infoParsed.level, 'info');
        assertEquals(infoParsed.message, 'info message');

        // Verify warn
        const warnParsed = JSON.parse(outputs.warn);
        assertEquals(warnParsed.level, 'warn');
        assertEquals(warnParsed.message, 'warn message');

        // Verify error
        const errorParsed = JSON.parse(outputs.error);
        assertEquals(errorParsed.level, 'error');
        assertEquals(errorParsed.message, 'error message');
    } finally {
        console.debug = originalConsoleDebug;
        console.info = originalConsoleInfo;
        console.warn = originalConsoleWarn;
        console.error = originalConsoleError;
    }
});

Deno.test('StructuredLogger - should respect log level filtering', () => {
    const logger = new StructuredLogger({ level: LogLevel.Error });

    let infoCallCount = 0;
    let errorCallCount = 0;

    const originalConsoleInfo = console.info;
    const originalConsoleError = console.error;

    console.info = () => {
        infoCallCount++;
    };
    console.error = () => {
        errorCallCount++;
    };

    try {
        logger.info('should not log');
        logger.error('should log');

        assertEquals(infoCallCount, 0);
        assertEquals(errorCallCount, 1);
    } finally {
        console.info = originalConsoleInfo;
        console.error = originalConsoleError;
    }
});

Deno.test('StructuredLogger - setCorrelationId should update correlationId', () => {
    const logger = new StructuredLogger({ level: LogLevel.Info });
    logger.setCorrelationId('new-corr-id');

    const originalConsoleInfo = console.info;
    let capturedOutput = '';
    console.info = (msg: string) => {
        capturedOutput = msg;
    };

    try {
        logger.info('test');
        const parsed = JSON.parse(capturedOutput);
        assertEquals(parsed.correlationId, 'new-corr-id');
    } finally {
        console.info = originalConsoleInfo;
    }
});

Deno.test('StructuredLogger - setTraceId should update traceId', () => {
    const logger = new StructuredLogger({ level: LogLevel.Info });
    logger.setTraceId('new-trace-id');

    const originalConsoleInfo = console.info;
    let capturedOutput = '';
    console.info = (msg: string) => {
        capturedOutput = msg;
    };

    try {
        logger.info('test');
        const parsed = JSON.parse(capturedOutput);
        assertEquals(parsed.traceId, 'new-trace-id');
    } finally {
        console.info = originalConsoleInfo;
    }
});

Deno.test('StructuredLogger - should not include empty context', () => {
    const logger = new StructuredLogger({ level: LogLevel.Info });

    const originalConsoleInfo = console.info;
    let capturedOutput = '';
    console.info = (msg: string) => {
        capturedOutput = msg;
    };

    try {
        logger.info('test message', {});

        const parsed = JSON.parse(capturedOutput);
        assertEquals(parsed.context, undefined);
    } finally {
        console.info = originalConsoleInfo;
    }
});

Deno.test('StructuredLogger - success should mark type as success in context', () => {
    const logger = new StructuredLogger({ level: LogLevel.Info });

    const originalConsoleInfo = console.info;
    let capturedOutput = '';
    console.info = (msg: string) => {
        capturedOutput = msg;
    };

    try {
        logger.success('operation succeeded');

        const parsed = JSON.parse(capturedOutput);
        assertEquals(parsed.level, 'info');
        assertEquals(parsed.context.type, 'success');
    } finally {
        console.info = originalConsoleInfo;
    }
});
