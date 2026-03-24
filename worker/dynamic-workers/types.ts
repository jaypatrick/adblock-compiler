/**
 * Dynamic Workers subsystem types.
 *
 * These types model the three execution modes enabled by Cloudflare Dynamic Workers:
 *   1. One-shot ephemeral Workers  — `loadEphemeralWorker()` via `env.LOADER.load()`
 *   2. Named persistent Workers    — `getOrCreateWorker()` via `env.LOADER.get()`
 *   3. Per-user AI agent Workers   — `getOrCreateUserAgent()` specialized wrapper
 *
 * @see https://developers.cloudflare.com/dynamic-workers/
 * @see ideas/CLOUDFLARE_DYNAMIC_WORKERS_PIVOT.md
 * @see https://github.com/jaypatrick/adblock-compiler/issues/1386
 */

/**
 * Result type for dynamic Worker invocations.
 */
export interface DynamicWorkerResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    /** Execution time in milliseconds (populated by the invocation helpers). */
    durationMs?: number;
}

/**
 * Options for the dynamic AST parse operation.
 */
export interface DynamicAstParseOptions {
    rules?: string[];
    text?: string;
    /** If true, strict mode is enabled — unknown rule types are errors, not warnings. */
    strict?: boolean;
}

/**
 * Options for the dynamic rule validation operation.
 */
export interface DynamicValidateOptions {
    rules: string[];
    strict?: boolean;
}

/**
 * Identity type for per-user dynamic agent Workers.
 * Uses the authenticated user's Clerk/BetterAuth user ID as the stable Worker name.
 */
export type AgentWorkerId = `agent-${string}`;

/**
 * Creates a stable, prefixed worker ID for a user's AI agent instance.
 * @param userId - The authenticated user's ID (from Clerk/BetterAuth).
 */
export function makeAgentWorkerId(userId: string): AgentWorkerId {
    return `agent-${userId}`;
}

/**
 * Checks whether the LOADER binding is available in the current environment.
 * Use this before calling any dynamic Worker functions.
 */
export function isLoaderAvailable(env: { LOADER?: unknown }): boolean {
    return typeof env.LOADER === 'object' && env.LOADER !== null &&
        typeof (env.LOADER as { load?: unknown }).load === 'function';
}
