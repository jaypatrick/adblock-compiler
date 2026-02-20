/**
 * Zod schemas for runtime validation with TypeScript integration.
 * Provides type-safe validation for configuration objects.
 */

import { z } from 'zod';
import { SourceType, TransformationType } from '../types/index.ts';

/**
 * Schema for filterable properties (exclusions/inclusions)
 */
const FilterableSchema = z.object({
    exclusions: z.array(z.string()).optional(),
    exclusions_sources: z.array(z.string()).optional(),
    inclusions: z.array(z.string()).optional(),
    inclusions_sources: z.array(z.string()).optional(),
});

/**
 * Schema for transformable properties
 */
const TransformableSchema = z.object({
    transformations: z.array(z.nativeEnum(TransformationType)).optional(),
});

/**
 * Schema for source type validation
 */
const SourceTypeSchema = z.nativeEnum(SourceType);

/**
 * Schema for ISource validation
 */
export const SourceSchema = z.object({
    source: z.string().min(1, 'source is required and must be a non-empty string'),
    name: z.string().min(1, 'name must be a non-empty string').optional(),
    type: SourceTypeSchema.optional(),
}).merge(FilterableSchema).merge(TransformableSchema).strict();

/**
 * Schema for IConfiguration validation
 */
export const ConfigurationSchema = z.object({
    name: z.string().min(1, 'name is required and must be a non-empty string'),
    description: z.string().optional(),
    homepage: z.string().optional(),
    license: z.string().optional(),
    version: z.string().optional(),
    sources: z.array(SourceSchema).nonempty('sources is required and must be a non-empty array'),
}).merge(FilterableSchema).merge(TransformableSchema).strict();

/**
 * Schema for CompileRequest validation (worker)
 */
export const CompileRequestSchema = z.object({
    configuration: ConfigurationSchema,
    preFetchedContent: z.record(z.string(), z.string()).optional(),
    benchmark: z.boolean().optional(),
    priority: z.enum(['standard', 'high']).optional(),
    turnstileToken: z.string().optional(),
});

/**
 * Schema for BatchRequest validation (worker)
 */
export const BatchRequestSchema = z.object({
    requests: z.array(
        z.object({
            id: z.string().min(1, 'id is required and must be a non-empty string'),
            configuration: ConfigurationSchema,
            preFetchedContent: z.record(z.string(), z.string()).optional(),
            benchmark: z.boolean().optional(),
        }),
    ).nonempty('requests array must not be empty'),
    priority: z.enum(['standard', 'high']).optional(),
}).refine(
    (data) => {
        // Check for duplicate IDs
        const ids = new Set<string>();
        for (const req of data.requests) {
            if (ids.has(req.id)) {
                return false;
            }
            ids.add(req.id);
        }
        return true;
    },
    {
        message: 'Duplicate request IDs are not allowed',
        path: ['requests'],
    },
);

/**
 * Schema for sync batch requests (max 10 items)
 */
export const BatchRequestSyncSchema = BatchRequestSchema.refine(
    (data) => data.requests.length <= 10,
    {
        message: 'Batch request limited to 10 requests maximum',
        path: ['requests'],
    },
);

/**
 * Schema for async batch requests (max 100 items)
 */
export const BatchRequestAsyncSchema = BatchRequestSchema.refine(
    (data) => data.requests.length <= 100,
    {
        message: 'Batch request limited to 100 requests maximum',
        path: ['requests'],
    },
);

// ============================================================================
// Platform Type Schemas
// ============================================================================

/**
 * Schema for HTTP fetcher options
 */
export const HttpFetcherOptionsSchema = z.object({
    timeout: z.number().int().positive().optional(),
    userAgent: z.string().optional(),
    allowEmptyResponse: z.boolean().optional(),
    headers: z.record(z.string(), z.string()).optional(),
});

/**
 * Schema for platform compiler options
 * Note: preFetchedContent and customFetcher are not validated as they are runtime objects
 */
export const PlatformCompilerOptionsSchema = z.object({
    preFetchedContent: z.union([
        z.map(z.string(), z.string()),
        z.record(z.string(), z.string()),
    ]).optional(),
    httpOptions: HttpFetcherOptionsSchema.optional(),
}).passthrough(); // Allow customFetcher which is not serializable

// ============================================================================
// Validation Error Schemas
// ============================================================================

/**
 * Schema for validation error type enum
 */
export const ValidationErrorTypeSchema = z.enum([
    'parse_error',
    'syntax_error',
    'unsupported_modifier',
    'invalid_hostname',
    'ip_not_allowed',
    'pattern_too_short',
    'public_suffix_match',
    'invalid_characters',
    'cosmetic_not_supported',
    'modifier_validation_failed',
]);

/**
 * Schema for validation severity enum
 */
export const ValidationSeveritySchema = z.enum([
    'error',
    'warning',
    'info',
]);

/**
 * Schema for a single validation error
 */
export const ValidationErrorSchema = z.object({
    type: ValidationErrorTypeSchema,
    severity: ValidationSeveritySchema,
    ruleText: z.string(),
    lineNumber: z.number().int().min(1).optional(), // Line numbers are 1-based
    message: z.string(),
    details: z.string().optional(),
    ast: z.unknown().optional(), // AST node - not validated as it's complex
    sourceName: z.string().optional(),
});

/**
 * Schema for validation report
 */
export const ValidationReportSchema = z.object({
    errorCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    infoCount: z.number().int().nonnegative(),
    errors: z.array(ValidationErrorSchema),
    totalRules: z.number().int().nonnegative(),
    validRules: z.number().int().nonnegative(),
    invalidRules: z.number().int().nonnegative(),
});

/**
 * Schema for validation result (compilation result with validation report)
 */
export const ValidationResultSchema = z.object({
    rules: z.array(z.string()),
    validation: ValidationReportSchema,
});
