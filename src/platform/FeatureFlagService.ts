/**
 * Platform-agnostic feature flag interface.
 *
 * This module defines the `IFeatureFlagService` contract and the
 * `FeatureFlagKey` union type. Cloudflare-specific implementations live in
 * `worker/services/feature-flag-service.ts`.
 *
 * OpenFeature / SaaS migration path:
 *   Swap the `KvFeatureFlagService` for an `OpenFeatureAdapter`,
 *   `FlagsmithProvider`, or `StatsigEdgeClient` by implementing
 *   `IFeatureFlagService` and injecting it via `WorkerCompilerDependencies`.
 *
 * @see worker/services/feature-flag-service.ts — KV-backed implementation
 * @see https://openfeature.dev/ — OpenFeature specification
 * @see https://developers.cloudflare.com/kv/ — Cloudflare KV documentation
 */

// ============================================================================
// Feature flag keys
// ============================================================================

/**
 * Compile-time union of all known feature flag names.
 *
 * Add new flags here before referencing them in handler code. Keep names in
 * UPPER_SNAKE_CASE so they are visually distinct from string literals.
 *
 * Naming conventions:
 *   ENABLE_<FEATURE>  — feature toggle (on/off)
 *   USE_<PROVIDER>    — provider / strategy selection
 *   ALLOW_<ACTION>    — permission gate
 */
export type FeatureFlagKey =
    // Compilation features
    | 'ENABLE_BATCH_STREAMING'      // Stream batch results as SSE as they complete
    | 'ENABLE_BROWSER_FETCHER'      // Use headless Chromium for source fetching
    | 'ENABLE_ASYNC_COMPILE'        // Enable /compile/async endpoint
    | 'ENABLE_WORKFLOW_COMPILE'     // Route async compiles through the Workflows API
    // Cache features
    | 'ENABLE_R2_CACHE'             // Persist compilation results to R2
    | 'ENABLE_WARMUP_CRON'          // Run the cache-warming cron job
    // Debug / observability
    | 'ENABLE_BENCHMARK_HEADERS'    // Return X-Benchmark-* headers on responses
    | 'ENABLE_VERBOSE_ERRORS';      // Include full stack traces in error responses

// ============================================================================
// Interface
// ============================================================================

/**
 * Minimal feature flag service interface.
 *
 * Implement this interface to swap in an OpenFeature-compatible provider
 * (Flagsmith, Statsig Edge SDK, LaunchDarkly) without changing call-site code.
 *
 * @example Inject a custom provider at startup:
 * ```ts
 * import { WorkerCompiler } from '@jk-com/adblock-compiler';
 * import { MyOpenFeatureAdapter } from './my-openfeature-adapter.ts';
 *
 * const compiler = new WorkerCompiler({
 *     dependencies: {
 *         featureFlagService: new MyOpenFeatureAdapter({ apiKey: env.FF_API_KEY }),
 *     },
 * });
 * ```
 */
export interface IFeatureFlagService {
    /**
     * Returns `true` when the named flag is enabled.
     *
     * @param key      - A {@link FeatureFlagKey} or any ad-hoc string key.
     * @param fallback - Value to return when the flag cannot be evaluated
     *                   (e.g. KV binding unavailable). Defaults to `false`.
     */
    isEnabled(key: FeatureFlagKey | string, fallback?: boolean): Promise<boolean>;

    /**
     * Returns all flag keys that are currently enabled.
     * Useful for diagnostic endpoints and health checks.
     */
    getAllEnabled(): Promise<FeatureFlagKey[]>;

    /**
     * Toggle a flag on or off (writes to the backing store).
     *
     * Implementations backed by a read-only source (environment variables,
     * hard-coded config) may throw `UnsupportedOperationError` or silently
     * no-op. KV-backed implementations write through immediately, subject to
     * Cloudflare KV eventual consistency (~60 s propagation).
     *
     * @param key     - Flag key.
     * @param enabled - Desired state.
     */
    setFlag(key: FeatureFlagKey | string, enabled: boolean): Promise<void>;
}
