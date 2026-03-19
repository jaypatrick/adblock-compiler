import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { provideRouter } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthFacadeService } from '../services/auth-facade.service';
import { provideTestBed } from '../../test-utils';

describe('authGuard', () => {
    let mockAuth: {
        isLoaded: ReturnType<typeof signal<boolean>>;
        isSignedIn: ReturnType<typeof signal<boolean>>;
    };
    let router: Router;

    const mockRoute = {} as ActivatedRouteSnapshot;
    const mockState = { url: '/api-keys' } as RouterStateSnapshot;

    beforeEach(() => {
        mockAuth = {
            isLoaded: signal(true),
            isSignedIn: signal(false),
        };

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideRouter([]),
                { provide: AuthFacadeService, useValue: mockAuth },
            ],
        });

        router = TestBed.inject(Router);
    });

    it('should allow navigation when signed in', async () => {
        mockAuth.isSignedIn.set(true);

        const result = await TestBed.runInInjectionContext(() => authGuard(mockRoute, mockState));
        expect(result).toBe(true);
    });

    it('should redirect to /sign-in when not signed in', async () => {
        mockAuth.isSignedIn.set(false);

        const result = await TestBed.runInInjectionContext(() => authGuard(mockRoute, mockState));
        expect(result).toBeInstanceOf(UrlTree);
        expect((result as UrlTree).toString()).toContain('/sign-in');
    });

    it('should include returnUrl in redirect query params', async () => {
        mockAuth.isSignedIn.set(false);

        const result = await TestBed.runInInjectionContext(() => authGuard(mockRoute, mockState));
        expect((result as UrlTree).queryParams['returnUrl']).toBe('/api-keys');
    });

    it('should wait for auth to load when not yet loaded', async () => {
        mockAuth.isLoaded.set(false);
        mockAuth.isSignedIn.set(true);

        // Resolve loading after a short delay using a real signal update
        setTimeout(() => mockAuth.isLoaded.set(true), 100);

        const result = await TestBed.runInInjectionContext(() => authGuard(mockRoute, mockState));
        expect(result).toBe(true);
    });

    describe('SSR / server platform', () => {
        beforeEach(() => {
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    ...provideTestBed('server'),
                    provideRouter([]),
                    { provide: AuthFacadeService, useValue: mockAuth },
                ],
            });
            router = TestBed.inject(Router);
        });

        it('should immediately redirect to /sign-in without waiting for auth', async () => {
            // Auth is never loaded on the server — guard must not stall
            mockAuth.isLoaded.set(false);

            const result = await TestBed.runInInjectionContext(() => authGuard(mockRoute, mockState));
            expect(result).toBeInstanceOf(UrlTree);
            expect((result as UrlTree).toString()).toContain('/sign-in');
        });

        it('should include returnUrl in the server-side redirect', async () => {
            mockAuth.isLoaded.set(false);

            const result = await TestBed.runInInjectionContext(() => authGuard(mockRoute, mockState));
            expect((result as UrlTree).queryParams['returnUrl']).toBe('/api-keys');
        });
    });
});
