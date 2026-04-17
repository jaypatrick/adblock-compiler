/// <reference types="@cloudflare/workers-types" />

/**
 * RateLimiterDO — Durable Object for per-identity rate limiting.
 *
 * Replaces the KV-based rate limiting implementation with a Durable Object
 * that provides atomic increments and strong per-shard consistency.
 *
 * **Why a Durable Object instead of KV?**
 * - KV has eventually-consistent read-after-write semantics; two Workers racing
 *   on the same key can both read stale counts and both allow the request.
 * - A DO is strictly serialised: every request to the same instance is
 *   processed one at a time, so increments are genuinely atomic and there are
 *   no race windows.
 * - DO storage persists across hibernation, so counters survive idle gaps
 *   without needing explicit TTL management.
 *
 * **Architecture**:
 * - `idFromName(identity)` routes each unique identity (user ID or client IP)
 *   to its own DO shard. No cross-shard coordination is needed.
 * - In-memory state is the source of truth while the DO is awake. Writes are
 *   flushed to DO Storage so the window survives hibernation.
 * - An `alarm()` fires ~1 s after the window expires to reset the counter and
 *   let the DO hibernate immediately after.
 * - The DO exposes a Hono sub-app so all paths are Zod-validated.
 *
 * **Usage from Worker**:
 * ```ts
 * import { checkRateLimitTiered } from './middleware/index.ts';
 * // checkRateLimitTiered auto-selects DO when env.RATE_LIMITER_DO is bound.
 * ```
 *
 * **Direct stub usage** (advanced):
 * ```ts
 * const id = env.RATE_LIMITER_DO.idFromName('user:user_abc');
 * const stub = env.RATE_LIMITER_DO.get(id);
 * const res = await stub.fetch(
 *   new Request('https://do/increment', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ maxRequests: 60, windowSeconds: 60 }),
 *   }),
 * );
 * const result = await res.json(); // { allowed, limit, remaining, resetAt }
 * ```
 */

import { Hono } from 'hono';
import { z } from 'zod';

// ============================================================================
// Schemas (Zod-validated at every trust boundary)
// ============================================================================

/**
 * Request body for the `/increment` endpoint.
 */
export const IncrementRequestSchema = z.object({
    /** Maximum number of requests allowed per window. */
    maxRequests: z.number().int().positive(),
    /** Length of the sliding window in seconds. */
    windowSeconds: z.number().int().positive(),
});

export type IncrementRequest = z.infer<typeof IncrementRequestSchema>;

/**
 * Structured result returned by `/increment` and forwarded as `IRateLimitResult`
 * by `checkRateLimitTiered`.
 */
export const RateLimitResultSchema = z.object({
    allowed: z.boolean(),
    limit: z.number(),
    remaining: z.number(),
    resetAt: z.number(),
});

export type RateLimitResult = z.infer<typeof RateLimitResultSchema>;

// ============================================================================
// Persisted State Keys
// ============================================================================

const STORAGE_KEY_COUNT = 'rl:count';
const STORAGE_KEY_RESET_AT = 'rl:resetAt';
const STORAGE_KEY_LIMIT = 'rl:limit';

// ============================================================================
// Durable Object
// ============================================================================

/**
 * Durable Object that provides atomic, per-identity rate limiting.
 *
 * One instance per identity (keyed by `idFromName`). Hibernates between
 * requests; storage is restored on wake-up via `blockConcurrencyWhile`.
 */
export class RateLimiterDO implements DurableObject {
    private readonly state: DurableObjectState;
    private readonly app: Hono;

    /** Current request count within the active window. */
    private count: number = 0;
    /** Unix timestamp (ms) when the current window resets. 0 means no active window. */
    private resetAt: number = 0;
    /** Configured max requests (stored so alarm() can log correctly). */
    private limit: number = 0;

    constructor(state: DurableObjectState, _env: unknown) {
        this.state = state;
        this.app = new Hono();
        this.setupRoutes();

        // Restore persisted state before handling the first request.
        // blockConcurrencyWhile guarantees no fetch() runs until this resolves.
        this.state.blockConcurrencyWhile(async () => {
            const [count, resetAt, limit] = await Promise.all([
                this.state.storage.get<number>(STORAGE_KEY_COUNT),
                this.state.storage.get<number>(STORAGE_KEY_RESET_AT),
                this.state.storage.get<number>(STORAGE_KEY_LIMIT),
            ]);
            this.count = count ?? 0;
            this.resetAt = resetAt ?? 0;
            this.limit = limit ?? 0;
        });
    }

    // --------------------------------------------------------------------------
    // Route setup
    // --------------------------------------------------------------------------

    private setupRoutes(): void {
        /** POST /increment — atomic increment; returns IRateLimitResult. */
        this.app.post('/increment', async (c) => {
            const parsed = IncrementRequestSchema.safeParse(await c.req.json());
            if (!parsed.success) {
                return c.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' }, 400);
            }
            const result = await this.increment(parsed.data.maxRequests, parsed.data.windowSeconds);
            return c.json(result);
        });

        /** GET /status — read-only snapshot of the current window state. */
        this.app.get('/status', (c) => {
            const now = Date.now();
            return c.json({
                count: this.count,
                limit: this.limit,
                resetAt: this.resetAt,
                remaining: Math.max(0, this.limit - this.count),
                windowExpired: this.resetAt === 0 || now > this.resetAt,
            });
        });

        /** POST /reset — force-reset the counter (admin / testing). */
        this.app.post('/reset', async (c) => {
            await this.resetCounter();
            return c.json({ success: true });
        });
    }

    // --------------------------------------------------------------------------
    // Core logic
    // --------------------------------------------------------------------------

    /**
     * Atomically increment the request count and return the rate-limit result.
     * All reads and writes to `this.count`/`this.resetAt` happen in a single
     * synchronous JS turn (DO is single-threaded), so this is race-free.
     */
    private async increment(maxRequests: number, windowSeconds: number): Promise<RateLimitResult> {
        const now = Date.now();
        const windowMs = windowSeconds * 1000;

        if (this.resetAt === 0 || now > this.resetAt) {
            // Start a new window.
            this.count = 1;
            this.resetAt = now + windowMs;
            this.limit = maxRequests;

            await this.state.storage.put({
                [STORAGE_KEY_COUNT]: this.count,
                [STORAGE_KEY_RESET_AT]: this.resetAt,
                [STORAGE_KEY_LIMIT]: this.limit,
            });

            // Schedule alarm to fire 1 s after window expiry so the DO can
            // hibernate immediately after the reset.
            await this.state.storage.setAlarm(this.resetAt + 1000);

            return {
                allowed: true,
                limit: maxRequests,
                remaining: maxRequests - 1,
                resetAt: this.resetAt,
            };
        }

        // Window is still active — update the stored limit in case the caller
        // passed a different maxRequests (e.g. due to a tier change).
        this.limit = maxRequests;

        if (this.count >= maxRequests) {
            return { allowed: false, limit: maxRequests, remaining: 0, resetAt: this.resetAt };
        }

        this.count++;
        // Only persist the count — resetAt and limit are unchanged.
        await this.state.storage.put(STORAGE_KEY_COUNT, this.count);

        return {
            allowed: true,
            limit: maxRequests,
            remaining: maxRequests - this.count,
            resetAt: this.resetAt,
        };
    }

    /** Reset counters and clear storage (used by alarm and /reset endpoint). */
    private async resetCounter(): Promise<void> {
        this.count = 0;
        this.resetAt = 0;
        this.limit = 0;
        await this.state.storage.deleteAll();
    }

    // --------------------------------------------------------------------------
    // Durable Object interface
    // --------------------------------------------------------------------------

    /** Called by Cloudflare when the window-expiry alarm fires. */
    async alarm(): Promise<void> {
        await this.resetCounter();
        // DO will now hibernate; next request starts a fresh window.
    }

    fetch(request: Request): Promise<Response> {
        return Promise.resolve(this.app.fetch(request));
    }
}
