/**
 * ProfileComponent — User profile editing + password change.
 *
 * Protected by authGuard — only reachable when signed in.
 */

import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { AuthFacadeService } from '../services/auth-facade.service';

function passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const newPass = control.get('newPassword')?.value as string | null;
    const confirm = control.get('confirmPassword')?.value as string | null;
    if (newPass && confirm && newPass !== confirm) {
        return { passwordMismatch: true };
    }
    return null;
}

@Component({
    selector: 'app-profile',
    standalone: true,
    imports: [
        ReactiveFormsModule,
        RouterLink,
        MatCardModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatProgressSpinnerModule,
        MatIconModule,
        MatDividerModule,
    ],
    template: `
        <div class="profile-page">
            <h1 class="mat-headline-4 page-title">My Profile</h1>

            <!-- Profile card -->
            <mat-card appearance="outlined" class="profile-card">
                <mat-card-header>
                    <mat-icon mat-card-avatar aria-hidden="true">person</mat-icon>
                    <mat-card-title>Account Details</mat-card-title>
                    <mat-card-subtitle>{{ auth.userIdentifier() }}</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>
                    @if (profileSuccess()) {
                        <div class="success-msg" role="status">Email updated successfully.</div>
                    }
                    @if (profileError()) {
                        <div class="error-msg" role="alert">{{ profileError() }}</div>
                    }
                    <form [formGroup]="profileForm" (ngSubmit)="saveProfile()" novalidate>
                        <mat-form-field appearance="outline" class="full-width">
                            <mat-label>Email</mat-label>
                            <input matInput type="email" formControlName="identifier" autocomplete="email" />
                            @if (profileForm.controls.identifier.invalid && profileForm.controls.identifier.touched) {
                                <mat-error>A valid email is required</mat-error>
                            }
                        </mat-form-field>
                        <button mat-flat-button color="primary" type="submit"
                            [disabled]="profileLoading() || profileForm.invalid">
                            @if (profileLoading()) { <mat-spinner diameter="20" /> }
                            @else { Save Changes }
                        </button>
                    </form>
                </mat-card-content>
            </mat-card>

            <mat-divider class="section-divider" />

            <!-- Change password card -->
            <mat-card appearance="outlined" class="profile-card">
                    <mat-card-header>
                        <mat-icon mat-card-avatar aria-hidden="true">lock</mat-icon>
                        <mat-card-title>Change Password</mat-card-title>
                    </mat-card-header>
                    <mat-card-content>
                        @if (passwordSuccess()) {
                            <div class="success-msg" role="status">Password changed successfully.</div>
                        }
                        @if (passwordError()) {
                            <div class="error-msg" role="alert">{{ passwordError() }}</div>
                        }
                        <form [formGroup]="passwordForm" (ngSubmit)="changePassword()" novalidate>
                            <mat-form-field appearance="outline" class="full-width">
                                <mat-label>Current password</mat-label>
                                <input matInput type="password" formControlName="currentPassword" autocomplete="current-password" />
                                @if (passwordForm.controls.currentPassword.invalid && passwordForm.controls.currentPassword.touched) {
                                    <mat-error>Current password is required</mat-error>
                                }
                            </mat-form-field>
                            <mat-form-field appearance="outline" class="full-width">
                                <mat-label>New password</mat-label>
                                <input matInput type="password" formControlName="newPassword" autocomplete="new-password" />
                                @if (passwordForm.controls.newPassword.invalid && passwordForm.controls.newPassword.touched) {
                                    <mat-error>New password must be at least 8 characters</mat-error>
                                }
                            </mat-form-field>
                            <mat-form-field appearance="outline" class="full-width">
                                <mat-label>Confirm new password</mat-label>
                                <input matInput type="password" formControlName="confirmPassword" autocomplete="new-password" />
                                @if (passwordForm.errors?.['passwordMismatch'] && passwordForm.controls.confirmPassword.touched) {
                                    <mat-error>Passwords do not match</mat-error>
                                }
                            </mat-form-field>
                            <button mat-flat-button color="primary" type="submit"
                                [disabled]="passwordLoading() || passwordForm.invalid">
                                @if (passwordLoading()) { <mat-spinner diameter="20" /> }
                                @else { Update Password }
                            </button>
                        </form>
                    </mat-card-content>
                </mat-card>
        </div>
    `,
    styles: [`
        .profile-page {
            max-width: 560px;
            margin: 2rem auto;
            padding: 0 1rem;
        }
        .page-title { margin-bottom: 1.5rem; }
        .profile-card { margin-bottom: 1.5rem; }
        .full-width { width: 100%; margin-bottom: 0.5rem; }
        .section-divider { margin: 1.5rem 0; }
        .success-msg {
            padding: 0.75rem 1rem;
            margin-bottom: 1rem;
            border-radius: 4px;
            background: var(--mat-sys-primary-container);
            color: var(--mat-sys-on-primary-container);
            font-size: 0.875rem;
        }
        .error-msg {
            padding: 0.75rem 1rem;
            margin-bottom: 1rem;
            border-radius: 4px;
            border: 1px solid var(--mat-sys-error);
            color: var(--mat-sys-error);
            font-size: 0.875rem;
        }
    `],
})
export class ProfileComponent {
    protected readonly auth = inject(AuthFacadeService);
    private readonly fb = inject(FormBuilder);

    protected readonly profileLoading = signal(false);
    protected readonly profileSuccess = signal(false);
    protected readonly profileError = signal<string | null>(null);

    protected readonly passwordLoading = signal(false);
    protected readonly passwordSuccess = signal(false);
    protected readonly passwordError = signal<string | null>(null);

    protected readonly profileForm = this.fb.nonNullable.group({
        identifier: [this.auth.userIdentifier() ?? '', [Validators.required, Validators.email]],
    });

    protected readonly passwordForm = this.fb.nonNullable.group(
        {
            currentPassword: ['', Validators.required],
            newPassword: ['', [Validators.required, Validators.minLength(8)]],
            confirmPassword: ['', Validators.required],
        },
        { validators: passwordMatchValidator },
    );

    protected async saveProfile(): Promise<void> {
        this.profileForm.markAllAsTouched();
        if (this.profileForm.invalid || this.profileLoading()) return;
        this.profileSuccess.set(false);
        this.profileError.set(null);
        this.profileLoading.set(true);

        const { identifier } = this.profileForm.getRawValue();
        const result = await this.auth.updateProfile(identifier);

        this.profileLoading.set(false);
        if (result.error) {
            this.profileError.set(result.error);
        } else {
            this.profileSuccess.set(true);
        }
    }

    protected async changePassword(): Promise<void> {
        this.passwordForm.markAllAsTouched();
        if (this.passwordForm.invalid || this.passwordLoading()) return;
        this.passwordSuccess.set(false);
        this.passwordError.set(null);
        this.passwordLoading.set(true);

        const { currentPassword, newPassword } = this.passwordForm.getRawValue();
        const result = await this.auth.changePassword(currentPassword, newPassword);

        this.passwordLoading.set(false);
        if (result.error) {
            this.passwordError.set(result.error);
        } else {
            this.passwordSuccess.set(true);
            this.passwordForm.reset();
        }
    }
}
