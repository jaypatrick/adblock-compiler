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
import { API_BASE_URL } from '../tokens';

/** Shape of the GET /api/auth/providers response */
export interface AuthProvidersConfig {
    readonly emailPassword: boolean;
    readonly github: boolean;
    readonly google: boolean;
    readonly mfa: boolean;
}

export interface BetterAuthUser {
    id: string;
    email: string;
    name: string | null;
    emailVerified: boolean;
    image: string | null;
    tier: string;
    role: string;
    twoFactorEnabled?: boolean;
}

export interface BetterAuthSession {
    id: string;
    token: string;
    userId: string;
    expiresAt: string;
    createdAt: string;
    updatedAt: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    isCurrent?: boolean;
}

export interface Organization {
    id: string;
    name: string;
    slug: string;
    logo?: string | null;
    metadata?: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
}

export interface OrganizationMember {
    id: string;
    organizationId: string;
    userId: string;
    role: 'owner' | 'admin' | 'member';
    createdAt: string;
    updatedAt: string;
    user?: BetterAuthUser;
}

export interface FullOrganization extends Organization {
    members: OrganizationMember[];
}

@Injectable({ providedIn: 'root' })
export class BetterAuthService {
    private readonly platformId = inject(PLATFORM_ID);
    private readonly apiBaseUrl = inject(API_BASE_URL);
    private readonly _user = signal<BetterAuthUser | null>(null);
    private readonly _isLoaded = signal(false);
    private readonly _sessionToken = signal<string | null>(null);
    private readonly _providers = signal<AuthProvidersConfig>({
        emailPassword: true,
        github: false,
        google: false,
        mfa: true,
    });

    readonly user = this._user.asReadonly();
    readonly isLoaded = this._isLoaded.asReadonly();
    readonly isSignedIn = computed(() => this._user() !== null);
    readonly isAdmin = computed(() => this._user()?.role === 'admin');
    /** Active auth providers — populated from GET /api/auth/providers on init. */
    readonly providers = this._providers.asReadonly();

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
        // Fire-and-forget providers fetch in parallel with session fetch (non-fatal).
        this.fetchProviders();
        try {
            const res = await fetch(`${this.apiBaseUrl}/auth/get-session`, {
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
        const res = await fetch(`${this.apiBaseUrl}/auth/sign-in/email`, {
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
        const res = await fetch(`${this.apiBaseUrl}/auth/sign-up/email`, {
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
            await fetch(`${this.apiBaseUrl}/auth/sign-out`, {
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
            const res = await fetch(`${this.apiBaseUrl}/auth/get-session`, {
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
            const res = await fetch(`${this.apiBaseUrl}/auth/update-user`, {
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
            const res = await fetch(`${this.apiBaseUrl}/auth/change-password`, {
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

    // =========================================================================
    // Social sign-in
    // =========================================================================

    /**
     * Initiate OAuth flow for a social provider.
     * Redirects the browser to the provider's authorization URL via Better Auth.
     * On success the provider redirects back to /api/auth/callback/<provider>
     * which sets a session cookie and redirects to `callbackURL`.
     */
    async signInWithSocial(
        provider: 'github' | 'google',
        callbackURL = '/dashboard',
    ): Promise<void> {
        const res = await fetch(`${this.apiBaseUrl}/auth/sign-in/social`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ provider, callbackURL }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({})) as { message?: string };
            throw new Error(body.message ?? `Failed to initiate ${provider} sign-in.`);
        }
        const data = await res.json() as { url?: string };
        if (data?.url) {
            // Better Auth returns a redirect URL — follow it to start the OAuth flow.
            window.location.href = data.url;
        }
    }

    // =========================================================================
    // Two-factor authentication (twoFactor plugin)
    // =========================================================================

    /** Enable TOTP 2FA for the current user. Returns the TOTP URI for QR display. */
    async enableTwoFactor(password: string): Promise<{ totpURI?: string; error?: string }> {
        try {
            const res = await fetch(`${this.apiBaseUrl}/auth/two-factor/enable`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ password }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                return { error: body.message ?? 'Failed to enable two-factor authentication.' };
            }
            const data = await res.json() as { totpURI?: string };
            return { totpURI: data.totpURI };
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to enable two-factor authentication.' };
        }
    }

    /** Verify a TOTP code to confirm 2FA setup or authenticate a 2FA challenge. */
    async verifyTwoFactor(code: string): Promise<{ error?: string }> {
        try {
            const res = await fetch(`${this.apiBaseUrl}/auth/two-factor/verify-totp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ code }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                return { error: body.message ?? 'Invalid code. Please try again.' };
            }
            return {};
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Verification failed.' };
        }
    }

    /** Disable 2FA for the current user (requires password confirmation). */
    async disableTwoFactor(password: string): Promise<{ error?: string }> {
        try {
            const res = await fetch(`${this.apiBaseUrl}/auth/two-factor/disable`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ password }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                return { error: body.message ?? 'Failed to disable two-factor authentication.' };
            }
            return {};
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to disable two-factor authentication.' };
        }
    }

    // =========================================================================
    // Session management (multiSession plugin)
    // =========================================================================

    /** List all active sessions for the current user. */
    async listSessions(): Promise<{ sessions?: BetterAuthSession[]; error?: string }> {
        try {
            const res = await fetch(`${this.apiBaseUrl}/auth/list-sessions`, {
                credentials: 'include',
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                return { error: body.message ?? 'Failed to load sessions.' };
            }
            const sessions = await res.json() as BetterAuthSession[];
            return { sessions };
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to load sessions.' };
        }
    }

    /** Revoke a specific session by token. */
    async revokeSession(token: string): Promise<{ error?: string }> {
        try {
            const res = await fetch(`${this.apiBaseUrl}/auth/revoke-session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ token }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                return { error: body.message ?? 'Failed to revoke session.' };
            }
            return {};
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to revoke session.' };
        }
    }

    /** Revoke all sessions except the current one. */
    async revokeOtherSessions(): Promise<{ error?: string }> {
        try {
            const res = await fetch(`${this.apiBaseUrl}/auth/revoke-other-sessions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                return { error: body.message ?? 'Failed to revoke sessions.' };
            }
            return {};
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to revoke sessions.' };
        }
    }

    /** Fetch supported auth providers from the server and update the providers signal. */
    private async fetchProviders(): Promise<void> {
        try {
            const res = await fetch(`${this.apiBaseUrl}/auth/providers`);
            if (res.ok) {
                const raw = await res.json() as { data?: AuthProvidersConfig } | AuthProvidersConfig;
                const config = (raw as { data?: AuthProvidersConfig }).data ?? (raw as AuthProvidersConfig);
                if (
                    config &&
                    typeof config.github === 'boolean' &&
                    typeof config.google === 'boolean' &&
                    typeof config.emailPassword === 'boolean' &&
                    typeof config.mfa === 'boolean'
                ) {
                    this._providers.set(config);
                }
            }
        } catch {
            console.warn('[BetterAuthService] Failed to fetch auth providers; using defaults.');
        }
    }

    // ============================================================================
    // Organization Methods (Better Auth organization plugin)
    // ============================================================================

    /**
     * Create a new organization.
     * Requires authenticated session.
     *
     * @param name - Organization display name
     * @param slug - Unique organization slug (URL-friendly)
     * @param logo - Optional logo URL
     * @returns Created organization or error
     */
    async createOrganization(
        name: string,
        slug: string,
        logo?: string,
    ): Promise<{ organization?: Organization; error?: string }> {
        try {
            const res = await fetch(`${this.apiBaseUrl}/auth/organization/create`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, slug, logo }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                return { error: body.message ?? 'Failed to create organization.' };
            }
            const organization = await res.json() as Organization;
            return { organization };
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to create organization.' };
        }
    }

    /**
     * List all organizations the current user is a member of.
     * Requires authenticated session.
     *
     * @returns Array of organizations or error
     */
    async listOrganizations(): Promise<{ organizations?: Organization[]; error?: string }> {
        try {
            const res = await fetch(`${this.apiBaseUrl}/auth/organization/list-organizations`, {
                credentials: 'include',
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                return { error: body.message ?? 'Failed to list organizations.' };
            }
            const organizations = await res.json() as Organization[];
            return { organizations };
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to list organizations.' };
        }
    }

    /**
     * Get full organization details including members.
     * Requires authenticated session and membership in the organization.
     *
     * @param organizationId - Organization ID
     * @returns Full organization data or error
     */
    async getOrganization(organizationId: string): Promise<{ organization?: FullOrganization; error?: string }> {
        try {
            const res = await fetch(`${this.apiBaseUrl}/auth/organization/get-full-organization`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organizationId }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                return { error: body.message ?? 'Failed to get organization.' };
            }
            const organization = await res.json() as FullOrganization;
            return { organization };
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to get organization.' };
        }
    }

    /**
     * Invite a user to an organization by email.
     * Requires admin or owner role in the organization.
     *
     * @param organizationId - Organization ID
     * @param email - Email of user to invite
     * @param role - Role to assign (owner, admin, member)
     * @returns Success status or error
     */
    async inviteOrganizationMember(
        organizationId: string,
        email: string,
        role: 'owner' | 'admin' | 'member',
    ): Promise<{ error?: string }> {
        try {
            const res = await fetch(`${this.apiBaseUrl}/auth/organization/invite-member`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organizationId, email, role }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                return { error: body.message ?? 'Failed to invite member.' };
            }
            return {};
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to invite member.' };
        }
    }

    /**
     * Remove a member from an organization.
     * Requires admin or owner role in the organization.
     *
     * @param organizationId - Organization ID
     * @param userId - User ID to remove
     * @returns Success status or error
     */
    async removeOrganizationMember(organizationId: string, userId: string): Promise<{ error?: string }> {
        try {
            const res = await fetch(`${this.apiBaseUrl}/auth/organization/remove-member`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organizationId, userId }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                return { error: body.message ?? 'Failed to remove member.' };
            }
            return {};
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to remove member.' };
        }
    }

    /**
     * Update a member's role in an organization.
     * Requires admin or owner role in the organization.
     *
     * @param organizationId - Organization ID
     * @param userId - User ID to update
     * @param role - New role to assign
     * @returns Success status or error
     */
    async updateOrganizationMemberRole(
        organizationId: string,
        userId: string,
        role: 'owner' | 'admin' | 'member',
    ): Promise<{ error?: string }> {
        try {
            const res = await fetch(`${this.apiBaseUrl}/auth/organization/update-member-role`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organizationId, userId, role }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                return { error: body.message ?? 'Failed to update member role.' };
            }
            return {};
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to update member role.' };
        }
    }

    /**
     * Leave an organization.
     * Cannot leave if you are the only owner.
     *
     * @param organizationId - Organization ID to leave
     * @returns Success status or error
     */
    async leaveOrganization(organizationId: string): Promise<{ error?: string }> {
        try {
            const res = await fetch(`${this.apiBaseUrl}/auth/organization/leave-organization`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organizationId }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                return { error: body.message ?? 'Failed to leave organization.' };
            }
            return {};
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to leave organization.' };
        }
    }

    /**
     * Delete an organization.
     * Only owners can delete organizations.
     *
     * @param organizationId - Organization ID to delete
     * @returns Success status or error
     */
    async deleteOrganization(organizationId: string): Promise<{ error?: string }> {
        try {
            const res = await fetch(`${this.apiBaseUrl}/auth/organization/delete-organization`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organizationId }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                return { error: body.message ?? 'Failed to delete organization.' };
            }
            return {};
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to delete organization.' };
        }
    }

    /**
     * Update organization details (name, logo, metadata).
     * Requires admin or owner role in the organization.
     *
     * @param organizationId - Organization ID
     * @param updates - Fields to update
     * @returns Success status or error
     */
    async updateOrganization(
        organizationId: string,
        updates: { name?: string; logo?: string; metadata?: Record<string, unknown> },
    ): Promise<{ error?: string }> {
        try {
            const res = await fetch(`${this.apiBaseUrl}/auth/organization/update-organization`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organizationId, ...updates }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                return { error: body.message ?? 'Failed to update organization.' };
            }
            return {};
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to update organization.' };
        }
    }

    /**
     * Get the active organization for the current user.
     * Returns null if no active organization is set.
     *
     * @returns Active organization or error
     */
    async getActiveOrganization(): Promise<{ organization?: Organization | null; error?: string }> {
        try {
            const res = await fetch(`${this.apiBaseUrl}/auth/organization/get-active-organization`, {
                credentials: 'include',
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                return { error: body.message ?? 'Failed to get active organization.' };
            }
            const organization = await res.json() as Organization | null;
            return { organization };
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to get active organization.' };
        }
    }

    /**
     * Set the active organization for the current user.
     * This affects which organization context is used for operations.
     *
     * @param organizationId - Organization ID to set as active
     * @returns Success status or error
     */
    async setActiveOrganization(organizationId: string): Promise<{ error?: string }> {
        try {
            const res = await fetch(`${this.apiBaseUrl}/auth/organization/set-active-organization`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organizationId }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                return { error: body.message ?? 'Failed to set active organization.' };
            }
            return {};
        } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to set active organization.' };
        }
    }
}
