/**
 * AuthFacadeService — strategy-pattern wrapper for authentication providers.
 *
 * Delegates to ClerkService when Clerk is configured and available,
 * or falls back to LocalAuthService when Clerk is not active.
 * All consumers (guards, interceptors, components) inject this facade
 * instead of the individual providers — switching auth systems requires
 * zero consumer changes.
 */

import { Injectable, computed, inject } from '@angular/core';
import { ClerkService } from './clerk.service';
import { LocalAuthService } from './local-auth.service';

@Injectable({ providedIn: 'root' })
export class AuthFacadeService {
    private readonly clerk = inject(ClerkService);
    private readonly local = inject(LocalAuthService);

    /** True when Clerk SDK is configured and available; false → local auth is active. */
    readonly useClerk = computed(() => this.clerk.isAvailable());

    /**
     * True once the active auth provider has finished loading.
     * Clerk resolves first and determines which provider is active;
     * if local auth is active we then wait for its /auth/me validation.
     */
    readonly isLoaded = computed(() => {
        if (!this.clerk.isLoaded()) return false;
        if (this.clerk.isAvailable()) return true;
        return this.local.isLoaded();
    });

    readonly isSignedIn = computed(() =>
        this.clerk.isAvailable() ? this.clerk.isSignedIn() : this.local.isSignedIn(),
    );

    readonly isAdmin = computed(() => {
        if (this.clerk.isAvailable()) {
            const meta = this.clerk.user()?.publicMetadata as Record<string, unknown> | undefined;
            return meta?.['role'] === 'admin';
        }
        return this.local.isAdmin();
    });

    /** Display-friendly identifier for the signed-in user. */
    readonly userIdentifier = computed<string | null>(() => {
        if (this.clerk.isAvailable()) {
            const u = this.clerk.user();
            return u?.primaryEmailAddress?.emailAddress ?? u?.id ?? null;
        }
        return this.local.user()?.identifier ?? null;
    });

    async getToken(): Promise<string | null> {
        return this.clerk.isAvailable() ? this.clerk.getToken() : this.local.getToken();
    }

    async signOut(): Promise<void> {
        if (this.clerk.isAvailable()) {
            await this.clerk.signOut();
        } else {
            this.local.signOut();
        }
    }

    /**
     * Local-auth only: sign in with identifier + password.
     * Returns `{ error }` on failure. No-op when Clerk is active (Clerk uses its own UI).
     */
    async login(identifier: string, password: string): Promise<{ error?: string }> {
        if (this.clerk.isAvailable()) return {};
        try {
            await this.local.login(identifier, password);
            return {};
        } catch (err) {
            const httpBody = (err as { error?: { error?: string } })?.error;
            const msg = httpBody?.error ?? (err instanceof Error ? err.message : 'Sign in failed. Please check your credentials.');
            return { error: msg };
        }
    }

    /**
     * Local-auth only: create account with identifier + password.
     * Returns `{ error }` on failure. No-op when Clerk is active.
     */
    async signup(identifier: string, password: string): Promise<{ error?: string }> {
        if (this.clerk.isAvailable()) return {};
        try {
            await this.local.signup(identifier, password);
            return {};
        } catch (err) {
            const httpBody = (err as { error?: { error?: string } })?.error;
            const msg = httpBody?.error ?? (err instanceof Error ? err.message : 'Sign up failed. Please try again.');
            return { error: msg };
        }
    }
}
