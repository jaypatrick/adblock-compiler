/**
 * Tests for ProfileComponent.
 *
 * Covers:
 *   - Component creation
 *   - saveProfile(): success, error, invalid form guard
 *   - changePassword(): success, error, password-mismatch guard
 * Uses a mock AuthFacadeService to avoid real HTTP calls.
 * Form interactions are driven via the reactive form API; results are verified
 * through DOM assertions to keep tests behaviour-oriented.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReactiveFormsModule } from '@angular/forms';
import { ProfileComponent } from './profile.component';
import { AuthFacadeService } from '../services/auth-facade.service';

function makeAuthMock(overrides: Partial<{
    userIdentifier: string | null;
    updateProfile: (id: string) => Promise<{ error?: string }>;
    changePassword: (current: string, next: string) => Promise<{ error?: string }>;
}> = {}) {
    return {
        userIdentifier: vi.fn().mockReturnValue(overrides.userIdentifier ?? 'user@example.com'),
        updateProfile: vi.fn().mockImplementation(
            overrides.updateProfile ?? (() => Promise.resolve({})),
        ),
        changePassword: vi.fn().mockImplementation(
            overrides.changePassword ?? (() => Promise.resolve({})),
        ),
    };
}

/** Helper: fill a named input and trigger the change event. */
function fillInput(fixture: ComponentFixture<ProfileComponent>, name: string, value: string): void {
    const el = fixture.nativeElement.querySelector(`[formcontrolname="${name}"]`) as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('change'));
    fixture.detectChanges();
}

/** Helper: submit a <form> element in the fixture by dispatch + detectChanges. */
async function submitForm(fixture: ComponentFixture<ProfileComponent>, index = 0): Promise<void> {
    const forms = fixture.nativeElement.querySelectorAll('form') as NodeListOf<HTMLFormElement>;
    forms[index]?.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    // Flush microtasks so async handler resolves
    await new Promise<void>((r) => setTimeout(r, 0));
    fixture.detectChanges();
}

describe('ProfileComponent', () => {
    let component: ProfileComponent;
    let fixture: ComponentFixture<ProfileComponent>;
    let authMock: ReturnType<typeof makeAuthMock>;

    async function setup(authOverrides: Parameters<typeof makeAuthMock>[0] = {}) {
        authMock = makeAuthMock(authOverrides);

        await TestBed.configureTestingModule({
            imports: [ProfileComponent, NoopAnimationsModule, ReactiveFormsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideRouter([]),
                { provide: AuthFacadeService, useValue: authMock },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ProfileComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    }

    beforeEach(async () => {
        await setup();
    });

    it('should be created', () => {
        expect(component).toBeTruthy();
    });

    describe('saveProfile()', () => {
        it('should call auth.updateProfile and show success message on success', async () => {
            authMock.updateProfile.mockResolvedValue({});

            fillInput(fixture, 'identifier', 'updated@example.com');
            await submitForm(fixture, 0);

            expect(authMock.updateProfile).toHaveBeenCalledWith('updated@example.com');
            const el: HTMLElement = fixture.nativeElement;
            expect(el.querySelector('[role="status"]')).toBeTruthy();
            expect(el.querySelector('[role="alert"]')).toBeNull();
        });

        it('should show error message on failure', async () => {
            authMock.updateProfile.mockResolvedValue({ error: 'Email already taken' });

            fillInput(fixture, 'identifier', 'taken@example.com');
            await submitForm(fixture, 0);

            const el: HTMLElement = fixture.nativeElement;
            expect(el.querySelector('[role="alert"]')?.textContent).toContain('Email already taken');
            expect(el.querySelector('[role="status"]')).toBeNull();
        });

        it('should not submit if form is invalid (bad email)', async () => {
            fillInput(fixture, 'identifier', 'not-a-valid-email');
            await submitForm(fixture, 0);

            expect(authMock.updateProfile).not.toHaveBeenCalled();
        });
    });

    describe('changePassword()', () => {
        it('should call auth.changePassword and show success message on success', async () => {
            authMock.changePassword.mockResolvedValue({});

            fillInput(fixture, 'currentPassword', 'oldpass123');
            fillInput(fixture, 'newPassword', 'newpass456');
            fillInput(fixture, 'confirmPassword', 'newpass456');
            // Second form (index 1) is the password form
            await submitForm(fixture, 1);

            expect(authMock.changePassword).toHaveBeenCalledWith('oldpass123', 'newpass456');
            const el: HTMLElement = fixture.nativeElement;
            // The password success message is the second [role="status"] in the DOM (if both were shown)
            // or the only one if profile form hasn't been submitted
            const statusMsgs = el.querySelectorAll('[role="status"]');
            expect(statusMsgs.length).toBeGreaterThan(0);
        });

        it('should show password error on failure', async () => {
            authMock.changePassword.mockResolvedValue({ error: 'Current password is incorrect' });

            fillInput(fixture, 'currentPassword', 'wrongpass');
            fillInput(fixture, 'newPassword', 'newpass456');
            fillInput(fixture, 'confirmPassword', 'newpass456');
            await submitForm(fixture, 1);

            const el: HTMLElement = fixture.nativeElement;
            const alerts = el.querySelectorAll('[role="alert"]');
            const errorText = Array.from(alerts)
                .map((a) => a.textContent ?? '')
                .join(' ');
            expect(errorText).toContain('Current password is incorrect');
        });

        it('should not submit if passwords do not match (passwordMismatch validation)', async () => {
            fillInput(fixture, 'currentPassword', 'currentpass');
            fillInput(fixture, 'newPassword', 'newpass456');
            fillInput(fixture, 'confirmPassword', 'differentpass');
            await submitForm(fixture, 1);

            expect(authMock.changePassword).not.toHaveBeenCalled();
        });
    });

});


