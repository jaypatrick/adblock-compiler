import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SignUpComponent } from './sign-up.component';
import { AuthFacadeService } from '../../services/auth-facade.service';
import type { AuthProvidersConfig } from '../../services/better-auth.service';

function makeMockAuth(overrides: Partial<{
    isLoaded: boolean;
    providers: AuthProvidersConfig;
}> = {}) {
    return {
        isLoaded: signal(overrides.isLoaded ?? true),
        providers: signal<AuthProvidersConfig>(
            overrides.providers ?? { emailPassword: true, github: false, google: false, mfa: false },
        ),
        signup: vi.fn().mockResolvedValue({}),
        signInWithSocial: vi.fn().mockResolvedValue({}),
    };
}

describe('SignUpComponent', () => {
    let component: SignUpComponent;
    let fixture: ComponentFixture<SignUpComponent>;
    let mockAuth: ReturnType<typeof makeMockAuth>;

    beforeEach(async () => {
        mockAuth = makeMockAuth();

        await TestBed.configureTestingModule({
            imports: [SignUpComponent],
            providers: [
                provideZonelessChangeDetection(),
                provideAnimationsAsync(),
                provideRouter([]),
                { provide: AuthFacadeService, useValue: mockAuth },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(SignUpComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should render .auth-page wrapper', () => {
        expect((fixture.nativeElement as HTMLElement).querySelector('.auth-page')).toBeTruthy();
    });

    it('should show loading spinner while auth is not loaded', () => {
        mockAuth.isLoaded.set(false);
        fixture.detectChanges();

        const el = fixture.nativeElement as HTMLElement;
        expect(el.querySelector('.auth-loading')).toBeTruthy();
        expect(el.querySelector('.local-auth-card')).toBeNull();
    });

    it('should show local auth card when auth is loaded', () => {
        const el = fixture.nativeElement as HTMLElement;
        expect(el.querySelector('.local-auth-card')).toBeTruthy();
        expect(el.querySelector('.auth-loading')).toBeNull();
    });

    it('should NOT show GitHub button when providers.github is false', () => {
        mockAuth.providers.set({ emailPassword: true, github: false, google: false, mfa: false });
        fixture.detectChanges();

        expect((fixture.nativeElement as HTMLElement).querySelector('.github-btn')).toBeNull();
    });

    it('should show GitHub button when providers.github is true', () => {
        mockAuth.providers.set({ emailPassword: true, github: true, google: false, mfa: false });
        fixture.detectChanges();

        expect((fixture.nativeElement as HTMLElement).querySelector('.github-btn')).toBeTruthy();
    });

    it('should call auth.signInWithSocial("github") when GitHub button is clicked', async () => {
        mockAuth.providers.set({ emailPassword: true, github: true, google: false, mfa: false });
        fixture.detectChanges();

        const githubBtn = (fixture.nativeElement as HTMLElement).querySelector('.github-btn') as HTMLButtonElement;
        githubBtn.click();
        await fixture.whenStable();

        expect(mockAuth.signInWithSocial).toHaveBeenCalledWith('github');
    });

    it('should show an error message when set on the component', () => {
        (component as any).errorMessage.set('Email already taken');
        fixture.detectChanges();

        const el = fixture.nativeElement as HTMLElement;
        expect(el.querySelector('.auth-error')?.textContent?.trim()).toBe('Email already taken');
    });

    it('should show a sign-in link', () => {
        const el = fixture.nativeElement as HTMLElement;
        const links = Array.from(el.querySelectorAll('a'));
        const hrefs = links.map(a => a.getAttribute('routerlink') ?? a.getAttribute('href'));
        expect(hrefs).toContain('/sign-in');
    });
});
