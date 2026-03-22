import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthFacadeService } from './auth-facade.service';
import { BetterAuthService, type BetterAuthUser, type AuthProvidersConfig } from './better-auth.service';

const MOCK_USER: BetterAuthUser = {
    id: 'ba-user-1',
    email: 'user@example.com',
    name: 'Test User',
    emailVerified: true,
    image: null,
    tier: 'free',
    role: 'user',
};

const DEFAULT_PROVIDERS: AuthProvidersConfig = {
    emailPassword: true,
    github: false,
    google: false,
    mfa: false,
};

function makeBetterAuthMock(overrides: Partial<{
    isLoaded: boolean;
    isSignedIn: boolean;
    isAdmin: boolean;
    user: BetterAuthUser | null;
    providers: AuthProvidersConfig;
}> = {}) {
    return {
        isLoaded: signal(overrides.isLoaded ?? true),
        isSignedIn: signal(overrides.isSignedIn ?? false),
        isAdmin: signal(overrides.isAdmin ?? false),
        user: signal<BetterAuthUser | null>(overrides.user ?? null),
        providers: signal<AuthProvidersConfig>(overrides.providers ?? DEFAULT_PROVIDERS),
        getToken: vi.fn<[], Promise<string | null>>().mockResolvedValue(null),
        signIn: vi.fn<[string, string], Promise<void>>().mockResolvedValue(undefined),
        signUp: vi.fn<[string, string], Promise<void>>().mockResolvedValue(undefined),
        signOut: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
        updateProfile: vi.fn<[string], Promise<{ error?: string }>>().mockResolvedValue({}),
        changePassword: vi.fn<[string, string], Promise<{ error?: string }>>().mockResolvedValue({}),
        signInWithSocial: vi.fn<['github'], Promise<void>>().mockResolvedValue(undefined),
    };
}

describe('AuthFacadeService', () => {
    let service: AuthFacadeService;
    let baMock: ReturnType<typeof makeBetterAuthMock>;

    function setup(overrides: Parameters<typeof makeBetterAuthMock>[0] = {}) {
        baMock = makeBetterAuthMock(overrides);
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                { provide: BetterAuthService, useValue: baMock },
            ],
        });
        service = TestBed.inject(AuthFacadeService);
    }

    beforeEach(() => setup());

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    // ──────────────────────────────────────────────────────────────────────────
    // Computed signals — delegation to BetterAuthService
    // ──────────────────────────────────────────────────────────────────────────

    describe('isLoaded', () => {
        it('returns true when betterAuth is loaded', () => {
            expect(service.isLoaded()).toBe(true);
        });

        it('returns false when betterAuth is not yet loaded', () => {
            baMock.isLoaded.set(false);
            expect(service.isLoaded()).toBe(false);
        });
    });

    describe('isSignedIn', () => {
        it('returns false when not signed in', () => {
            expect(service.isSignedIn()).toBe(false);
        });

        it('returns true when betterAuth is signed in', () => {
            baMock.isSignedIn.set(true);
            expect(service.isSignedIn()).toBe(true);
        });
    });

    describe('isAdmin', () => {
        it('returns false by default', () => {
            expect(service.isAdmin()).toBe(false);
        });

        it('returns true when betterAuth user is admin', () => {
            baMock.isAdmin.set(true);
            expect(service.isAdmin()).toBe(true);
        });
    });

    describe('userIdentifier', () => {
        it('returns null when no user is signed in', () => {
            expect(service.userIdentifier()).toBeNull();
        });

        it('returns the user email when signed in', () => {
            baMock.user.set(MOCK_USER);
            expect(service.userIdentifier()).toBe('user@example.com');
        });
    });

    describe('providers', () => {
        it('returns default providers', () => {
            expect(service.providers()).toEqual(DEFAULT_PROVIDERS);
        });

        it('reflects provider config from betterAuth', () => {
            const provs: AuthProvidersConfig = { emailPassword: true, github: true, google: false, mfa: false };
            baMock.providers.set(provs);
            expect(service.providers()).toEqual(provs);
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // Async methods
    // ──────────────────────────────────────────────────────────────────────────

    describe('getToken()', () => {
        it('delegates to betterAuth.getToken', async () => {
            baMock.getToken.mockResolvedValue('token-abc');
            expect(await service.getToken()).toBe('token-abc');
            expect(baMock.getToken).toHaveBeenCalled();
        });

        it('returns null when betterAuth returns null', async () => {
            baMock.getToken.mockResolvedValue(null);
            expect(await service.getToken()).toBeNull();
        });
    });

    describe('signOut()', () => {
        it('delegates to betterAuth.signOut', async () => {
            await service.signOut();
            expect(baMock.signOut).toHaveBeenCalled();
        });
    });

    describe('login()', () => {
        it('calls betterAuth.signIn and returns empty object on success', async () => {
            baMock.signIn.mockResolvedValue(undefined);
            const result = await service.login('user@example.com', 'pass123');
            expect(result).toEqual({});
            expect(baMock.signIn).toHaveBeenCalledWith('user@example.com', 'pass123');
        });

        it('returns error message from betterAuth error body', async () => {
            baMock.signIn.mockRejectedValue({ error: { message: 'Invalid credentials' } });
            const result = await service.login('user@example.com', 'wrong');
            expect(result.error).toBe('Invalid credentials');
        });

        it('returns fallback message for unexpected error shapes', async () => {
            baMock.signIn.mockRejectedValue('unexpected');
            const result = await service.login('user@example.com', 'pass');
            expect(result.error).toBe('Sign in failed. Please check your credentials.');
        });
    });

    describe('signup()', () => {
        it('calls betterAuth.signUp and returns empty object on success', async () => {
            baMock.signUp.mockResolvedValue(undefined);
            const result = await service.signup('new@example.com', 'pass123');
            expect(result).toEqual({});
            expect(baMock.signUp).toHaveBeenCalledWith('new@example.com', 'pass123');
        });

        it('returns error message on failure', async () => {
            baMock.signUp.mockRejectedValue({ error: { message: 'Email already taken' } });
            const result = await service.signup('taken@example.com', 'pass');
            expect(result.error).toBe('Email already taken');
        });

        it('returns fallback message for unexpected signup errors', async () => {
            baMock.signUp.mockRejectedValue('oops');
            const result = await service.signup('user@example.com', 'pass');
            expect(result.error).toBeDefined();
        });
    });

    describe('updateProfile()', () => {
        it('delegates to betterAuth.updateProfile', async () => {
            baMock.updateProfile.mockResolvedValue({});
            expect(await service.updateProfile('new@example.com')).toEqual({});
            expect(baMock.updateProfile).toHaveBeenCalledWith('new@example.com');
        });

        it('passes through error response', async () => {
            baMock.updateProfile.mockResolvedValue({ error: 'Email already in use' });
            const result = await service.updateProfile('taken@example.com');
            expect(result.error).toBe('Email already in use');
        });
    });

    describe('changePassword()', () => {
        it('delegates to betterAuth.changePassword', async () => {
            baMock.changePassword.mockResolvedValue({});
            expect(await service.changePassword('old', 'new')).toEqual({});
            expect(baMock.changePassword).toHaveBeenCalledWith('old', 'new');
        });

        it('passes through error response', async () => {
            baMock.changePassword.mockResolvedValue({ error: 'Incorrect current password' });
            const result = await service.changePassword('wrong', 'new');
            expect(result.error).toBe('Incorrect current password');
        });
    });

    describe('signInWithSocial()', () => {
        it('calls betterAuth.signInWithSocial and returns empty object on success', async () => {
            baMock.signInWithSocial.mockResolvedValue(undefined);
            const result = await service.signInWithSocial('github');
            expect(result).toEqual({});
            expect(baMock.signInWithSocial).toHaveBeenCalledWith('github');
        });

        it('returns error message on failure', async () => {
            baMock.signInWithSocial.mockRejectedValue({ error: { message: 'OAuth error' } });
            const result = await service.signInWithSocial('github');
            expect(result.error).toBe('OAuth error');
        });
    });
});
