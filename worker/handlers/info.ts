/**
 * Info and API metadata handlers for the Cloudflare Worker.
 *
 * GET /api                     — API info (JSON) or redirect to /api-docs (browser)
 * GET /api/version             — latest deployment version
 * GET /api/deployments         — deployment history
 * GET /api/deployments/stats   — deployment statistics
 * GET /api/turnstile-config    — Turnstile site key for frontend
 */

import { VERSION } from '../../src/version.ts';
import { API_DOCS_REDIRECT } from '../utils/constants.ts';
import { handleSentryConfig } from './sentry-config.ts';
import { _internals } from '../lib/prisma.ts';
import type { Env } from '../types.ts';

/**
 * Return API information or redirect browsers to the interactive API docs.
 * GET /api
 */
export function handleInfo(request: Request, env: Env): Response {
    const accept = request.headers.get('Accept') ?? '';
    const searchParams = new URL(request.url).searchParams;
    const wantsHtml = Boolean(env.ASSETS) &&
        accept.includes('text/html') &&
        searchParams.get('format') !== 'json';

    if (wantsHtml) {
        return Response.redirect(new URL(API_DOCS_REDIRECT, request.url).toString(), 302);
    }

    const info = {
        name: 'Hostlist Compiler Worker',
        version: env.COMPILER_VERSION || VERSION,
        endpoints: {
            'GET /': 'Web UI for interactive compilation',
            'GET /api': 'API information (this endpoint)',
            'GET /metrics': 'Request metrics and statistics',
            'GET /queue/stats': 'Queue statistics and diagnostics',
            'GET /queue/history': 'Job history and queue depth over time',
            'DELETE /queue/cancel/:requestId': 'Cancel a pending queue job',
            'POST /compile': 'Compile a filter list (JSON response)',
            'POST /compile/stream': 'Compile with real-time progress (SSE)',
            'POST /compile/batch': 'Compile multiple filter lists in parallel',
            'POST /compile/async': 'Queue a compilation job for async processing',
            'POST /compile/batch/async': 'Queue multiple compilations for async processing',
            'GET /ws/compile': 'WebSocket endpoint for bidirectional real-time compilation',
            'GET /ws/compile/v2': 'Hibernatable WebSocket endpoint backed by WsHibernationDO (session presence)',
            'POST /validate-rule': 'Validate a single adblock rule (optionally test against a URL)',
            'GET /rules': 'List saved rule sets',
            'POST /rules': 'Create a new saved rule set',
            'GET /rules/:id': 'Retrieve a saved rule set by ID',
            'PUT /rules/:id': 'Update a saved rule set by ID',
            'DELETE /rules/:id': 'Delete a saved rule set by ID',
            'POST /notify': 'Send a notification event to configured webhook targets',
            'POST /ast/parse': 'Parse an adblock/hosts rule into an AST (AGTree)',
            'GET /configuration/defaults': 'System compilation defaults and hard limits (anonymous)',
            'POST /configuration/validate': 'Validate a configuration object against the schema',
            'POST /configuration/resolve': 'Merge configuration layers and return effective IConfiguration',
            'GET /api/schemas': 'Self-describing JSON Schemas for all public request/response types',
        },
        example: {
            method: 'POST',
            url: '/compile',
            body: {
                configuration: {
                    name: 'My Filter List',
                    sources: [
                        {
                            name: 'Example Source',
                            source: 'https://example.com/filters.txt',
                        },
                    ],
                    transformations: ['Deduplicate', 'RemoveEmptyLines'],
                },
                benchmark: true,
            },
        },
    };

    return Response.json(info, { headers: {} });
}

/**
 * Route handler for pre-auth API metadata endpoints.
 *
 * Returns null if the pathname is not a metadata route so that the caller can
 * continue to the next routing block.
 *
 * @param pathname - Full request pathname (e.g. "/api/version")
 * @param request  - Incoming request
 * @param url      - Parsed request URL
 * @param env      - Worker environment bindings
 */
export async function routeApiMeta(
    pathname: string,
    request: Request,
    url: URL,
    env: Env,
): Promise<Response | null> {
    if (request.method !== 'GET') {
        return null;
    }

    if (pathname === '/api') {
        return handleInfo(request, env);
    }

    if (pathname === '/api/version') {
        try {
            if (!env.HYPERDRIVE) {
                return Response.json(
                    {
                        success: false,
                        error: 'Hyperdrive binding not available',
                        version: env.COMPILER_VERSION || VERSION,
                    },
                    { status: 503 },
                );
            }
            const prisma = _internals.createPrismaClient(env.HYPERDRIVE.connectionString);
            const deployment = await prisma.deploymentHistory.findFirst({
                orderBy: { deployedAt: 'desc' },
                where: { status: 'success' },
            });
            return Response.json(
                {
                    success: true,
                    ...(deployment
                        ? {
                            version: deployment.version,
                            buildNumber: deployment.buildNumber,
                            fullVersion: deployment.fullVersion,
                            gitCommit: deployment.gitCommit,
                            gitBranch: deployment.gitBranch,
                            deployedAt: deployment.deployedAt,
                            deployedBy: deployment.deployedBy,
                            status: deployment.status,
                            metadata: deployment.metadata,
                        }
                        : {
                            version: env.COMPILER_VERSION || VERSION,
                            message: 'No deployment history available',
                        }),
                },
                { headers: { 'Cache-Control': 'public, max-age=60' } },
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return Response.json(
                { success: false, error: message, version: env.COMPILER_VERSION || VERSION },
                { status: 500 },
            );
        }
    }

    if (pathname === '/api/deployments') {
        try {
            if (!env.HYPERDRIVE) {
                return Response.json({ success: false, error: 'Hyperdrive binding not available' }, { status: 503 });
            }
            const rawLimit = parseInt(url.searchParams.get('limit') || '50', 10);
            const limit = isNaN(rawLimit) || rawLimit < 1 ? 50 : rawLimit;
            const version = url.searchParams.get('version') || undefined;
            const status = url.searchParams.get('status') || undefined;
            const branch = url.searchParams.get('branch') || undefined;
            const prisma = _internals.createPrismaClient(env.HYPERDRIVE.connectionString);
            const deployments = await prisma.deploymentHistory.findMany({
                where: {
                    ...(version && { version }),
                    ...(status && { status }),
                    ...(branch && { gitBranch: branch }),
                },
                orderBy: { deployedAt: 'desc' },
                take: limit,
            });
            return Response.json(
                { success: true, deployments, count: deployments.length },
                { headers: { 'Cache-Control': 'public, max-age=60' } },
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return Response.json({ success: false, error: message }, { status: 500 });
        }
    }

    if (pathname === '/api/deployments/stats') {
        try {
            if (!env.HYPERDRIVE) {
                return Response.json({ success: false, error: 'Hyperdrive binding not available' }, { status: 503 });
            }
            const prisma = _internals.createPrismaClient(env.HYPERDRIVE.connectionString);
            const [total, successful, failed, latest] = await Promise.all([
                prisma.deploymentHistory.count(),
                prisma.deploymentHistory.count({ where: { status: 'success' } }),
                prisma.deploymentHistory.count({ where: { status: 'failed' } }),
                prisma.deploymentHistory.findFirst({
                    orderBy: { deployedAt: 'desc' },
                    select: { fullVersion: true },
                }),
            ]);
            return Response.json(
                {
                    success: true,
                    totalDeployments: total,
                    successfulDeployments: successful,
                    failedDeployments: failed,
                    latestVersion: latest?.fullVersion ?? null,
                },
                { headers: { 'Cache-Control': 'public, max-age=60' } },
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return Response.json({ success: false, error: message }, { status: 500 });
        }
    }

    if (pathname === '/api/turnstile-config') {
        return Response.json(
            { siteKey: env.TURNSTILE_SITE_KEY || null, enabled: !!env.TURNSTILE_SECRET_KEY },
            { headers: { 'Cache-Control': 'public, max-age=3600' } },
        );
    }

    if (pathname === '/api/sentry-config') {
        return handleSentryConfig(env);
    }

    if (pathname === '/api/schemas') {
        const { handleSchemas } = await import('./schemas.ts');
        return handleSchemas(request, env);
    }

    return null;
}
