/**
 * SignUpComponent — Mounts Clerk's pre-built sign-up UI when Clerk is active,
 * or shows a reactive local-auth registration form when Clerk is unavailable.
 *
 * Uses AuthFacadeService as the single source of auth truth.
 * `@if (auth.useClerk())` drives the provider branch — no commented-out code.
 */

import { Component, ElementRef, afterNextRender, inject, viewChild, OnDestroy, effect, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ClerkService } from '../../services/clerk.service';
import { AuthFacadeService } from '../../services/auth-facade.service';
import { ThemeService } from '../../services/theme.service';

function passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const password = control.get('password')?.value as string | null;
    const confirm = control.get('confirmPassword')?.value as string | null;
    if (password && confirm && password !== confirm) {
        return { passwordMismatch: true };
    }
    return null;
}

@Component({
    selector: 'app-sign-up',
    standalone: true,
    imports: [
        ReactiveFormsModule,
        MatProgressSpinnerModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
    ],
    template: `
        <div class="auth-page">
            @if (!auth.isLoaded()) {
                <div class="auth-loading" aria-label="Loading sign-up">
                    <mat-spinner diameter="40" />
                </div>
            } @else if (auth.useClerk()) {
                <!-- Clerk branch: mount the hosted sign-up widget -->
                <div #signUpContainer class="clerk-container"></div>
            } @else {
                <!-- Local auth branch: reactive registration form -->
                <div class="local-auth-card">
                    <h2 class="local-auth-title">Create account</h2>

                    @if (errorMessage()) {
                        <div class="auth-error" role="alert">{{ errorMessage() }}</div>
                    }

                    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
                        <mat-form-field appearance="outline" class="full-width">
                            <mat-label>Email</mat-label>
                            <input matInput type="email" formControlName="identifier" autocomplete="email" />
                            @if (form.controls.identifier.invalid && form.controls.identifier.touched) {
                                <mat-error>A valid email is required</mat-error>
                            }
                        </mat-form-field>

                        <mat-form-field appearance="outline" class="full-width">
                            <mat-label>Password</mat-label>
                            <input matInput type="password" formControlName="password" autocomplete="new-password" />
                            @if (form.controls.password.invalid && form.controls.password.touched) {
                                <mat-error>Password must be at least 8 characters</mat-error>
                            }
                        </mat-form-field>

                        <mat-form-field appearance="outline" class="full-width">
                            <mat-label>Confirm password</mat-label>
                            <input matInput type="password" formControlName="confirmPassword" autocomplete="new-password" />
                            @if (form.errors?.['passwordMismatch'] && form.controls.confirmPassword.touched) {
                                <mat-error>Passwords do not match</mat-error>
                            }
                        </mat-form-field>

                        <button
                            mat-flat-button
                            color="primary"
                            type="submit"
                            class="full-width submit-btn"
                            [disabled]="loading() || form.invalid"
                        >
                            @if (loading()) {
                                <mat-spinner diameter="20" />
                            } @else {
                                Create account
                            }
                        </button>
                    </form>
                </div>
            }
        </div>
    `,
    styles: [`
        .auth-page {
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding: 2rem;
            min-height: 60vh;
        }
        .clerk-container { min-width: 320px; }
        .auth-loading {
            display: flex;
            justify-content: center;
            align-items: center;
            padding-top: 4rem;
        }
        .local-auth-card {
            width: 100%;
            max-width: 400px;
            padding: 2rem;
            border-radius: 8px;
            border: 1px solid var(--mat-sys-outline-variant);
            background: var(--mat-sys-surface);
        }
        .local-auth-title {
            margin: 0 0 1.5rem;
            font-size: 1.5rem;
            font-weight: 500;
            color: var(--mat-sys-on-surface);
        }
        .auth-error {
            padding: 0.75rem 1rem;
            margin-bottom: 1rem;
            border-radius: 4px;
            border: 1px solid var(--mat-sys-error);
            color: var(--mat-sys-error);
            font-size: 0.875rem;
        }
        .full-width { width: 100%; }
        .submit-btn { margin-top: 0.5rem; }
    `],
})
export class SignUpComponent implements OnDestroy {
    protected readonly auth = inject(AuthFacadeService);
    private readonly clerk = inject(ClerkService);
    private readonly router = inject(Router);
    private readonly theme = inject(ThemeService);
    private readonly fb = inject(FormBuilder);

    private readonly container = viewChild<ElementRef<HTMLDivElement>>('signUpContainer');
    private mounted = false;

    protected readonly loading = signal(false);
    protected readonly errorMessage = signal<string | null>(null);

    protected readonly form = this.fb.nonNullable.group(
        {
            identifier: ['', [Validators.required, Validators.email]],
            password: ['', [Validators.required, Validators.minLength(8)]],
            confirmPassword: ['', Validators.required],
        },
        { validators: passwordMatchValidator },
    );

    private readonly _mount = afterNextRender(() => this.tryMount());

    private readonly _themeEffect = effect(() => {
        this.theme.isDark();
        if (this.mounted) {
            const el = this.container()?.nativeElement;
            if (el) {
                this.clerk.unmountSignUp(el);
                this.mounted = false;
                this.tryMount();
            }
        }
    });

    ngOnDestroy(): void {
        const el = this.container()?.nativeElement;
        if (el) this.clerk.unmountSignUp(el);
    }

    protected async submit(): Promise<void> {
        if (this.form.invalid || this.loading()) return;
        this.errorMessage.set(null);
        this.loading.set(true);

        const { identifier, password } = this.form.getRawValue();
        const result = await this.auth.signup(identifier, password);

        this.loading.set(false);

        if (result.error) {
            this.errorMessage.set(result.error);
            return;
        }

        await this.router.navigateByUrl('/api-keys');
    }

    private tryMount(): void {
        const el = this.container()?.nativeElement;
        if (el && !this.mounted && this.auth.useClerk()) {
            this.clerk.mountSignUp(el);
            this.mounted = true;
        }
    }
}
