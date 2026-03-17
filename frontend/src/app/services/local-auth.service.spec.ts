import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LocalAuthService, LocalUser } from './local-auth.service';
import { API_BASE_URL } from '../tokens';

/** Flush one round of microtasks (Promise callbacks). */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const MOCK_USER: LocalUser = {
    id: 'user-1',
    identifier: 'test@example.com',
    identifier_type: 'email',
    role: 'user',
    tier: 'free',
    api_disabled: 0,
};

const ADMIN_USER: LocalUser = {
    ...MOCK_USER,
    id: 'admin-1',
    role: 'admin',
    tier: 'admin',
};

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.dGVzdA.signature';

describe('LocalAuthService', () => {
    let service: LocalAuthService;
    let httpTesting: HttpTestingController;

    function createService(platform: string = 'browser') {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: PLATFORM_ID, useValue: platform },
                { provide: API_BASE_URL, useValue: '/api' },
            ],
        });
        service = TestBed.inject(LocalAuthService);
        httpTesting = TestBed.inject(HttpTestingController);
    }

    afterEach(() => {
        sessionStorage.clear();
        httpTesting?.verify();
    });

    describe('on server platform (SSR)', () => {
        beforeEach(() => createService('server'));

        it('should be created', () => {
            expect(service).toBeTruthy();
        });

        it('should set isLoaded to true immediately (no HTTP call on server)', () => {
            expect(service.isLoaded()).toBe(true);
        });

        it('should start not signed in', () => {
            expect(service.isSignedIn()).toBe(false);
        });

        it('should start with null user', () => {
            expect(service.user()).toBeNull();
        });

        it('should return null from getToken', () => {
            expect(service.getToken()).toBeNull();
        });
    });

    describe('on browser platform — no stored token', () => {
        beforeEach(() => {
            sessionStorage.clear();
            createService('browser');
        });

        it('should be created', () => {
            expect(service).toBeTruthy();
        });

        it('should set isLoaded to true when no stored token', () => {
            expect(service.isLoaded()).toBe(true);
        });

        it('should start not signed in', () => {
            expect(service.isSignedIn()).toBe(false);
        });

        it('should start with null user', () => {
            expect(service.user()).toBeNull();
        });

        it('should report isAdmin false when no user', () => {
            expect(service.isAdmin()).toBe(false);
        });
    });

    describe('on browser platform — stored token present', () => {
        beforeEach(() => {
            sessionStorage.setItem('adblock-jwt', TOKEN);
            createService('browser');
        });

        it('should set token signal from sessionStorage', async () => {
            expect(service.getToken()).toBe(TOKEN);
            // Flush pending /auth/me request to satisfy afterEach verify()
            httpTesting.expectOne('/api/auth/me').flush({ user: MOCK_USER });
            await tick();
        });

        it('should start signed in while /auth/me is pending', async () => {
            expect(service.isSignedIn()).toBe(true);
            // Flush pending /auth/me request to satisfy afterEach verify()
            httpTesting.expectOne('/api/auth/me').flush({ user: MOCK_USER });
            await tick();
        });

        it('should set isLoaded and user on successful /auth/me response', async () => {
            const req = httpTesting.expectOne('/api/auth/me');
            expect(req.request.method).toBe('GET');
            expect(req.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);

            req.flush({ user: MOCK_USER });
            await tick();

            expect(service.isLoaded()).toBe(true);
            expect(service.user()).toEqual(MOCK_USER);
            expect(service.isAdmin()).toBe(false);
        });

        it('should sign out and set isLoaded on /auth/me error (invalid/expired token)', async () => {
            const req = httpTesting.expectOne('/api/auth/me');
            req.error(new ProgressEvent('error'), { status: 401, statusText: 'Unauthorized' });
            await tick();

            expect(service.isLoaded()).toBe(true);
            expect(service.isSignedIn()).toBe(false);
            expect(service.user()).toBeNull();
            expect(service.getToken()).toBeNull();
            expect(sessionStorage.getItem('adblock-jwt')).toBeNull();
        });
    });

    describe('login()', () => {
        beforeEach(() => {
            sessionStorage.clear();
            createService('browser');
        });

        it('should persist token, set token signal and user on success', async () => {
            const promise = service.login('test@example.com', 'password123');

            const req = httpTesting.expectOne('/api/auth/login');
            expect(req.request.method).toBe('POST');
            expect(req.request.body).toEqual({ identifier: 'test@example.com', password: 'password123' });
            req.flush({ token: TOKEN, user: MOCK_USER });

            await promise;

            expect(service.getToken()).toBe(TOKEN);
            expect(service.user()).toEqual(MOCK_USER);
            expect(service.isSignedIn()).toBe(true);
            expect(sessionStorage.getItem('adblock-jwt')).toBe(TOKEN);
        });

        it('should throw on HTTP error', async () => {
            const promise = service.login('bad@example.com', 'wrong');

            const req = httpTesting.expectOne('/api/auth/login');
            req.error(new ProgressEvent('error'), { status: 401, statusText: 'Unauthorized' });

            await expect(promise).rejects.toBeTruthy();
            expect(service.isSignedIn()).toBe(false);
        });

        it('should report isAdmin true for admin role', async () => {
            const promise = service.login('admin@example.com', 'pass');

            const req = httpTesting.expectOne('/api/auth/login');
            req.flush({ token: TOKEN, user: ADMIN_USER });

            await promise;

            expect(service.isAdmin()).toBe(true);
        });
    });

    describe('signup()', () => {
        beforeEach(() => {
            sessionStorage.clear();
            createService('browser');
        });

        it('should persist token, set token signal and user on success', async () => {
            const promise = service.signup('new@example.com', 'password123');

            const req = httpTesting.expectOne('/api/auth/signup');
            expect(req.request.method).toBe('POST');
            expect(req.request.body).toEqual({ identifier: 'new@example.com', password: 'password123' });
            req.flush({ token: TOKEN, user: MOCK_USER });

            await promise;

            expect(service.getToken()).toBe(TOKEN);
            expect(service.user()).toEqual(MOCK_USER);
            expect(service.isSignedIn()).toBe(true);
            expect(sessionStorage.getItem('adblock-jwt')).toBe(TOKEN);
        });

        it('should throw on HTTP error', async () => {
            const promise = service.signup('taken@example.com', 'pass');

            const req = httpTesting.expectOne('/api/auth/signup');
            req.error(new ProgressEvent('error'), { status: 409, statusText: 'Conflict' });

            await expect(promise).rejects.toBeTruthy();
        });
    });

    describe('signOut()', () => {
        beforeEach(() => {
            sessionStorage.clear();
            createService('browser');
        });

        it('should clear token, user, and sessionStorage', async () => {
            // First login to populate state
            const loginPromise = service.login('test@example.com', 'pass');
            const req = httpTesting.expectOne('/api/auth/login');
            req.flush({ token: TOKEN, user: MOCK_USER });
            await loginPromise;

            expect(service.isSignedIn()).toBe(true);

            service.signOut();

            expect(service.isSignedIn()).toBe(false);
            expect(service.user()).toBeNull();
            expect(service.getToken()).toBeNull();
            expect(sessionStorage.getItem('adblock-jwt')).toBeNull();
        });

        it('should not throw when already signed out', () => {
            expect(() => service.signOut()).not.toThrow();
        });
    });

    describe('token persistence', () => {
        beforeEach(() => createService('browser'));

        it('should store token in sessionStorage on login', async () => {
            const promise = service.login('test@example.com', 'pass');
            httpTesting.expectOne('/api/auth/login').flush({ token: TOKEN, user: MOCK_USER });
            await promise;

            expect(sessionStorage.getItem('adblock-jwt')).toBe(TOKEN);
        });

        it('should store token in sessionStorage on signup', async () => {
            const promise = service.signup('new@example.com', 'pass');
            httpTesting.expectOne('/api/auth/signup').flush({ token: TOKEN, user: MOCK_USER });
            await promise;

            expect(sessionStorage.getItem('adblock-jwt')).toBe(TOKEN);
        });
    });

    describe('updateProfile()', () => {
        beforeEach(() => {
            sessionStorage.clear();
            createService('browser');
        });

        it('should update user successfully via PATCH /api/auth/profile', async () => {
            // First log in to get a token
            const loginPromise = service.login('old@example.com', 'pass');
            httpTesting.expectOne('/api/auth/login').flush({ token: TOKEN, user: MOCK_USER });
            await loginPromise;

            const updatedUser = { ...MOCK_USER, identifier: 'new@example.com' };
            const updatePromise = service.updateProfile('new@example.com');

            const req = httpTesting.expectOne('/api/auth/profile');
            expect(req.request.method).toBe('PATCH');
            expect(req.request.body).toEqual({ identifier: 'new@example.com' });
            expect(req.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
            req.flush({ user: updatedUser });

            await updatePromise;

            expect(service.user()).toEqual(updatedUser);
        });

        it('should throw when not authenticated (no token)', async () => {
            // No login — token is null
            await expect(service.updateProfile('new@example.com')).rejects.toThrow('Not authenticated');
        });
    });

    describe('changePassword()', () => {
        beforeEach(() => {
            sessionStorage.clear();
            createService('browser');
        });

        it('should call POST /api/auth/change-password successfully', async () => {
            // First log in to get a token
            const loginPromise = service.login('user@example.com', 'oldpass');
            httpTesting.expectOne('/api/auth/login').flush({ token: TOKEN, user: MOCK_USER });
            await loginPromise;

            const changePromise = service.changePassword('oldpass', 'newpass123');

            const req = httpTesting.expectOne('/api/auth/change-password');
            expect(req.request.method).toBe('POST');
            expect(req.request.body).toEqual({ currentPassword: 'oldpass', newPassword: 'newpass123' });
            expect(req.request.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
            req.flush({});

            await changePromise;
        });

        it('should throw when not authenticated (no token)', async () => {
            // No login — token is null
            await expect(service.changePassword('old', 'new123')).rejects.toThrow('Not authenticated');
        });
    });
});
