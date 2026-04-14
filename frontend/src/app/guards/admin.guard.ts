/**
 * Functional route guard for admin pages.
 *
 * Provider-aware via AuthFacadeService:
 *   - Waits for the active auth provider to finish loading
 *   - Unauthenticated → redirects to /sign-in with returnUrl
 *   - Authenticated but not admin → redirects to /
 *   - Authenticated admin → allows navigation
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

export const adminGuard: CanActivateFn = async (_route, state) => {
    // Capture all inject() calls before the first await (injection context
    // is only valid synchronously at the start of the guard call).
    const platformId = inject(PLATFORM_ID);
    const auth = inject(AuthFacadeService);
    const router = inject(Router);

    // On the server (SSR or build-time prerender), Better Auth never initialises,
    // so waiting for auth would stall for the full 5 s timeout. Return an
    // immediate redirect; the client will re-evaluate the guard after hydration.
    if (!isPlatformBrowser(platformId)) {
        return router.createUrlTree(['/sign-in'], {
            queryParams: { returnUrl: state.url },
        });
    }

    await waitForAuth(auth, 5_000);

    if (!auth.isSignedIn()) {
        return router.createUrlTree(['/sign-in'], {
            queryParams: { returnUrl: state.url },
        });
    }

    if (!auth.isAdmin()) {
        return router.createUrlTree(['/']);
    }

    return true;
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
