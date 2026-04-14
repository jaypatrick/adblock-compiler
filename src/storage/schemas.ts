/**
 * Zod schemas for database model validation.
 *
 * Validates data at the application boundary before writes to PostgreSQL
 * via Prisma. Ensures business rules are enforced in TypeScript regardless
 * of which storage adapter is used.
 */

import { z } from 'zod';

// ============================================================================
// Shared primitives
// ============================================================================

const UuidSchema = z.string().uuid();
const EmailSchema = z.string().email().max(255);
const UrlSchema = z.string().url().max(2048);
const RoleSchema = z.enum(['admin', 'user', 'readonly']);
const HealthStatusSchema = z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']);
const RequestSourceSchema = z.enum(['worker', 'cli', 'batch_api', 'workflow']);

// ============================================================================
// Authentication
// ============================================================================

export const CreateUserSchema = z.object({
    email: EmailSchema,
    displayName: z.string().max(100).optional(),
    role: RoleSchema.default('user'),
});

export const CreateApiKeySchema = z.object({
    userId: UuidSchema,
    name: z.string().min(1).max(100),
    scopes: z.array(z.string().min(1).max(50)).min(1).default(['compile']),
    rateLimitPerMinute: z.number().int().min(1).max(10000).default(60),
    expiresAt: z.coerce.date().optional(),
});

export const CreateSessionSchema = z.object({
    userId: UuidSchema,
    token: z.string().min(32).max(255).optional(),
    ipAddress: z.string().max(45).optional(),
    userAgent: z.string().max(500).optional(),
    expiresAt: z.coerce.date(),
});

// ============================================================================
// Better Auth — Accounts & Verification
// ============================================================================

/** Validates a complete Better Auth Account record (all fields). */
export const AccountSchema = z.object({
    id: UuidSchema,
    userId: UuidSchema,
    accountId: z.string(),
    providerId: z.string(),
    accessToken: z.string().nullable().optional(),
    refreshToken: z.string().nullable().optional(),
    accessTokenExpiresAt: z.coerce.date().nullable().optional(),
    refreshTokenExpiresAt: z.coerce.date().nullable().optional(),
    scope: z.string().nullable().optional(),
    idToken: z.string().nullable().optional(),
    password: z.string().nullable().optional(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
});

/** Validates input for creating a new Better Auth Account (auto-generated fields omitted). */
export const CreateAccountSchema = AccountSchema.omit({ id: true, createdAt: true, updatedAt: true });

/** Validates a complete Better Auth Verification record (all fields). */
export const VerificationSchema = z.object({
    id: UuidSchema,
    identifier: z.string(),
    value: z.string(),
    expiresAt: z.coerce.date(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
});

/** Validates input for creating a new Better Auth Verification (auto-generated fields omitted). */
export const CreateVerificationSchema = VerificationSchema.omit({ id: true, createdAt: true, updatedAt: true });

// ============================================================================
// Filter Sources
// ============================================================================

export const CreateFilterSourceSchema = z.object({
    url: UrlSchema,
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    homepage: UrlSchema.optional(),
    license: z.string().max(100).optional(),
    isPublic: z.boolean().default(true),
    ownerUserId: UuidSchema.optional(),
    refreshIntervalSeconds: z.number().int().min(60).max(86400).default(3600),
});

export const CreateFilterListVersionSchema = z.object({
    sourceId: UuidSchema,
    contentHash: z.string().min(64).max(128),
    ruleCount: z.number().int().min(0),
    etag: z.string().max(500).optional(),
    r2Key: z.string().min(1).max(500),
    expiresAt: z.coerce.date().optional(),
    isCurrent: z.boolean().default(false),
});

// ============================================================================
// Compiled Outputs
// ============================================================================

export const CreateCompiledOutputSchema = z.object({
    configHash: z.string().min(64).max(128),
    configName: z.string().min(1).max(200),
    configSnapshot: z.record(z.string(), z.unknown()),
    ruleCount: z.number().int().min(0),
    sourceCount: z.number().int().min(1),
    durationMs: z.number().int().min(0),
    r2Key: z.string().min(1).max(500),
    ownerUserId: UuidSchema.optional(),
    expiresAt: z.coerce.date().optional(),
});

// ============================================================================
// Compilation Events
// ============================================================================

export const CreateCompilationEventSchema = z.object({
    compiledOutputId: UuidSchema.optional(),
    userId: UuidSchema.optional(),
    apiKeyId: UuidSchema.optional(),
    requestSource: RequestSourceSchema,
    workerRegion: z.string().max(20).optional(),
    durationMs: z.number().int().min(0),
    cacheHit: z.boolean().default(false),
    errorMessage: z.string().max(5000).optional(),
});

// ============================================================================
// Health Tracking
// ============================================================================

export const CreateSourceHealthSnapshotSchema = z.object({
    sourceId: UuidSchema,
    status: HealthStatusSchema.exclude(['unknown']),
    totalAttempts: z.number().int().min(0).default(0),
    successfulAttempts: z.number().int().min(0).default(0),
    failedAttempts: z.number().int().min(0).default(0),
    consecutiveFailures: z.number().int().min(0).default(0),
    avgDurationMs: z.number().min(0).default(0),
    avgRuleCount: z.number().min(0).default(0),
});

export const CreateSourceChangeEventSchema = z.object({
    sourceId: UuidSchema,
    previousVersionId: UuidSchema.optional(),
    newVersionId: UuidSchema,
    ruleCountDelta: z.number().int().default(0),
    contentHashChanged: z.boolean().default(true),
});

// ============================================================================
// Inferred types
// ============================================================================

export type CreateUser = z.infer<typeof CreateUserSchema>;
export type CreateApiKey = z.infer<typeof CreateApiKeySchema>;
export type CreateSession = z.infer<typeof CreateSessionSchema>;
export type Account = z.infer<typeof AccountSchema>;
export type CreateAccount = z.infer<typeof CreateAccountSchema>;
export type Verification = z.infer<typeof VerificationSchema>;
export type CreateVerification = z.infer<typeof CreateVerificationSchema>;
export type CreateFilterSource = z.infer<typeof CreateFilterSourceSchema>;
export type CreateFilterListVersion = z.infer<typeof CreateFilterListVersionSchema>;
export type CreateCompiledOutput = z.infer<typeof CreateCompiledOutputSchema>;
export type CreateCompilationEvent = z.infer<typeof CreateCompilationEventSchema>;
export type CreateSourceHealthSnapshot = z.infer<typeof CreateSourceHealthSnapshotSchema>;
export type CreateSourceChangeEvent = z.infer<typeof CreateSourceChangeEventSchema>;
