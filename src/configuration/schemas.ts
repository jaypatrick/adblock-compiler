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
            id: z.string(),
            configuration: ConfigurationSchema,
            preFetchedContent: z.record(z.string(), z.string()).optional(),
            benchmark: z.boolean().optional(),
        }),
    ),
    priority: z.enum(['standard', 'high']).optional(),
});
