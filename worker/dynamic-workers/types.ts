/**
 * Dynamic Workers subsystem — shared types.
 *
 * @see https://developers.cloudflare.com/dynamic-workers/
 * @see https://github.com/jaypatrick/adblock-compiler/issues/1386
 */

import type { Env } from '../types.ts';

// ============================================================================
// DynamicWorkerLoader binding type
// ============================================================================

/**
 * Cloudflare DynamicWorkerLoader binding.
 * Declared in wrangler.toml as: type = "dynamic_worker_loader", name = "DYNAMIC_WORKER_LOADER"
 *
 * @see https://developers.cloudflare.com/dynamic-workers/
 */
export interface DynamicWorkerLoader {
    /**
     * Load a Worker from a source string, returning a callable worker handle.
     * @param source - ES module source code string (must export `default { fetch }`)
     * @param opts   - Optional binding overrides for the spawned Worker
     */
    load(
        source: string,
        opts?: { bindings?: Record<string, unknown> },
    ): Promise<DynamicWorkerHandle>;
}

/**
 * Handle to an instantiated dynamic Worker.
 */
export interface DynamicWorkerHandle {
    fetch(request: Request): Promise<Response>;
}

// ============================================================================
// Task descriptors
// ============================================================================

/**
 * Describes a stateless compilation task that can be offloaded to a Dynamic Worker.
 */
export type DynamicWorkerTaskType = 'ast-parse' | 'validate' | 'transform';

export interface DynamicWorkerTask {
    readonly type: DynamicWorkerTaskType;
    readonly payload: unknown;
    readonly requestId: string;
}

// ============================================================================
// Registry entry extension
// ============================================================================

/**
 * Transport discriminator for Dynamic Worker dispatch.
 * Extends the existing 'websocket' | 'sse' union in AgentRegistryEntry.
 */
export type DynamicWorkerTransport = 'dynamic-worker';

/**
 * Bindings forwarded to a spawned Dynamic Worker.
 *
 * Contains only the minimum set required for stateless compilation tasks —
 * never auth secrets, admin databases, or the full `Env`. This enforces the
 * ZTA least-privilege principle: spawned isolates cannot escalate beyond the
 * capabilities explicitly granted here.
 *
 * - `COMPILATION_CACHE`: read/write access for caching parsed results
 * - `RATE_LIMIT`: per-request rate tracking inside the isolate
 * - `COMPILER_VERSION`: runtime version tag for result metadata
 */
export type DynamicWorkerBindings = Pick<
    Env,
    'COMPILATION_CACHE' | 'RATE_LIMIT' | 'COMPILER_VERSION'
>;
