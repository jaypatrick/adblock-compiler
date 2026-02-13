/**
 * Zod schemas for configuration validation.
 * Provides runtime type validation with TypeScript integration.
 */

import { z } from 'zod';
import { SourceType, TransformationType } from '../types/index.ts';

/**
 * Schema for source type validation
 */
const SourceTypeSchema = z.nativeEnum(SourceType);

/**
 * Schema for transformation type validation
 */
const TransformationTypeSchema = z.nativeEnum(TransformationType);

/**
 * Schema for a single source configuration
 */
export const SourceSchema = z.object({
    source: z.string().min(1, 'source is required and must be a non-empty string'),
    name: z.string().min(1, 'name must be a non-empty string').optional(),
    type: SourceTypeSchema.optional(),
    transformations: z.array(TransformationTypeSchema).optional(),
    exclusions: z.array(z.string()).optional(),
    exclusions_sources: z.array(z.string()).optional(),
    inclusions: z.array(z.string()).optional(),
    inclusions_sources: z.array(z.string()).optional(),
}).strict();

/**
 * Schema for the main configuration
 */
export const ConfigurationSchema = z.object({
    name: z.string().min(1, 'name is required and must be a non-empty string'),
    description: z.string().optional(),
    homepage: z.string().optional(),
    license: z.string().optional(),
    version: z.string().optional(),
    sources: z.array(SourceSchema).nonempty('sources is required and must be a non-empty array'),
    transformations: z.array(TransformationTypeSchema).optional(),
    exclusions: z.array(z.string()).optional(),
    exclusions_sources: z.array(z.string()).optional(),
    inclusions: z.array(z.string()).optional(),
    inclusions_sources: z.array(z.string()).optional(),
}).strict();

/**
 * Type inference from the schema
 */
export type ConfigurationInput = z.input<typeof ConfigurationSchema>;
export type SourceInput = z.input<typeof SourceSchema>;
