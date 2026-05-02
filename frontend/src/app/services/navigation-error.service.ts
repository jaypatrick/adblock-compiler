/**
 * NavigationErrorService — passes structured error context between routes via
 * Angular Router state.
 *
 * Problem: guards and resolvers sometimes redirect to another route (e.g.
 * /sign-in) and need to surface a user-facing error message on the target
 * page. Using URL query params leaks error details into the address bar and
 * browser history. Using FlashService (signal-based) loses state across SSR
 * hydration boundaries.
 *
 * Solution: attach the error to the Router navigation extras `state` object.
 * The target component reads the state from `router.lastSuccessfulNavigation`
 * or the `NavigationStart` event. State is ephemeral — it is never persisted
 * and is cleared on the next navigation.
 *
 * Angular 21 patterns: inject(), signal(), NavigationExtras
 */

import { Injectable, inject, signal } from '@angular/core';
import { Router, NavigationExtras } from '@angular/router';
import { resolveErrorCode, ErrorCodeDefinition } from '../error/error-codes';

export interface NavigationError {
    /** Named error code key from the ERROR_CODES registry (e.g. 'TOKEN_EXPIRED'). */
    readonly code: string;
    /** Resolved definition for convenient template access. */
    readonly definition: ErrorCodeDefinition;
    /** Optional override for the user-facing message. */
    readonly message?: string;
    /** Timestamp of when this error was raised. */
    readonly timestamp: Date;
}

@Injectable({ providedIn: 'root' })
export class NavigationErrorService {
    private readonly router = inject(Router);

    /**
     * Signal that holds the most recent navigation error surfaced on the
     * current page. Components read this to display contextual banners.
     * Cleared on the next call to navigateWithError() or manually via clear().
     */
    readonly currentError = signal<NavigationError | null>(null);

    /**
     * Navigate to a route and attach a structured error payload in Router state.
     *
     * The target component should call `readError()` in its constructor/ngOnInit
     * to retrieve the error. The error is NEVER written to the URL.
     *
     * @param commands   Route command array (e.g. `['/sign-in']`)
     * @param code       Key in the ERROR_CODES registry (e.g. `'TOKEN_EXPIRED'`)
     * @param extras     Standard NavigationExtras (queryParams, replaceUrl, …)
     * @returns Promise that resolves to the Router.navigate() result
     */
    navigateWithError(
        commands: unknown[],
        code: string,
        extras?: NavigationExtras,
    ): Promise<boolean> {
        const definition = resolveErrorCode(code);
        const navError: NavigationError = {
            code,
            definition,
            timestamp: new Date(),
        };

        this.currentError.set(navError);

        return this.router.navigate(commands, {
            ...extras,
            state: {
                ...(extras?.state as Record<string, unknown> | undefined),
                navError,
            },
        });
    }

    /**
     * Read a NavigationError from the current Router navigation state.
     *
     * Call this in component constructor/init to hydrate currentError from
     * the navigation state set by navigateWithError(). This is necessary
     * when the component is first rendered (e.g. after a redirect) because
     * the signal is not transferred across page loads or navigation cycles.
     *
     * Returns the NavigationError if present in Router state, otherwise null.
     */
    readError(): NavigationError | null {
        const nav = this.router.lastSuccessfulNavigation?.();
        const state = nav?.extras?.state as Record<string, unknown> | undefined;
        const navError = state?.['navError'] as NavigationError | undefined;

        if (navError) {
            // Rehydrate the signal so components that read currentError() work
            this.currentError.set(navError);
            return navError;
        }

        return this.currentError();
    }

    /** Manually clear the current navigation error. */
    clear(): void {
        this.currentError.set(null);
    }
}
