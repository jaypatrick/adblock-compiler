/**
 * Handler for POST /api/ast/walk
 *
 * Performs a deep, structure-aware walk of the AGTree AST built from the
 * supplied filter list rules.  Unlike the shallow `/ast/parse` endpoint (which
 * returns the raw top-level rule nodes), `/ast/walk` descends recursively into
 * every structurally meaningful sub-node (modifier lists, domain lists, rule
 * bodies, scriptlet parameter lists, etc.) and returns a flat list of every
 * node visited, optionally filtered by type.
 *
 * ## Request body (Zod-validated via {@link ASTWalkRequestSchema})
 *
 * ```json
 * {
 *   "rules":        ["||example.org^$third-party", "@@||safe.example.com^"],
 *   "text":         "# or pass the full list as a single string\n||example.org^",
 *   "nodeTypes":    ["NetworkRule", "Modifier"],
 *   "maxDepth":     10,
 *   "includeContext": true,
 *   "turnstileToken": "<optional>"
 * }
 * ```
 *
 * Exactly one of `rules` or `text` must be supplied (enforced by
 * {@link ASTWalkRequestSchema} — supplying both is a 422 validation error).
 *
 * ## Response body
 *
 * ```json
 * {
 *   "success": true,
 *   "nodes": [
 *     { "type": "NetworkRule", "depth": 1, "key": "children", "index": 0, "node": { ... } }
 *   ],
 *   "summary": {
 *     "NetworkRule": 2,
 *     "Modifier": 3,
 *     "total": 5
 *   },
 *   "duration": "4ms"
 * }
 * ```
 *
 * @module
 */

import { ASTWalkRequestSchema } from '../schemas.ts';
import { JsonResponse } from '../utils/response.ts';
import type { Env } from '../types.ts';

/**
 * A single node result returned by the walker.
 */
export interface WalkResultNode {
    /** AGTree node type discriminant (e.g. `'NetworkRule'`, `'Modifier'`). */
    type: string;
    /** Traversal depth — 0 is the FilterList root, rule children start at 1. */
    depth: number;
    /** Property name on the parent that holds this node. Only present when `includeContext` is `true`. */
    key?: string | null;
    /** Zero-based array index if the node lives inside a collection. Only present when `includeContext` is `true`. */
    index?: number | null;
    /** The full AGTree AST node object. */
    // deno-lint-ignore no-explicit-any
    node: Record<string, any>;
}

/**
 * Handler for `POST /api/ast/walk`.
 *
 * Validates the request with Zod ({@link ASTWalkRequestSchema}), builds the
 * AGTree `FilterList` AST, runs the deep walker, and returns the collected
 * nodes together with a type-count summary.
 *
 * @param request - Raw Cloudflare Worker `Request`.
 * @param _env    - Worker environment bindings (unused but required by convention).
 * @returns JSON response — see module-level docs for the shape.
 */
export async function handleASTWalkRequest(request: Request, _env: Env): Promise<Response> {
    const startTime = Date.now();

    let rawBody: unknown;
    try {
        rawBody = await request.json();
    } catch {
        return JsonResponse.badRequest('Invalid JSON body');
    }

    // ── Zod validation ────────────────────────────────────────────────────────
    const parsed = ASTWalkRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
        const msg = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
        return JsonResponse.error(msg, 422);
    }

    const { rules, text, nodeTypes, maxDepth = 50, includeContext = false } = parsed.data;

    try {
        const { AGTreeParser, walkAGTree } = await import('../../src/utils/AGTreeParser.ts');

        // ── Build the AST ─────────────────────────────────────────────────────
        let filterListText: string;
        if (text !== undefined) {
            filterListText = text;
        } else {
            // rules is guaranteed defined since text is absent (XOR enforced by schema)
            filterListText = (rules as string[]).join('\n');
        }

        const filterList = AGTreeParser.parseFilterList(filterListText);

        // ── Walk ──────────────────────────────────────────────────────────────
        const nodeTypeSet = nodeTypes ? new Set<string>(nodeTypes) : null;
        const results: WalkResultNode[] = [];

        walkAGTree(filterList, (node, ctx) => {
            // Enforce maxDepth
            if (ctx.depth > maxDepth) return;

            const nodeType = (node as { type?: string }).type ?? '';

            // Apply node-type filter
            if (nodeTypeSet !== null && !nodeTypeSet.has(nodeType)) return;

            // deno-lint-ignore no-explicit-any
            const base: { type: string; depth: number; node: Record<string, any>; key?: string | null; index?: number | null } = {
                type: nodeType,
                depth: ctx.depth,
                // deno-lint-ignore no-explicit-any
                node: node as Record<string, any>,
            };

            if (includeContext) {
                base.key = ctx.key;
                base.index = ctx.index;
            }

            results.push(base as WalkResultNode);
        });

        // ── Build summary ─────────────────────────────────────────────────────
        const summary: Record<string, number> = {};
        for (const r of results) {
            summary[r.type] = (summary[r.type] ?? 0) + 1;
        }
        summary['total'] = results.length;

        return JsonResponse.success({
            nodes: results,
            summary,
            duration: `${Date.now() - startTime}ms`,
        });
    } catch (error) {
        return JsonResponse.serverError(error);
    }
}
