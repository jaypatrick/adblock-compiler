/**
 * Per-User API Usage Tracking
 *
 * Tracks API request counts per user using KV storage.
 * Maintains two rolling buckets per user:
 *   1. Daily bucket  — keyed by date (YYYY-MM-DD), with TTL of 90 days
 *   2. Total bucket  — keyed as 'total', no TTL
 *
 * KV key schema:
 *   usage:user:<userId>:day:<YYYY-MM-DD>  — DailyUsageBucket (JSON)
 *   usage:user:<userId>:total             — TotalUsageBucket (JSON)
 *
 * ## Design goals
 * - Fire-and-forget: callers use `void trackApiUsage(...)` — never awaited in hot path
 * - Fail-silent: all errors are swallowed — usage tracking must not affect request flow
 * - Anonymous skip: userId=null means no tracking (anonymous users only rate-limited)
 * - Additive: read-modify-write pattern; concurrent writes may lose counts (acceptable at scale)
 *
 * ## Extensibility
 * Additional per-user metrics (bandwidth, error rates) can be added to the bucket
 * types and aggregated in the same read-modify-write cycle.
 *
 * @see worker/utils/user-access.ts — per-user access gating
 * @see worker/handlers/admin-usage.ts — admin query handler
 */

import type { Env, IAuthContext } from '../types.ts';

// ============================================================================
// Bucket types
// ============================================================================

/** A single day's usage data for one user. */
export interface DailyUsageBucket {
    /** Total request count for this day. */
    count: number;
    /** Per-route breakdown: { '/compile': 5, '/validate': 2 } */
    routes: Record<string, number>;
}

/** Lifetime usage totals for one user. */
export interface TotalUsageBucket {
    /** Total request count across all time. */
    count: number;
    /** ISO timestamp of first recorded request. */
    firstSeen: string;
    /** ISO timestamp of most recent request. */
    lastSeen: string;
}

/** Aggregated usage result returned by getUserApiUsage. */
export interface UserApiUsageResult {
    total: TotalUsageBucket | null;
    days: (DailyUsageBucket & { date: string })[];
}

// ============================================================================
// Constants
// ============================================================================

/** TTL for daily buckets: 90 days. */
const DAILY_BUCKET_TTL_SECONDS = 90 * 24 * 60 * 60;

// ============================================================================
// trackApiUsage
// ============================================================================

/**
 * Record one API request for the given user.
 *
 * Silently skips if:
 *   - authContext.userId is null (anonymous)
 *   - env.RATE_LIMIT is not configured
 *
 * Never throws.
 *
 * @param authContext - Resolved auth context (userId required)
 * @param path        - Request path (e.g. '/compile')
 * @param _method     - HTTP method (reserved for future per-method breakdown)
 * @param env         - Worker env bindings
 */
export async function trackApiUsage(
    authContext: IAuthContext,
    path: string,
    _method: string,
    env: Env,
): Promise<void> {
    if (!authContext.userId) return;
    if (!env.RATE_LIMIT) return;

    const userId = authContext.userId;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const nowIso = now.toISOString();

    const dailyKey = `usage:user:${userId}:day:${dateStr}`;
    const totalKey = `usage:user:${userId}:total`;

    try {
        // --- Daily bucket ---
        const dailyRaw = await env.RATE_LIMIT.get(dailyKey);
        const daily: DailyUsageBucket = dailyRaw ? (JSON.parse(dailyRaw) as DailyUsageBucket) : { count: 0, routes: {} };

        daily.count += 1;
        daily.routes[path] = (daily.routes[path] ?? 0) + 1;

        await env.RATE_LIMIT.put(dailyKey, JSON.stringify(daily), {
            expirationTtl: DAILY_BUCKET_TTL_SECONDS,
        });

        // --- Total bucket ---
        const totalRaw = await env.RATE_LIMIT.get(totalKey);
        const total: TotalUsageBucket = totalRaw ? (JSON.parse(totalRaw) as TotalUsageBucket) : { count: 0, firstSeen: nowIso, lastSeen: nowIso };

        total.count += 1;
        total.lastSeen = nowIso;

        await env.RATE_LIMIT.put(totalKey, JSON.stringify(total));
    } catch {
        // Fail-silent: usage tracking must never affect request flow
    }
}

// ============================================================================
// getUserApiUsage
// ============================================================================

/**
 * Query aggregated API usage for a specific user.
 *
 * Returns total usage stats and per-day breakdown for the last `lookbackDays`.
 * Days with no data are omitted from the `days` array.
 *
 * Returns empty result if RATE_LIMIT is not configured.
 *
 * @param userId      - User UUID to query
 * @param env         - Worker env bindings
 * @param lookbackDays - Number of past days to include (default: 30)
 */
export async function getUserApiUsage(
    userId: string,
    env: Env,
    lookbackDays = 30,
): Promise<UserApiUsageResult> {
    if (!env.RATE_LIMIT) return { total: null, days: [] };

    try {
        const totalKey = `usage:user:${userId}:total`;
        const totalRaw = await env.RATE_LIMIT.get(totalKey);
        const total: TotalUsageBucket | null = totalRaw ? (JSON.parse(totalRaw) as TotalUsageBucket) : null;

        const days: (DailyUsageBucket & { date: string })[] = [];
        const now = new Date();

        for (let i = 0; i < lookbackDays; i++) {
            const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
            const dateStr = d.toISOString().slice(0, 10);
            const dailyKey = `usage:user:${userId}:day:${dateStr}`;
            const dailyRaw = await env.RATE_LIMIT.get(dailyKey);
            if (dailyRaw) {
                const bucket = JSON.parse(dailyRaw) as DailyUsageBucket;
                days.push({ date: dateStr, ...bucket });
            }
        }

        return { total, days };
    } catch {
        return { total: null, days: [] };
    }
}
