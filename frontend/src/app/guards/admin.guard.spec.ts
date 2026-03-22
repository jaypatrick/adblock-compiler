import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree } from '@angular/router';
import { provideRouter } from '@angular/router';
import { adminGuard } from './admin.guard';
import { AuthFacadeService } from '../services/auth-facade.service';
import { provideTestBed } from '../../test-utils';

describe('adminGuard', () => {
    let mockAuth: {
        isLoaded: ReturnType<typeof signal<boolean>>;
        isSignedIn: ReturnType<typeof signal<boolean>>;
        isAdmin: ReturnType<typeof signal<boolean>>;
    };
    let router: Router;

    const mockRoute = {} as ActivatedRouteSnapshot;
    const mockState = { url: '/admin' } as RouterStateSnapshot;

    beforeEach(() => {
        mockAuth = {
            isLoaded: signal(true),
            isSignedIn: signal(false),
            isAdmin: signal(false),
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

    it('should allow navigation when signed in as admin', async () => {
        mockAuth.isSignedIn.set(true);
        mockAuth.isAdmin.set(true);

        const result = await TestBed.runInInjectionContext(() => adminGuard(mockRoute, mockState));
        expect(result).toBe(true);
    });

    it('should redirect to /sign-in when not signed in', async () => {
        mockAuth.isSignedIn.set(false);

        const result = await TestBed.runInInjectionContext(() => adminGuard(mockRoute, mockState));
        expect(result).toBeInstanceOf(UrlTree);
        expect((result as UrlTree).toString()).toContain('/sign-in');
    });

    it('should redirect to / when signed in but not admin', async () => {
        mockAuth.isSignedIn.set(true);
        mockAuth.isAdmin.set(false);

        const result = await TestBed.runInInjectionContext(() => adminGuard(mockRoute, mockState));
        expect(result).toBeInstanceOf(UrlTree);
        expect((result as UrlTree).toString()).toBe('/');
    });

    it('should include returnUrl in sign-in redirect', async () => {
        mockAuth.isSignedIn.set(false);

        const result = await TestBed.runInInjectionContext(() => adminGuard(mockRoute, mockState));
        expect((result as UrlTree).queryParams['returnUrl']).toBe('/admin');
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
            // BetterAuth never loads synchronously on the server — guard must not stall
            mockAuth.isLoaded.set(false);

            const result = await TestBed.runInInjectionContext(() => adminGuard(mockRoute, mockState));
            expect(result).toBeInstanceOf(UrlTree);
            expect((result as UrlTree).toString()).toContain('/sign-in');
        });

        it('should include returnUrl in the server-side redirect', async () => {
            mockAuth.isLoaded.set(false);

            const result = await TestBed.runInInjectionContext(() => adminGuard(mockRoute, mockState));
            expect((result as UrlTree).queryParams['returnUrl']).toBe('/admin');
        });
    });
});
