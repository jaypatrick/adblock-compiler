/**
 * Extensible Token Validator System
 *
 * Provides a composable validation layer that runs AFTER provider.verifyToken()
 * succeeds. Validators are stored in TOKEN_VALIDATOR_REGISTRY (an ordered array)
 * and executed in sequence — the first failure short-circuits the chain.
 *
 * ## Built-in validators
 * 1. SessionRevocationValidator — checks RATE_LIMIT KV for revoked session IDs
 * 2. ClaimsIntegrityValidator  — verifies userId, tier, and role integrity
 *
 * ## Extensibility
 * Push custom validators to TOKEN_VALIDATOR_REGISTRY after module load:
 * ```typescript
 * TOKEN_VALIDATOR_REGISTRY.push(myCustomValidator);
 * ```
 *
 * ## ZTA compliance
 * Even a valid JWT is rejected if its session has been administratively revoked
 * or if its embedded claims have been tampered with. This closes the window
 * between token issuance and the next JWKS rotation.
 *
 * @see worker/middleware/auth.ts — integration point (called in JWT path)
 */

import { type Env, type IAuthContext, UserTier } from '../types.ts';

// ============================================================================
// Types
// ============================================================================

/** Result of a single token validation step. */
export interface ITokenValidationResult {
    valid: boolean;
    error?: string;
}

/**
 * A single pluggable token validator.
 *
 * Implement this interface and push an instance to TOKEN_VALIDATOR_REGISTRY
 * to add custom validation logic (e.g. device fingerprint check, geo-fence).
 */
export interface ITokenValidator {
    /** Unique name for logging and debugging. */
    readonly name: string;
    /**
     * Validate the token and its resolved auth context.
     * Must never throw — return { valid: false, error } on failure.
     */
    validate(token: string, authContext: IAuthContext, env: Env): Promise<ITokenValidationResult>;
}

// ============================================================================
// Registry
// ============================================================================

/**
 * Ordered list of token validators.
 *
 * Validators are executed in insertion order. The first failure short-circuits
 * the chain. Operators append custom validators at startup.
 *
 * Built-in validators are pushed at module load (see bottom of this file).
 */
export const TOKEN_VALIDATOR_REGISTRY: ITokenValidator[] = [];

// ============================================================================
// Built-in: SessionRevocationValidator
// ============================================================================

/**
 * Checks whether the JWT session ID has been administratively revoked.
 *
 * Revocation is stored in the RATE_LIMIT KV namespace under the key:
 *   `revoked:sid:<sessionId>`
 *
 * To revoke a session, write any non-null value to that key (TTL = token TTL).
 * Skips silently if sessionId is null or RATE_LIMIT is not configured.
 */
export const SessionRevocationValidator: ITokenValidator = {
    name: 'session-revocation',
    async validate(_token: string, authContext: IAuthContext, env: Env): Promise<ITokenValidationResult> {
        if (!authContext.sessionId) return { valid: true };
        if (!env.RATE_LIMIT) return { valid: true };

        const revoked = await env.RATE_LIMIT.get(`revoked:sid:${authContext.sessionId}`);
        if (revoked !== null) {
            return { valid: false, error: 'Token has been revoked' };
        }
        return { valid: true };
    },
};

// ============================================================================
// Built-in: ClaimsIntegrityValidator
// ============================================================================

/**
 * Verifies the integrity of claims embedded in the auth context.
 *
 * For any authenticated (non-anonymous) request, asserts:
 *   - userId is a non-empty string (providerUserId was resolved)
 *   - tier is a recognised UserTier value
 *   - role is a non-empty string
 *
 * Skips silently for anonymous requests (authMethod === 'anonymous').
 * This catches claim-tampering and misconfigured providers early.
 */
export const ClaimsIntegrityValidator: ITokenValidator = {
    name: 'claims-integrity',
    validate(_token: string, authContext: IAuthContext, _env: Env): Promise<ITokenValidationResult> {
        if (authContext.authMethod === 'anonymous') {
            return Promise.resolve({ valid: true });
        }

        if (!authContext.userId || authContext.userId.length === 0) {
            return Promise.resolve({
                valid: false,
                error: 'Token claims integrity check failed: missing providerUserId',
            });
        }

        const validTiers = Object.values(UserTier) as string[];
        if (!validTiers.includes(authContext.tier as string)) {
            return Promise.resolve({
                valid: false,
                error: 'Token claims integrity check failed: invalid tier',
            });
        }

        if (!authContext.role || authContext.role.length === 0) {
            return Promise.resolve({
                valid: false,
                error: 'Token claims integrity check failed: missing role',
            });
        }

        return Promise.resolve({ valid: true });
    },
};

// ============================================================================
// Runner
// ============================================================================

/**
 * Run all registered token validators in order.
 *
 * Returns the FIRST failure (short-circuit evaluation). If all validators
 * pass, returns `{ valid: true }`.
 *
 * Never throws — all exceptions are caught and returned as failures.
 *
 * @param token       - The raw Bearer token string
 * @param authContext - Resolved auth context from the provider
 * @param env         - Worker env bindings
 */
export async function runTokenValidators(
    token: string,
    authContext: IAuthContext,
    env: Env,
): Promise<ITokenValidationResult> {
    for (const validator of TOKEN_VALIDATOR_REGISTRY) {
        try {
            const result = await validator.validate(token, authContext, env);
            if (!result.valid) return result;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // deno-lint-ignore no-console
            console.error(`[token-validator] Validator '${validator.name}' threw unexpectedly:`, message);
            return { valid: false, error: 'Token validation failed' };
        }
    }
    return { valid: true };
}

// Register built-in validators (order matters: revocation check before integrity)
TOKEN_VALIDATOR_REGISTRY.push(SessionRevocationValidator);
TOKEN_VALIDATOR_REGISTRY.push(ClaimsIntegrityValidator);
