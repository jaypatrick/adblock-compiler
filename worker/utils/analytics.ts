/**
 * Analytics service factory for the Cloudflare Worker.
 *
 * Creates an AnalyticsService instance bound to the Cloudflare Analytics Engine
 * dataset. When ANALYTICS_ENGINE is not configured, a no-op instance is returned
 * so callers never need to null-check before calling tracking methods.
 */

import { AnalyticsService } from '../../src/services/AnalyticsService.ts';
import type { Env } from '../types.ts';

/**
 * Create an {@link AnalyticsService} instance for the current request.
 *
 * @param env - Worker environment bindings
 * @returns An AnalyticsService bound to `env.ANALYTICS_ENGINE` (or a no-op if unset)
 */
export function createAnalyticsService(env: Env): AnalyticsService {
    return new AnalyticsService(env.ANALYTICS_ENGINE);
}
