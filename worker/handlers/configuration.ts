/**
 * Configuration API handlers.
 *
 * Exposes three endpoints under /api/configuration/:
 *
 *  GET  /api/configuration/defaults   — system defaults + limits (anonymous)
 *  POST /api/configuration/validate   — validate a config object (free tier, Turnstile)
 *  POST /api/configuration/resolve    — merge layers → return effective IConfiguration (free tier, Turnstile)
 */

import { COMPILATION_DEFAULTS, VALIDATION_DEFAULTS } from '../../src/config/defaults.ts';
import { ConfigurationManager, ConfigurationValidationError, ObjectConfigurationSource } from '../../src/configuration/index.ts';
import { ConfigurationSchema } from '../../src/configuration/schemas.ts';
import { JsonResponse } from '../utils/response.ts';
import type { Env } from '../types.ts';
import { z } from 'zod';

// ── Request schemas ─────────────────────────────────────────────────────────

const ResolveRequestSchema = z.object({
    config: z.record(z.string(), z.unknown()),
    override: z.record(z.string(), z.unknown()).optional(),
    applyEnvOverrides: z.boolean().optional(),
    turnstileToken: z.string().optional(),
});

/**
 * Schema for POST /configuration/validate request body.
 * Exported for use in Hono route middleware.
 */
export const ConfigurationValidateRequestSchema = z.object({
    config: z.record(z.string(), z.unknown()),
    turnstileToken: z.string().optional(),
});

// ============================================================================
// GET /api/configuration/defaults
// ============================================================================

/**
 * Returns system defaults and hard limits that apply to every compilation.
 * This is an unauthenticated, anonymous-tier endpoint.
 */
export async function handleConfigurationDefaults(
    _request: Request,
    _env: Env,
): Promise<Response> {
    return JsonResponse.success({
        defaults: {
            compilation: COMPILATION_DEFAULTS,
            validation: VALIDATION_DEFAULTS,
        },
        limits: {
            maxSources: VALIDATION_DEFAULTS.MAX_SOURCES,
            maxExclusions: VALIDATION_DEFAULTS.MAX_EXCLUSIONS,
        },
        supportedSourceTypes: ['adblock', 'hosts'],
    });
}

// ============================================================================
// POST /api/configuration/validate
// ============================================================================

/**
 * Validates a configuration object against the schema.
 *
 * Request body:
 * ```json
 * { "config": { ... }, "turnstileToken": "<token>" }
 * ```
 *
 * Returns `{ valid: true }` or `{ valid: false, errors: ZodIssue[] }`.
 */
export async function handleConfigurationValidate(
    request: Request,
    _env: Env,
): Promise<Response> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return JsonResponse.badRequest('Request body must be valid JSON');
    }

    if (typeof body !== 'object' || body === null || !('config' in body)) {
        return JsonResponse.badRequest('Request body must contain a "config" field');
    }

    const { config } = body as { config: unknown };
    const result = ConfigurationSchema.safeParse(config);

    if (result.success) {
        return JsonResponse.success({ valid: true });
    }

    return JsonResponse.success({
        valid: false,
        errors: result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
            code: issue.code,
        })),
    });
}

// ============================================================================
// POST /api/configuration/resolve
// ============================================================================

/**
 * Merges provided configuration layers and returns the effective IConfiguration.
 *
 * Request body:
 * ```json
 * {
 *   "config": { ... },
 *   "override": { ... },  // optional highest-priority JSON overlay
 *   "applyEnvOverrides": true,  // optional, default true
 *   "turnstileToken": "<token>"
 * }
 * ```
 */
export async function handleConfigurationResolve(
    request: Request,
    _env: Env,
): Promise<Response> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return JsonResponse.badRequest('Request body must be valid JSON');
    }

    if (typeof body !== 'object' || body === null || !('config' in body)) {
        return JsonResponse.badRequest('Request body must contain a "config" field');
    }

    const parsed = ResolveRequestSchema.safeParse(body);
    if (!parsed.success) {
        return JsonResponse.badRequest(
            parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
        );
    }

    const { config, override, applyEnvOverrides } = parsed.data;

    try {
        const sources = [new ObjectConfigurationSource(config)];
        if (override !== undefined) {
            sources.push(new ObjectConfigurationSource(override));
        }

        const mgr = ConfigurationManager.fromSources(sources, {
            applyEnvOverrides: applyEnvOverrides !== false,
        });

        const effective = await mgr.load();
        return JsonResponse.success({ config: effective });
    } catch (err) {
        if (err instanceof ConfigurationValidationError) {
            const errors = err.zodError.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
                code: issue.code,
            }));
            return Response.json(
                { success: false, error: 'Configuration validation failed', errors },
                { status: 400 },
            );
        }
        if (err instanceof Error) {
            return JsonResponse.badRequest(`Failed to resolve configuration: ${err.message}`);
        }
        throw err;
    }
}
