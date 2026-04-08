/**
 * Configuration API handlers.
 *
 * Exposes five endpoints under /api/configuration/:
 *
 *  GET  /api/configuration/defaults   — system defaults + limits (anonymous)
 *  POST /api/configuration/validate   — validate a config object (free tier, Turnstile)
 *  POST /api/configuration/resolve    — merge layers → return effective IConfiguration (free tier, Turnstile)
 *  POST /api/configuration/create     — create and store a configuration file (free tier, Turnstile)
 *  GET  /api/configuration/download/:id — download a stored configuration file (free tier)
 */

import { COMPILATION_DEFAULTS, VALIDATION_DEFAULTS } from '../../src/config/defaults.ts';
import { ConfigurationManager, ConfigurationValidationError, ObjectConfigurationSource } from '../../src/configuration/index.ts';
import { ConfigurationSchema } from '../../src/configuration/schemas.ts';
import { JsonResponse } from '../utils/response.ts';
import type { Env } from '../types.ts';
import { stringify as yamlStringify } from 'yaml';
import { z } from 'zod';

// ── Request schemas ─────────────────────────────────────────────────────────

export const ResolveRequestSchema = z.object({
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

// ============================================================================
// POST /api/configuration/create
// ============================================================================

/**
 * Schema for POST /configuration/create request body.
 */
export const ConfigurationCreateRequestSchema = z.object({
    config: z.record(z.string(), z.unknown()),
    format: z.enum(['json', 'yaml']).optional().default('json'),
    turnstileToken: z.string().optional(),
});

/**
 * Creates and stores a configuration file, returning an ID for download.
 *
 * Request body:
 * ```json
 * {
 *   "config": { ... },
 *   "format": "json" | "yaml",  // optional, defaults to "json"
 *   "turnstileToken": "<token>"
 * }
 * ```
 *
 * Returns `{ id: string, format: string }`.
 */
export async function handleConfigurationCreate(
    request: Request,
    env: Env,
): Promise<Response> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return JsonResponse.badRequest('Request body must be valid JSON');
    }

    const parsed = ConfigurationCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
        return JsonResponse.badRequest(
            parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
        );
    }

    const { config, format } = parsed.data;

    // Validate the configuration
    const validationResult = ConfigurationSchema.safeParse(config);
    if (!validationResult.success) {
        return JsonResponse.success({
            valid: false,
            errors: validationResult.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
                code: issue.code,
            })),
        });
    }

    // Generate a unique ID for this configuration
    const configId = crypto.randomUUID();
    const key = `config:${configId}`;

    // Store in KV with 24-hour expiration.
    // Use dedicated CONFIG_STORE binding when available; fallback to COMPILATION_CACHE.
    const kvStore: KVNamespace = env.CONFIG_STORE ?? env.COMPILATION_CACHE;
    const configData = {
        config: validationResult.data,
        format,
        createdAt: new Date().toISOString(),
    };

    try {
        await kvStore.put(
            key,
            JSON.stringify(configData),
            { expirationTtl: 86400 }, // 24 hours
        );

        return JsonResponse.success({
            id: configId,
            format,
            expiresIn: 86400,
        });
    } catch (err) {
        if (err instanceof Error) {
            return JsonResponse.serverError(`Failed to store configuration: ${err.message}`);
        }
        throw err;
    }
}

// ============================================================================
// GET /api/configuration/download/:id
// ============================================================================

/**
 * Downloads a stored configuration file.
 *
 * Returns the configuration in the requested format (JSON or YAML).
 */
export async function handleConfigurationDownload(
    configId: string,
    format: 'json' | 'yaml' | undefined,
    env: Env,
): Promise<Response> {
    const key = `config:${configId}`;
    // Mirror the same KV selection used during create
    const kvStore: KVNamespace = env.CONFIG_STORE ?? env.COMPILATION_CACHE;

    try {
        const stored = await kvStore.get(key);
        if (!stored) {
            return Response.json(
                { success: false, error: 'Configuration not found or expired' },
                { status: 404 },
            );
        }

        const configData = JSON.parse(stored);
        const config = configData.config;
        const storedFormat = format || configData.format || 'json';

        let content: string;
        let contentType: string;
        let filename: string;

        if (storedFormat === 'yaml') {
            content = yamlStringify(config as Record<string, unknown>);
            contentType = 'application/x-yaml';
            filename = `config-${configId}.yaml`;
        } else {
            content = JSON.stringify(config, null, 4);
            contentType = 'application/json';
            filename = `config-${configId}.json`;
        }

        return new Response(content, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Cache-Control': 'private, no-cache',
            },
        });
    } catch (err) {
        if (err instanceof Error) {
            return JsonResponse.serverError(`Failed to retrieve configuration: ${err.message}`);
        }
        throw err;
    }
}
