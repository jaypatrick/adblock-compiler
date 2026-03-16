/**
 * Functional route guard for authenticated routes.
 *
 * Provider-aware via AuthFacadeService:
 *   - Waits for the active auth provider to finish loading (Clerk or local JWT)
 *   - If signed in → allows navigation
 *   - If not signed in → redirects to /sign-in with a returnUrl query param
 */

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthFacadeService } from '../services/auth-facade.service';

export const authGuard: CanActivateFn = async (_route, state) => {
    const auth = inject(AuthFacadeService);
    const router = inject(Router);

    await waitForAuth(auth, 10_000);

    if (auth.isSignedIn()) return true;

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
