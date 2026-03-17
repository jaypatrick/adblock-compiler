/**
 * LocalAuthService — bridge auth service for local JWT authentication.
 *
 * Used when Clerk is not configured. Stores the JWT in sessionStorage and
 * exposes signals mirroring the ClerkService interface so guards and
 * interceptors can check either auth system transparently.
 *
 * This is a temporary bridge until Clerk is activated.
 */

import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../tokens';

export interface LocalUser {
    id: string;
    identifier: string;
    identifier_type: 'email' | 'phone';
    role: string;
    tier: string;
    api_disabled: number;
}

const TOKEN_KEY = 'adblock-jwt';

@Injectable({ providedIn: 'root' })
export class LocalAuthService {
    private readonly http = inject(HttpClient);
    private readonly apiBase = inject(API_BASE_URL);
    private readonly platformId = inject(PLATFORM_ID);

    private readonly _token = signal<string | null>(null);
    private readonly _user = signal<LocalUser | null>(null);
    private readonly _isLoaded = signal(false);
    private revalidationInterval: ReturnType<typeof setInterval> | null = null;

    readonly isLoaded = this._isLoaded.asReadonly();
    readonly isSignedIn = computed(() => this._token() !== null);
    readonly user = this._user.asReadonly();
    readonly isAdmin = computed(() => this._user()?.role === 'admin');

    constructor() {
        if (!isPlatformBrowser(this.platformId)) {
            this._isLoaded.set(true);
            return;
        }

        const stored = this.loadToken();
        if (!stored) {
            this._isLoaded.set(true);
            return;
        }

        this._token.set(stored);

        // Validate stored token with /auth/me
        this.http
            .get<{ user: LocalUser }>(`${this.apiBase}/auth/me`, {
                headers: { Authorization: `Bearer ${stored}` },
            })
            .subscribe({
                next: (res) => {
                    this._user.set(res.user);
                    this._isLoaded.set(true);
                },
                error: () => {
                    this.signOut();
                    this._isLoaded.set(true);
                },
            });

        // ZTA: re-validate token every 5 minutes to ensure it hasn't been revoked
        // and to pick up any role/tier changes made by an admin.
        this.startRevalidation();
    }

    getToken(): string | null {
        return this._token();
    }

    async login(identifier: string, password: string): Promise<void> {
        const res = await firstValueFrom(
            this.http.post<{ token: string; user: LocalUser }>(`${this.apiBase}/auth/login`, {
                identifier,
                password,
            }),
        );
        this.persist(res.token);
        this._token.set(res.token);
        this._user.set(res.user);
        this.startRevalidation();
    }

    async signup(identifier: string, password: string): Promise<void> {
        const res = await firstValueFrom(
            this.http.post<{ token: string; user: LocalUser }>(`${this.apiBase}/auth/signup`, {
                identifier,
                password,
            }),
        );
        this.persist(res.token);
        this._token.set(res.token);
        this._user.set(res.user);
        this.startRevalidation();
    }

    signOut(): void {
        if (this.revalidationInterval !== null) {
            clearInterval(this.revalidationInterval);
            this.revalidationInterval = null;
        }
        this._token.set(null);
        this._user.set(null);
        try {
            sessionStorage.removeItem(TOKEN_KEY);
        } catch {
            // sessionStorage not available
        }
    }

    async updateProfile(identifier: string): Promise<void> {
        const tok = this._token();
        if (!tok) throw new Error('Not authenticated');
        const res = await firstValueFrom(
            this.http.patch<{ user: LocalUser }>(`${this.apiBase}/auth/profile`, { identifier }, {
                headers: { Authorization: `Bearer ${tok}` },
            }),
        );
        this._user.set(res.user);
    }

    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
        const tok = this._token();
        if (!tok) throw new Error('Not authenticated');
        await firstValueFrom(
            this.http.post(`${this.apiBase}/auth/change-password`, { currentPassword, newPassword }, {
                headers: { Authorization: `Bearer ${tok}` },
            }),
        );
    }

    /**
     * Start (or restart) the 5-minute /auth/me revalidation interval.
     * Clears any existing interval first to prevent duplicates when called
     * after login/signup on a session that was already active.
     * Only runs in browser contexts.
     */
    private startRevalidation(): void {
        if (!isPlatformBrowser(this.platformId)) return;
        if (this.revalidationInterval !== null) {
            clearInterval(this.revalidationInterval);
            this.revalidationInterval = null;
        }
        this.revalidationInterval = setInterval(() => {
            const tok = this._token();
            if (!tok) return;
            this.http
                .get<{ user: LocalUser }>(`${this.apiBase}/auth/me`, {
                    headers: { Authorization: `Bearer ${tok}` },
                })
                .subscribe({
                    next: (res) => this._user.set(res.user),
                    error: () => this.signOut(),
                });
        }, 5 * 60 * 1000); // 5 minutes
    }

    private loadToken(): string | null {
        try {
            return sessionStorage.getItem(TOKEN_KEY);
        } catch {
            return null;
        }
    }

    private persist(token: string): void {
        try {
            sessionStorage.setItem(TOKEN_KEY, token);
        } catch {
            // sessionStorage not available
        }
    }
}
