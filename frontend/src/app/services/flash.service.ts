/**
 * FlashService — Signal-based one-time flash message service.
 *
 * Provides two ways to surface a transient notification to the user:
 *   1. `set(message, type)` — Direct in-process signal write. Used by auth.guard.ts
 *      to surface "please sign in" messages without a network round-trip.
 *   2. `consume(token)` — Reads a one-time flash from the Worker KV store via
 *      `GET /api/flash/:token`. Used when the Worker sets a flash and redirects
 *      to the frontend with `?flash=<token>` in the URL.
 *   3. `readFromUrl()` — Reads `?flash=<token>` from `window.location.search`
 *      and calls `consume()`. Called in app.config.ts before first render.
 *
 * Consumed by `UrlErrorBannerComponent` which renders the banner when
 * `currentFlash()` is non-null.
 *
 * Angular 21 patterns: inject(), signal(), HttpClient
 */

import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { FLASH_ENDPOINT } from '../tokens';

export type FlashType = 'info' | 'warn' | 'error' | 'success';

/** Mirrors `FlashMessage` in worker/lib/flash.ts */
export interface FlashMessage {
    readonly message: string;
    readonly type: FlashType;
    readonly createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class FlashService {
    private readonly http = inject(HttpClient);
    private readonly flashEndpoint = inject(FLASH_ENDPOINT);
    private readonly platformId = inject(PLATFORM_ID);

    /** The currently-pending flash message. Consumed by UrlErrorBannerComponent. */
    readonly currentFlash = signal<FlashMessage | null>(null);

    /**
     * Set a flash message directly in the signal — no network call.
     * Used by auth.guard.ts before redirecting to /sign-in.
     */
    set(message: string, type: FlashType): void {
        this.currentFlash.set({ message, type, createdAt: new Date().toISOString() });
    }

    /** Clear the current flash (e.g. user clicked Dismiss). */
    clear(): void {
        this.currentFlash.set(null);
    }

    /**
     * Consume a flash token from the Worker KV store.
     * Makes a `GET /api/flash/:token` request. On success the signal is
     * updated; on any error the request is silently discarded (token may
     * have already been consumed or expired).
     */
    consume(token: string): void {
        this.http
            .get<FlashMessage>(`${this.flashEndpoint}/${token}`)
            .pipe(catchError(() => of(null)))
            .subscribe(flash => {
                if (flash) this.currentFlash.set(flash);
            });
    }

    /**
     * Read a `?flash=<token>` query parameter from the current URL and
     * consume the corresponding flash from the Worker KV store.
     *
     * Must be called in a browser context (uses `window.location.search`).
     * Called during `provideAppInitializer` before first render.
     */
    readFromUrl(): void {
        // Guard against accidental server-side calls (window is not available in SSR).
        if (!isPlatformBrowser(this.platformId)) return;
        const params = new URLSearchParams(window.location.search);
        const token = params.get('flash');
        if (token) this.consume(token);
    }
}
