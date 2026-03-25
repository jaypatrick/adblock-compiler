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
    /** HTTP status code from the isolate response (4xx/5xx preserved for callers). */
    status?: number;
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
 * Uses the authenticated user's Better Auth user ID as the stable Worker name.
 */
export type AgentWorkerId = `agent-${string}`;

/**
 * Creates a stable, prefixed worker ID for a user's AI agent instance.
 * @param userId - The authenticated user's ID from the current Better Auth provider.
 */
export function makeAgentWorkerId(userId: string): AgentWorkerId {
    return `agent-${userId}`;
}

/**
 * Checks whether the LOADER binding is available in the current environment.
 * Verifies both `.load()` (ephemeral Workers) and `.get()` (persistent Workers)
 * are present before callers attempt either operation.
 * Use this before calling any dynamic Worker functions.
 */
export function isLoaderAvailable(env: { LOADER?: unknown }): boolean {
    const loader = env.LOADER as { load?: unknown; get?: unknown } | null | undefined;
    return typeof loader === 'object' && loader !== null &&
        typeof loader.load === 'function' &&
        typeof loader.get === 'function';
}
