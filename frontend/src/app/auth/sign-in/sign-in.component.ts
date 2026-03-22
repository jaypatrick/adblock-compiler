/**
 * SignInComponent — Email/password sign-in form with GitHub social login.
 * Uses BetterAuth as the sole authentication provider via AuthFacadeService.
 */

import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { AuthFacadeService } from '../../services/auth-facade.service';

@Component({
    selector: 'app-sign-in',
    standalone: true,
    imports: [
        ReactiveFormsModule,
        RouterLink,
        MatProgressSpinnerModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatDividerModule,
    ],
    template: `
        <div class="auth-page">
            @if (!auth.isLoaded()) {
                <div class="auth-loading" aria-label="Loading sign-in">
                    <mat-spinner diameter="40" />
                </div>
            } @else {
                <div class="local-auth-card">
                    <h2 class="local-auth-title">Sign in</h2>

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
                            <input matInput type="password" formControlName="password" autocomplete="current-password" />
                            @if (form.controls.password.invalid && form.controls.password.touched) {
                                <mat-error>Password is required</mat-error>
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
                                Sign in
                            }
                        </button>
                    </form>

                    <mat-divider class="divider" />

                    <button
                        mat-stroked-button
                        type="button"
                        class="full-width github-btn"
                        (click)="signInWithGitHub()"
                    >
                        <span class="github-icon" aria-hidden="true">&#xe800;</span>
                        Sign in with GitHub
                    </button>

                    <p class="auth-switch">Don't have an account? <a routerLink="/sign-up" class="auth-link">Sign up</a></p>
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
        .divider { margin: 1.25rem 0; }
        .github-btn { margin-bottom: 0.5rem; }
        .github-icon { margin-right: 0.5rem; font-size: 1rem; }
        .auth-switch { margin-top: 1rem; text-align: center; font-size: 0.875rem; color: var(--mat-sys-on-surface-variant); }
        .auth-link { color: var(--mat-sys-primary); text-decoration: none; font-weight: 500; }
        .auth-link:hover { text-decoration: underline; }
    `],
})
export class SignInComponent {
    protected readonly auth = inject(AuthFacadeService);
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);
    private readonly fb = inject(FormBuilder);

    protected readonly loading = signal(false);
    protected readonly errorMessage = signal<string | null>(null);

    protected readonly form = this.fb.nonNullable.group({
        identifier: ['', [Validators.required, Validators.email]],
        password: ['', Validators.required],
    });

    protected async submit(): Promise<void> {
        this.form.markAllAsTouched();
        if (this.form.invalid || this.loading()) return;
        this.errorMessage.set(null);
        this.loading.set(true);

        const { identifier, password } = this.form.getRawValue();
        const result = await this.auth.login(identifier, password);

        this.loading.set(false);

        if (result.error) {
            this.errorMessage.set(result.error);
            return;
        }

        const returnUrl = (this.route.snapshot.queryParams['returnUrl'] as string | undefined) ?? '/api-keys';
        await this.router.navigateByUrl(returnUrl);
    }

    protected signInWithGitHub(): void {
        this.auth.signInWithSocial('github');
    }
}
