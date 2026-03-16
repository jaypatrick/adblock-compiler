/**
 * Functional route guard for admin pages.
 *
 * Provider-aware via AuthFacadeService:
 *   - Waits for the active auth provider to finish loading
 *   - Unauthenticated → redirects to /sign-in with returnUrl
 *   - Authenticated but not admin → redirects to /
 *   - Authenticated admin → allows navigation
 */

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthFacadeService } from '../services/auth-facade.service';

export const adminGuard: CanActivateFn = async (_route, state) => {
    const auth = inject(AuthFacadeService);
    const router = inject(Router);

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
