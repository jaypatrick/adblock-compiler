/**
 * KV-backed feature flag service for the Adblock Compiler Worker.
 *
 * Flags are stored in the `FEATURE_FLAGS` KV namespace as JSON values under
 * the key prefix `flag:`. For example, the flag `ENABLE_BATCH_STREAMING` is
 * stored as:
 *
 *   Key:   flag:ENABLE_BATCH_STREAMING
 *   Value: {"enabled":true,"updatedAt":"2025-01-01T00:00:00.000Z"}
 *
 * Eventual consistency caveat (important):
 *   Cloudflare KV is globally distributed with eventual consistency.
 *   Flag changes propagate to all edge nodes within approximately 60 seconds.
 *   This is intentional for feature flags — lagging on rollout is acceptable
 *   in exchange for sub-millisecond read latency at the edge.
 *   DO NOT use this service for security-sensitive gates (use Clerk JWT claims
 *   or CF Access headers for access control instead).
 *
 * OpenFeature / SaaS migration path:
 *   1. Implement `IFeatureFlagService` with your chosen provider SDK
 *      (Flagsmith, Statsig, LaunchDarkly, OpenFeature SDK + any provider).
 *   2. Inject the custom implementation via `WorkerCompilerDependencies`:
 *      ```ts
 *      new WorkerCompiler({ dependencies: { featureFlagService: myProvider } })
 *      ```
 *   3. Remove the `FEATURE_FLAGS` KV binding from `wrangler.toml` once you
 *      no longer need the KV fallback.
 *
 * @see src/platform/FeatureFlagService.ts — `IFeatureFlagService` interface
 * @see worker/services/admin-feature-flag-service.ts — D1-backed CRUD + targeting
 * @see https://developers.cloudflare.com/kv/ — Cloudflare KV documentation
 * @see https://openfeature.dev/ — OpenFeature specification
 * @see https://flagsmith.github.io/flagsmith-openfeature-provider — Flagsmith provider
 * @see https://docs.statsig.com/server/cloudflare — Statsig Edge SDK
 */

/// <reference types="@cloudflare/workers-types" />

import type { ILogger } from '../../src/types/index.ts';
import type { FeatureFlagKey, IFeatureFlagService } from '../../src/platform/FeatureFlagService.ts';

// Re-export for consumers that only import from worker/
export type { FeatureFlagKey, IFeatureFlagService };

// ============================================================================
// KV value schema
// ============================================================================

/**
 * JSON shape stored per flag in Cloudflare KV.
 * Stored under key `flag:<FeatureFlagKey>`.
 */
export interface KvFlagValue {
    /** Whether the flag is currently enabled. */
    enabled: boolean;
    /** ISO-8601 timestamp of the last write. */
    updatedAt: string;
    /** Optional human-readable note from the last writer (e.g. 'rollout started by @alice'). */
    note?: string;
}

// ============================================================================
// KV-backed implementation
// ============================================================================

/**
 * Cloudflare KV-backed implementation of {@link IFeatureFlagService}.
 *
 * Key format:   `flag:<key>`
 * Value format: JSON-serialised {@link KvFlagValue}
 *
 * All reads fall back to `fallback` (default `false`) on KV errors so that a
 * KV outage degrades gracefully rather than breaking the Worker.
 */
export class KvFeatureFlagService implements IFeatureFlagService {
    private readonly kv: KVNamespace;
    private readonly logger: ILogger;

    constructor(kv: KVNamespace, logger: ILogger) {
        this.kv = kv;
        this.logger = logger;
    }

    /** Returns the KV key for the given flag name. */
    private static kvKey(flagKey: string): string {
        return `flag:${flagKey}`;
    }

    async isEnabled(key: FeatureFlagKey | string, fallback = false): Promise<boolean> {
        try {
            const raw = await this.kv.get<KvFlagValue>(KvFeatureFlagService.kvKey(key), 'json');
            if (raw === null) {
                return fallback;
            }
            return raw.enabled;
        } catch (err) {
            this.logger.warn(
                `[FeatureFlagService] KV read failed for "${key}": ${err instanceof Error ? err.message : String(err)}`,
            );
            return fallback;
        }
    }

    async getAllEnabled(): Promise<FeatureFlagKey[]> {
        try {
            const list = await this.kv.list({ prefix: 'flag:' });
            const enabledKeys: FeatureFlagKey[] = [];

            await Promise.all(
                list.keys.map(async ({ name }) => {
                    const raw = await this.kv.get<KvFlagValue>(name, 'json');
                    if (raw?.enabled) {
                        enabledKeys.push(name.slice('flag:'.length) as FeatureFlagKey);
                    }
                }),
            );

            return enabledKeys;
        } catch (err) {
            this.logger.warn(
                `[FeatureFlagService] KV list failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            return [];
        }
    }

    async setFlag(key: FeatureFlagKey | string, enabled: boolean): Promise<void> {
        const value: KvFlagValue = { enabled, updatedAt: new Date().toISOString() };
        await this.kv.put(KvFeatureFlagService.kvKey(key), JSON.stringify(value));
        this.logger.info(`[FeatureFlagService] Flag "${key}" set to ${enabled}`);
    }
}

// ============================================================================
// No-op fallback implementation
// ============================================================================

/**
 * No-op implementation of {@link IFeatureFlagService}.
 *
 * Always returns the `fallback` value (default `false`). Used when:
 * - The `FEATURE_FLAGS` KV binding is absent (e.g. local dev without --local).
 * - A test double that should not interact with KV is needed.
 */
export class NullFeatureFlagService implements IFeatureFlagService {
    async isEnabled(_key: FeatureFlagKey | string, fallback = false): Promise<boolean> {
        return fallback;
    }

    async getAllEnabled(): Promise<FeatureFlagKey[]> {
        return [];
    }

    async setFlag(_key: FeatureFlagKey | string, _enabled: boolean): Promise<void> {
        // no-op: NullFeatureFlagService does not persist flags
    }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an {@link IFeatureFlagService} from an optional KV binding.
 *
 * Returns a {@link KvFeatureFlagService} when the `kv` binding is present,
 * otherwise falls back to {@link NullFeatureFlagService} and emits a warning.
 *
 * Usage in a Worker handler:
 * ```ts
 * import { createFeatureFlagService } from './services/feature-flag-service.ts';
 * import { silentLogger } from '../src/utils/index.ts';
 *
 * const featureFlags = createFeatureFlagService(env.FEATURE_FLAGS, logger);
 * if (await featureFlags.isEnabled('ENABLE_BATCH_STREAMING')) {
 *     // ... stream batch results
 * }
 * ```
 *
 * @param kv     - `env.FEATURE_FLAGS` KV binding (may be `undefined` in local dev).
 * @param logger - Logger for warning / info messages.
 */
export function createFeatureFlagService(
    kv: KVNamespace | undefined,
    logger: ILogger,
): IFeatureFlagService {
    if (!kv) {
        logger.warn(
            '[FeatureFlagService] FEATURE_FLAGS KV binding is absent — using NullFeatureFlagService (all flags default to false).',
        );
        return new NullFeatureFlagService();
    }
    return new KvFeatureFlagService(kv, logger);
}
