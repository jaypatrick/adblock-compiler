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
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { zValidator } from '@hono/zod-validator';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';
import { buildSyntheticRequest, verifyTurnstileInline, zodValidationError } from './shared.ts';

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
import { handleValidateRule } from '../handlers/validate-rule.ts';
import { handleDiff } from '../handlers/diff.ts';
import { handleWebSocketUpgrade } from '../websocket.ts';

import { BatchRequestAsyncSchema, BatchRequestSyncSchema, CompileRequestSchema } from '../../src/configuration/schemas.ts';
import { AstParseRequestSchema, DiffRequestSchema, ValidateRequestSchema, ValidateRuleRequestSchema } from '../schemas.ts';

export const compileRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();

// ── Compile routes ────────────────────────────────────────────────────────────
//
// All primary compile/validate routes share the same Phase 2 middleware stack:
//   1. bodySizeMiddleware()    — reject oversized payloads (413) via clone
//   2. rateLimitMiddleware()   — per-user/IP tiered quota (429)
//   3. zValidator()            — structural body validation (422) — consumes body
//   4. Inline Turnstile check  — reads token from c.req.valid('json')
//   5. buildSyntheticRequest() — re-creates the Request for the handler
//
// These routes use `zValidator` BEFORE Turnstile verification so the body
// stream is consumed exactly once.  `turnstileMiddleware()` would clone+parse,
// then zValidator would parse again — doubling the work.  Instead, Turnstile
// verification is inlined via `verifyTurnstileInline()` which reads the token
// from the already-validated `c.req.valid('json')`.
//
// See docs/architecture/hono-routing.md — Phase 2 for the full middleware
// extraction rationale and execution-order guarantees.

compileRoutes.post(
    '/compile',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', CompileRequestSchema as any, zodValidationError),
    async (c) => {
        // Turnstile verification — reads token from the already-validated body
        // (c.req.raw body stream was consumed by zValidator above).
        // deno-lint-ignore no-explicit-any
        const turnstileError = await verifyTurnstileInline(c, (c.req.valid('json') as any).turnstileToken ?? '');
        if (turnstileError) return turnstileError;
        // Reconstruct a Request from the validated (and sanitised) data so the
        // existing handler signature (Request, Env, ...) is preserved.
        return handleCompileJson(buildSyntheticRequest(c, c.req.valid('json')), c.env, c.get('analytics'), c.get('requestId'));
    },
);

compileRoutes.post(
    '/compile/stream',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', CompileRequestSchema as any, zodValidationError),
    async (c) => {
        // deno-lint-ignore no-explicit-any
        const turnstileError = await verifyTurnstileInline(c, (c.req.valid('json') as any).turnstileToken ?? '');
        if (turnstileError) return turnstileError;
        return handleCompileStream(buildSyntheticRequest(c, c.req.valid('json')), c.env);
    },
);

compileRoutes.post(
    '/compile/batch',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', BatchRequestSyncSchema as any, zodValidationError),
    async (c) => {
        // deno-lint-ignore no-explicit-any
        const turnstileError = await verifyTurnstileInline(c, (c.req.valid('json') as any).turnstileToken ?? '');
        if (turnstileError) return turnstileError;
        return handleCompileBatch(buildSyntheticRequest(c, c.req.valid('json')), c.env);
    },
);

compileRoutes.post(
    '/ast/parse',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    turnstileMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', AstParseRequestSchema as any, zodValidationError),
    (c) => handleASTParseRequest(buildSyntheticRequest(c, c.req.valid('json')), c.env),
);

compileRoutes.post(
    '/validate',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    turnstileMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', ValidateRequestSchema as any, zodValidationError),
    (c) => handleValidate(buildSyntheticRequest(c, c.req.valid('json')), c.env),
);

// ── WebSocket ─────────────────────────────────────────────────────────────────

compileRoutes.get('/ws/compile', async (c) => {
    if (c.env.TURNSTILE_SECRET_KEY) {
        const url = new URL(c.req.url);
        const token = url.searchParams.get('turnstileToken') || '';
        const result = await verifyTurnstileToken(c.env, token, c.get('ip'));
        if (!result.success) {
            return c.json({ success: false, error: result.error || 'Turnstile verification failed' }, 403);
        }
    }
    return handleWebSocketUpgrade(c.req.raw, c.env);
});

// ── Validate-rule ─────────────────────────────────────────────────────────────

compileRoutes.post(
    '/validate-rule',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', ValidateRuleRequestSchema as any, zodValidationError),
    (c) => handleValidateRule(c.req.raw, c.env),
);

// ── Diff ──────────────────────────────────────────────────────────────────────

compileRoutes.post(
    '/diff',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', DiffRequestSchema as any, zodValidationError),
    (c) => handleDiff(buildSyntheticRequest(c, c.req.valid('json')), c.env),
);

// ── Async compile ─────────────────────────────────────────────────────────────

compileRoutes.post(
    '/compile/async',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', CompileRequestSchema as any, zodValidationError),
    async (c) => {
        // deno-lint-ignore no-explicit-any
        const turnstileError = await verifyTurnstileInline(c, (c.req.valid('json') as any).turnstileToken ?? '');
        if (turnstileError) return turnstileError;
        return handleCompileAsync(buildSyntheticRequest(c, c.req.valid('json')), c.env);
    },
);

compileRoutes.post(
    '/compile/batch/async',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', BatchRequestAsyncSchema as any, zodValidationError),
    async (c) => {
        // deno-lint-ignore no-explicit-any
        const turnstileError = await verifyTurnstileInline(c, (c.req.valid('json') as any).turnstileToken ?? '');
        if (turnstileError) return turnstileError;
        return handleCompileBatchAsync(buildSyntheticRequest(c, c.req.valid('json')), c.env);
    },
);

compileRoutes.post(
    '/compile/container',
    bodySizeMiddleware(),
    rateLimitMiddleware(),
    // deno-lint-ignore no-explicit-any
    zValidator('json', CompileRequestSchema as any, zodValidationError),
    async (c) => {
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
            // Body is re-serialised from the validated data because zValidator consumed
            // c.req.raw.body above (cannot re-read a consumed ReadableStream).
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Container-Secret': c.env.CONTAINER_SECRET,
            },
            body: JSON.stringify(c.req.valid('json')),
        });
        const containerRes = await stub.fetch(containerReq);
        return new Response(containerRes.body, {
            status: containerRes.status,
            headers: containerRes.headers,
        });
    },
);
