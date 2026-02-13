/**
 * Example demonstrating per-module log level configuration
 *
 * Run with:
 * deno run --allow-env examples/module-log-levels-example.ts
 *
 * Or with environment variables:
 * LOG_LEVEL=info LOG_MODULE_OVERRIDES=compiler:debug,downloader:trace deno run --allow-env examples/module-log-levels-example.ts
 */

import { createLogger, createLoggerFromEnv, LogLevel } from '../src/index.ts';

console.log('=== Example 1: Basic Module Override Configuration ===\n');

// Create a logger with module-specific log levels
const logger = createLogger({
    level: LogLevel.Info,
    moduleOverrides: {
        'compiler': LogLevel.Debug,
        'downloader': LogLevel.Trace,
    },
});

// Create loggers for different modules
const compilerLogger = createLogger({
    level: LogLevel.Info,
    module: 'compiler',
    prefix: 'Compiler',
    moduleOverrides: {
        'compiler': LogLevel.Debug,
        'downloader': LogLevel.Trace,
    },
});

const downloaderLogger = createLogger({
    level: LogLevel.Info,
    module: 'downloader',
    prefix: 'Downloader',
    moduleOverrides: {
        'compiler': LogLevel.Debug,
        'downloader': LogLevel.Trace,
    },
});

const transformationLogger = createLogger({
    level: LogLevel.Info,
    module: 'transformation',
    prefix: 'Transformation',
    moduleOverrides: {
        'compiler': LogLevel.Debug,
        'downloader': LogLevel.Trace,
    },
});

console.log('Compiler logger (override to Debug):');
compilerLogger.debug('This debug message WILL show because module override is Debug');
compilerLogger.info('This info message will show');

console.log('\nDownloader logger (override to Trace):');
downloaderLogger.trace('This trace message WILL show because module override is Trace');
downloaderLogger.debug('This debug message will show');
downloaderLogger.info('This info message will show');

console.log('\nTransformation logger (uses default Info level):');
transformationLogger.debug('This debug message will NOT show (default is Info)');
transformationLogger.info('This info message WILL show');

console.log('\n=== Example 2: Environment Variable Configuration ===\n');

// Set environment variables for demonstration
if (typeof Deno !== 'undefined' && Deno.env) {
    Deno.env.set('LOG_LEVEL', 'info');
    Deno.env.set('LOG_MODULE_OVERRIDES', 'compiler:debug,downloader:trace');
}

// Create logger from environment variables
const envLogger = createLoggerFromEnv({ prefix: 'FromEnv' });

console.log('Logger created from environment variables:');
console.log('- Default level: info (from LOG_LEVEL)');
console.log('- Module overrides: compiler:debug, downloader:trace (from LOG_MODULE_OVERRIDES)');

// Create module-specific loggers using env configuration
const envCompilerLogger = createLoggerFromEnv({
    module: 'compiler',
    prefix: 'EnvCompiler',
});

const envTransformLogger = createLoggerFromEnv({
    module: 'transformation',
    prefix: 'EnvTransform',
});

console.log('\nEnvCompiler logger (debug from env):');
envCompilerLogger.debug('This debug message WILL show');

console.log('\nEnvTransform logger (default info from env):');
envTransformLogger.debug('This debug message will NOT show');
envTransformLogger.info('This info message will show');

console.log('\n=== Example 3: Real-World Scenario ===\n');

// Simulate a compilation pipeline with different module log levels
const pipelineLogger = createLogger({
    level: LogLevel.Warn, // Default: only warnings and errors
    moduleOverrides: {
        'compiler': LogLevel.Info, // Compiler: show info and above
        'downloader': LogLevel.Debug, // Downloader: show debug and above for troubleshooting
    },
});

// Simulate different modules
const modules = [
    {
        name: 'compiler',
        prefix: 'FilterCompiler',
        logs: [
            { level: 'debug', msg: 'Analyzing configuration...' },
            { level: 'info', msg: 'Starting compilation' },
            { level: 'info', msg: 'Compilation completed: 1000 rules' },
        ],
    },
    {
        name: 'downloader',
        prefix: 'FilterDownloader',
        logs: [
            { level: 'debug', msg: 'Checking cache for source' },
            { level: 'debug', msg: 'Cache miss, downloading from network' },
            { level: 'info', msg: 'Downloaded 5000 rules' },
        ],
    },
    {
        name: 'transformation',
        prefix: 'Deduplicate',
        logs: [
            { level: 'debug', msg: 'Building hash table...' },
            { level: 'info', msg: 'Removed 500 duplicates' },
            { level: 'warn', msg: 'High duplicate rate detected (50%)' },
        ],
    },
];

console.log('Simulated compilation pipeline:');
console.log('- Default level: Warn');
console.log('- Compiler module: Info');
console.log('- Downloader module: Debug\n');

for (const module of modules) {
    const moduleLogger = createLogger({
        level: LogLevel.Warn,
        module: module.name,
        prefix: module.prefix,
        moduleOverrides: pipelineLogger.getModuleOverrides(),
    });

    for (const log of module.logs) {
        switch (log.level) {
            case 'debug':
                moduleLogger.debug(log.msg);
                break;
            case 'info':
                moduleLogger.info(log.msg);
                break;
            case 'warn':
                moduleLogger.warn(log.msg);
                break;
            default:
                moduleLogger.info(log.msg);
        }
    }
}

console.log('\n=== Example 4: Child Loggers Inherit Module Configuration ===\n');

const parentLogger = createLogger({
    level: LogLevel.Info,
    module: 'compiler',
    prefix: 'Parent',
    moduleOverrides: {
        'compiler': LogLevel.Debug,
    },
});

// Child loggers inherit the module and overrides
const childLogger = parentLogger.child('SourceCompiler');
const grandchildLogger = childLogger.child('Validator');

console.log('Parent logger (module: compiler, override to Debug):');
parentLogger.debug('Parent debug message WILL show');

console.log('\nChild logger (inherits module and override):');
childLogger.debug('Child debug message WILL show');

console.log('\nGrandchild logger (inherits module and override):');
grandchildLogger.debug('Grandchild debug message WILL show');

console.log('\n✅ All examples completed!');
console.log('\nKey Takeaways:');
console.log('- Module overrides allow fine-grained control over log verbosity');
console.log('- Use environment variables for runtime configuration');
console.log('- Child loggers inherit module and override configuration');
console.log('- Perfect for debugging specific components without flooding logs');
console.log('- Works with both Logger and StructuredLogger');

// Clean up environment variables
if (typeof Deno !== 'undefined' && Deno.env) {
    Deno.env.delete('LOG_LEVEL');
    Deno.env.delete('LOG_MODULE_OVERRIDES');
}
