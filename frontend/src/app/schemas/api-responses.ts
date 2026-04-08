/**
 * Zod schemas for validating API responses from the Worker backend.
 *
 * ZTA principle: the Angular frontend MUST treat the Worker API as an
 * untrusted external service. All critical API responses are validated
 * at runtime before being consumed by components or services.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

export const ApiKeySchema = z.object({
    id: z.string(),
    keyPrefix: z.string(),
    name: z.string(),
    scopes: z.array(z.string()),
    rateLimitPerMinute: z.number(),
    lastUsedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    createdAt: z.string(),
});
export type ApiKeyValidated = z.infer<typeof ApiKeySchema>;

export const GetKeysResponseSchema = z.object({
    success: z.boolean(),
    keys: z.array(ApiKeySchema),
    total: z.number(),
});

export const CreateKeyResponseSchema = z.object({
    success: z.boolean(),
    key: z.string(),
    id: z.string(),
    keyPrefix: z.string(),
    name: z.string(),
    scopes: z.array(z.string()),
    rateLimitPerMinute: z.number(),
    expiresAt: z.string().nullable(),
    createdAt: z.string(),
});

export const UpdateKeyResponseSchema = z.object({
    success: z.boolean(),
    id: z.string(),
    keyPrefix: z.string(),
    name: z.string(),
    scopes: z.array(z.string()),
    rateLimitPerMinute: z.number(),
    lastUsedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

export const CompileResponseSchema = z.object({
    success: z.boolean(),
    rules: z.array(z.string()).optional(),
    ruleCount: z.number().optional(),
    sources: z.number().optional(),
    benchmark: z
        .object({
            duration: z.string().optional(),
            startTime: z.number().optional(),
            endTime: z.number().optional(),
        })
        .optional(),
    metrics: z
        .object({
            totalDuration: z.number().optional(),
            sourceCount: z.number().optional(),
            transformationCount: z.number().optional(),
            inputRuleCount: z.number().optional(),
            outputRuleCount: z.number().optional(),
            phases: z.record(z.string(), z.number()).optional(),
        })
        .optional(),
    compiledAt: z.string().optional(),
    previousVersion: z
        .object({
            rules: z.array(z.string()),
            ruleCount: z.number(),
            compiledAt: z.string(),
        })
        .optional(),
    cached: z.boolean().optional(),
    deduplicated: z.boolean().optional(),
    error: z.string().optional(),
});

export const AsyncCompileResponseSchema = z.object({
    success: z.boolean(),
    requestId: z.string(),
    note: z.string(),
    message: z.string().optional(),
    batchSize: z.number().optional(),
    priority: z.string().optional(),
    error: z.string().optional(),
});

export const BatchCompileItemSchema = CompileResponseSchema.extend({
    id: z.string(),
});

export const BatchCompileResponseSchema = z.object({
    success: z.boolean(),
    results: z.array(BatchCompileItemSchema),
    error: z.string().optional(),
});

// ---------------------------------------------------------------------------
// AST Viewer — strongly-typed parse response schemas
// ---------------------------------------------------------------------------

export const AstRuleNetworkPropertiesSchema = z.object({
    pattern: z.string(),
    isException: z.boolean(),
    modifiers: z.array(z.object({
        name: z.string(),
        value: z.string().nullable(),
        exception: z.boolean(),
    })),
});

export const AstRuleCosmeticPropertiesSchema = z.object({
    domains: z.array(z.string()),
    separator: z.string(),
    isException: z.boolean(),
    body: z.string(),
    ruleType: z.string(),
});

export const AstRuleHostPropertiesSchema = z.object({
    ip: z.string(),
    hostnames: z.array(z.string()),
    comment: z.string().nullable(),
});

export const AstRuleCommentPropertiesSchema = z.object({
    text: z.string(),
    header: z.string().optional(),
    value: z.string().optional(),
});

export const AstRulePropertiesSchema = z.object({
    network: AstRuleNetworkPropertiesSchema.optional(),
    cosmetic: AstRuleCosmeticPropertiesSchema.optional(),
    host: AstRuleHostPropertiesSchema.optional(),
    comment: AstRuleCommentPropertiesSchema.optional(),
});

export const ParsedRuleInfoSchema = z.object({
    ruleText: z.string(),
    success: z.boolean(),
    error: z.string().optional(),
    category: z.string().optional(),
    type: z.string().optional(),
    syntax: z.string().optional(),
    valid: z.boolean().optional(),
    properties: AstRulePropertiesSchema.optional(),
    ast: z.unknown().optional(),
});
export type ParsedRuleInfo = z.infer<typeof ParsedRuleInfoSchema>;

export const AstSummarySchema = z.object({
    total: z.number(),
    successful: z.number(),
    failed: z.number(),
    byCategory: z.record(z.string(), z.number()),
    byType: z.record(z.string(), z.number()),
});
export type AstSummary = z.infer<typeof AstSummarySchema>;

export const AstParseResponseSchema = z.object({
    success: z.boolean(),
    parsedRules: z.array(ParsedRuleInfoSchema),
    summary: AstSummarySchema.optional(),
    error: z.string().optional(),
});
export type AstParseResponse = z.infer<typeof AstParseResponseSchema>;

export const ASTResultSchema = z.object({
    success: z.boolean(),
    parsedRules: z.unknown(),
    summary: z.unknown().optional(),
    error: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Container Status
// ---------------------------------------------------------------------------

export const ContainerLifecycleStatusSchema = z.enum(['running', 'starting', 'sleeping', 'error', 'unavailable']);

export const ContainerStatusResponseSchema = z.object({
    status: ContainerLifecycleStatusSchema,
    version: z.string().optional(),
    latencyMs: z.number().optional(),
    checkedAt: z.string(),
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const ValidationErrorSchema = z.object({
    line: z.number(),
    column: z.number().optional(),
    rule: z.string(),
    errorType: z.string(),
    message: z.string(),
    severity: z.enum(['error', 'warning', 'info']),
    category: z.string().optional(),
    syntax: z.string().optional(),
});

export const ValidationResultSchema = z.object({
    success: z.boolean(),
    valid: z.boolean(),
    totalRules: z.number(),
    validRules: z.number(),
    invalidRules: z.number(),
    errors: z.array(ValidationErrorSchema),
    warnings: z.array(ValidationErrorSchema),
    duration: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Rule Conversion
// ---------------------------------------------------------------------------

export const ConvertRuleResponseSchema = z.object({
    success: z.boolean(),
    rule: z.string(),
    targetSyntax: z.enum(['adg', 'ubo']),
    convertedRules: z.array(z.string()),
    isConverted: z.boolean(),
    error: z.string().optional(),
    duration: z.string(),
});
export type ConvertRuleResponse = z.infer<typeof ConvertRuleResponseSchema>;

// ---------------------------------------------------------------------------
// Utility: safe parse helper
// ---------------------------------------------------------------------------

/**
 * Validate an API response with the given Zod schema.
 * Returns the parsed value on success, throws a descriptive error on failure.
 */
export function validateResponse<T>(schema: z.ZodType<T>, data: unknown, context: string): T {
    const result = schema.safeParse(data);
    if (!result.success) {
        console.error(`[ZTA] Invalid API response from ${context}:`, result.error.format());
        throw new Error(`Invalid API response from ${context}`);
    }
    return result.data;
}

// ---------------------------------------------------------------------------
// Admin System Responses — ZTA validation for admin panel API calls (#1054)
// ---------------------------------------------------------------------------

/** Announcement severity */
export const AnnouncementSeveritySchema = z.enum(['info', 'warning', 'error', 'success']);

/** Admin role returned by the API */
export const AdminRoleSchema = z.object({
    id: z.number(),
    role_name: z.string(),
    display_name: z.string(),
    description: z.string(),
    permissions: z.array(z.string()),
    is_active: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
});
export type AdminRoleValidated = z.infer<typeof AdminRoleSchema>;

/** Admin role assignment */
export const AdminRoleAssignmentSchema = z.object({
    id: z.number(),
    clerk_user_id: z.string(),
    role_name: z.string(),
    assigned_by: z.string(),
    assigned_at: z.string(),
    expires_at: z.string().nullable(),
});
export type AdminRoleAssignmentValidated = z.infer<typeof AdminRoleAssignmentSchema>;

/** Tier config as returned by the admin API */
export const TierConfigSchema = z.object({
    id: z.number(),
    tier_name: z.string(),
    order_rank: z.number(),
    rate_limit: z.number(),
    display_name: z.string(),
    description: z.string(),
    features: z.record(z.string(), z.unknown()),
    is_active: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
});
export type TierConfigValidated = z.infer<typeof TierConfigSchema>;

/** Scope config as returned by the admin API */
export const ScopeConfigSchema = z.object({
    id: z.number(),
    scope_name: z.string(),
    display_name: z.string(),
    description: z.string(),
    required_tier: z.string(),
    is_active: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
});
export type ScopeConfigValidated = z.infer<typeof ScopeConfigSchema>;

/** Endpoint auth override */
export const EndpointAuthOverrideSchema = z.object({
    id: z.number(),
    path_pattern: z.string(),
    method: z.string(),
    required_tier: z.string().nullable(),
    required_scopes: z.array(z.string()).nullable(),
    is_public: z.boolean(),
    is_active: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
});
export type EndpointAuthOverrideValidated = z.infer<typeof EndpointAuthOverrideSchema>;

/** Feature flag */
export const FeatureFlagSchema = z.object({
    id: z.number(),
    flag_name: z.string(),
    enabled: z.boolean(),
    rollout_percentage: z.number(),
    target_tiers: z.array(z.string()),
    target_users: z.array(z.string()),
    description: z.string(),
    created_by: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
});
export type FeatureFlagValidated = z.infer<typeof FeatureFlagSchema>;

/** Announcement */
export const AdminAnnouncementSchema = z.object({
    id: z.number(),
    title: z.string(),
    body: z.string(),
    severity: AnnouncementSeveritySchema,
    active_from: z.string().nullable(),
    active_until: z.string().nullable(),
    is_active: z.boolean(),
    created_by: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
});
export type AdminAnnouncementValidated = z.infer<typeof AdminAnnouncementSchema>;

/** Audit log entry */
export const AdminAuditLogSchema = z.object({
    id: z.number(),
    actor_id: z.string(),
    actor_email: z.string().nullable(),
    action: z.string(),
    resource_type: z.string(),
    resource_id: z.string().nullable(),
    old_values: z.unknown().nullable(),
    new_values: z.unknown().nullable(),
    ip_address: z.string().nullable(),
    status: z.string(),
    created_at: z.string(),
});
export type AdminAuditLogValidated = z.infer<typeof AdminAuditLogSchema>;

/** Resolved admin context (current user's role + permissions) */
export const ResolvedAdminContextSchema = z.object({
    clerk_user_id: z.string(),
    role_name: z.string(),
    permissions: z.array(z.string()),
    expires_at: z.string().nullable(),
});
export type ResolvedAdminContextValidated = z.infer<typeof ResolvedAdminContextSchema>;

/** Generic admin list response — reusable for all paginated admin endpoints */
export const AdminListResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
    z.object({
        success: z.literal(true),
        items: z.array(itemSchema),
        total: z.number(),
        limit: z.number(),
        offset: z.number(),
    });

// Pre-built list responses for common admin entities
export const GetRolesResponseSchema = AdminListResponseSchema(AdminRoleSchema);
export const GetTierConfigsResponseSchema = AdminListResponseSchema(TierConfigSchema);
export const GetScopeConfigsResponseSchema = AdminListResponseSchema(ScopeConfigSchema);
export const GetFeatureFlagsResponseSchema = AdminListResponseSchema(FeatureFlagSchema);
export const GetAnnouncementsResponseSchema = AdminListResponseSchema(AdminAnnouncementSchema);
export const GetAuditLogsResponseSchema = AdminListResponseSchema(AdminAuditLogSchema);
export const GetEndpointOverridesResponseSchema = AdminListResponseSchema(EndpointAuthOverrideSchema);

// ---------------------------------------------------------------------------
// Diff Response — ZTA validation for POST /diff
// ---------------------------------------------------------------------------

const DiffParseErrorSchemaLocal = z.object({
    line:    z.number(),
    rule:    z.string(),
    message: z.string(),
});

const RuleDiffSchemaLocal = z.object({
    rule:         z.string(),
    type:         z.enum(['added', 'removed', 'modified']),
    source:       z.string().optional(),
    originalLine: z.number().optional(),
    newLine:      z.number().optional(),
    /** Rule category detected by AGTree (network, cosmetic, host, comment, unknown) */
    category:    z.enum(['network', 'cosmetic', 'host', 'comment', 'unknown']).optional(),
    /** Adblock syntax dialect detected by AGTree */
    syntax:      z.string().optional(),
    /** Whether this is an exception (allowlist) rule */
    isException: z.boolean().optional(),
});

const DomainDiffSchemaLocal = z.object({
    domain:  z.string(),
    added:   z.number(),
    removed: z.number(),
});

const CategoryChangeCountsSchemaLocal = z.object({
    network:  z.object({ added: z.number(), removed: z.number() }),
    cosmetic: z.object({ added: z.number(), removed: z.number() }),
    host:     z.object({ added: z.number(), removed: z.number() }),
    comment:  z.object({ added: z.number(), removed: z.number() }),
    unknown:  z.object({ added: z.number(), removed: z.number() }),
});

const DiffSummarySchemaLocal = z.object({
    originalCount:    z.number(),
    newCount:         z.number(),
    addedCount:       z.number(),
    removedCount:     z.number(),
    unchangedCount:   z.number(),
    netChange:        z.number(),
    percentageChange: z.number(),
    /** Per-category breakdown of added/removed counts */
    categoryBreakdown: CategoryChangeCountsSchemaLocal.optional(),
});

const DiffReportSchemaLocal = z.object({
    timestamp:        z.string(),
    generatorVersion: z.string(),
    original:         z.object({ name: z.string().optional(), version: z.string().optional(), timestamp: z.string().optional(), ruleCount: z.number() }),
    current:          z.object({ name: z.string().optional(), version: z.string().optional(), timestamp: z.string().optional(), ruleCount: z.number() }),
    summary:          DiffSummarySchemaLocal,
    added:            z.array(RuleDiffSchemaLocal),
    removed:          z.array(RuleDiffSchemaLocal),
    domainChanges:    z.array(DomainDiffSchemaLocal),
});

export const DiffApiResponseSchema = z.object({
    success:     z.boolean(),
    parseErrors: z.object({
        original: z.array(DiffParseErrorSchemaLocal),
        current:  z.array(DiffParseErrorSchemaLocal),
    }),
    report:   DiffReportSchemaLocal,
    duration: z.string(),
});

export type DiffApiResponse     = z.infer<typeof DiffApiResponseSchema>;
export type DiffReport          = z.infer<typeof DiffReportSchemaLocal>;
export type DiffSummary         = z.infer<typeof DiffSummarySchemaLocal>;
export type RuleDiff            = z.infer<typeof RuleDiffSchemaLocal>;
export type DomainDiff          = z.infer<typeof DomainDiffSchemaLocal>;
export type DiffParseError      = z.infer<typeof DiffParseErrorSchemaLocal>;
export type CategoryChangeCounts = z.infer<typeof CategoryChangeCountsSchemaLocal>;

// ---------------------------------------------------------------------------
// Configuration Builder — ZTA validation for /api/configuration/* endpoints
// ---------------------------------------------------------------------------

const ConfigErrorSchema = z.object({
    path: z.string(),
    message: z.string(),
    code: z.string().optional(),
});
export type ConfigError = z.infer<typeof ConfigErrorSchema>;

/** Response schema for POST /api/configuration/validate */
export const ConfigValidateResponseSchema = z.object({
    success: z.boolean(),
    valid: z.boolean(),
    errors: z.array(ConfigErrorSchema).optional(),
});
export type ConfigValidateResponse = z.infer<typeof ConfigValidateResponseSchema>;

/** Response schema for POST /api/configuration/create */
export const ConfigCreateResponseSchema = z.object({
    success: z.boolean(),
    id: z.string().optional(),
    format: z.string().optional(),
    expiresIn: z.number().optional(),
    valid: z.boolean().optional(),
    errors: z.array(ConfigErrorSchema).optional(),
});
export type ConfigCreateResponse = z.infer<typeof ConfigCreateResponseSchema>;
