import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthFacadeService } from './auth-facade.service';
import { BetterAuthService, type BetterAuthUser } from './better-auth.service';

const MOCK_BA_USER: BetterAuthUser = {
    id: 'ba-1',
    email: 'user@example.com',
    name: 'Test User',
    emailVerified: true,
    image: null,
    tier: 'free',
    role: 'user',
};

const MOCK_ADMIN_BA_USER: BetterAuthUser = {
    ...MOCK_BA_USER,
    role: 'admin',
};

type MockClerkUser = {
    id: string;
    primaryEmailAddress: { emailAddress: string } | null;
    publicMetadata: Record<string, unknown>;
};

function makeClerkMock(overrides: Partial<{
    isLoaded: boolean;
    isAvailable: boolean;
    isSignedIn: boolean;
    user: MockClerkUser | null;
    getToken: () => Promise<string | null>;
    signOut: () => Promise<void>;
}> = {}) {
    return {
        isLoaded: vi.fn().mockReturnValue(overrides.isLoaded ?? true),
        isAvailable: vi.fn().mockReturnValue(overrides.isAvailable ?? false),
        isSignedIn: vi.fn().mockReturnValue(overrides.isSignedIn ?? false),
        user: vi.fn().mockReturnValue(overrides.user ?? null),
        getToken: vi.fn().mockImplementation(overrides.getToken ?? (() => Promise.resolve(null))),
        signOut: vi.fn().mockImplementation(overrides.signOut ?? (() => Promise.resolve())),
    };
}

function makeBetterAuthMock(overrides: Partial<{
    isLoaded: boolean;
    isSignedIn: boolean;
    isAdmin: boolean;
    user: BetterAuthUser | null;
    getToken: () => Promise<string | null>;
    signIn: (email: string, pw: string) => Promise<void>;
    signUp: (email: string, pw: string, name?: string) => Promise<void>;
    signOut: () => Promise<void>;
}> = {}) {
    return {
        isLoaded: vi.fn().mockReturnValue(overrides.isLoaded ?? true),
        isSignedIn: vi.fn().mockReturnValue(overrides.isSignedIn ?? false),
        isAdmin: vi.fn().mockReturnValue(overrides.isAdmin ?? false),
        user: vi.fn().mockReturnValue(overrides.user ?? null),
        getToken: vi.fn().mockImplementation(overrides.getToken ?? (() => Promise.resolve(null))),
        signIn: vi.fn().mockImplementation(overrides.signIn ?? (() => Promise.resolve())),
        signUp: vi.fn().mockImplementation(overrides.signUp ?? (() => Promise.resolve())),
        signOut: vi.fn().mockImplementation(overrides.signOut ?? (() => Promise.resolve())),
    };
}

describe('AuthFacadeService', () => {
    let service: AuthFacadeService;
    let clerkMock: ReturnType<typeof makeClerkMock>;
    let baMock: ReturnType<typeof makeBetterAuthMock>;

    function setup(
        clerkOverrides: Parameters<typeof makeClerkMock>[0] = {},
        baOverrides: Parameters<typeof makeBetterAuthMock>[0] = {},
    ) {
        clerkMock = makeClerkMock(clerkOverrides);
        baMock = makeBetterAuthMock(baOverrides);

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                { provide: ClerkService, useValue: clerkMock },
                { provide: BetterAuthService, useValue: baMock },
            ],
        });
        service = TestBed.inject(AuthFacadeService);
    }

    describe('provider selection — Better Auth active (Clerk not available)', () => {
        beforeEach(() => setup({ isAvailable: false }));

        it('should be created', () => {
            expect(service).toBeTruthy();
        });

        it('useClerk should return false', () => {
            expect(service.useClerk()).toBe(false);
        });

        it('useBetterAuth should return true', () => {
            expect(service.useBetterAuth()).toBe(true);
        });

        it('isLoaded delegates to clerk.isLoaded then betterAuth.isLoaded', () => {
            clerkMock.isLoaded.mockReturnValue(true);
            baMock.isLoaded.mockReturnValue(true);
            expect(service.isLoaded()).toBe(true);
        });

        it('isLoaded is false when clerk is not yet loaded', () => {
            clerkMock.isLoaded.mockReturnValue(false);
            expect(service.isLoaded()).toBe(false);
        });

        it('isLoaded waits for betterAuth.isLoaded when clerk is loaded but unavailable', () => {
            clerkMock.isLoaded.mockReturnValue(true);
            baMock.isLoaded.mockReturnValue(false);
            expect(service.isLoaded()).toBe(false);
        });

        it('isSignedIn delegates to betterAuth.isSignedIn', () => {
            baMock.isSignedIn.mockReturnValue(true);
            expect(service.isSignedIn()).toBe(true);
        });

        it('isAdmin delegates to betterAuth.isAdmin', () => {
            baMock.isSignedIn.mockReturnValue(true);
            baMock.isAdmin.mockReturnValue(true);
            expect(service.isAdmin()).toBe(true);
        });

        it('userIdentifier returns Better Auth user email', () => {
            baMock.isSignedIn.mockReturnValue(true);
            baMock.user.mockReturnValue(MOCK_BA_USER);
            expect(service.userIdentifier()).toBe('user@example.com');
        });

        it('userIdentifier returns null when no user', () => {
            baMock.user.mockReturnValue(null);
            expect(service.userIdentifier()).toBeNull();
        });

        it('getToken delegates to betterAuth.getToken', async () => {
            baMock.isSignedIn.mockReturnValue(true);
            baMock.getToken.mockResolvedValue('ba-session-token');
            const token = await service.getToken();
            expect(token).toBe('ba-session-token');
            expect(baMock.getToken).toHaveBeenCalled();
        });

        it('signOut delegates to betterAuth.signOut', async () => {
            baMock.isSignedIn.mockReturnValue(true);
            await service.signOut();
            expect(baMock.signOut).toHaveBeenCalled();
        });
    });

    describe('provider selection — Clerk active', () => {
        const clerkUser: MockClerkUser = {
            id: 'clerk-user-1',
            primaryEmailAddress: { emailAddress: 'clerk@example.com' },
            publicMetadata: { role: 'user' },
        };

        beforeEach(() =>
            setup({
                isAvailable: true,
                isLoaded: true,
                isSignedIn: true,
                user: clerkUser,
                getToken: () => Promise.resolve('clerk-jwt'),
            }),
        );

        it('useClerk should return true', () => {
            expect(service.useClerk()).toBe(true);
        });

        it('useBetterAuth should return false', () => {
            expect(service.useBetterAuth()).toBe(false);
        });

        it('isSignedIn delegates to clerk.isSignedIn', () => {
            clerkMock.isSignedIn.mockReturnValue(true);
            expect(service.isSignedIn()).toBe(true);
        });

        it('isAdmin returns true for clerk user with admin role', () => {
            clerkMock.user.mockReturnValue({
                ...clerkUser,
                publicMetadata: { role: 'admin' },
            });
            expect(service.isAdmin()).toBe(true);
        });

        it('getToken delegates to clerk.getToken', async () => {
            const token = await service.getToken();
            expect(token).toBe('clerk-jwt');
            expect(clerkMock.getToken).toHaveBeenCalled();
        });

        it('signOut delegates to clerk.signOut', async () => {
            await service.signOut();
            expect(clerkMock.signOut).toHaveBeenCalled();
        });
    });

    describe('login() — Better Auth active', () => {
        beforeEach(() => setup({ isAvailable: false }));

        it('returns empty object on success', async () => {
            baMock.signIn.mockResolvedValue(undefined);
            const result = await service.login('user@example.com', 'password');
            expect(result).toEqual({});
            expect(baMock.signIn).toHaveBeenCalledWith('user@example.com', 'password');
        });

        it('returns error message on failure', async () => {
            baMock.signIn.mockRejectedValue({ error: { message: 'Invalid credentials' } });
            const result = await service.login('user@example.com', 'wrong');
            expect(result.error).toBe('Invalid credentials');
        });

        it('returns fallback message when error is not an Error instance', async () => {
            baMock.signIn.mockRejectedValue('unexpected string');
            const result = await service.login('user@example.com', 'pass');
            expect(result.error).toBe('Sign in failed. Please check your credentials.');
        });
    });

    describe('login() — Clerk active (no-op)', () => {
        beforeEach(() => setup({ isAvailable: true, isSignedIn: true }));

        it('returns empty object without calling betterAuth.signIn', async () => {
            const result = await service.login('clerk@example.com', 'pass');
            expect(result).toEqual({});
            expect(baMock.signIn).not.toHaveBeenCalled();
        });
    });

    describe('signup() — Better Auth active', () => {
        beforeEach(() => setup({ isAvailable: false }));

        it('returns empty object on success', async () => {
            baMock.signUp.mockResolvedValue(undefined);
            const result = await service.signup('new@example.com', 'password');
            expect(result).toEqual({});
            expect(baMock.signUp).toHaveBeenCalledWith('new@example.com', 'password');
        });

        it('returns error message on failure', async () => {
            baMock.signUp.mockRejectedValue({ error: { message: 'Email already taken' } });
            const result = await service.signup('taken@example.com', 'pass');
            expect(result.error).toBe('Email already taken');
        });
    });

    describe('signup() — Clerk active (no-op)', () => {
        beforeEach(() => setup({ isAvailable: true, isSignedIn: true }));

        it('returns empty object without calling betterAuth.signUp', async () => {
            const result = await service.signup('clerk@example.com', 'pass');
            expect(result).toEqual({});
            expect(baMock.signUp).not.toHaveBeenCalled();
        });
    });
});
