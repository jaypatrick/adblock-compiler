/**
 * BetterAuthService — Angular service wrapping the Better Auth client.
 *
 * Communicates with Better Auth's server-side endpoints at `/api/auth/*`.
 * Uses cookies for session management (set automatically by Better Auth).
 * The bearer() plugin on the server also supports Authorization headers.
 *
 * Signals: isLoaded, isSignedIn, user, isAdmin
 */

import { Injectable, signal, computed } from '@angular/core';

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
    private readonly _user = signal<BetterAuthUser | null>(null);
    private readonly _isLoaded = signal(false);
    private readonly _sessionToken = signal<string | null>(null);

    readonly user = this._user.asReadonly();
    readonly isLoaded = this._isLoaded.asReadonly();
    readonly isSignedIn = computed(() => this._user() !== null);
    readonly isAdmin = computed(() => this._user()?.role === 'admin');

    constructor() {
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
        } finally {
            this._user.set(null);
            this._sessionToken.set(null);
        }
    }

    /**
     * Get a bearer token for API calls.
     * Better Auth uses cookies by default, but the bearer plugin also
     * provides tokens that can be used in Authorization headers.
     */
    async getToken(): Promise<string | null> {
        // If we have a cached token, return it
        if (this._sessionToken()) return this._sessionToken();

        // Try to get session which may include the token
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
            // Fall through
        }

        // Cookies are sent automatically, return null to signal cookie-based auth
        return null;
    }
}
