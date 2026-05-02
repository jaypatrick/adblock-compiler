/**
 * Functional route guard for authenticated routes.
 *
 * Provider-aware via AuthFacadeService:
 * Waits for the active auth provider to finish loading
 *   - If signed in → allows navigation
 *   - If not signed in → redirects to /sign-in with a returnUrl query param
 *
 * SSR/prerender: auth is browser-only and never initialises on the server,
 * so waitForAuth() would stall for the full timeout. On a non-browser platform
 * we skip the polling entirely and return an immediate redirect so the client
 * router re-evaluates with real auth state after hydration.
 */

import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CanActivateFn, Router } from '@angular/router';
import { AuthFacadeService } from '../services/auth-facade.service';
import { FlashService } from '../services/flash.service';
import { ErrorCode, ERROR_MESSAGES } from '../error/error-codes';

export const authGuard: CanActivateFn = async (_route, state) => {
    // Capture all inject() calls before the first await (injection context
    // is only valid synchronously at the start of the guard call).
    const platformId = inject(PLATFORM_ID);
    const auth = inject(AuthFacadeService);
    const router = inject(Router);
    const flashService = inject(FlashService);

    // On the server (SSR or build-time prerender), auth never initialises,
    // so waiting would stall for the full 10 s timeout. Return an
    // immediate redirect; the client will re-evaluate the guard after hydration.
    // Do NOT set a flash message here — signal state is not transferred from
    // server to client, so it would be silently lost. The client-side guard
    // execution after hydration will set the flash if auth fails.
    if (!isPlatformBrowser(platformId)) {
        return router.createUrlTree(['/sign-in'], {
            queryParams: { returnUrl: state.url },
        });
    }

    await waitForAuth(auth, 10_000);

    if (auth.isSignedIn()) return true;

    flashService.set(ERROR_MESSAGES[ErrorCode.UNAUTHORIZED], 'warn');
    return router.createUrlTree(['/sign-in'], {
        queryParams: { returnUrl: state.url },
    });
};

function waitForAuth(auth: AuthFacadeService, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
        if (auth.isLoaded()) {
            resolve();
            return;
        }
        const start = Date.now();
        const interval = setInterval(() => {
            if (auth.isLoaded() || Date.now() - start > timeoutMs) {
                clearInterval(interval);
                resolve();
            }
        }, 50);
    });
}
