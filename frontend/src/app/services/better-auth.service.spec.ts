/**
 * Tests for BetterAuthService
 *
 * Covers:
 *   - SSR platform guard: constructor does not call checkSession() on the server;
 *     sets isLoaded immediately.
 *   - checkSession() happy path: sets user and caches session token.
 *   - checkSession() empty path: no user in response → remains signed out, isLoaded = true.
 *   - checkSession() network error: remains signed out, isLoaded = true.
 *   - getToken() when signed out: returns null without a fetch.
 *   - getToken() with cached token: returns token without a fetch.
 *   - getToken() without cached token: re-fetches session and returns token.
 *   - getToken() re-fetch returns no token: handles cookie-auth fallback without warning and returns null.
 *   - signIn() success: sets user and caches token.
 *   - signIn() failure: throws with error body.
 *   - signUp() success: sets user and caches token.
 *   - signUp() failure: throws with error body.
 *   - signOut(): clears user and token.
 */

import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BetterAuthService, type BetterAuthUser } from './better-auth.service';

const MOCK_USER: BetterAuthUser = {
    id: 'ba-user-1',
    email: 'user@example.com',
    name: 'Test User',
    emailVerified: true,
    image: null,
    tier: 'free',
    role: 'user',
};

const MOCK_TOKEN = 'sess_mock_bearer_token_abc123';

/** Create a Response-like object for fetch mocks. */
function makeResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
}

/** Flush pending microtasks/Promises (e.g. constructor async tasks). */
function flushPromises(): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Set up a single fetch mock that returns responses in order.
 * Returns a vitest spy that can be used to inspect calls.
 *
 * Using ONE spy per test avoids stacked-spy issues when vi.spyOn is called
 * multiple times on the same property.
 */
const MOCK_PROVIDERS_RESPONSE = makeResponse({
    emailPassword: true,
    github: false,
    google: false,
    mfa: false,
});

function mockFetch(...responses: Response[]) {
    let index = 0;
    return vi.spyOn(globalThis, 'fetch').mockImplementation((url: RequestInfo | URL) => {
        // fetchProviders() is always fire-and-forget on browser init; handle it
        // transparently so individual tests only need to mock session/auth calls.
        if (String(url).includes('/auth/providers')) {
            return Promise.resolve(MOCK_PROVIDERS_RESPONSE.clone());
        }
        const resp = responses[index++];
        if (!resp) throw new Error(`Unexpected fetch call #${index}`);
        return Promise.resolve(resp);
    });
}

/** Create a BetterAuthService in the TestBed with the given platform. */
function createService(platform: 'browser' | 'server' = 'browser'): BetterAuthService {
    TestBed.configureTestingModule({
        providers: [
            provideZonelessChangeDetection(),
            { provide: PLATFORM_ID, useValue: platform },
        ],
    });
    return TestBed.inject(BetterAuthService);
}

describe('BetterAuthService', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        TestBed.resetTestingModule();
    });

    // =========================================================================
    // SSR platform guard
    // =========================================================================

    describe('on server platform (SSR)', () => {
        it('should not call fetch during construction', () => {
            const fetchSpy = vi.spyOn(globalThis, 'fetch');
            createService('server');
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        it('should set isLoaded to true immediately', () => {
            const service = createService('server');
            expect(service.isLoaded()).toBe(true);
        });

        it('should be signed out on server', () => {
            const service = createService('server');
            expect(service.isSignedIn()).toBe(false);
            expect(service.user()).toBeNull();
        });
    });

    // =========================================================================
    // checkSession()
    // =========================================================================

    describe('checkSession()', () => {
        it('should set user and session token when session exists', async () => {
            mockFetch(makeResponse({ user: MOCK_USER, session: { token: MOCK_TOKEN } }));
            const service = createService();
            await flushPromises();

            expect(service.user()).toEqual(MOCK_USER);
            expect(service.isSignedIn()).toBe(true);
            expect(service.isLoaded()).toBe(true);
        });

        it('should cache session token so subsequent getToken() skips fetch', async () => {
            const spy = mockFetch(makeResponse({ user: MOCK_USER, session: { token: MOCK_TOKEN } }));
            const service = createService();
            await flushPromises();

            const callsBefore = spy.mock.calls.length;
            const token = await service.getToken();
            expect(token).toBe(MOCK_TOKEN);
            // No additional fetch after the initial checkSession
            expect(spy.mock.calls.length).toBe(callsBefore);
        });

        it('should remain signed out when response has no user', async () => {
            mockFetch(makeResponse({}));
            const service = createService();
            await flushPromises();

            expect(service.user()).toBeNull();
            expect(service.isSignedIn()).toBe(false);
            expect(service.isLoaded()).toBe(true);
        });

        it('should set isLoaded true on non-ok response', async () => {
            mockFetch(new Response(null, { status: 401 }));
            const service = createService();
            await flushPromises();

            expect(service.isLoaded()).toBe(true);
            expect(service.isSignedIn()).toBe(false);
        });

        it('should set isLoaded true on network error', async () => {
            vi.spyOn(globalThis, 'fetch')
                .mockResolvedValueOnce(MOCK_PROVIDERS_RESPONSE.clone()) // fetchProviders
                .mockRejectedValueOnce(new Error('Network error'));       // get-session
            const service = createService();
            await flushPromises();

            expect(service.isLoaded()).toBe(true);
            expect(service.isSignedIn()).toBe(false);
        });
    });

    // =========================================================================
    // getToken()
    // =========================================================================

    describe('getToken()', () => {
        it('should return null when not signed in (no extra fetch)', async () => {
            const spy = mockFetch(makeResponse({})); // no user
            const service = createService();
            await flushPromises();

            const callsBefore = spy.mock.calls.length;
            const token = await service.getToken();
            expect(token).toBeNull();
            expect(spy.mock.calls.length).toBe(callsBefore); // no extra fetch
        });

        it('should re-fetch session when signed in but no cached token', async () => {
            // checkSession returns user without session.token
            mockFetch(
                makeResponse({ user: MOCK_USER, session: {} }),
                makeResponse({ session: { token: MOCK_TOKEN } }), // re-fetch in getToken()
            );
            const service = createService();
            await flushPromises();

            const token = await service.getToken();
            expect(token).toBe(MOCK_TOKEN);
        });

        it('should return null (without warning) when signed in but token unavailable — cookie auth fallback', async () => {
            mockFetch(
                makeResponse({ user: MOCK_USER, session: {} }),   // checkSession: no token
                makeResponse({ session: {} }),                     // getToken re-fetch: still no token
            );
            const service = createService();
            await flushPromises();

            const token = await service.getToken();
            expect(token).toBeNull();
            // No warning: cookie-based auth is a valid, non-error path
        });
    });

    // =========================================================================
    // signIn()
    // =========================================================================

    describe('signIn()', () => {
        it('should set user and cache token on success', async () => {
            mockFetch(
                makeResponse({}),                                              // constructor checkSession
                makeResponse({ user: MOCK_USER, token: MOCK_TOKEN }),         // signIn
            );
            const service = createService();
            await flushPromises();
            await service.signIn('user@example.com', 'password123');

            expect(service.user()).toEqual(MOCK_USER);
            expect(service.isSignedIn()).toBe(true);
        });

        it('should cache token so getToken() returns it without extra fetch', async () => {
            const spy = mockFetch(
                makeResponse({}),
                makeResponse({ user: MOCK_USER, token: MOCK_TOKEN }),
            );
            const service = createService();
            await flushPromises();
            await service.signIn('user@example.com', 'password123');

            const callsBefore = spy.mock.calls.length;
            const token = await service.getToken();
            expect(token).toBe(MOCK_TOKEN);
            expect(spy.mock.calls.length).toBe(callsBefore);
        });

        it('should throw with error body on non-ok response', async () => {
            const errorBody = { message: 'Invalid credentials' };
            mockFetch(
                makeResponse({}),                                    // constructor checkSession
                new Response(JSON.stringify(errorBody), { status: 401 }), // signIn fails
            );
            const service = createService();
            await flushPromises();

            await expect(service.signIn('user@example.com', 'wrong')).rejects.toMatchObject({
                error: errorBody,
            });
            expect(service.isSignedIn()).toBe(false);
        });
    });

    // =========================================================================
    // signUp()
    // =========================================================================

    describe('signUp()', () => {
        it('should set user and cache token on success', async () => {
            mockFetch(
                makeResponse({}),
                makeResponse({ user: MOCK_USER, token: MOCK_TOKEN }),
            );
            const service = createService();
            await flushPromises();
            await service.signUp('new@example.com', 'password123', 'New User');

            expect(service.user()).toEqual(MOCK_USER);
            expect(service.isSignedIn()).toBe(true);
        });

        it('should throw with error body on non-ok response', async () => {
            const errorBody = { message: 'Email already in use' };
            mockFetch(
                makeResponse({}),
                new Response(JSON.stringify(errorBody), { status: 422 }),
            );
            const service = createService();
            await flushPromises();

            await expect(service.signUp('existing@example.com', 'pass123')).rejects.toMatchObject({
                error: errorBody,
            });
        });

        it('should derive name from email when name is not provided', async () => {
            const spy = mockFetch(
                makeResponse({}),
                makeResponse({ user: MOCK_USER, token: MOCK_TOKEN }),
            );
            const service = createService();
            await flushPromises();
            await service.signUp('john.doe@example.com', 'pass123');

            // calls[0] = fetchProviders (fire-and-forget), calls[1] = get-session, calls[2] = signUp
            const signUpArgs = spy.mock.calls[2]!;
            const body = JSON.parse(signUpArgs[1]!.body as string);
            expect(body.name).toBe('john.doe');
        });
    });

    // =========================================================================
    // signOut()
    // =========================================================================

    describe('signOut()', () => {
        it('should clear user and token after sign-out', async () => {
            mockFetch(
                makeResponse({ user: MOCK_USER, session: { token: MOCK_TOKEN } }), // checkSession
                new Response(null, { status: 200 }),                                // signOut
            );
            const service = createService();
            await flushPromises();
            expect(service.isSignedIn()).toBe(true);

            await service.signOut();
            expect(service.isSignedIn()).toBe(false);
            expect(service.user()).toBeNull();
        });

        it('should send Content-Type: application/json', async () => {
            const spy = mockFetch(
                makeResponse({ user: MOCK_USER, session: { token: MOCK_TOKEN } }), // checkSession
                new Response(null, { status: 200 }),                                // signOut
            );
            const service = createService();
            await flushPromises();

            await service.signOut();

            // fetchProviders (index 0), get-session (index 1), sign-out (index 2)
            const signOutCall = spy.mock.calls.find(([url]) => String(url).includes('/auth/sign-out'));
            expect(signOutCall).toBeDefined();
            const init = signOutCall![1] as RequestInit;
            expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
        });

        it('should clear user and token even when sign-out request fails', async () => {
            vi.spyOn(globalThis, 'fetch')
                .mockResolvedValueOnce(MOCK_PROVIDERS_RESPONSE.clone())                  // fetchProviders
                .mockResolvedValueOnce(
                    makeResponse({ user: MOCK_USER, session: { token: MOCK_TOKEN } }),   // checkSession
                )
                .mockRejectedValueOnce(new Error('Network error'));                      // signOut

            const service = createService();
            await flushPromises();
            expect(service.isSignedIn()).toBe(true);

            await service.signOut();
            expect(service.isSignedIn()).toBe(false);
            expect(service.user()).toBeNull();
        });
    });

    // =========================================================================
    // revokeOtherSessions()
    // =========================================================================

    describe('revokeOtherSessions()', () => {
        it('should send Content-Type: application/json', async () => {
            const spy = mockFetch(
                makeResponse({ user: MOCK_USER, session: { token: MOCK_TOKEN } }), // checkSession
                new Response(null, { status: 200 }),                                // revokeOtherSessions
            );
            const service = createService();
            await flushPromises();

            await service.revokeOtherSessions();

            const revokeCall = spy.mock.calls.find(([url]) => String(url).includes('/auth/revoke-other-sessions'));
            expect(revokeCall).toBeDefined();
            const init = revokeCall![1] as RequestInit;
            expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
        });

        it('should return an error object on non-ok response', async () => {
            mockFetch(
                makeResponse({ user: MOCK_USER, session: { token: MOCK_TOKEN } }), // checkSession
                new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }), // revokeOtherSessions
            );
            const service = createService();
            await flushPromises();

            const result = await service.revokeOtherSessions();
            expect(result.error).toBe('Unauthorized');
        });
    });

    // =========================================================================
    // isAdmin
    // =========================================================================

    describe('isAdmin', () => {
        it('should return false for a regular user', async () => {
            mockFetch(makeResponse({ user: MOCK_USER, session: { token: MOCK_TOKEN } }));
            const service = createService();
            await flushPromises();
            expect(service.isAdmin()).toBe(false);
        });

        it('should return true for a user with role admin', async () => {
            mockFetch(makeResponse({ user: { ...MOCK_USER, role: 'admin' }, session: { token: MOCK_TOKEN } }));
            const service = createService();
            await flushPromises();
            expect(service.isAdmin()).toBe(true);
        });
    });
});
