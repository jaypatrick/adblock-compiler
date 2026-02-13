/**
 * Zod schemas for worker handler request validation.
 * Provides runtime type validation for API request bodies.
 */

import { z } from 'zod';
import { ConfigurationSchema } from '../../src/configuration/schemas.ts';

/**
 * Priority schema
 */
const PrioritySchema = z.enum(['standard', 'high']);

/**
 * Schema for compile request body
 */
export const CompileRequestSchema = z.object({
    configuration: ConfigurationSchema,
    preFetchedContent: z.record(z.string()).optional(),
    benchmark: z.boolean().optional(),
    priority: PrioritySchema.optional(),
    turnstileToken: z.string().optional(),
}).strict();

/**
 * Schema for batch compile request item
 */
const BatchRequestItemSchema = z.object({
    id: z.string().min(1, 'Each request must have an "id" field'),
    configuration: ConfigurationSchema,
    preFetchedContent: z.record(z.string()).optional(),
    benchmark: z.boolean().optional(),
}).strict();

/**
 * Schema for batch compile request body
 */
export const BatchRequestSchema = z.object({
    requests: z.array(BatchRequestItemSchema)
        .min(1, 'Batch request must contain at least one request')
        .max(100, 'Batch request limited to 100 requests maximum'),
    priority: PrioritySchema.optional(),
}).strict();

/**
 * Schema for AST parse request body
 */
export const ASTParseRequestSchema = z.object({
    rules: z.array(z.string()).optional(),
    text: z.string().optional(),
}).strict().refine(
    (data) => data.rules !== undefined || data.text !== undefined,
    {
        message: 'Request must include either "rules" array or "text" string',
    },
);

/**
 * Type inference from schemas
 */
export type CompileRequestInput = z.input<typeof CompileRequestSchema>;
export type BatchRequestInput = z.input<typeof BatchRequestSchema>;
export type ASTParseRequestInput = z.input<typeof ASTParseRequestSchema>;
