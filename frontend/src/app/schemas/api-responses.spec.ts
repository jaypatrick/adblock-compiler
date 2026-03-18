/**
 * Tests for the Zod API response validation schemas.
 *
 * ZTA principle: the Angular frontend treats the Worker as an untrusted
 * external service. These tests verify that schema validation correctly
 * accepts valid API responses and rejects malformed ones.
 *
 * Covers:
 *   - ApiKeySchema: valid and invalid key objects
 *   - GetKeysResponseSchema: full list response
 *   - CompileResponseSchema: compile result with optional fields
 *   - AsyncCompileResponseSchema: async compile
 *   - ValidationResultSchema: validation error list
 *   - validateResponse: throws on invalid data, returns on valid
 *   - AdminListResponseSchema: generic paginated list
 *   - FeatureFlagSchema: feature flag object
 *   - AnnouncementSeveritySchema: valid/invalid severity values
 *
 * @see frontend/src/app/schemas/api-responses.ts
 */

import {
    AdminListResponseSchema,
    AdminRoleSchema,
    AnnouncementSeveritySchema,
    ApiKeySchema,
    AsyncCompileResponseSchema,
    CompileResponseSchema,
    FeatureFlagSchema,
    GetKeysResponseSchema,
    validateResponse,
    ValidationResultSchema,
} from './api-responses';

// ============================================================================
// ApiKeySchema
// ============================================================================

describe('ApiKeySchema', () => {
    const validKey = {
        id: 'key-001',
        keyPrefix: 'abc_0123',
        name: 'My API Key',
        scopes: ['compile', 'rules'],
        rateLimitPerMinute: 60,
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: '2024-01-01T00:00:00Z',
    };

    it('accepts a valid API key object', () => {
        expect(ApiKeySchema.safeParse(validKey).success).toBe(true);
    });

    it('accepts null nullable fields', () => {
        const result = ApiKeySchema.safeParse({ ...validKey, lastUsedAt: null, expiresAt: null });
        expect(result.success).toBe(true);
    });

    it('accepts non-null lastUsedAt', () => {
        const result = ApiKeySchema.safeParse({ ...validKey, lastUsedAt: '2024-06-01T12:00:00Z' });
        expect(result.success).toBe(true);
    });

    it('rejects missing id field', () => {
        const { id: _id, ...rest } = validKey;
        expect(ApiKeySchema.safeParse(rest).success).toBe(false);
    });

    it('rejects non-array scopes', () => {
        const result = ApiKeySchema.safeParse({ ...validKey, scopes: 'compile' });
        expect(result.success).toBe(false);
    });

    it('rejects non-number rateLimitPerMinute', () => {
        const result = ApiKeySchema.safeParse({ ...validKey, rateLimitPerMinute: 'unlimited' });
        expect(result.success).toBe(false);
    });
});

// ============================================================================
// GetKeysResponseSchema
// ============================================================================

describe('GetKeysResponseSchema', () => {
    it('accepts a valid keys list response', () => {
        const data = {
            success: true,
            keys: [],
            total: 0,
        };
        expect(GetKeysResponseSchema.safeParse(data).success).toBe(true);
    });

    it('rejects response missing keys array', () => {
        expect(GetKeysResponseSchema.safeParse({ success: true, total: 0 }).success).toBe(false);
    });
});

// ============================================================================
// CompileResponseSchema
// ============================================================================

describe('CompileResponseSchema', () => {
    it('accepts minimal compile response', () => {
        expect(CompileResponseSchema.safeParse({ success: true }).success).toBe(true);
    });

    it('accepts compile response with all optional fields', () => {
        const data = {
            success: true,
            rules: ['||ads.example.com^'],
            ruleCount: 1,
            sources: 1,
            benchmark: { duration: '100ms', startTime: 0, endTime: 100 },
            compiledAt: '2024-01-01T00:00:00Z',
            cached: false,
        };
        expect(CompileResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts error response', () => {
        const data = { success: false, error: 'Compilation failed' };
        expect(CompileResponseSchema.safeParse(data).success).toBe(true);
    });

    it('rejects missing success field', () => {
        expect(CompileResponseSchema.safeParse({ rules: [] }).success).toBe(false);
    });
});

// ============================================================================
// AsyncCompileResponseSchema
// ============================================================================

describe('AsyncCompileResponseSchema', () => {
    it('accepts valid async compile response', () => {
        const data = {
            success: true,
            requestId: 'req-001',
            note: 'Queued',
        };
        expect(AsyncCompileResponseSchema.safeParse(data).success).toBe(true);
    });

    it('rejects missing requestId', () => {
        const data = { success: true, note: 'Queued' };
        expect(AsyncCompileResponseSchema.safeParse(data).success).toBe(false);
    });

    it('rejects missing note', () => {
        const data = { success: true, requestId: 'req-001' };
        expect(AsyncCompileResponseSchema.safeParse(data).success).toBe(false);
    });
});

// ============================================================================
// ValidationResultSchema
// ============================================================================

describe('ValidationResultSchema', () => {
    it('accepts a valid validation result', () => {
        const data = {
            success: true,
            valid: true,
            totalRules: 10,
            validRules: 10,
            invalidRules: 0,
            errors: [],
            warnings: [],
        };
        expect(ValidationResultSchema.safeParse(data).success).toBe(true);
    });

    it('accepts validation errors with all required fields', () => {
        const data = {
            success: true,
            valid: false,
            totalRules: 5,
            validRules: 4,
            invalidRules: 1,
            errors: [{
                line: 3,
                rule: '||bad rule',
                errorType: 'SyntaxError',
                message: 'Invalid syntax',
                severity: 'error',
            }],
            warnings: [],
        };
        expect(ValidationResultSchema.safeParse(data).success).toBe(true);
    });

    it('rejects error with invalid severity', () => {
        const data = {
            success: true,
            valid: false,
            totalRules: 1,
            validRules: 0,
            invalidRules: 1,
            errors: [{ line: 1, rule: 'x', errorType: 'E', message: 'm', severity: 'critical' }],
            warnings: [],
        };
        expect(ValidationResultSchema.safeParse(data).success).toBe(false);
    });
});

// ============================================================================
// validateResponse
// ============================================================================

describe('validateResponse', () => {
    it('returns parsed data for valid input', () => {
        const data = { success: true, requestId: 'req-001', note: 'ok' };
        const result = validateResponse(AsyncCompileResponseSchema, data, 'test');
        expect(result.requestId).toBe('req-001');
    });

    it('throws an Error for invalid input', () => {
        expect(() => validateResponse(AsyncCompileResponseSchema, {}, 'test-context')).toThrow(
            'Invalid API response from test-context',
        );
    });
});

// ============================================================================
// AnnouncementSeveritySchema
// ============================================================================

describe('AnnouncementSeveritySchema', () => {
    it('accepts valid severity values', () => {
        for (const severity of ['info', 'warning', 'error', 'success']) {
            expect(AnnouncementSeveritySchema.safeParse(severity).success).toBe(true);
        }
    });

    it('rejects invalid severity value', () => {
        expect(AnnouncementSeveritySchema.safeParse('critical').success).toBe(false);
    });
});

// ============================================================================
// AdminListResponseSchema
// ============================================================================

describe('AdminListResponseSchema', () => {
    it('accepts a valid paginated list', () => {
        const schema = AdminListResponseSchema(AdminRoleSchema);
        const data = {
            success: true as const,
            items: [],
            total: 0,
            limit: 20,
            offset: 0,
        };
        expect(schema.safeParse(data).success).toBe(true);
    });

    it('rejects when success is false', () => {
        const schema = AdminListResponseSchema(AdminRoleSchema);
        const data = { success: false, items: [], total: 0, limit: 20, offset: 0 };
        expect(schema.safeParse(data).success).toBe(false);
    });

    it('rejects missing pagination fields', () => {
        const schema = AdminListResponseSchema(AdminRoleSchema);
        const data = { success: true, items: [] };
        expect(schema.safeParse(data).success).toBe(false);
    });
});

// ============================================================================
// FeatureFlagSchema
// ============================================================================

describe('FeatureFlagSchema', () => {
    const validFlag = {
        id: 1,
        flag_name: 'new-compiler',
        enabled: true,
        rollout_percentage: 50,
        target_tiers: ['pro', 'admin'],
        target_users: [],
        description: 'Test flag',
        created_by: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
    };

    it('accepts a valid feature flag', () => {
        expect(FeatureFlagSchema.safeParse(validFlag).success).toBe(true);
    });

    it('rejects missing enabled field', () => {
        const { enabled: _enabled, ...rest } = validFlag;
        expect(FeatureFlagSchema.safeParse(rest).success).toBe(false);
    });

    it('rejects non-array target_tiers', () => {
        expect(FeatureFlagSchema.safeParse({ ...validFlag, target_tiers: 'pro' }).success).toBe(false);
    });

    it('rejects non-number rollout_percentage', () => {
        expect(FeatureFlagSchema.safeParse({ ...validFlag, rollout_percentage: '50%' }).success).toBe(false);
    });
});
