/**
 * SignInComponent — Mounts Clerk's pre-built sign-in UI when Clerk is active,
 * or shows a reactive local-auth email/password form when Clerk is unavailable.
 *
 * Uses AuthFacadeService as the single source of auth truth.
 * `@if (auth.useClerk())` drives the provider branch — no commented-out code.
 */

import { Component, ElementRef, afterNextRender, inject, viewChild, OnDestroy, effect, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ClerkService } from '../../services/clerk.service';
import { AuthFacadeService } from '../../services/auth-facade.service';
import { ThemeService } from '../../services/theme.service';

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
    ],
    template: `
        <div class="auth-page">
            @if (!auth.isLoaded()) {
                <div class="auth-loading" aria-label="Loading sign-in">
                    <mat-spinner diameter="40" />
                </div>
            } @else if (auth.useClerk()) {
                <!-- Clerk branch: mount the hosted sign-in widget -->
                <div #signInContainer class="clerk-container"></div>
            } @else {
                <!-- Local auth branch: reactive email/password form -->
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
        .auth-switch { margin-top: 1rem; text-align: center; font-size: 0.875rem; color: var(--mat-sys-on-surface-variant); }
        .auth-link { color: var(--mat-sys-primary); text-decoration: none; font-weight: 500; }
        .auth-link:hover { text-decoration: underline; }
    `],
})
export class SignInComponent implements OnDestroy {
    protected readonly auth = inject(AuthFacadeService);
    /** @deprecated TODO(auth-migration): Remove ClerkService injection when Clerk support is dropped. */
    private readonly clerk = inject(ClerkService);
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);
    private readonly theme = inject(ThemeService);
    private readonly fb = inject(FormBuilder);

    /** @deprecated TODO(auth-migration): Remove Clerk mount container + mounted flag. */
    private readonly container = viewChild<ElementRef<HTMLDivElement>>('signInContainer');
    private mounted = false;

    protected readonly loading = signal(false);
    protected readonly errorMessage = signal<string | null>(null);

    protected readonly form = this.fb.nonNullable.group({
        identifier: ['', [Validators.required, Validators.email]],
        password: ['', Validators.required],
    });

    private readonly _mount = afterNextRender(() => this.tryMount());

    // TODO(auth-migration): Remove Clerk theme re-mount effect when Clerk support is dropped.
    private readonly _themeEffect = effect(() => {
        this.theme.isDark();
        if (this.mounted) {
            const el = this.container()?.nativeElement;
            if (el) {
                this.clerk.unmountSignIn(el);
                this.mounted = false;
                this.tryMount();
            }
        }
    });

    // TODO(auth-migration): Remove Clerk unmount in ngOnDestroy when Clerk support is dropped.
    ngOnDestroy(): void {
        const el = this.container()?.nativeElement;
        if (el) this.clerk.unmountSignIn(el);
    }

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

    /** @deprecated TODO(auth-migration): Remove Clerk mount logic when Clerk support is dropped. */
    private tryMount(): void {
        const el = this.container()?.nativeElement;
        if (el && !this.mounted && this.auth.useClerk()) {
            const returnUrl = this.route.snapshot.queryParams['returnUrl'] as string | undefined;
            this.clerk.mountSignIn(el, returnUrl);
            this.mounted = true;
        }
    }
}
