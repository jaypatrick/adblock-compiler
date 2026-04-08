/// <reference types="@cloudflare/workers-types" />

/**
 * Compile, validate, AST parse and WebSocket routes.
 *
 * Routes:
 *   POST /compile
 *   POST /compile/stream
 *   POST /compile/batch
 *   POST /ast/parse
 *   POST /validate
 *   GET  /ws/compile
 *   POST /validate-rule
 *   POST /compile/async
 *   POST /compile/batch/async
 *   POST /compile/container
 *   POST /diff
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';
import { buildSyntheticRequest, verifyTurnstileInline } from './shared.ts';

import { bodySizeMiddleware, rateLimitMiddleware, turnstileMiddleware } from '../middleware/hono-middleware.ts';
import { verifyTurnstileToken } from '../middleware/index.ts';

import {
    handleASTParseRequest,
    handleCompileAsync,
    handleCompileBatch,
    handleCompileBatchAsync,
    handleCompileJson,
    handleCompileStream,
    handleValidate,
} from '../handlers/compile.ts';
import { handleConvertRule } from '../handlers/convert-rule.ts';
import { handleValidateRule } from '../handlers/validate-rule.ts';
import { handleDiff } from '../handlers/diff.ts';
import { handleWebSocketUpgrade } from '../websocket.ts';
export const compileRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Compile routes ────────────────────────────────────────────────────────────
//
// All primary compile/validate routes share the same Phase 2 middleware stack:
//   1. bodySizeMiddleware()    — reject oversized payloads (413) via clone
//   2. rateLimitMiddleware()   — per-user/IP tiered quota (429)
//   3. createRoute validation  — structural body validation (422) via OpenAPI
//   4. Inline Turnstile check  — reads token from c.req.valid('json')
//   5. buildSyntheticRequest() — re-creates the Request for the handler
//
// These routes use OpenAPI validation BEFORE Turnstile verification so the body
// stream is consumed exactly once. Turnstile verification is inlined via
// `verifyTurnstileInline()` which reads the token from the already-validated body.
//
// See docs/architecture/hono-routing.md — Phase 2 for the full middleware
// extraction rationale and execution-order guarantees.

// Shared compile request schema
const compileRequestBody = z.object({
    configuration: z.record(z.string(), z.unknown()),
    preFetchedContent: z.record(z.string(), z.string()).optional(),
    benchmark: z.boolean().optional(),
    priority: z.enum(['low', 'normal', 'high']).optional(),
    turnstileToken: z.string().optional(),
});

// Shared compile response schema
const compileSuccessResponse = z.object({
    success: z.boolean(),
    result: z.object({
        output: z.string(),
        stats: z.object({
            total: z.number(),
            processed: z.number(),
            failed: z.number(),
        }).optional(),
        benchmark: z.record(z.string(), z.unknown()).optional(),
    }),
});

const compileRoute = createRoute({
    method: 'post',
    path: '/compile',
    tags: ['Compile'],
    summary: 'Compile filter lists',
    description: 'Compiles adblock filter lists with JSON response',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: compileRequestBody,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Compilation successful',
            content: {
                'application/json': {
                    schema: compileSuccessResponse,
                },
            },
        },
        422: {
            description: 'Validation error',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
    },
});

compileRoutes.use('/compile', bodySizeMiddleware());
compileRoutes.use('/compile', rateLimitMiddleware());
compileRoutes.openapi(compileRoute, async (c) => {
    // deno-lint-ignore no-explicit-any
    const turnstileError = await verifyTurnstileInline(c, (c.req.valid('json') as any).turnstileToken ?? '');
    if (turnstileError) return turnstileError;
    // deno-lint-ignore no-explicit-any
    return handleCompileJson(buildSyntheticRequest(c, c.req.valid('json')), c.env, c.get('analytics'), c.get('requestId')) as any;
});

const compileStreamRoute = createRoute({
    method: 'post',
    path: '/compile/stream',
    tags: ['Compile'],
    summary: 'Compile with streaming',
    description: 'Compiles filter lists with Server-Sent Events streaming',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: compileRequestBody,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Streaming response started',
            content: {
                'text/event-stream': {
                    schema: z.string(),
                },
            },
        },
    },
});

compileRoutes.use('/compile/stream', bodySizeMiddleware());
compileRoutes.use('/compile/stream', rateLimitMiddleware());
compileRoutes.openapi(compileStreamRoute, async (c) => {
    // deno-lint-ignore no-explicit-any
    const turnstileError = await verifyTurnstileInline(c, (c.req.valid('json') as any).turnstileToken ?? '');
    if (turnstileError) return turnstileError;
    // deno-lint-ignore no-explicit-any
    return handleCompileStream(buildSyntheticRequest(c, c.req.valid('json')), c.env) as any;
});

const compileBatchRoute = createRoute({
    method: 'post',
    path: '/compile/batch',
    tags: ['Compile'],
    summary: 'Batch compile',
    description: 'Compiles multiple filter lists in a single request',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        requests: z.array(
                            z.object({
                                id: z.string(),
                                configuration: z.record(z.string(), z.unknown()),
                                preFetchedContent: z.record(z.string(), z.string()).optional(),
                                benchmark: z.boolean().optional(),
                            }),
                        ),
                        priority: z.enum(['low', 'normal', 'high']).optional(),
                        turnstileToken: z.string().optional(),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Batch compilation results',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        results: z.array(
                            z.object({
                                id: z.string(),
                                success: z.boolean(),
                                result: z.unknown().optional(),
                                error: z.string().optional(),
                            }),
                        ),
                    }),
                },
            },
        },
    },
});

compileRoutes.use('/compile/batch', bodySizeMiddleware());
compileRoutes.use('/compile/batch', rateLimitMiddleware());
compileRoutes.openapi(compileBatchRoute, async (c) => {
    // deno-lint-ignore no-explicit-any
    const turnstileError = await verifyTurnstileInline(c, (c.req.valid('json') as any).turnstileToken ?? '');
    if (turnstileError) return turnstileError;
    // deno-lint-ignore no-explicit-any
    return handleCompileBatch(buildSyntheticRequest(c, c.req.valid('json')), c.env) as any;
});

const astParseRoute = createRoute({
    method: 'post',
    path: '/ast/parse',
    tags: ['Compile'],
    summary: 'Parse filter list AST',
    description: 'Parses filter list rules into an Abstract Syntax Tree',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        rules: z.array(z.string()),
                        includeMetadata: z.boolean().optional(),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Parsed AST',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        ast: z.array(z.unknown()),
                    }),
                },
            },
        },
    },
});

compileRoutes.use('/ast/parse', bodySizeMiddleware());
compileRoutes.use('/ast/parse', rateLimitMiddleware());
compileRoutes.use('/ast/parse', turnstileMiddleware());
compileRoutes.openapi(astParseRoute, (c) => {
    // deno-lint-ignore no-explicit-any
    return handleASTParseRequest(buildSyntheticRequest(c, c.req.valid('json')), c.env) as any;
});

const validateRoute = createRoute({
    method: 'post',
    path: '/validate',
    tags: ['Compile'],
    summary: 'Validate filter list',
    description: 'Validates filter list rules without compilation',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        rules: z.array(z.string()),
                        strict: z.boolean().optional(),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Validation results',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        valid: z.boolean(),
                        errors: z.array(
                            z.object({
                                line: z.number(),
                                message: z.string(),
                            }),
                        ).optional(),
                    }),
                },
            },
        },
    },
});

compileRoutes.use('/validate', bodySizeMiddleware());
compileRoutes.use('/validate', rateLimitMiddleware());
compileRoutes.use('/validate', turnstileMiddleware());
compileRoutes.openapi(validateRoute, (c) => {
    // deno-lint-ignore no-explicit-any
    return handleValidate(buildSyntheticRequest(c, c.req.valid('json')), c.env) as any;
});

// ── WebSocket ─────────────────────────────────────────────────────────────────

const wsCompileRoute = createRoute({
    method: 'get',
    path: '/ws/compile',
    tags: ['Compile'],
    summary: 'WebSocket compile endpoint',
    description: 'WebSocket endpoint for real-time compilation updates',
    request: {
        query: z.object({
            turnstileToken: z.string().optional(),
        }),
    },
    responses: {
        101: {
            description: 'WebSocket upgrade successful',
        },
        403: {
            description: 'Turnstile verification failed',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
    },
});

compileRoutes.openapi(wsCompileRoute, async (c) => {
    if (c.env.TURNSTILE_SECRET_KEY) {
        const url = new URL(c.req.url);
        const token = url.searchParams.get('turnstileToken') || '';
        const result = await verifyTurnstileToken(c.env, token, c.get('ip'));
        if (!result.success) {
            return c.json({ success: false, error: result.error || 'Turnstile verification failed' }, 403);
        }
    }
    // deno-lint-ignore no-explicit-any
    return handleWebSocketUpgrade(c.req.raw, c.env) as any;
});

// ── Validate-rule ─────────────────────────────────────────────────────────────

const validateRuleRoute = createRoute({
    method: 'post',
    path: '/validate-rule',
    tags: ['Compile'],
    summary: 'Validate single rule',
    description: 'Validates a single filter list rule',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        rule: z.string(),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Validation result',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        valid: z.boolean(),
                        error: z.string().optional(),
                    }),
                },
            },
        },
    },
});

compileRoutes.use('/validate-rule', bodySizeMiddleware());
compileRoutes.use('/validate-rule', rateLimitMiddleware());
compileRoutes.openapi(validateRuleRoute, (c) => {
    // deno-lint-ignore no-explicit-any
    return handleValidateRule(c.req.raw, c.env) as any;
});

// ── Diff ──────────────────────────────────────────────────────────────────────

const diffRoute = createRoute({
    method: 'post',
    path: '/diff',
    tags: ['Compile'],
    summary: 'Diff two filter lists',
    description: 'Compares two filter lists and returns added, removed, and domain-level changes using the AGTree AST diff engine.',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        original: z.array(z.string()).min(1),
                        current: z.array(z.string()).min(1),
                        options: z.object({
                            ignoreComments: z.boolean().optional(),
                            ignoreEmptyLines: z.boolean().optional(),
                            analyzeDomains: z.boolean().optional(),
                            includeFullRules: z.boolean().optional(),
                            maxRulesToInclude: z.number().int().min(1).max(10_000).optional(),
                        }).optional(),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Diff generated successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        parseErrors: z.object({
                            original: z.array(z.object({ line: z.number(), rule: z.string(), message: z.string() })),
                            current: z.array(z.object({ line: z.number(), rule: z.string(), message: z.string() })),
                        }),
                        report: z.object({
                            timestamp: z.string(),
                            generatorVersion: z.string(),
                            original: z.object({ name: z.string().optional(), version: z.string().optional(), timestamp: z.string().optional(), ruleCount: z.number() }),
                            current: z.object({ name: z.string().optional(), version: z.string().optional(), timestamp: z.string().optional(), ruleCount: z.number() }),
                            summary: z.object({
                                originalCount: z.number(),
                                newCount: z.number(),
                                addedCount: z.number(),
                                removedCount: z.number(),
                                unchangedCount: z.number(),
                                netChange: z.number(),
                                percentageChange: z.number(),
                                categoryBreakdown: z.object({
                                    network: z.object({ added: z.number(), removed: z.number() }),
                                    cosmetic: z.object({ added: z.number(), removed: z.number() }),
                                    host: z.object({ added: z.number(), removed: z.number() }),
                                    comment: z.object({ added: z.number(), removed: z.number() }),
                                    unknown: z.object({ added: z.number(), removed: z.number() }),
                                }).optional(),
                            }),
                            added: z.array(z.object({
                                rule: z.string(),
                                type: z.enum(['added', 'removed', 'modified']),
                                source: z.string().optional(),
                                originalLine: z.number().optional(),
                                newLine: z.number().optional(),
                                category: z.enum(['network', 'cosmetic', 'host', 'comment', 'unknown']).optional(),
                                syntax: z.string().optional(),
                                isException: z.boolean().optional(),
                            })),
                            removed: z.array(z.object({
                                rule: z.string(),
                                type: z.enum(['added', 'removed', 'modified']),
                                source: z.string().optional(),
                                originalLine: z.number().optional(),
                                newLine: z.number().optional(),
                                category: z.enum(['network', 'cosmetic', 'host', 'comment', 'unknown']).optional(),
                                syntax: z.string().optional(),
                                isException: z.boolean().optional(),
                            })),
                            domainChanges: z.array(z.object({ domain: z.string(), added: z.number(), removed: z.number() })),
                        }),
                        duration: z.string(),
                    }),
                },
            },
        },
        400: {
            description: 'Invalid JSON body',
            content: {
                'application/json': {
                    schema: z.object({ success: z.literal(false), error: z.string() }),
                },
            },
        },
        422: {
            description: 'Request validation failed',
            content: {
                'application/json': {
                    schema: z.object({ success: z.literal(false), error: z.string() }),
                },
            },
        },
    },
});

compileRoutes.use('/diff', bodySizeMiddleware());
compileRoutes.use('/diff', rateLimitMiddleware());
// deno-lint-ignore no-explicit-any
compileRoutes.openapi(diffRoute, (c) => handleDiff(buildSyntheticRequest(c, c.req.valid('json')), c.env) as any);

// ── Async compile ─────────────────────────────────────────────────────────────

const compileAsyncRoute = createRoute({
    method: 'post',
    path: '/compile/async',
    tags: ['Compile'],
    summary: 'Async compile',
    description: 'Queues a compilation job for asynchronous processing',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: compileRequestBody,
                },
            },
        },
    },
    responses: {
        202: {
            description: 'Job queued successfully',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        jobId: z.string(),
                        status: z.string(),
                    }),
                },
            },
        },
    },
});

compileRoutes.use('/compile/async', bodySizeMiddleware());
compileRoutes.use('/compile/async', rateLimitMiddleware());
compileRoutes.openapi(compileAsyncRoute, async (c) => {
    // deno-lint-ignore no-explicit-any
    const turnstileError = await verifyTurnstileInline(c, (c.req.valid('json') as any).turnstileToken ?? '');
    if (turnstileError) return turnstileError;
    // deno-lint-ignore no-explicit-any
    return handleCompileAsync(buildSyntheticRequest(c, c.req.valid('json')), c.env) as any;
});

const compileBatchAsyncRoute = createRoute({
    method: 'post',
    path: '/compile/batch/async',
    tags: ['Compile'],
    summary: 'Async batch compile',
    description: 'Queues multiple compilation jobs for asynchronous processing',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        requests: z.array(
                            z.object({
                                id: z.string(),
                                configuration: z.record(z.string(), z.unknown()),
                                preFetchedContent: z.record(z.string(), z.string()).optional(),
                                benchmark: z.boolean().optional(),
                            }),
                        ),
                        priority: z.enum(['low', 'normal', 'high']).optional(),
                        turnstileToken: z.string().optional(),
                    }),
                },
            },
        },
    },
    responses: {
        202: {
            description: 'Batch jobs queued',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        batchId: z.string(),
                        jobIds: z.array(z.string()),
                    }),
                },
            },
        },
    },
});

compileRoutes.use('/compile/batch/async', bodySizeMiddleware());
compileRoutes.use('/compile/batch/async', rateLimitMiddleware());
compileRoutes.openapi(compileBatchAsyncRoute, async (c) => {
    // deno-lint-ignore no-explicit-any
    const turnstileError = await verifyTurnstileInline(c, (c.req.valid('json') as any).turnstileToken ?? '');
    if (turnstileError) return turnstileError;
    // deno-lint-ignore no-explicit-any
    return handleCompileBatchAsync(buildSyntheticRequest(c, c.req.valid('json')), c.env) as any;
});

const compileContainerRoute = createRoute({
    method: 'post',
    path: '/compile/container',
    tags: ['Compile'],
    summary: 'Container compile',
    description: 'Compiles filter lists using Durable Object container',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: compileRequestBody,
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Compilation successful',
            content: {
                'application/json': {
                    schema: compileSuccessResponse,
                },
            },
        },
        503: {
            description: 'Container not available',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        error: z.string(),
                    }),
                },
            },
        },
    },
});

compileRoutes.use('/compile/container', bodySizeMiddleware());
compileRoutes.use('/compile/container', rateLimitMiddleware());
compileRoutes.openapi(compileContainerRoute, async (c) => {
    // deno-lint-ignore no-explicit-any
    const turnstileError = await verifyTurnstileInline(c, (c.req.valid('json') as any).turnstileToken ?? '');
    if (turnstileError) return turnstileError;
    if (!c.env.ADBLOCK_COMPILER) {
        return c.json({ success: false, error: 'Container binding (ADBLOCK_COMPILER) is not available in this deployment' }, 503);
    }
    if (!c.env.CONTAINER_SECRET) {
        return c.json({ success: false, error: 'CONTAINER_SECRET is not configured' }, 503);
    }
    const id = c.env.ADBLOCK_COMPILER.idFromName('default');
    const stub = c.env.ADBLOCK_COMPILER.get(id);
    const containerReq = new Request('http://container/compile', {
        // Note: the URL hostname/scheme is irrelevant for DO stub.fetch() — the stub
        // intercepts the call and routes it to the container's internal server.
        // The path '/compile' maps to the POST /compile handler in container-server.ts.
        // Body is re-serialised from the validated data because OpenAPI validation consumed
        // c.req.raw.body above (cannot re-read a consumed ReadableStream).
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Container-Secret': c.env.CONTAINER_SECRET,
        },
        body: JSON.stringify(c.req.valid('json')),
    });
    const containerRes = await stub.fetch(containerReq);
    // deno-lint-ignore no-explicit-any
    return new Response(containerRes.body, {
        status: containerRes.status,
        headers: containerRes.headers,
    }) as any;
});

// ── Convert-rule ─────────────────────────────────────────────────────────────

const convertRuleRoute = createRoute({
    method: 'post',
    path: '/convert-rule',
    tags: ['Compile'],
    summary: 'Convert a filter rule to a different syntax',
    description: 'Converts a single adblock filter rule between AdGuard and uBlock Origin syntaxes using AGTree',
    request: {
        body: {
            content: {
                'application/json': {
                    // Route body schema uses @hono/zod-openapi's extended `z` for spec generation.
                    // Runtime validation is done separately in handleConvertRule via ConvertRuleRequestSchema.
                    schema: z.object({
                        rule: z.string().min(1),
                        targetSyntax: z.enum(['adg', 'ubo']),
                        turnstileToken: z.string().optional(),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Conversion result',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        rule: z.string(),
                        targetSyntax: z.enum(['adg', 'ubo']),
                        convertedRules: z.array(z.string()),
                        isConverted: z.boolean(),
                        error: z.string().optional(),
                        duration: z.string(),
                    }),
                },
            },
        },
        400: {
            description: 'Invalid request',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
        422: {
            description: 'Validation error',
            content: {
                'application/json': {
                    schema: z.object({ success: z.boolean(), error: z.string() }),
                },
            },
        },
    },
});

compileRoutes.use('/convert-rule', bodySizeMiddleware());
compileRoutes.use('/convert-rule', rateLimitMiddleware());
compileRoutes.use('/convert-rule', turnstileMiddleware());
compileRoutes.openapi(convertRuleRoute, (c) => {
    // deno-lint-ignore no-explicit-any
    return handleConvertRule(buildSyntheticRequest(c, c.req.valid('json')), c.env) as any;
});
