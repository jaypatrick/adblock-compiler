/**
 * Security Overview handler — aggregates security event metrics for the
 * admin Security Overview dashboard.
 *
 * This handler queries the D1 admin audit log for denied/failed entries
 * and returns structured data for the frontend Security Overview panel.
 * It mirrors the Cloudflare Security Overview Dashboard concept by surfacing
 * auth failures, rate-limit hits, access denials, and other threat signals.
 *
 * Analytics Engine write events (auth_failure, rate_limit, turnstile_rejection,
 * cors_rejection, cf_access_denial, size_limit) are write-only from the Worker
 * and can only be read via the Cloudflare Analytics Engine GraphQL API.
 * This handler therefore surfaces:
 *  1. D1 audit log security signals (denied/failure status entries).
 *  2. A manifest of Analytics Engine event types being actively tracked.
 *  3. Time-windowed event counts from D1 for sparkline/trend rendering.
 *
 * Route: GET /admin/security/overview?window=24h|7d|30d
 */

import type { D1Database } from '../types.ts';
import { JsonResponse } from '../utils/response.ts';

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

/** A single security event entry surfaced from the audit log. */
export interface SecurityOverviewEvent {
    readonly id: number;
    readonly actor_id: string;
    readonly action: string;
    readonly resource_type: string;
    readonly resource_id: string | null;
    readonly status: 'failure' | 'denied';
    readonly ip_address: string | null;
    readonly created_at: string;
}

/** Per-event-type count row */
export interface SecurityEventTypeCount {
    readonly event_type: string;
    readonly count: number;
}

/** Top targeted path row */
export interface TopTargetedResource {
    readonly resource_type: string;
    readonly count: number;
}

/** Response envelope for GET /admin/security/overview */
export interface SecurityOverviewResponse {
    readonly success: true;
    /** ISO 8601 timestamp of the response */
    readonly timestamp: string;
    /** Time window used for queries */
    readonly window: '24h' | '7d' | '30d';
    /** Total denied/failure events in the window */
    readonly total_security_events: number;
    /** Breakdown by status (denied vs failure) */
    readonly by_status: { denied: number; failure: number };
    /** Breakdown by action */
    readonly by_action: SecurityEventTypeCount[];
    /** Breakdown by resource type */
    readonly by_resource_type: TopTargetedResource[];
    /** 10 most recent security events */
    readonly recent_events: SecurityOverviewEvent[];
    /** Analytics Engine event types actively tracked — informational */
    readonly analytics_engine_tracked_events: string[];
    /** Whether the ANALYTICS_ENGINE binding is configured */
    readonly analytics_engine_configured: boolean;
}

// ---------------------------------------------------------------------------
// Valid time windows
// ---------------------------------------------------------------------------

const VALID_WINDOWS = ['24h', '7d', '30d'] as const;
type TimeWindow = typeof VALID_WINDOWS[number];

function windowToIso(window: TimeWindow): string {
    const now = Date.now();
    const msMap: Record<TimeWindow, number> = {
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
    };
    return new Date(now - msMap[window])
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d{3}Z$/, '');
}

// ---------------------------------------------------------------------------
// D1 query helpers
// ---------------------------------------------------------------------------

async function getTotalSecurityEvents(db: D1Database, since: string): Promise<number> {
    const result = await db
        .prepare(
            `SELECT COUNT(*) AS cnt
             FROM admin_audit_logs
             WHERE status IN ('failure', 'denied')
               AND created_at >= ?`,
        )
        .bind(since)
        .first<{ cnt: number }>();
    return result?.cnt ?? 0;
}

async function getByStatus(
    db: D1Database,
    since: string,
): Promise<{ denied: number; failure: number }> {
    const rows = await db
        .prepare(
            `SELECT status, COUNT(*) AS cnt
             FROM admin_audit_logs
             WHERE status IN ('failure', 'denied')
               AND created_at >= ?
             GROUP BY status`,
        )
        .bind(since)
        .all<{ status: string; cnt: number }>();
    const result = { denied: 0, failure: 0 };
    for (const row of rows.results ?? []) {
        if (row.status === 'denied') result.denied = row.cnt;
        if (row.status === 'failure') result.failure = row.cnt;
    }
    return result;
}

async function getByAction(
    db: D1Database,
    since: string,
): Promise<SecurityEventTypeCount[]> {
    const rows = await db
        .prepare(
            `SELECT action AS event_type, COUNT(*) AS count
             FROM admin_audit_logs
             WHERE status IN ('failure', 'denied')
               AND created_at >= ?
             GROUP BY action
             ORDER BY count DESC
             LIMIT 10`,
        )
        .bind(since)
        .all<{ event_type: string; count: number }>();
    return rows.results ?? [];
}

async function getByResourceType(
    db: D1Database,
    since: string,
): Promise<TopTargetedResource[]> {
    const rows = await db
        .prepare(
            `SELECT resource_type, COUNT(*) AS count
             FROM admin_audit_logs
             WHERE status IN ('failure', 'denied')
               AND created_at >= ?
             GROUP BY resource_type
             ORDER BY count DESC
             LIMIT 10`,
        )
        .bind(since)
        .all<{ resource_type: string; count: number }>();
    return rows.results ?? [];
}

async function getRecentEvents(
    db: D1Database,
    since: string,
): Promise<SecurityOverviewEvent[]> {
    const rows = await db
        .prepare(
            `SELECT id, actor_id, action, resource_type, resource_id,
                    status, ip_address, created_at
             FROM admin_audit_logs
             WHERE status IN ('failure', 'denied')
               AND created_at >= ?
             ORDER BY created_at DESC
             LIMIT 10`,
        )
        .bind(since)
        .all<SecurityOverviewEvent>();
    return rows.results ?? [];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Handle GET /admin/security/overview
 *
 * Returns aggregated security event metrics for the admin Security Overview
 * dashboard. Uses D1 admin_audit_logs for actual data when available.
 *
 * ZTA: caller must already be authenticated as admin (enforced by the
 * route permission registry — this handler does not re-check auth).
 */
export async function handleSecurityOverview(
    request: Request,
    env: { ADMIN_DB?: D1Database; ANALYTICS_ENGINE?: unknown },
): Promise<Response> {
    const url = new URL(request.url);
    const rawWindow = url.searchParams.get('window') ?? '24h';
    const window: TimeWindow = (VALID_WINDOWS as readonly string[]).includes(rawWindow) ? (rawWindow as TimeWindow) : '24h';

    const since = windowToIso(window);

    const analyticsEngineTrackedEvents = [
        'auth_failure',
        'rate_limit',
        'turnstile_rejection',
        'cors_rejection',
        'cf_access_denial',
        'size_limit',
    ];

    // If ADMIN_DB is not configured, return a structured stub so the
    // frontend can display a graceful placeholder.
    if (!env.ADMIN_DB) {
        const response: SecurityOverviewResponse = {
            success: true,
            timestamp: new Date().toISOString(),
            window,
            total_security_events: 0,
            by_status: { denied: 0, failure: 0 },
            by_action: [],
            by_resource_type: [],
            recent_events: [],
            analytics_engine_tracked_events: analyticsEngineTrackedEvents,
            analytics_engine_configured: Boolean(env.ANALYTICS_ENGINE),
        };
        return JsonResponse.success(response);
    }

    try {
        const [total, byStatus, byAction, byResourceType, recentEvents] = await Promise.all([
            getTotalSecurityEvents(env.ADMIN_DB, since),
            getByStatus(env.ADMIN_DB, since),
            getByAction(env.ADMIN_DB, since),
            getByResourceType(env.ADMIN_DB, since),
            getRecentEvents(env.ADMIN_DB, since),
        ]);

        const response: SecurityOverviewResponse = {
            success: true,
            timestamp: new Date().toISOString(),
            window,
            total_security_events: total,
            by_status: byStatus,
            by_action: byAction,
            by_resource_type: byResourceType,
            recent_events: recentEvents,
            analytics_engine_tracked_events: analyticsEngineTrackedEvents,
            analytics_engine_configured: Boolean(env.ANALYTICS_ENGINE),
        };

        return JsonResponse.success(response);
    } catch (err) {
        // deno-lint-ignore no-console
        console.error('[security-overview] query error:', err instanceof Error ? err.message : err);
        return JsonResponse.serverError('Failed to retrieve security overview');
    }
}
