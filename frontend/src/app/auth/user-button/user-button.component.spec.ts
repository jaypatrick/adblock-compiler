import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserButtonComponent } from './user-button.component';
import { AuthFacadeService } from '../../services/auth-facade.service';

function makeMockAuth(overrides: Partial<{
    isLoaded: boolean;
    isSignedIn: boolean;
    userIdentifier: string | null;
    isAdmin: boolean;
}> = {}) {
    return {
        isLoaded: signal(overrides.isLoaded ?? true),
        isSignedIn: signal(overrides.isSignedIn ?? false),
        userIdentifier: signal<string | null>(overrides.userIdentifier ?? null),
        isAdmin: signal(overrides.isAdmin ?? false),
        signOut: vi.fn().mockResolvedValue(undefined),
    };
}

describe('UserButtonComponent', () => {
    let component: UserButtonComponent;
    let fixture: ComponentFixture<UserButtonComponent>;
    let mockAuth: ReturnType<typeof makeMockAuth>;

    beforeEach(async () => {
        mockAuth = makeMockAuth();
        await TestBed.configureTestingModule({
            imports: [UserButtonComponent],
            providers: [
                provideZonelessChangeDetection(),
                provideRouter([]),
                { provide: AuthFacadeService, useValue: mockAuth },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(UserButtonComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should not render content while auth is loading', () => {
        mockAuth.isLoaded.set(false);
        fixture.detectChanges();

        const el = fixture.nativeElement as HTMLElement;
        expect(el.querySelector('.local-user')).toBeNull();
        expect(el.querySelector('.auth-links')).toBeNull();
    });

    it('should show auth-links when loaded and signed out', () => {
        mockAuth.isLoaded.set(true);
        mockAuth.isSignedIn.set(false);
        fixture.detectChanges();

        const el = fixture.nativeElement as HTMLElement;
        expect(el.querySelector('.auth-links')).toBeTruthy();
        expect(el.querySelector('.local-user')).toBeNull();
    });

    it('should show sign-in and sign-up links when not signed in', () => {
        mockAuth.isLoaded.set(true);
        mockAuth.isSignedIn.set(false);
        fixture.detectChanges();

        const links = (fixture.nativeElement as HTMLElement).querySelectorAll('a');
        const hrefs = Array.from(links).map(a => a.getAttribute('routerlink') ?? a.getAttribute('href'));
        expect(hrefs).toContain('/sign-in');
        expect(hrefs).toContain('/sign-up');
    });

    it('should show local-user section when signed in', () => {
        mockAuth.isLoaded.set(true);
        mockAuth.isSignedIn.set(true);
        mockAuth.userIdentifier.set('user@example.com');
        fixture.detectChanges();

        const el = fixture.nativeElement as HTMLElement;
        expect(el.querySelector('.local-user')).toBeTruthy();
        expect(el.querySelector('.auth-links')).toBeNull();
    });

    it('should display the user email when signed in', () => {
        mockAuth.isLoaded.set(true);
        mockAuth.isSignedIn.set(true);
        mockAuth.userIdentifier.set('alice@example.com');
        fixture.detectChanges();

        const el = fixture.nativeElement as HTMLElement;
        expect(el.querySelector('.local-user-email')?.textContent?.trim()).toBe('alice@example.com');
    });

    it('should show Admin link for admin users', () => {
        mockAuth.isLoaded.set(true);
        mockAuth.isSignedIn.set(true);
        mockAuth.isAdmin.set(true);
        fixture.detectChanges();

        const el = fixture.nativeElement as HTMLElement;
        expect(el.querySelector('a[routerlink="/admin"]')).toBeTruthy();
    });

    it('should hide Admin link for non-admin users', () => {
        mockAuth.isLoaded.set(true);
        mockAuth.isSignedIn.set(true);
        mockAuth.isAdmin.set(false);
        fixture.detectChanges();

        const el = fixture.nativeElement as HTMLElement;
        expect(el.querySelector('a[routerlink="/admin"]')).toBeNull();
    });

    it('should call auth.signOut when sign-out button is clicked', async () => {
        mockAuth.isLoaded.set(true);
        mockAuth.isSignedIn.set(true);
        fixture.detectChanges();

        const btn = (fixture.nativeElement as HTMLElement).querySelector('button') as HTMLButtonElement;
        btn.click();
        await fixture.whenStable();

        expect(mockAuth.signOut).toHaveBeenCalled();
    });

    it('should toggle between signed-out and signed-in states reactively', () => {
        const el = fixture.nativeElement as HTMLElement;

        mockAuth.isLoaded.set(true);
        mockAuth.isSignedIn.set(false);
        fixture.detectChanges();
        expect(el.querySelector('.auth-links')).toBeTruthy();
        expect(el.querySelector('.local-user')).toBeNull();

        mockAuth.isSignedIn.set(true);
        fixture.detectChanges();
        expect(el.querySelector('.local-user')).toBeTruthy();
        expect(el.querySelector('.auth-links')).toBeNull();

        mockAuth.isSignedIn.set(false);
        fixture.detectChanges();
        expect(el.querySelector('.auth-links')).toBeTruthy();
        expect(el.querySelector('.local-user')).toBeNull();
    });
});
