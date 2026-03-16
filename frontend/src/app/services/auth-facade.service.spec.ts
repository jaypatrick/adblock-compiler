import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthFacadeService } from './auth-facade.service';
import { ClerkService } from './clerk.service';
import { LocalAuthService, LocalUser } from './local-auth.service';

const MOCK_LOCAL_USER: LocalUser = {
    id: 'local-1',
    identifier: 'local@example.com',
    identifier_type: 'email',
    role: 'user',
    tier: 'free',
    api_disabled: 0,
};

const MOCK_ADMIN_LOCAL_USER: LocalUser = {
    ...MOCK_LOCAL_USER,
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

function makeLocalMock(overrides: Partial<{
    isLoaded: boolean;
    isSignedIn: boolean;
    isAdmin: boolean;
    user: LocalUser | null;
    getToken: () => string | null;
    login: (id: string, pw: string) => Promise<void>;
    signup: (id: string, pw: string) => Promise<void>;
    signOut: () => void;
}> = {}) {
    return {
        isLoaded: vi.fn().mockReturnValue(overrides.isLoaded ?? true),
        isSignedIn: vi.fn().mockReturnValue(overrides.isSignedIn ?? false),
        isAdmin: vi.fn().mockReturnValue(overrides.isAdmin ?? false),
        user: vi.fn().mockReturnValue(overrides.user ?? null),
        getToken: vi.fn().mockImplementation(overrides.getToken ?? (() => null)),
        login: vi.fn().mockImplementation(overrides.login ?? (() => Promise.resolve())),
        signup: vi.fn().mockImplementation(overrides.signup ?? (() => Promise.resolve())),
        signOut: vi.fn().mockImplementation(overrides.signOut ?? (() => {})),
    };
}

describe('AuthFacadeService', () => {
    let service: AuthFacadeService;
    let clerkMock: ReturnType<typeof makeClerkMock>;
    let localMock: ReturnType<typeof makeLocalMock>;

    function setup(
        clerkOverrides: Parameters<typeof makeClerkMock>[0] = {},
        localOverrides: Parameters<typeof makeLocalMock>[0] = {},
    ) {
        clerkMock = makeClerkMock(clerkOverrides);
        localMock = makeLocalMock(localOverrides);

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                { provide: ClerkService, useValue: clerkMock },
                { provide: LocalAuthService, useValue: localMock },
            ],
        });
        service = TestBed.inject(AuthFacadeService);
    }

    describe('provider selection — local auth active (Clerk not available)', () => {
        beforeEach(() => setup({ isAvailable: false }));

        it('should be created', () => {
            expect(service).toBeTruthy();
        });

        it('useClerk should return false', () => {
            expect(service.useClerk()).toBe(false);
        });

        it('isLoaded delegates to clerk.isLoaded then local.isLoaded', () => {
            clerkMock.isLoaded.mockReturnValue(true);
            localMock.isLoaded.mockReturnValue(true);
            expect(service.isLoaded()).toBe(true);
        });

        it('isLoaded is false when clerk is not yet loaded', () => {
            clerkMock.isLoaded.mockReturnValue(false);
            expect(service.isLoaded()).toBe(false);
        });

        it('isLoaded waits for local.isLoaded when clerk is loaded but unavailable', () => {
            clerkMock.isLoaded.mockReturnValue(true);
            localMock.isLoaded.mockReturnValue(false);
            expect(service.isLoaded()).toBe(false);
        });

        it('isSignedIn delegates to local.isSignedIn', () => {
            localMock.isSignedIn.mockReturnValue(true);
            expect(service.isSignedIn()).toBe(true);
        });

        it('isAdmin delegates to local.isAdmin', () => {
            localMock.isAdmin.mockReturnValue(true);
            expect(service.isAdmin()).toBe(true);
        });

        it('isAdmin returns false when local user does not have admin role', () => {
            localMock.isAdmin.mockReturnValue(false);
            expect(service.isAdmin()).toBe(false);
        });

        it('userIdentifier returns local user identifier', () => {
            localMock.user.mockReturnValue(MOCK_LOCAL_USER);
            expect(service.userIdentifier()).toBe('local@example.com');
        });

        it('userIdentifier returns null when no user', () => {
            localMock.user.mockReturnValue(null);
            expect(service.userIdentifier()).toBeNull();
        });

        it('getToken delegates to local.getToken', async () => {
            localMock.getToken.mockReturnValue('local-jwt');
            const token = await service.getToken();
            expect(token).toBe('local-jwt');
            expect(localMock.getToken).toHaveBeenCalled();
        });

        it('signOut delegates to local.signOut', async () => {
            await service.signOut();
            expect(localMock.signOut).toHaveBeenCalled();
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

        it('isLoaded is true when clerk is loaded and available', () => {
            expect(service.isLoaded()).toBe(true);
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

        it('isAdmin returns false for clerk user without admin role', () => {
            clerkMock.user.mockReturnValue({
                ...clerkUser,
                publicMetadata: { role: 'user' },
            });
            expect(service.isAdmin()).toBe(false);
        });

        it('isAdmin returns false when clerk user has no publicMetadata', () => {
            clerkMock.user.mockReturnValue({ ...clerkUser, publicMetadata: {} });
            expect(service.isAdmin()).toBe(false);
        });

        it('isAdmin returns false when clerk user is null', () => {
            clerkMock.user.mockReturnValue(null);
            expect(service.isAdmin()).toBe(false);
        });

        it('userIdentifier returns clerk primary email', () => {
            expect(service.userIdentifier()).toBe('clerk@example.com');
        });

        it('userIdentifier falls back to user id when no email', () => {
            clerkMock.user.mockReturnValue({
                ...clerkUser,
                primaryEmailAddress: null,
            });
            expect(service.userIdentifier()).toBe('clerk-user-1');
        });

        it('userIdentifier returns null when clerk user is null', () => {
            clerkMock.user.mockReturnValue(null);
            expect(service.userIdentifier()).toBeNull();
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

    describe('login() — local auth active', () => {
        beforeEach(() => setup({ isAvailable: false }));

        it('returns empty object on success', async () => {
            localMock.login.mockResolvedValue(undefined);
            const result = await service.login('user@example.com', 'password');
            expect(result).toEqual({});
            expect(localMock.login).toHaveBeenCalledWith('user@example.com', 'password');
        });

        it('returns error message on HTTP error with structured body', async () => {
            localMock.login.mockRejectedValue({ error: { error: 'Invalid credentials' } });
            const result = await service.login('user@example.com', 'wrong');
            expect(result.error).toBe('Invalid credentials');
        });

        it('returns error message from Error instance when no structured body', async () => {
            localMock.login.mockRejectedValue(new Error('Network failure'));
            const result = await service.login('user@example.com', 'pass');
            expect(result.error).toBe('Network failure');
        });

        it('returns fallback message when error is not an Error instance', async () => {
            localMock.login.mockRejectedValue('unexpected string');
            const result = await service.login('user@example.com', 'pass');
            expect(result.error).toBe('Sign in failed. Please check your credentials.');
        });
    });

    describe('login() — Clerk active (no-op)', () => {
        beforeEach(() => setup({ isAvailable: true }));

        it('returns empty object without calling local.login', async () => {
            const result = await service.login('clerk@example.com', 'pass');
            expect(result).toEqual({});
            expect(localMock.login).not.toHaveBeenCalled();
        });
    });

    describe('signup() — local auth active', () => {
        beforeEach(() => setup({ isAvailable: false }));

        it('returns empty object on success', async () => {
            localMock.signup.mockResolvedValue(undefined);
            const result = await service.signup('new@example.com', 'password');
            expect(result).toEqual({});
            expect(localMock.signup).toHaveBeenCalledWith('new@example.com', 'password');
        });

        it('returns error message on HTTP error with structured body', async () => {
            localMock.signup.mockRejectedValue({ error: { error: 'Identifier already taken' } });
            const result = await service.signup('taken@example.com', 'pass');
            expect(result.error).toBe('Identifier already taken');
        });

        it('returns error message from Error instance when no structured body', async () => {
            localMock.signup.mockRejectedValue(new Error('Server error'));
            const result = await service.signup('new@example.com', 'pass');
            expect(result.error).toBe('Server error');
        });

        it('returns fallback message when error is not an Error instance', async () => {
            localMock.signup.mockRejectedValue(42);
            const result = await service.signup('new@example.com', 'pass');
            expect(result.error).toBe('Sign up failed. Please try again.');
        });
    });

    describe('signup() — Clerk active (no-op)', () => {
        beforeEach(() => setup({ isAvailable: true }));

        it('returns empty object without calling local.signup', async () => {
            const result = await service.signup('clerk@example.com', 'pass');
            expect(result).toEqual({});
            expect(localMock.signup).not.toHaveBeenCalled();
        });
    });
});
