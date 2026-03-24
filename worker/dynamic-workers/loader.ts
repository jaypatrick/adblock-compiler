/**
 * Dynamic Worker orchestration helpers.
 *
 * Provides `dispatchToDynamicWorker` — a ZTA-safe helper that:
 *   1. Validates the source string is non-empty.
 *   2. Loads a short-lived Worker from source via `env.DYNAMIC_WORKER_LOADER`.
 *   3. Forwards the serialised task payload as a POST request.
 *   4. Returns the parsed JSON response.
 *
 * All spawned Workers inherit only the minimum required bindings
 * (COMPILATION_CACHE, RATE_LIMIT, COMPILER_VERSION) — never the full Env.
 *
 * @see https://developers.cloudflare.com/dynamic-workers/
 * @see https://github.com/jaypatrick/adblock-compiler/issues/1386
 */

import type { Env } from '../types.ts';
import type { DynamicWorkerTask } from './types.ts';

// ============================================================================
// Constants
// ============================================================================

/** Content-Type used for all inter-Worker task POST requests. */
const TASK_CONTENT_TYPE = 'application/json';

/** Internal URL used as the request target inside the dynamic Worker isolate. */
const INTERNAL_TASK_URL = 'https://internal.dynamic-worker/task';

// ============================================================================
// Public API
// ============================================================================

/**
 * Dispatches a structured task to a freshly spawned Dynamic Worker.
 *
 * @param env    - Caller's Worker environment (must have DYNAMIC_WORKER_LOADER bound)
 * @param source - ES module source string for the dynamic Worker
 * @param task   - Typed task descriptor
 * @returns Parsed JSON response body from the dynamic Worker
 *
 * @throws {Error} if DYNAMIC_WORKER_LOADER is not bound (misconfiguration)
 * @throws {Error} if the dynamic Worker returns a non-2xx response
 */
export async function dispatchToDynamicWorker<T = unknown>(
    env: Env,
    source: string,
    task: DynamicWorkerTask,
): Promise<T> {
    if (!env.DYNAMIC_WORKER_LOADER) {
        throw new Error(
            'DYNAMIC_WORKER_LOADER binding is not configured. ' +
                'Add `type = "dynamic_worker_loader"` to wrangler.toml.',
        );
    }

    if (!source.trim()) {
        throw new Error('Dynamic Worker source must be a non-empty string.');
    }

    // Spawn an ephemeral Worker with minimum required bindings only (ZTA).
    const handle = await env.DYNAMIC_WORKER_LOADER.load(source, {
        bindings: {
            COMPILATION_CACHE: env.COMPILATION_CACHE,
            RATE_LIMIT: env.RATE_LIMIT,
            COMPILER_VERSION: env.COMPILER_VERSION,
        },
    });

    const request = new Request(INTERNAL_TASK_URL, {
        method: 'POST',
        headers: { 'Content-Type': TASK_CONTENT_TYPE },
        body: JSON.stringify(task),
    });

    const response = await handle.fetch(request);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
            `Dynamic Worker returned ${response.status}: ${errorText}`,
        );
    }

    return response.json() as Promise<T>;
}

/**
 * Returns true if the DYNAMIC_WORKER_LOADER binding is present in env.
 * Use this to feature-flag dynamic Worker dispatch vs. fallback paths.
 */
export function isDynamicWorkerAvailable(env: Env): boolean {
    return !!env.DYNAMIC_WORKER_LOADER;
}
