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
import type { Context } from 'hono';
import type { Env } from '../types.ts';
import { getContainer } from '@cloudflare/containers';
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

export async function handleContainerStatus(c: Context<{ Bindings: Env }>): Promise<Response> {
    const checkedAt = new Date().toISOString();

    if (!c.env.ADBLOCK_COMPILER) {
        return c.json<ContainerStatusResponse>({ status: 'unavailable', checkedAt }, 200);
    }

    const t0 = Date.now();
    try {
        // getContainer() returns a Durable Object stub — the URL hostname is irrelevant;
        // the DO intercepts the call and routes it to the container's internal server.
        // This is not an outbound network request, so SSRF protections do not apply.
        const stub = getContainer(c.env.ADBLOCK_COMPILER);
        // Use a short timeout so this endpoint stays fast even on cold start
        const ac = new AbortController();
        const timeout = setTimeout(() => ac.abort(), 3000);
        try {
            const res = await stub.fetch(new Request('http://container/health'), { signal: ac.signal } as RequestInit);
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
                return c.json<ContainerStatusResponse>({ status: 'running', version, latencyMs, checkedAt }, 200);
            } else {
                return c.json<ContainerStatusResponse>({ status: 'error', latencyMs, checkedAt }, 200);
            }
        } catch (err) {
            clearTimeout(timeout);
            const latencyMs = Date.now() - t0;
            const isTimeout = err instanceof Error && err.name === 'AbortError';
            // AbortError after ~0ms means DO exists but container hasn't started yet
            return c.json<ContainerStatusResponse>({
                status: isTimeout ? 'starting' : 'sleeping',
                latencyMs,
                checkedAt,
            }, 200);
        }
    } catch {
        return c.json<ContainerStatusResponse>({ status: 'unavailable', checkedAt }, 200);
    }
}
