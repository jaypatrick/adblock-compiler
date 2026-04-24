/**
 * ProblemDetailsService — RFC 9457 Problem Details parser for the Angular frontend.
 *
 * RFC 9457 (https://www.rfc-editor.org/rfc/rfc9457) defines a standardised
 * `application/problem+json` media type for machine-readable HTTP error bodies.
 * The Worker API emits these for every error response (400, 401, 403, 404,
 * 413, 429, 500, 503).
 *
 * This service:
 *   1. Detects whether an HTTP response (from `fetch` or Angular's `HttpClient`)
 *      carries `application/problem+json`.
 *   2. Parses the body into a typed `ProblemDetails` object.
 *   3. Extracts a human-readable message string suitable for toast/overlay display.
 *   4. Provides a static helper for non-injected contexts (e.g. interceptors).
 *
 * ## Backward compatibility
 *
 * The Worker previously returned `{ success: false, error: "..." }` envelopes.
 * `extractMessage()` falls back to the old `error` field when `detail` is absent
 * so callers do not break during the migration period.
 *
 * ## Adblocker overlay integration
 *
 * When a response has `type` equal to `PROBLEM_TYPES.adblockDetected` or
 * `PROBLEM_TYPES.turnstileRejection`, the detail message should be surfaced as a
 * prominent overlay or banner (not just a toast) to guide the user to whitelist
 * the site.  The `isAdblockProblem()` helper signals this to the component layer.
 *
 * ## Usage
 *
 * ```typescript
 * // In a service that uses raw fetch():
 * const svc = inject(ProblemDetailsService);
 * const msg = await svc.extractMessage(res);
 *
 * // In an HttpClient error handler:
 * if (ProblemDetailsService.isFromHeader(error.headers)) {
 *   const problem = error.error as ProblemDetails;
 *   const msg = ProblemDetailsService.messageFromBody(problem);
 * }
 * ```
 *
 * @see {@link https://www.rfc-editor.org/rfc/rfc9457} RFC 9457
 */

import { Injectable } from '@angular/core';
import type { HttpHeaders } from '@angular/common/http';
import { z } from 'zod';

// ── Problem type URIs — must match worker/utils/problem-details.ts ─────────────

const PROBLEM_TYPE_BASE = 'https://api.bloqr.dev/probs';

/** Subset of well-known problem type URIs used for client-side branching. */
export const CLIENT_PROBLEM_TYPES = {
    rateLimited: `${PROBLEM_TYPE_BASE}/rate-limited`,
    unauthorized: `${PROBLEM_TYPE_BASE}/unauthorized`,
    forbidden: `${PROBLEM_TYPE_BASE}/forbidden`,
    notFound: `${PROBLEM_TYPE_BASE}/not-found`,
    badRequest: `${PROBLEM_TYPE_BASE}/bad-request`,
    internalServerError: `${PROBLEM_TYPE_BASE}/internal-server-error`,
    serviceUnavailable: `${PROBLEM_TYPE_BASE}/service-unavailable`,
    payloadTooLarge: `${PROBLEM_TYPE_BASE}/payload-too-large`,
    turnstileRejection: `${PROBLEM_TYPE_BASE}/turnstile-rejection`,
    adblockDetected: `${PROBLEM_TYPE_BASE}/adblock-detected`,
} as const satisfies Record<string, string>;

// ── Content-Type sentinel ─────────────────────────────────────────────────────

/** Media type that signals an RFC 9457 response body. */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

// ── Zod schema ────────────────────────────────────────────────────────────────

/**
 * Zod schema for RFC 9457 Problem Details.
 * All fields except `type`, `title`, and `status` are optional.
 * Extension members are captured by `passthrough()`.
 */
export const ProblemDetailsSchema = z
    .object({
        type: z.string(),
        title: z.string(),
        status: z.number().int().min(100).max(599),
        detail: z.string().optional(),
        instance: z.string().optional(),
        // Well-known extension used by rateLimited
        retryAfter: z.number().optional(),
        // Extension used by internalServerError
        requestId: z.string().optional(),
    })
    .passthrough();

/** Validated RFC 9457 Problem Details object. */
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class ProblemDetailsService {
    // ── Static helpers (usable without injection) ──────────────────────────────

    /**
     * Returns `true` when a `Content-Type` string indicates RFC 9457.
     * Accepts both bare `application/problem+json` and values with a `;charset=...` suffix.
     */
    static isProblemContentType(contentType: string | null): boolean {
        if (!contentType) return false;
        return contentType.split(';')[0].trim().toLowerCase() === PROBLEM_CONTENT_TYPE;
    }

    /**
     * Returns `true` when an `HttpHeaders` object signals RFC 9457 content.
     * Convenient for use in Angular's `HttpClient` error handlers.
     */
    static isFromHeader(headers: HttpHeaders | null): boolean {
        if (!headers) return false;
        return ProblemDetailsService.isProblemContentType(headers.get('Content-Type'));
    }

    /**
     * Returns `true` when a `Headers` object (from `fetch`) signals RFC 9457 content.
     */
    static isFromFetchHeaders(headers: Headers): boolean {
        return ProblemDetailsService.isProblemContentType(headers.get('Content-Type'));
    }

    /**
     * Parse a raw JSON value as a `ProblemDetails` object using Zod.
     * Returns `null` if the value does not conform to the RFC 9457 schema.
     */
    static parse(raw: unknown): ProblemDetails | null {
        const result = ProblemDetailsSchema.safeParse(raw);
        return result.success ? result.data : null;
    }

    /**
     * Extract a human-readable message string from a `ProblemDetails` object.
     *
     * Priority order:
     *   1. `detail` (RFC 9457 — occurrence-specific explanation)
     *   2. `title` (RFC 9457 — problem-type summary)
     *   3. Fallback string
     */
    static messageFromBody(problem: ProblemDetails): string {
        return problem.detail ?? problem.title ?? 'An unexpected error occurred.';
    }

    /**
     * Returns `true` when the problem type signals adblocker interference or a
     * Turnstile rejection — both cases where the user should see a prominent
     * overlay, not just a toast.
     */
    static isAdblockProblem(problem: ProblemDetails): boolean {
        return (
            problem.type === CLIENT_PROBLEM_TYPES.adblockDetected ||
            problem.type === CLIENT_PROBLEM_TYPES.turnstileRejection
        );
    }

    // ── Instance methods ───────────────────────────────────────────────────────

    /**
     * Read the error message from a non-ok `fetch` Response.
     *
     * - If the response carries `application/problem+json`, parse it as RFC 9457
     *   and return `detail` (falling back to `title`).
     * - Otherwise fall back to the legacy `{ error: string }` envelope, then
     *   to `res.statusText`.
     *
     * The response body is consumed by this call; do not attempt to read it again.
     */
    async extractMessage(res: Response): Promise<string> {
        const isProblem = ProblemDetailsService.isFromFetchHeaders(res.headers);
        try {
            const raw: unknown = await res.json();
            if (isProblem) {
                const problem = ProblemDetailsService.parse(raw);
                if (problem) {
                    return ProblemDetailsService.messageFromBody(problem);
                }
            }
            // Legacy `{ error?: string }` envelope
            if (raw && typeof raw === 'object' && 'error' in raw) {
                const legacy = raw as { error?: unknown };
                if (typeof legacy.error === 'string') {
                    return legacy.error;
                }
            }
        } catch {
            // Body unreadable — fall through to statusText
        }
        return res.statusText || 'Unknown error';
    }
}
