/**
 * AuthFacadeService — strategy-pattern wrapper for authentication providers.
 *
 * Delegates to ClerkService when Clerk is configured and available,
 * or falls back to BetterAuthService when Clerk is not active.
 * All consumers (guards, interceptors, components) inject this facade
 * instead of the individual providers — switching auth systems requires
 * zero consumer changes.
 */

import { Injectable, computed, inject } from '@angular/core';
import { ClerkService } from './clerk.service';
import { BetterAuthService } from './better-auth.service';

@Injectable({ providedIn: 'root' })
export class AuthFacadeService {
    private readonly clerk = inject(ClerkService);
    private readonly betterAuth = inject(BetterAuthService);

    /** True when Clerk SDK is configured and available; false → Better Auth is active. */
    readonly useClerk = computed(() => this.clerk.isAvailable());

    /** True when Better Auth is the active provider. */
    readonly useBetterAuth = computed(() => !this.clerk.isAvailable());

    /**
     * True once the active auth provider has finished loading.
     * Clerk resolves first and determines which provider is active;
     * if Better Auth is active we then wait for its session check.
     */
    readonly isLoaded = computed(() => {
        if (!this.clerk.isLoaded()) return false;
        if (this.clerk.isAvailable()) return true;
        return this.betterAuth.isLoaded();
    });

    readonly isSignedIn = computed(() =>
        this.clerk.isAvailable() ? this.clerk.isSignedIn() : this.betterAuth.isSignedIn(),
    );

    readonly isAdmin = computed(() => {
        if (this.clerk.isAvailable()) {
            const meta = this.clerk.user()?.publicMetadata as Record<string, unknown> | undefined;
            return meta?.['role'] === 'admin';
        }
        return this.betterAuth.isAdmin();
    });

    /** Display-friendly identifier for the signed-in user. */
    readonly userIdentifier = computed<string | null>(() => {
        if (this.clerk.isAvailable()) {
            const u = this.clerk.user();
            return u?.primaryEmailAddress?.emailAddress ?? u?.id ?? null;
        }
        return this.betterAuth.user()?.email ?? null;
    });

    async getToken(): Promise<string | null> {
        return this.clerk.isAvailable() ? this.clerk.getToken() : this.betterAuth.getToken();
    }

    async signOut(): Promise<void> {
        if (this.clerk.isAvailable()) {
            await this.clerk.signOut();
        } else {
            await this.betterAuth.signOut();
        }
    }

    /**
     * Better Auth: sign in with email + password.
     * Returns `{ error }` on failure. No-op when Clerk is active (Clerk uses its own UI).
     */
    async login(identifier: string, password: string): Promise<{ error?: string }> {
        if (this.clerk.isAvailable()) return {};
        try {
            await this.betterAuth.signIn(identifier, password);
            return {};
        } catch (err) {
            const httpBody = (err as { error?: { message?: string } })?.error;
            const msg = httpBody?.message ?? (err instanceof Error ? err.message : 'Sign in failed. Please check your credentials.');
            return { error: msg };
        }
    }

    /**
     * Better Auth: create account with email + password.
     * Returns `{ error }` on failure. No-op when Clerk is active.
     */
    async signup(identifier: string, password: string): Promise<{ error?: string }> {
        if (this.clerk.isAvailable()) return {};
        try {
            await this.betterAuth.signUp(identifier, password);
            return {};
        } catch (err) {
            const httpBody = (err as { error?: { message?: string } })?.error;
            const msg = httpBody?.message ?? (err instanceof Error ? err.message : 'Sign up failed. Please try again.');
            return { error: msg };
        }
    }

    /**
     * Better Auth: update the signed-in user's profile email.
     * No-op when Clerk is active (Clerk users manage their profile through Clerk's hosted UI).
     */
    async updateProfile(email: string): Promise<{ error?: string }> {
        if (this.clerk.isAvailable()) return {};
        return this.betterAuth.updateProfile(email);
    }

    /**
     * Better Auth: change the signed-in user's password.
     * No-op when Clerk is active.
     */
    async changePassword(currentPassword: string, newPassword: string): Promise<{ error?: string }> {
        if (this.clerk.isAvailable()) return {};
        return this.betterAuth.changePassword(currentPassword, newPassword);
    }
}
