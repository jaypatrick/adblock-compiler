/**
 * Error reporter factory for Cloudflare Worker.
 * Creates and configures error reporters based on environment variables.
 */

import type { Env } from '../types.ts';
import { VERSION } from '../../src/version.ts';
import {
    CloudflareErrorReporter,
    CompositeErrorReporter,
    ConsoleErrorReporter,
    IErrorReporter,
    NoOpErrorReporter,
    SentryErrorReporter,
} from '../../src/utils/ErrorReporter.ts';

/**
 * Creates an error reporter based on environment configuration.
 * 
 * Supported configurations:
 * - ERROR_REPORTER_TYPE: 'console', 'cloudflare', 'sentry', 'composite', or 'none'
 * - SENTRY_DSN: Required if using Sentry reporter
 * - ERROR_REPORTER_VERBOSE: 'true' for verbose console logging
 * - ANALYTICS_ENGINE: Cloudflare Analytics Engine binding (optional)
 * 
 * @param env - Worker environment bindings
 * @returns Configured error reporter instance
 */
export function createWorkerErrorReporter(env: Env): IErrorReporter {
    const reporterType = env.ERROR_REPORTER_TYPE?.toLowerCase() || 'console';
    const verbose = env.ERROR_REPORTER_VERBOSE === 'true';
    const environment = 'production'; // Could be configurable via env var

    switch (reporterType) {
        case 'console':
            return new ConsoleErrorReporter(verbose);

        case 'cloudflare':
            if (env.ANALYTICS_ENGINE) {
                return new CloudflareErrorReporter(env.ANALYTICS_ENGINE, {
                    environment,
                    release: env.COMPILER_VERSION || VERSION,
                });
            }
            console.warn('Analytics Engine not available, falling back to console reporter');
            return new ConsoleErrorReporter(verbose);

        case 'sentry':
            if (env.SENTRY_DSN) {
                return new SentryErrorReporter(env.SENTRY_DSN, {
                    environment,
                    release: env.COMPILER_VERSION || VERSION,
                });
            }
            console.warn('Sentry DSN not configured, falling back to console reporter');
            return new ConsoleErrorReporter(verbose);

        case 'composite': {
            const reporters: IErrorReporter[] = [];

            // Always include console reporter
            reporters.push(new ConsoleErrorReporter(verbose));

            // Add Cloudflare reporter if available
            if (env.ANALYTICS_ENGINE) {
                reporters.push(
                    new CloudflareErrorReporter(env.ANALYTICS_ENGINE, {
                        environment,
                        release: env.COMPILER_VERSION || VERSION,
                    }),
                );
            }

            // Add Sentry reporter if configured
            if (env.SENTRY_DSN) {
                reporters.push(
                    new SentryErrorReporter(env.SENTRY_DSN, {
                        environment,
                        release: env.COMPILER_VERSION || VERSION,
                    }),
                );
            }

            return new CompositeErrorReporter(reporters);
        }

        case 'none':
            return new NoOpErrorReporter();

        default:
            console.warn(`Unknown error reporter type: ${reporterType}, falling back to console`);
            return new ConsoleErrorReporter(verbose);
    }
}
