/**
 * Handler for POST /api/diff
 *
 * Compares two filter lists via AGTree AST. Both lists are parsed through
 * ASTViewerService before comparison — parse errors are returned alongside
 * the diff report but do not block the diff. Rules that fail to parse are
 * excluded from the comparison.
 */

import { DiffGenerator } from '../../src/diff/DiffReport.ts';
import { ASTViewerService } from '../../src/services/ASTViewerService.ts';
import { DiffRequestSchema } from '../schemas.ts';
import { JsonResponse } from '../utils/response.ts';
import type { Env } from '../types.ts';
import type { ParseError } from '../openapi-types.ts';

/** Parse a list of rule strings through AGTree, collecting errors for invalid rules. */
function parseAndFilter(rules: string[], errors: ParseError[]): string[] {
    const valid: string[] = [];
    for (let i = 0; i < rules.length; i++) {
        const rule = rules[i].trim();
        if (!rule) continue;
        const result = ASTViewerService.parseRule(rule);
        if (result.success) {
            valid.push(rule);
        } else {
            errors.push({ line: i + 1, rule, message: result.error ?? 'Parse error' });
        }
    }
    return valid;
}

/** POST /api/diff — compare two filter lists and return a DiffReport. */
export async function handleDiff(request: Request, _env: Env): Promise<Response> {
    const startTime = Date.now();

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return JsonResponse.badRequest('Invalid JSON body');
    }

    const parsed = DiffRequestSchema.safeParse(body);
    if (!parsed.success) {
        return JsonResponse.error(parsed.error.issues.map((i) => i.message).join('; '), 422);
    }

    const { original, current, options } = parsed.data;

    const parseErrors = { original: [] as ParseError[], current: [] as ParseError[] };
    const validOriginal = parseAndFilter(original, parseErrors.original);
    const validCurrent  = parseAndFilter(current,  parseErrors.current);

    const generator = new DiffGenerator(options);
    const report    = generator.generate(validOriginal, validCurrent);

    return JsonResponse.success({
        success: true,
        parseErrors,
        report,
        duration: `${Date.now() - startTime}ms`,
    });
}
