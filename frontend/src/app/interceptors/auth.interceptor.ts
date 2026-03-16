/**
 * Functional HTTP interceptor for JWT authentication.
 *
 * Provider-aware via AuthFacadeService — works with both Clerk and local JWT.
 * Attaches `Authorization: Bearer <token>` to outgoing API requests when
 * the user is signed in. Skips public/health endpoints and local auth paths
 * (to avoid circular validation calls).
 */

import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap, catchError, throwError } from 'rxjs';
import { AuthFacadeService } from '../services/auth-facade.service';

/** Paths that never need a Bearer token. */
const PUBLIC_PATHS = [
    '/api/version',
    '/api/health',
    '/api/turnstile-config',
    '/api/clerk-config',
    '/api/deployments',
    '/api/metrics',
    // Local auth endpoints — skip to avoid circular calls during token validation
    '/api/auth/login',
    '/api/auth/signup',
    '/api/auth/me',
];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
    const auth = inject(AuthFacadeService);

    if (!auth.isSignedIn()) return next(req);

    const isPublic = PUBLIC_PATHS.some((p) => req.url.includes(p));
    if (isPublic) return next(req);

    return from(auth.getToken()).pipe(
        catchError((err) => {
            console.warn('[authInterceptor] Failed to get session token:', err instanceof Error ? err.message : String(err));
            return throwError(() => new Error('Session token refresh failed — please sign in again'));
        }),
        switchMap((token) => {
            if (token) {
                const authed = req.clone({
                    setHeaders: { Authorization: `Bearer ${token}` },
                });
                return next(authed);
            }
            return next(req);
        }),
    );
};
