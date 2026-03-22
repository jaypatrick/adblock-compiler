/**
 * BetterAuthService — Angular service wrapping the Better Auth client.
 *
 * Communicates with Better Auth's server-side endpoints at `/api/auth/*`.
 * Uses cookies for session management (set automatically by Better Auth).
 * The bearer() plugin on the server also supports Authorization headers.
 *
 * SSR behavior: the constructor guards network calls with `isPlatformBrowser`.
 * On the server, `isLoaded` is set to `true` immediately with no session, and
 * other public methods are expected to be called only in a browser context.
 *
 * Signals: isLoaded, isSignedIn, user, isAdmin
 */

import { Injectable, signal, computed, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface BetterAuthUser {
    id: string;
    email: string;
    name: string | null;
    emailVerified: boolean;
    image: string | null;
    tier: string;
    role: string;
}

@Injectable({ providedIn: 'root' })
export class BetterAuthService {
    private readonly platformId = inject(PLATFORM_ID);
    private readonly _user = signal<BetterAuthUser | null>(null);
    private readonly _isLoaded = signal(false);
    private readonly _sessionToken = signal<string | null>(null);

    readonly user = this._user.asReadonly();
    readonly isLoaded = this._isLoaded.asReadonly();
    readonly isSignedIn = computed(() => this._user() !== null);
    readonly isAdmin = computed(() => this._user()?.role === 'admin');

    constructor() {
        if (!isPlatformBrowser(this.platformId)) {
            // SSR: mark as loaded immediately with no session.
            // Relative fetch() calls are not valid in Node.js, and there is no
            // browser cookie jar to check. The browser will re-run checkSession()
            // once Angular hydrates on the client.
            this._isLoaded.set(true);
            return;
        }
        // Check for existing session on init
        this.checkSession();
    }

    /** Fetch the current session from the server. */
    async checkSession(): Promise<void> {
        try {
            const res = await fetch('/api/auth/get-session', {
                credentials: 'include',
            });
            if (res.ok) {
                const data = await res.json();
                if (data?.user) {
                    this._user.set(data.user);
                    if (data.session?.token) {
                        this._sessionToken.set(data.session.token);
                    }
                }
            }
        } catch {
            // No session — user is not signed in
        } finally {
            this._isLoaded.set(true);
        }
    }

    /** Sign in with email and password. */
    async signIn(email: string, password: string): Promise<void> {
        const res = await fetch('/api/auth/sign-in/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, password }),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw { error: body };
        }

        const data = await res.json();
        if (data?.user) {
            this._user.set(data.user);
            if (data.token) {
                this._sessionToken.set(data.token);
            }
        }
    }

    /** Sign up with email, password, and optional name. */
    async signUp(email: string, password: string, name?: string): Promise<void> {
        const res = await fetch('/api/auth/sign-up/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, password, name: name ?? email.split('@')[0] }),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw { error: body };
        }

        const data = await res.json();
        if (data?.user) {
            this._user.set(data.user);
            if (data.token) {
                this._sessionToken.set(data.token);
            }
        }
    }

    /** Sign out and clear local state. */
    async signOut(): Promise<void> {
        try {
            await fetch('/api/auth/sign-out', {
                method: 'POST',
                credentials: 'include',
            });
        } catch {
            // Ignore sign-out request failures — local state is always cleared.
        } finally {
            this._user.set(null);
            this._sessionToken.set(null);
        }
    }

    /**
     * Get a bearer token for API calls.
     * Better Auth uses the bearer() plugin which provides the session token
     * in the `get-session` response (`session.token`). This token can be
     * sent as `Authorization: Bearer <token>` to authenticated Worker routes.
     *
     * Returns `null` only when the user is not signed in (anonymous requests
     * should proceed without an Authorization header).
     */
    async getToken(): Promise<string | null> {
        // Not signed in — no token needed
        if (!this.isSignedIn()) return null;

        // Return cached token if available
        if (this._sessionToken()) return this._sessionToken();

        // Token not cached yet (e.g., after SSR hydration) — re-fetch the session.
        // The get-session response includes session.token when the bearer() plugin
        // is configured on the server.
        try {
            const res = await fetch('/api/auth/get-session', {
                credentials: 'include',
            });
            if (res.ok) {
                const data = await res.json();
                if (data?.session?.token) {
                    this._sessionToken.set(data.session.token);
                    return data.session.token;
                }
            }
        } catch {
            // Silently ignore errors; fall back to cookie-based session auth without a bearer token.
        }

        // Signed in but unable to retrieve a bearer token from the session response.
        // The Worker will still authenticate via the session cookie (cookie-based
        // auth is supported by the Better Auth provider). This is not an error state
        // for cookie-first flows — no console output to keep logs clean.
        return null;
    }

    /**
     * Update the signed-in user's profile email.
     * Calls Better Auth's update-user endpoint.
     */
    async updateProfile(email: string): Promise<{ error?: string }> {
        try {
            const res = await fetch('/api/auth/update-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ email }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                return { error: body.message ?? 'Failed to update profile.' };
            }
            const data = await res.json() as { user?: BetterAuthUser };
            if (data?.user) {
                this._user.set(data.user);
            }
            return {};
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to update profile.' };
        }
    }

    /**
     * Change the signed-in user's password.
     * Calls Better Auth's change-password endpoint.
     */
    async changePassword(currentPassword: string, newPassword: string): Promise<{ error?: string }> {
        try {
            const res = await fetch('/api/auth/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                return { error: body.message ?? 'Failed to change password.' };
            }
            return {};
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to change password.' };
        }
    }
}
