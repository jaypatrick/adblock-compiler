/**
 * Tests for the Extensible Token Validator System.
 *
 * Covers:
 *   - SessionRevocationValidator: revoked/not revoked, null sessionId, no RATE_LIMIT
 *   - ClaimsIntegrityValidator: anonymous pass, valid JWT context pass, bad tier, empty role
 *   - runTokenValidators: runs all, short-circuits, catches exceptions
 *
 * @see worker/middleware/token-validator.ts
 */

import { assertEquals } from '@std/assert';
import { ClaimsIntegrityValidator, type ITokenValidator, runTokenValidators, SessionRevocationValidator, TOKEN_VALIDATOR_REGISTRY } from './token-validator.ts';
import { type Env, type IAuthContext, UserTier } from '../types.ts';

// ============================================================================
// Fixtures
// ============================================================================

function makeAuthContext(overrides: Partial<IAuthContext> = {}): IAuthContext {
    return {
        userId: 'user-001',
        clerkUserId: 'clerk-user-001',
        tier: UserTier.Free,
        role: 'user',
        apiKeyId: null,
        sessionId: 'sess-001',
        scopes: [],
        authMethod: 'local-jwt',
        ...overrides,
    };
}

function makeAnonContext(): IAuthContext {
    return {
        userId: null,
        clerkUserId: null,
        tier: UserTier.Anonymous,
        role: 'anonymous',
        apiKeyId: null,
        sessionId: null,
        scopes: [],
        authMethod: 'anonymous',
    };
}

function makeEnv(kvStore: Record<string, string> = {}): Env {
    return {
        COMPILER_VERSION: '1.0.0-test',
        COMPILATION_CACHE: undefined as unknown as KVNamespace,
        RATE_LIMIT: {
            get: async (key: string) => kvStore[key] ?? null,
            put: async () => undefined,
        } as unknown as KVNamespace,
        METRICS: undefined as unknown as KVNamespace,
        ASSETS: undefined as unknown as Fetcher,
    };
}

function makeEnvNoRateLimit(): Env {
    return {
        COMPILER_VERSION: '1.0.0-test',
        COMPILATION_CACHE: undefined as unknown as KVNamespace,
        RATE_LIMIT: undefined as unknown as KVNamespace,
        METRICS: undefined as unknown as KVNamespace,
        ASSETS: undefined as unknown as Fetcher,
    };
}

// ============================================================================
// SessionRevocationValidator
// ============================================================================

Deno.test('SessionRevocationValidator - returns valid when session is not revoked', async () => {
    const ctx = makeAuthContext({ sessionId: 'sess-active' });
    const env = makeEnv({}); // empty KV
    const result = await SessionRevocationValidator.validate('token', ctx, env);
    assertEquals(result.valid, true);
});

Deno.test('SessionRevocationValidator - returns invalid when session is revoked', async () => {
    const ctx = makeAuthContext({ sessionId: 'sess-revoked' });
    const env = makeEnv({ 'revoked:sid:sess-revoked': '1' });
    const result = await SessionRevocationValidator.validate('token', ctx, env);
    assertEquals(result.valid, false);
    assertEquals(result.error, 'Token has been revoked');
});

Deno.test('SessionRevocationValidator - skips check when sessionId is null', async () => {
    const ctx = makeAuthContext({ sessionId: null });
    const env = makeEnv({ 'revoked:sid:null': '1' }); // should never be checked
    const result = await SessionRevocationValidator.validate('token', ctx, env);
    assertEquals(result.valid, true);
});

Deno.test('SessionRevocationValidator - skips check when RATE_LIMIT is undefined', async () => {
    const ctx = makeAuthContext({ sessionId: 'sess-001' });
    const env = makeEnvNoRateLimit();
    const result = await SessionRevocationValidator.validate('token', ctx, env);
    assertEquals(result.valid, true);
});

// ============================================================================
// ClaimsIntegrityValidator
// ============================================================================

Deno.test('ClaimsIntegrityValidator - passes for anonymous context', async () => {
    const ctx = makeAnonContext();
    const env = makeEnv();
    const result = await ClaimsIntegrityValidator.validate('token', ctx, env);
    assertEquals(result.valid, true);
});

Deno.test('ClaimsIntegrityValidator - passes for valid authenticated context', async () => {
    const ctx = makeAuthContext({
        clerkUserId: 'clerk-user-abc',
        tier: UserTier.Pro,
        role: 'user',
    });
    const env = makeEnv();
    const result = await ClaimsIntegrityValidator.validate('token', ctx, env);
    assertEquals(result.valid, true);
});

Deno.test('ClaimsIntegrityValidator - fails when clerkUserId is null', async () => {
    const ctx = makeAuthContext({ clerkUserId: null });
    const env = makeEnv();
    const result = await ClaimsIntegrityValidator.validate('token', ctx, env);
    assertEquals(result.valid, false);
    assertEquals(typeof result.error, 'string');
    assertEquals(result.error!.includes('providerUserId'), true);
});

Deno.test('ClaimsIntegrityValidator - fails when clerkUserId is empty string', async () => {
    const ctx = makeAuthContext({ clerkUserId: '' });
    const env = makeEnv();
    const result = await ClaimsIntegrityValidator.validate('token', ctx, env);
    assertEquals(result.valid, false);
    assertEquals(result.error!.includes('providerUserId'), true);
});

Deno.test('ClaimsIntegrityValidator - fails when tier is invalid', async () => {
    const ctx = makeAuthContext({ tier: 'enterprise' as unknown as UserTier });
    const env = makeEnv();
    const result = await ClaimsIntegrityValidator.validate('token', ctx, env);
    assertEquals(result.valid, false);
    assertEquals(result.error!.includes('invalid tier'), true);
});

Deno.test('ClaimsIntegrityValidator - fails when role is empty string', async () => {
    const ctx = makeAuthContext({ role: '' });
    const env = makeEnv();
    const result = await ClaimsIntegrityValidator.validate('token', ctx, env);
    assertEquals(result.valid, false);
    assertEquals(result.error!.includes('missing role'), true);
});

Deno.test('ClaimsIntegrityValidator - passes for all valid tiers', async () => {
    const env = makeEnv();
    for (const tier of Object.values(UserTier)) {
        if (tier === UserTier.Anonymous) continue; // anonymous skips
        const ctx = makeAuthContext({ tier, clerkUserId: 'clerk-abc', role: 'user' });
        const result = await ClaimsIntegrityValidator.validate('token', ctx, env);
        assertEquals(result.valid, true, `Should pass for tier: ${tier}`);
    }
});

// ============================================================================
// runTokenValidators
// ============================================================================

Deno.test('runTokenValidators - returns valid when all validators pass', async () => {
    const ctx = makeAuthContext();
    const env = makeEnv();
    const result = await runTokenValidators('token', ctx, env);
    assertEquals(result.valid, true);
});

Deno.test('runTokenValidators - short-circuits on first failure', async () => {
    // Save original registry
    const originalRegistry = [...TOKEN_VALIDATOR_REGISTRY];
    TOKEN_VALIDATOR_REGISTRY.length = 0;

    const firstCallCount = { n: 0 };
    const secondCallCount = { n: 0 };

    const alwaysFail: ITokenValidator = {
        name: 'always-fail',
        validate: async () => {
            firstCallCount.n++;
            return { valid: false, error: 'First validator failed' };
        },
    };
    const shouldNotRun: ITokenValidator = {
        name: 'should-not-run',
        validate: async () => {
            secondCallCount.n++;
            return { valid: true };
        },
    };

    TOKEN_VALIDATOR_REGISTRY.push(alwaysFail, shouldNotRun);

    const result = await runTokenValidators('token', makeAuthContext(), makeEnv());
    assertEquals(result.valid, false);
    assertEquals(result.error, 'First validator failed');
    assertEquals(firstCallCount.n, 1);
    assertEquals(secondCallCount.n, 0); // never called

    // Restore registry
    TOKEN_VALIDATOR_REGISTRY.length = 0;
    for (const v of originalRegistry) TOKEN_VALIDATOR_REGISTRY.push(v);
});

Deno.test('runTokenValidators - catches validator exceptions', async () => {
    const originalRegistry = [...TOKEN_VALIDATOR_REGISTRY];
    TOKEN_VALIDATOR_REGISTRY.length = 0;

    const throwingValidator: ITokenValidator = {
        name: 'throwing-validator',
        validate: async () => {
            throw new Error('Unexpected error in validator');
        },
    };

    TOKEN_VALIDATOR_REGISTRY.push(throwingValidator);

    const result = await runTokenValidators('token', makeAuthContext(), makeEnv());
    assertEquals(result.valid, false);
    assertEquals(result.error, 'Token validation failed');

    // Restore registry
    TOKEN_VALIDATOR_REGISTRY.length = 0;
    for (const v of originalRegistry) TOKEN_VALIDATOR_REGISTRY.push(v);
});

Deno.test('runTokenValidators - runs multiple validators in order', async () => {
    const originalRegistry = [...TOKEN_VALIDATOR_REGISTRY];
    TOKEN_VALIDATOR_REGISTRY.length = 0;

    const callOrder: string[] = [];
    const v1: ITokenValidator = {
        name: 'v1',
        validate: async () => {
            callOrder.push('v1');
            return { valid: true };
        },
    };
    const v2: ITokenValidator = {
        name: 'v2',
        validate: async () => {
            callOrder.push('v2');
            return { valid: true };
        },
    };

    TOKEN_VALIDATOR_REGISTRY.push(v1, v2);

    const result = await runTokenValidators('token', makeAuthContext(), makeEnv());
    assertEquals(result.valid, true);
    assertEquals(callOrder, ['v1', 'v2']);

    // Restore registry
    TOKEN_VALIDATOR_REGISTRY.length = 0;
    for (const v of originalRegistry) TOKEN_VALIDATOR_REGISTRY.push(v);
});
