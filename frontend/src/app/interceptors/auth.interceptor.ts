/**
 * Functional HTTP interceptor for Bearer token authentication.
 *
 * Provider-aware via AuthFacadeService — works with both Better Auth (primary)
 * and Clerk (deprecated legacy fallback).
 *
 * **Auth model:**
 * - Better Auth uses cookie-based session auth by default. The bearer() plugin
 *   on the server *also* accepts `Authorization: Bearer <token>` headers. This
 *   interceptor attaches the bearer token when available, giving the Worker two
 *   ways to authenticate the request (cookie OR header).
 * - Clerk uses JWT-based auth exclusively via `Authorization: Bearer <token>`.
 *
 * Skips public/health endpoints and `/api/auth/` paths to avoid circular
 * validation calls during the auth flow.
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
    '/api/sentry-config',
    '/api/deployments',
    '/api/metrics',
    // Better Auth endpoints — skip to avoid circular calls during auth flow
    '/api/auth/',
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
