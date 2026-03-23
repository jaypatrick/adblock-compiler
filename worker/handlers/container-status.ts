/**
 * Container status handler.
 *
 * GET /container/status
 *
 * Probes the AdblockCompiler Durable Object container and returns its
 * current lifecycle state. This is intentionally lightweight — it calls
 * GET /health on the container server which returns in <10ms when warm.
 *
 * This endpoint is intentionally unauthenticated, consistent with the
 * GET /health route pattern. It exposes only container lifecycle state
 * (running / starting / sleeping / error / unavailable) and round-trip
 * latency — no sensitive data, no internal configuration.
 *
 * Response shape:
 * {
 *   status: 'running' | 'starting' | 'sleeping' | 'error' | 'unavailable',
 *   version?: string,      // from container /health when running
 *   latencyMs?: number,    // round-trip to container in ms
 *   checkedAt: string,     // ISO timestamp
 * }
 */
import type { Env } from '../types.ts';
import { z } from 'zod';

export type ContainerLifecycleStatus = 'running' | 'starting' | 'sleeping' | 'error' | 'unavailable';

export interface ContainerStatusResponse {
    readonly status: ContainerLifecycleStatus;
    readonly version?: string;
    readonly latencyMs?: number;
    readonly checkedAt: string;
}

/** Zod schema for the container /health response body */
const ContainerHealthBodySchema = z.object({
    version: z.string().optional(),
}).passthrough();

function jsonResponse(body: ContainerStatusResponse, status = 200): Response {
    return Response.json(body, { status });
}

/**
 * Build the container fetch function from the ADBLOCK_COMPILER binding.
 *
 * `@cloudflare/containers` is dynamically imported so that unit tests running
 * in Deno (where the package's internal CJS-style resolution fails) can inject
 * a `containerFetch` stub instead of relying on the real package.
 */
async function buildContainerFetch(
    ns: DurableObjectNamespace,
): Promise<(req: Request, init?: RequestInit) => Promise<Response>> {
    const { getContainer } = await import('@cloudflare/containers');
    // deno-lint-ignore no-explicit-any
    const stub = getContainer(ns as any);
    return (req, init) => stub.fetch(req, init as RequestInit);
}

/**
 * @param env - Worker environment bindings.
 * @param containerFetch - Optional injectable fetch for the container /health
 *   endpoint. Defaults to the real `@cloudflare/containers` stub when omitted.
 *   Pass a stub in unit tests to avoid the package's CJS module resolution issue.
 */
export async function handleContainerStatus(
    env: Env,
    containerFetch?: (req: Request, init?: RequestInit) => Promise<Response>,
): Promise<Response> {
    const checkedAt = new Date().toISOString();

    if (!env.ADBLOCK_COMPILER) {
        return jsonResponse({ status: 'unavailable', checkedAt });
    }

    const fetchFn = containerFetch ?? await buildContainerFetch(env.ADBLOCK_COMPILER);

    const t0 = Date.now();
    // Use a short timeout so this endpoint stays fast even on cold start
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 3000);
    try {
        // The URL hostname is irrelevant; the DO stub intercepts the call and
        // routes it to the container's internal server. Not an outbound request.
        const res = await fetchFn(new Request('http://container/health'), { signal: ac.signal });
        clearTimeout(timeout);
        const latencyMs = Date.now() - t0;

        if (res.ok) {
            let version: string | undefined;
            try {
                const rawBody = await res.json();
                const parsed = ContainerHealthBodySchema.safeParse(rawBody);
                if (parsed.success) {
                    version = parsed.data.version;
                }
            } catch { /* ignore — version is optional */ }
            return jsonResponse({ status: 'running', version, latencyMs, checkedAt });
        } else {
            return jsonResponse({ status: 'error', latencyMs, checkedAt });
        }
    } catch (err) {
        clearTimeout(timeout);
        const latencyMs = Date.now() - t0;
        const isTimeout = err instanceof Error && err.name === 'AbortError';
        // AbortError from our 3s timeout likely means DO exists but container hasn't started yet
        return jsonResponse({
            status: isTimeout ? 'starting' : 'error',
            latencyMs,
            checkedAt,
        });
    }
}
