/**
 * AuthFacadeService — strategy-pattern wrapper for authentication providers.
 *
 * **Better Auth is the primary auth provider.** Clerk is retained only as a
 * deprecated legacy fallback for users who have existing Clerk sessions.
 * All new sign-ins and sign-ups go through Better Auth.
 *
 * Provider resolution order:
 *   1. Better Auth session active → use Better Auth
 *   2. Clerk SDK available + Clerk session active → use Clerk (legacy)
 *   3. No session → Better Auth forms shown (primary for new users)
 *
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

    /**
     * Determines the active provider based on session state:
     *   1. Better Auth has an active session → 'better-auth' (primary)
     *   2. Clerk is available and has an active session → 'clerk' (legacy fallback)
     *   3. No session from either provider → null
     */
    readonly activeProvider = computed<'better-auth' | 'clerk' | null>(() => {
        if (this.betterAuth.isSignedIn()) return 'better-auth';
        if (this.clerk.isAvailable() && this.clerk.isSignedIn()) return 'clerk';
        return null;
    });

    /**
     * @deprecated Clerk is a legacy auth provider. This returns true only for
     * users with active Clerk sessions. New sign-ins always go through Better Auth.
     * Will be removed when Clerk support is fully dropped.
     */
    readonly useClerk = computed(() => this.activeProvider() === 'clerk');

    /**
     * True when Better Auth is the active provider (primary) or no provider
     * has a session (new users will sign in via Better Auth forms).
     */
    readonly useBetterAuth = computed(() => this.activeProvider() !== 'clerk');

    /**
     * True once auth state is fully determined. Loading order:
     *   1. Wait for Better Auth to finish its session check (primary provider).
     *   2. If BA has a session → immediately loaded (skip Clerk wait).
     *   3. Otherwise wait for Clerk to finish loading (legacy fallback check).
     *
     * This ensures the UI never flashes the wrong auth state.
     */
    readonly isLoaded = computed(() => {
        if (!this.betterAuth.isLoaded()) return false;      // Wait for BA (primary)
        if (this.betterAuth.isSignedIn()) return true;      // BA session found — done
        return this.clerk.isLoaded();                       // Fall through to Clerk
    });

    readonly isSignedIn = computed(() =>
        this.betterAuth.isSignedIn() || (this.clerk.isAvailable() && this.clerk.isSignedIn()),
    );

    readonly isAdmin = computed(() => {
        if (this.betterAuth.isSignedIn()) return this.betterAuth.isAdmin();
        if (this.clerk.isAvailable() && this.clerk.isSignedIn()) {
            const meta = this.clerk.user()?.publicMetadata as Record<string, unknown> | undefined;
            return meta?.['role'] === 'admin';
        }
        return false;
    });

    /** Display-friendly identifier for the signed-in user. */
    readonly userIdentifier = computed<string | null>(() => {
        if (this.betterAuth.isSignedIn()) return this.betterAuth.user()?.email ?? null;
        if (this.clerk.isAvailable() && this.clerk.isSignedIn()) {
            const u = this.clerk.user();
            return u?.primaryEmailAddress?.emailAddress ?? u?.id ?? null;
        }
        return null;
    });

    async getToken(): Promise<string | null> {
        if (this.betterAuth.isSignedIn()) return this.betterAuth.getToken();
        if (this.clerk.isAvailable() && this.clerk.isSignedIn()) return this.clerk.getToken();
        return null;
    }

    async signOut(): Promise<void> {
        // Sign out of whichever provider has an active session.
        // Both checks are intentional — a user could theoretically have sessions in both.
        if (this.betterAuth.isSignedIn()) await this.betterAuth.signOut();
        if (this.clerk.isAvailable() && this.clerk.isSignedIn()) await this.clerk.signOut();
    }

    /**
     * Sign in with email + password via Better Auth (primary provider).
     * Returns `{ error }` on failure.
     */
    async login(identifier: string, password: string): Promise<{ error?: string }> {
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
     * Create account with email + password via Better Auth (primary provider).
     * Returns `{ error }` on failure.
     */
    async signup(identifier: string, password: string): Promise<{ error?: string }> {
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
     * Update the signed-in user's profile email via Better Auth.
     * No-op for legacy Clerk users (they manage profiles through Clerk's hosted UI).
     */
    async updateProfile(email: string): Promise<{ error?: string }> {
        if (this.activeProvider() === 'clerk') return {}; // @deprecated: Clerk users manage via Clerk UI
        return this.betterAuth.updateProfile(email);
    }

    /**
     * Change the signed-in user's password via Better Auth.
     * No-op for legacy Clerk users.
     */
    async changePassword(currentPassword: string, newPassword: string): Promise<{ error?: string }> {
        if (this.activeProvider() === 'clerk') return {}; // @deprecated: Clerk users manage via Clerk UI
        return this.betterAuth.changePassword(currentPassword, newPassword);
    }
}
