/**
 * GlobalErrorHandler — Custom ErrorHandler with signal-based state.
 *
 * Replaces Angular's default ErrorHandler to:
 * 1. Store the last error in a signal (consumed by ErrorBoundaryComponent)
 * 2. Log errors via LogService with structured context
 * 3. Report errors to the Cloudflare Worker via LogService.reportError()
 *
 * Angular 21 patterns: ErrorHandler override, signal(), inject()
 */

import { ErrorHandler, Injectable, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { LogService } from '../services/log.service';
import { Sentry } from '../sentry';
import { ErrorCode, ERROR_MESSAGES } from './error-codes';

export interface AppError {
    readonly message: string;
    readonly stack?: string;
    readonly timestamp: Date;
    readonly context?: string;
    /** When true the error handler navigates to /fatal-error instead of showing the inline banner. */
    readonly isFatal?: boolean;
    /** Structured error code from ErrorCode enum or ERROR_CODES registry (e.g. 'TOKEN_EXPIRED'). */
    readonly code?: string;
    /** Triage severity — used by error UI to choose colour/icon. */
    readonly severity?: 'info' | 'warning' | 'error' | 'fatal';
    /** Override user-facing copy; falls back to ERROR_CODES[code].userMessage. */
    readonly userMessage?: string;
    /** Correlation ID from the backend response (X-Request-Id / CF-Ray). */
    readonly requestId?: string;
}

@Injectable()
export class GlobalErrorHandler extends ErrorHandler {
    private readonly log = inject(LogService);
    private readonly router = inject(Router);

    /** The most recent unhandled error */
    readonly lastError = signal<AppError | null>(null);

    /** Whether there's an active error to display */
    readonly hasError = computed(() => this.lastError() !== null);

    /** Error history (last 10 errors) */
    private readonly _errorHistory = signal<AppError[]>([]);
    readonly errorHistory = this._errorHistory.asReadonly();

    override handleError(error: unknown): void {
        const appError = this.normalizeError(error);
        this.lastError.set(appError);

        // Navigate to /fatal-error for errors that cannot be gracefully recovered.
        if (appError.isFatal) {
            void this.router.navigate(['/fatal-error'], { state: { error: appError } });
        }

        // Maintain history (last 10)
        this._errorHistory.update(history => {
            const updated = [appError, ...history];
            return updated.slice(0, 10);
        });

        // Log via LogService (structured console + buffer)
        this.log.error(appError.message, 'unhandled-error', {
            stack: appError.stack,
            context: appError.context,
            timestamp: appError.timestamp.toISOString(),
        });

        // Report to Cloudflare Worker backend
        this.log.reportError({
            message: appError.message,
            stack: appError.stack,
            context: appError.context,
        });

        // Forward to Sentry if initialised (non-fatal)
        try {
            if (Sentry.getClient() !== undefined) {
                Sentry.captureException(error);
            }
        } catch {
            // Non-fatal: Sentry capture failure must not disrupt the error handler
        }
    }

    /** Clear the current error (e.g. user clicks "Dismiss") */
    clearError(): void {
        this.lastError.set(null);
    }

    /** Clear all error history */
    clearHistory(): void {
        this._errorHistory.set([]);
        this.lastError.set(null);
    }

    private normalizeError(error: unknown): AppError {
        if (error instanceof Error) {
            const appErr = error as Error & {
                ngDebugContext?: string;
                code?: string;
                severity?: AppError['severity'];
                userMessage?: string;
                requestId?: string;
                isFatal?: boolean;
            };
            return {
                message: appErr.message,
                stack: appErr.stack,
                timestamp: new Date(),
                context: appErr.ngDebugContext,
                code: appErr.code,
                severity: appErr.severity,
                userMessage: appErr.userMessage,
                requestId: appErr.requestId,
                isFatal: appErr.isFatal,
            };
        }

        if (typeof error === 'string') {
            return { message: error, timestamp: new Date() };
        }

        return {
            message: ERROR_MESSAGES[ErrorCode.UNKNOWN],
            timestamp: new Date(),
            context: JSON.stringify(error),
        };
    }
}
