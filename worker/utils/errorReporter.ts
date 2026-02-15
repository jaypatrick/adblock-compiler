/**
 * Error reporter factory and utilities for Cloudflare Workers.
 *
 * Provides helper functions to create and configure error reporters
 * for use in Cloudflare Workers environment.
 *
 * @module worker/utils/errorReporter
 */

import {
    CloudflareErrorReporter,
    CompositeErrorReporter,
    ConsoleErrorReporter,
    type IErrorReporter,
    NoOpErrorReporter,
    SentryErrorReporter,
} from '../../src/utils/ErrorReporter.ts';
import type { Env } from '../types.ts';
import { VERSION } from '../../src/version.ts';

/**
 * Creates an error reporter based on worker environment configuration.
 *
 * Supported ERROR_REPORTER_TYPE values:
 * - 'console': Console-based error logging (development)
 * - 'cloudflare': Cloudflare Analytics Engine (production default)
 * - 'sentry': Sentry error tracking (requires SENTRY_DSN)
 * - 'composite': Multiple reporters (console + cloudflare + sentry if configured)
 * - undefined/other: Defaults to 'cloudflare' if ANALYTICS_ENGINE available, else 'console'
 *
 * @param env - Cloudflare Worker environment bindings
 * @param options - Additional options
 * @param options.environment - Environment name (production, staging, etc.)
 * @returns Configured error reporter
 *
 * @example
 * ```typescript
 * // In a Cloudflare Worker
 * export default {
 *     async fetch(request: Request, env: Env): Promise<Response> {
 *         const errorReporter = createWorkerErrorReporter(env);
 *
 *         try {
 *             // Your code here
 *         } catch (error) {
 *             errorReporter.report(error as Error, {
 *                 requestId: crypto.randomUUID(),
 *                 environment: 'production'
 *             });
 *             return new Response('Internal Server Error', { status: 500 });
 *         }
 *     }
 * }
 * ```
 */
export function createWorkerErrorReporter(
    env: Env,
    options: { environment?: string } = {},
): IErrorReporter {
    const reporterType = env.ERROR_REPORTER_TYPE?.toLowerCase();
    const environment = options.environment ?? 'production';

    switch (reporterType) {
        case 'console': {
            const verbose = env.ERROR_REPORTER_VERBOSE?.toLowerCase() !== 'false';
            return new ConsoleErrorReporter({ verbose });
        }

        case 'cloudflare': {
            if (env.ANALYTICS_ENGINE) {
                return new CloudflareErrorReporter(env.ANALYTICS_ENGINE);
            }
            console.warn('ERROR_REPORTER_TYPE=cloudflare but ANALYTICS_ENGINE not available. Falling back to console.');
            return new ConsoleErrorReporter({ verbose: true });
        }

        case 'sentry': {
            if (env.SENTRY_DSN) {
                return new SentryErrorReporter(env.SENTRY_DSN, {
                    environment,
                    release: env.COMPILER_VERSION ?? VERSION,
                });
            }
            console.warn('ERROR_REPORTER_TYPE=sentry but SENTRY_DSN not configured. Falling back to console.');
            return new ConsoleErrorReporter({ verbose: true });
        }

        case 'composite': {
            const reporters: IErrorReporter[] = [];

            // Always include console for debugging
            const verbose = env.ERROR_REPORTER_VERBOSE?.toLowerCase() !== 'false';
            reporters.push(new ConsoleErrorReporter({ verbose }));

            // Add Cloudflare Analytics Engine if available
            if (env.ANALYTICS_ENGINE) {
                reporters.push(new CloudflareErrorReporter(env.ANALYTICS_ENGINE));
            }

            // Add Sentry if configured
            if (env.SENTRY_DSN) {
                reporters.push(
                    new SentryErrorReporter(env.SENTRY_DSN, {
                        environment,
                        release: env.COMPILER_VERSION ?? VERSION,
                    }),
                );
            }

            if (reporters.length === 0) {
                console.warn('No error reporters configured. Using no-op reporter.');
                return new NoOpErrorReporter();
            }

            return new CompositeErrorReporter(reporters);
        }

        case 'none':
        case 'disabled':
            return new NoOpErrorReporter();

        default: {
            // Auto-detect best reporter
            if (env.ANALYTICS_ENGINE) {
                // Production: Use Analytics Engine
                return new CloudflareErrorReporter(env.ANALYTICS_ENGINE);
            } else {
                // Development: Use console
                console.info('No ERROR_REPORTER_TYPE configured. Defaulting to console reporter.');
                return new ConsoleErrorReporter({ verbose: true });
            }
        }
    }
}

/**
 * Creates a composite error reporter with all available backends.
 *
 * This helper creates a reporter that sends errors to all configured
 * backends simultaneously for maximum observability.
 *
 * @param env - Cloudflare Worker environment bindings
 * @param options - Additional options
 * @param options.environment - Environment name
 * @param options.includeConsole - Whether to include console logging (default: true)
 * @returns Composite error reporter
 *
 * @example
 * ```typescript
 * const reporter = createCompositeWorkerErrorReporter(env, {
 *     environment: 'production',
 *     includeConsole: false // Disable console in production
 * });
 * ```
 */
export function createCompositeWorkerErrorReporter(
    env: Env,
    options: { environment?: string; includeConsole?: boolean } = {},
): IErrorReporter {
    const reporters: IErrorReporter[] = [];
    const environment = options.environment ?? 'production';
    const includeConsole = options.includeConsole ?? true;

    if (includeConsole) {
        const verbose = env.ERROR_REPORTER_VERBOSE?.toLowerCase() !== 'false';
        reporters.push(new ConsoleErrorReporter({ verbose }));
    }

    if (env.ANALYTICS_ENGINE) {
        reporters.push(new CloudflareErrorReporter(env.ANALYTICS_ENGINE));
    }

    if (env.SENTRY_DSN) {
        reporters.push(
            new SentryErrorReporter(env.SENTRY_DSN, {
                environment,
                release: env.COMPILER_VERSION ?? VERSION,
            }),
        );
    }

    if (reporters.length === 0) {
        console.warn('No error reporters configured. Using no-op reporter.');
        return new NoOpErrorReporter();
    }

    return new CompositeErrorReporter(reporters);
}
