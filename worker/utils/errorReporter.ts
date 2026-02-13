/**
 * Error reporter initialization for Cloudflare Workers.
 * Creates and configures error reporters based on environment settings.
 */

import { createErrorReporter, type IErrorReporter } from '../../src/utils/ErrorReporter.ts';
import { VERSION } from '../../src/version.ts';
import type { Env } from '../types.ts';

/**
 * Creates an error reporter instance from worker environment configuration.
 * @param env - Worker environment bindings
 * @returns Configured error reporter instance
 */
export function createWorkerErrorReporter(env: Env): IErrorReporter {
    const reporterType = env.ERROR_REPORTER_TYPE || 'cloudflare';
    const verbose = env.ERROR_REPORTER_VERBOSE === 'true';

    return createErrorReporter({
        type: reporterType,
        verbose,
        analyticsEngine: env.ANALYTICS_ENGINE,
        sentryDsn: env.SENTRY_DSN,
        serviceName: 'adblock-compiler',
        environment: getEnvironment(env),
        release: env.COMPILER_VERSION || VERSION,
        logToConsole: reporterType === 'composite' || reporterType === 'console',
    });
}

/**
 * Determines the environment from worker bindings.
 * @param env - Worker environment bindings
 * @returns Environment name (production, staging, or development)
 */
function getEnvironment(env: Env): string {
    // Check if we're in development (no ANALYTICS_ENGINE usually means dev)
    if (!env.ANALYTICS_ENGINE) {
        return 'development';
    }

    // Check for staging indicators
    const version = env.COMPILER_VERSION || VERSION;
    if (version.includes('beta') || version.includes('rc') || version.includes('alpha')) {
        return 'staging';
    }

    // Default to production
    return 'production';
}
