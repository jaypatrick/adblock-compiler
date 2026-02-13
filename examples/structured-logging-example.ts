/**
 * Example demonstrating structured JSON logging for production observability
 *
 * Run with:
 * deno run --allow-read examples/structured-logging-example.ts
 */

import { createLogger, LogLevel, StructuredLogger } from '../src/index.ts';

console.log('=== Example 1: Basic Structured Logger ===\n');

// Create a structured logger with createLogger helper
const basicLogger = createLogger({
    structured: true,
    level: LogLevel.Info,
});

basicLogger.info('Application started');
basicLogger.info('Processing user request', { userId: 12345, action: 'login' });
basicLogger.warn('Rate limit approaching', { current: 95, max: 100 });
basicLogger.error('Database connection failed', { errorCode: 'ECONN', retries: 3 });

console.log('\n=== Example 2: Logger with Correlation and Trace IDs ===\n');

// Create a structured logger with correlation and trace IDs for distributed tracing
const tracingLogger = new StructuredLogger({
    level: LogLevel.Info,
    prefix: 'api',
    correlationId: 'req-abc-123-def-456',
    traceId: 'trace-xyz-789',
});

tracingLogger.info('Request received', {
    method: 'POST',
    path: '/api/compile',
    contentLength: 1024,
});

tracingLogger.info('Validating configuration', { sources: 5 });
tracingLogger.success('Configuration validated', { duration: 45 });

console.log('\n=== Example 3: Child Loggers ===\n');

// Child loggers inherit correlation/trace IDs and build hierarchical prefixes
const parentLogger = new StructuredLogger({
    level: LogLevel.Debug,
    prefix: 'compiler',
    correlationId: 'compile-001',
});

parentLogger.info('Starting compilation');

const sourceLogger = parentLogger.child('source-1');
sourceLogger.debug('Downloading filter list', {
    url: 'https://example.com/list.txt',
    method: 'GET',
});

const transformLogger = parentLogger.child('transformation');
transformLogger.info('Applying transformations', {
    count: 3,
    types: ['Deduplicate', 'Compress', 'Validate'],
});

console.log('\n=== Example 4: Dynamic Correlation ID Updates ===\n');

const dynamicLogger = new StructuredLogger({
    level: LogLevel.Info,
    prefix: 'queue',
});

dynamicLogger.info('Processing job from queue', { jobId: 'job-001' });

// Update correlation ID for the next request
dynamicLogger.setCorrelationId('job-001');
dynamicLogger.info('Job started', { priority: 'high' });

dynamicLogger.setCorrelationId('job-002');
dynamicLogger.info('Job started', { priority: 'low' });

console.log('\n=== Example 5: All Log Levels ===\n');

const allLevelsLogger = new StructuredLogger({
    level: LogLevel.Trace,
    prefix: 'demo',
});

allLevelsLogger.trace('Trace level - very detailed', { step: 1, details: 'initialization' });
allLevelsLogger.debug('Debug level - diagnostic info', { cacheHit: true, cacheSize: 1024 });
allLevelsLogger.info('Info level - general information', { status: 'running' });
allLevelsLogger.warn('Warn level - potential issue', { warningCode: 'W001' });
allLevelsLogger.error('Error level - error occurred', { errorCode: 'E500', stack: 'sample stack' });
allLevelsLogger.success('Success level - operation completed', { duration: 1500, items: 100 });

console.log('\n=== Example 6: Backward Compatibility (Standard Logger) ===\n');

// Standard logger still works for human-readable output
const standardLogger = createLogger({
    level: LogLevel.Info,
    timestamps: true,
    colors: true,
    prefix: 'legacy',
});

standardLogger.info('This is human-readable output');
standardLogger.warn('Traditional logging format');
standardLogger.error('No JSON, just plain text');

console.log('\n=== Example 7: Use in Production ===\n');

// Typical production setup
const productionLogger = new StructuredLogger({
    level: LogLevel.Info,
    prefix: 'production',
    correlationId: crypto.randomUUID(),
});

productionLogger.info('Service started', {
    version: '1.0.0',
    environment: 'production',
    region: 'us-east-1',
});

productionLogger.info('Health check', {
    status: 'healthy',
    uptime: 86400,
    memoryUsage: 512,
});

console.log('\n✅ All examples completed!');
console.log('\nNotes:');
console.log('- Structured logs are JSON formatted for easy parsing by log aggregation systems');
console.log('- Use correlationId to group related logs across multiple requests');
console.log('- Use traceId for distributed tracing across multiple services');
console.log('- Child loggers inherit IDs and build hierarchical prefixes');
console.log('- Backward compatible: standard Logger still outputs human-readable text');
