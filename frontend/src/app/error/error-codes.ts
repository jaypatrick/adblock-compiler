/**
 * Application error codes and human-readable messages.
 *
 * ErrorCode is used throughout the app to classify failures:
 *   - NOT_FOUND:    route or resource does not exist (maps to /not-found)
 *   - UNAUTHORIZED: user is not authenticated
 *   - FORBIDDEN:    user is authenticated but lacks permission
 *   - SERVER_ERROR: 5xx from the Cloudflare Worker
 *   - NETWORK_ERROR: fetch timeout / offline
 *   - UNKNOWN:      catch-all for unclassified errors
 */

export enum ErrorCode {
    UNKNOWN = 'UNKNOWN',
    NOT_FOUND = 'NOT_FOUND',
    UNAUTHORIZED = 'UNAUTHORIZED',
    FORBIDDEN = 'FORBIDDEN',
    SERVER_ERROR = 'SERVER_ERROR',
    NETWORK_ERROR = 'NETWORK_ERROR',
}

/**
 * User-facing messages for each ErrorCode.
 * These are displayed in error UI components such as NotFoundComponent
 * and FatalErrorComponent.
 */
export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
    [ErrorCode.UNKNOWN]:       'An unexpected error occurred.',
    [ErrorCode.NOT_FOUND]:     "The page you're looking for doesn't exist.",
    [ErrorCode.UNAUTHORIZED]:  'You must be signed in to view this page.',
    [ErrorCode.FORBIDDEN]:     "You don't have permission to view this page.",
    [ErrorCode.SERVER_ERROR]:  'A server error occurred. Please try again later.',
    [ErrorCode.NETWORK_ERROR]: 'A network error occurred. Please check your connection.',
};

// ─── Extended error code registry ────────────────────────────────────────────

/**
 * Full definition for a named error code including severity, recoverability,
 * and optional suggested navigation action.
 */
export interface ErrorCodeDefinition {
    userMessage: string;
    adminMessage?: string;
    severity: 'info' | 'warning' | 'error' | 'fatal';
    recoverable: boolean;
    suggestedAction?: string;
    suggestedRoute?: string;
}

/**
 * Structured registry of named error codes.
 * Keys are used in `?error=<CODE>` URL params and Router state payloads.
 */
export const ERROR_CODES: Record<string, ErrorCodeDefinition> = {
    TOKEN_EXPIRED: {
        userMessage: 'Your session has expired. Please sign in again.',
        adminMessage: 'JWT/session token TTL exceeded.',
        severity: 'warning',
        recoverable: true,
        suggestedAction: 'Sign In',
        suggestedRoute: '/sign-in',
    },
    INVALID_CREDENTIALS: {
        userMessage: 'The email or password you entered is incorrect.',
        severity: 'error',
        recoverable: true,
        suggestedAction: 'Try Again',
        suggestedRoute: '/sign-in',
    },
    ACCOUNT_LOCKED: {
        userMessage: 'Your account has been temporarily locked. Please contact support.',
        adminMessage: 'Account flagged by sentinel: credential stuffing threshold exceeded.',
        severity: 'error',
        recoverable: false,
    },
    RATE_LIMITED: {
        userMessage: 'Too many requests. Please wait a moment before trying again.',
        severity: 'warning',
        recoverable: true,
    },
    FORBIDDEN: {
        userMessage: "You don't have permission to access that resource.",
        adminMessage: 'Route permission denied by ZTA middleware.',
        severity: 'error',
        recoverable: true,
        suggestedAction: 'Go Home',
        suggestedRoute: '/',
    },
    CORS_REJECTED: {
        userMessage: 'This request was blocked by our security policy.',
        adminMessage: 'Origin not in CORS allowlist.',
        severity: 'error',
        recoverable: false,
    },
    SERVICE_UNAVAILABLE: {
        userMessage: "Bloqr is temporarily unavailable. We're working on it.",
        severity: 'fatal',
        recoverable: false,
    },
    UNKNOWN: {
        userMessage: 'Something unexpected happened. Please try again.',
        severity: 'error',
        recoverable: true,
        suggestedAction: 'Go Home',
        suggestedRoute: '/',
    },
};

/**
 * Resolve a named error code to its definition.
 * Falls back to the UNKNOWN definition when the code is unrecognised.
 */
export function resolveErrorCode(code: string): ErrorCodeDefinition {
    return ERROR_CODES[code] ?? ERROR_CODES['UNKNOWN'];
}
