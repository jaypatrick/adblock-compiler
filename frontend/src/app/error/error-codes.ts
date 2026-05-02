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
