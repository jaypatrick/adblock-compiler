import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SignInComponent } from './sign-in.component';
import { AuthFacadeService } from '../../services/auth-facade.service';

function makeRoute(queryParams: Record<string, string> = {}) {
    return { snapshot: { queryParams } };
}

function makeMockAuth(overrides: Partial<{ isLoaded: boolean; isSignedIn: boolean }> = {}) {
    return {
        isLoaded: signal(overrides.isLoaded ?? true),
        isSignedIn: signal(overrides.isSignedIn ?? false),
        providers: signal({ emailPassword: true, github: false, google: false, mfa: false }),
        login: vi.fn().mockResolvedValue({}),
        signInWithSocial: vi.fn().mockResolvedValue({}),
    };
}

describe('SignInComponent', () => {
    let component: SignInComponent;
    let fixture: ComponentFixture<SignInComponent>;
    let mockAuth: ReturnType<typeof makeMockAuth>;

    beforeEach(async () => {
        mockAuth = makeMockAuth();

        await TestBed.configureTestingModule({
            imports: [SignInComponent],
            providers: [
                provideZonelessChangeDetection(),
                provideRouter([{ path: '**', redirectTo: '' }]),
                { provide: AuthFacadeService, useValue: mockAuth },
                { provide: ActivatedRoute, useValue: makeRoute() },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(SignInComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should show loading spinner while auth is not loaded', () => {
        mockAuth.isLoaded.set(false);
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;
        expect(el.querySelector('.auth-loading')).toBeTruthy();
        expect(el.querySelector('.local-auth-card')).toBeNull();
    });

    it('should show local auth form when loaded', () => {
        mockAuth.isLoaded.set(true);
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;
        expect(el.querySelector('.local-auth-card')).toBeTruthy();
        expect(el.querySelector('.auth-loading')).toBeNull();
    });

    it('should call login on form submit', async () => {
        const el = fixture.nativeElement as HTMLElement;
        const emailInput = el.querySelector('input[type="email"]') as HTMLInputElement;
        const passwordInput = el.querySelector('input[type="password"]') as HTMLInputElement;
        emailInput.value = 'test@example.com';
        emailInput.dispatchEvent(new Event('input'));
        passwordInput.value = 'password123';
        passwordInput.dispatchEvent(new Event('input'));
        fixture.detectChanges();

        // trigger submit via component method directly
        (component as any).form.controls.identifier.setValue('test@example.com');
        (component as any).form.controls.password.setValue('password123');
        await (component as any).submit();

        expect(mockAuth.login).toHaveBeenCalledWith('test@example.com', 'password123');
    });

    it('should call signInWithSocial when GitHub button is clicked', () => {
        (component as any).signInWithGitHub();
        expect(mockAuth.signInWithSocial).toHaveBeenCalledWith('github');
    });

    it('should display error message on failed login', async () => {
        mockAuth.login.mockResolvedValue({ error: 'Invalid credentials' });
        (component as any).form.controls.identifier.setValue('test@example.com');
        (component as any).form.controls.password.setValue('wrong');
        await (component as any).submit();
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;
        expect(el.querySelector('.auth-error')?.textContent).toContain('Invalid credentials');
    });
});
