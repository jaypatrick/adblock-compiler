/**
 * AuthFacadeService — thin wrapper around BetterAuthService.
 *
 * Better Auth is the sole authentication provider. This facade exists to
 * give consumers a stable injection token that is decoupled from the
 * concrete auth implementation. Swapping providers requires only changes
 * to this file, not every component/guard.
 */

import { Injectable, computed, inject } from '@angular/core';
import { BetterAuthService } from './better-auth.service';

@Injectable({ providedIn: 'root' })
export class AuthFacadeService {
    private readonly betterAuth = inject(BetterAuthService);

    readonly isLoaded = computed(() => this.betterAuth.isLoaded());
    readonly isSignedIn = computed(() => this.betterAuth.isSignedIn());
    readonly isAdmin = computed(() => this.betterAuth.isAdmin());
    readonly userIdentifier = computed<string | null>(() => this.betterAuth.user()?.email ?? null);
    /** Active auth providers — reflects the server's configured social login options. */
    readonly providers = computed(() => this.betterAuth.providers());

    async getToken(): Promise<string | null> {
        return this.betterAuth.getToken();
    }

    async signOut(): Promise<void> {
        await this.betterAuth.signOut();
    }

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

    async updateProfile(email: string): Promise<{ error?: string }> {
        return this.betterAuth.updateProfile(email);
    }

    async changePassword(currentPassword: string, newPassword: string): Promise<{ error?: string }> {
        return this.betterAuth.changePassword(currentPassword, newPassword);
    }

    async signInWithSocial(provider: 'github'): Promise<{ error?: string }> {
        try {
            await this.betterAuth.signInWithSocial(provider);
            return {};
        } catch (err) {
            const httpBody = (err as { error?: { message?: string } })?.error;
            const msg =
                httpBody?.message ??
                (err instanceof Error ? err.message : 'Social sign in failed. Please try again.');
            return { error: msg };
        }
    }
}
