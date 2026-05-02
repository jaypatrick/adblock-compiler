/// <reference types="@cloudflare/workers-types" />

/**
 * Error event logger — persists unhandled Worker errors to D1.
 *
 * Written to by `app.onError()` in `hono-app.ts` via
 * `c.executionCtx.waitUntil(logErrorToD1(...))`.  Non-blocking by design:
 * the Worker sends the HTTP error response immediately and the D1 insert
 * runs in the background.
 *
 * ## Schema
 * The target table is `error_events` created by migration
 * `migrations/0012_error_events.sql`.
 *
 * ## ZTA checklist
 * - [x] All fields Zod-free (already validated by caller)
 * - [x] D1 insert parameterized (.prepare().bind())
 * - [x] Errors caught and logged to console (never re-thrown)
 */

/** Source of the error event. */
export type ErrorSource = 'worker' | 'frontend';

/** Severity of the error event. */
export type ErrorSeverity = 'info' | 'warning' | 'error' | 'fatal';

/** Structured payload for an error event. */
export interface ErrorEvent {
    /** Human-readable error message. */
    readonly message: string;
    /** Stack trace, if available. */
    readonly stack?: string;
    /** Free-form JSON-serialisable context. */
    readonly context?: unknown;
    /** URL of the request or page that triggered the error. */
    readonly url?: string;
    /** User-Agent header value (Worker errors) or navigator.userAgent (frontend). */
    readonly userAgent?: string;
    /** Session ID from auth context or frontend session storage. */
    readonly sessionId?: string;
    /** Error source — 'worker' | 'frontend'. Defaults to 'worker'. */
    readonly source?: ErrorSource;
    /** Error severity level. */
    readonly severity?: ErrorSeverity;
}

/**
 * Insert an error event into the `error_events` D1 table.
 *
 * Safe to call from `executionCtx.waitUntil()` — all errors are caught
 * and logged to console so they never propagate.
 *
 * @param db    The D1 database binding (`c.env.DB`).
 * @param event Structured error payload.
 */
export async function logErrorToD1(db: D1Database, event: ErrorEvent): Promise<void> {
    try {
        // Only JSON.stringify context when it is not already a string to avoid
        // double-encoding (e.g. "\"route\"" instead of "route").
        const contextStr = event.context != null ? (typeof event.context === 'string' ? event.context : JSON.stringify(event.context)) : null;

        await db.prepare(
            `INSERT INTO error_events
               (id, source, message, stack, context, url, user_agent, session_id, severity)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
            .bind(
                crypto.randomUUID(),
                event.source ?? 'worker',
                event.message,
                event.stack ?? null,
                contextStr,
                event.url ?? null,
                event.userAgent ?? null,
                event.sessionId ?? null,
                event.severity ?? null,
            )
            .run();
    } catch (err) {
        // Non-fatal: D1 insert failure must not disrupt the error response.
        // deno-lint-ignore no-console
        console.warn(
            '[error-logger] Failed to persist error event to D1:',
            err instanceof Error ? err.message : String(err),
        );
    }
}
