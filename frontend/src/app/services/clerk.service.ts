/**
 * @deprecated Clerk is a legacy auth provider. Better Auth is now the primary
 * authentication system. This service is retained only for backward compatibility
 * with users who have existing Clerk sessions. All new sign-ins/sign-ups go
 * through BetterAuthService. This service and its dependencies (`@clerk/clerk-js`,
 * `@clerk/shared`) will be removed in a future release.
 *
 * ClerkService — Signal-based wrapper around `@clerk/clerk-js`.
 *
 * Provides reactive auth state for Angular 21 via signals:
 *   - `isLoaded()` — whether the Clerk SDK has finished initialising
 *   - `isSignedIn()` — whether a user session is active
 *   - `user()` — the current Clerk UserResource (or null)
 *   - `userId()` — shortcut to the Clerk user ID string
 *
 * SSR-safe: all Clerk operations are guarded by `isPlatformBrowser`.
 * Clerk JS is loaded lazily via dynamic import to keep the server bundle clean.
 */

import { Injectable, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import type { Clerk } from '@clerk/clerk-js';
import type { UserResource, SessionResource } from '@clerk/shared/types';
import { ClerkAppearanceService } from './clerk-appearance.service';

/** @deprecated Use BetterAuthService instead. Clerk is a legacy fallback. */
@Injectable({ providedIn: 'root' })
export class ClerkService {
    private readonly platformId = inject(PLATFORM_ID);
    private readonly document = inject(DOCUMENT);
    private readonly clerkAppearanceService = inject(ClerkAppearanceService);
    private clerkInstance: Clerk | null = null;

    // Writable signals (private)
    private readonly _isLoaded = signal(false);
    private readonly _isAvailable = signal(false);
    private readonly _configLoadFailed = signal(false);
    private readonly _user = signal<UserResource | null>(null);
    private readonly _session = signal<SessionResource | null>(null);

    // Public read-only signals
    readonly isLoaded = this._isLoaded.asReadonly();
    /** True only when the Clerk SDK loaded successfully (publishable key was valid). */
    readonly isAvailable = this._isAvailable.asReadonly();
    /**
     * True when the `/api/clerk-config` fetch failed (network error, timeout, etc.).
     * Distinct from `isAvailable=false` which means the key is simply not configured.
     * Consumers can use this to show a "temporarily unavailable" error with a retry hint
     * rather than implying the auth environment variable is missing.
     *
     * Cleared automatically when `initialize()` completes successfully so the service
     * reflects current state rather than historical state (i.e. a successful retry
     * removes the error indicator).
     */
    readonly configLoadFailed = this._configLoadFailed.asReadonly();
    readonly user = this._user.asReadonly();
    readonly session = this._session.asReadonly();
    readonly isSignedIn = computed(() => !!this._user());
    readonly userId = computed(() => this._user()?.id ?? null);

    /**
     * @deprecated Clerk is a legacy auth provider.
     * Mark that the Clerk config fetch itself failed (e.g. network error or timeout
     * hitting `/api/clerk-config`). This is distinct from the key simply being absent —
     * consumers can use `configLoadFailed()` to show a transient-error message instead
     * of an "authentication not configured" fallback.
     */
    markConfigLoadFailed(): void {
        this._configLoadFailed.set(true);
    }

    /**
     * @deprecated Clerk is a legacy auth provider.
     * Initialise the Clerk SDK. Called from `provideAppInitializer` in app.config.ts.
     * No-op on the server (SSR-safe).
     */
    async initialize(publishableKey: string): Promise<void> {
        if (!isPlatformBrowser(this.platformId)) return;
        if (!publishableKey) {
            // Mark loaded (but not available) so consumers can show an error/fallback
            // state instead of spinning indefinitely waiting for Clerk to initialise.
            this._isLoaded.set(true);
            return;
        }

        try {
            const { Clerk: ClerkJS } = await import('@clerk/clerk-js');
            this.clerkInstance = new ClerkJS(publishableKey);
            await this.clerkInstance.load();

            // Seed initial state — clear any previous config-load failure since
            // the SDK loaded successfully (transient error has resolved).
            this._user.set(this.clerkInstance.user ?? null);
            this._session.set(this.clerkInstance.session ?? null);
            this._configLoadFailed.set(false);
            this._isAvailable.set(true);
            this._isLoaded.set(true);

            // Subscribe to future state changes
            this.clerkInstance.addListener((emission) => {
                this._user.set(emission.user ?? null);
                this._session.set(emission.session ?? null);
            });
        } catch (err) {
            // Non-fatal: app works without Clerk (anonymous mode)
            console.error('[ClerkService] Failed to initialise Clerk:', err);
            this._isLoaded.set(true);
        }
    }

    /**
     * @deprecated Clerk is a legacy auth provider.
     * Get a fresh session JWT. Returns null when not signed in.
     * Used by the auth interceptor to attach `Authorization: Bearer <token>`.
     */
    async getToken(): Promise<string | null> {
        return (await this.clerkInstance?.session?.getToken()) ?? null;
    }

    /** @deprecated Clerk is a legacy auth provider. Mount Clerk's pre-built sign-in UI into the given DOM element. */
    mountSignIn(element: HTMLDivElement, fallbackRedirectUrl?: string): void {
        if (!this.clerkInstance) return;
        this.clerkInstance.mountSignIn(element, {
            ...(fallbackRedirectUrl ? { fallbackRedirectUrl } : {}),
            appearance: this.clerkAppearanceService.buildAppearance(),
        });
    }

    /** @deprecated Clerk is a legacy auth provider. */
    unmountSignIn(element: HTMLDivElement): void {
        this.clerkInstance?.unmountSignIn(element);
    }

    /** @deprecated Clerk is a legacy auth provider. */
    mountSignUp(element: HTMLDivElement): void {
        this.clerkInstance?.mountSignUp(element, {
            appearance: this.clerkAppearanceService.buildAppearance(),
        });
    }

    /** @deprecated Clerk is a legacy auth provider. */
    unmountSignUp(element: HTMLDivElement): void {
        this.clerkInstance?.unmountSignUp(element);
    }

    /** @deprecated Clerk is a legacy auth provider. */
    mountUserButton(element: HTMLDivElement): void {
        this.clerkInstance?.mountUserButton(element, {
            appearance: this.clerkAppearanceService.buildAppearance(),
        });
    }

    /** @deprecated Clerk is a legacy auth provider. */
    unmountUserButton(element: HTMLDivElement): void {
        this.clerkInstance?.unmountUserButton(element);
    }

    /** @deprecated Clerk is a legacy auth provider. Sign the user out and clear local state. */
    async signOut(): Promise<void> {
        await this.clerkInstance?.signOut();
        this._user.set(null);
        this._session.set(null);
    }
}
