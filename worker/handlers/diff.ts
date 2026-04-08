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

/** Rule text alongside its 1-based line number in the user's original input. */
interface TrackedRule {
    rule: string;
    originalLine: number;
}

/**
 * Parse a list of rule strings through AGTree, collecting errors for invalid rules.
 *
 * Filtering behaviour is aligned with DiffGenerator.normalizeRules() so that
 * the TrackedRule indices produced here correspond 1-to-1 with the positions
 * DiffGenerator will assign when it receives the extracted rule strings.  This
 * lets us remap filtered-array line numbers back to original input line numbers
 * after the diff is generated.
 */
function parseAndFilter(
    rules: string[],
    options: { ignoreEmptyLines: boolean; ignoreComments: boolean },
    errors: ParseError[],
): TrackedRule[] {
    const result: TrackedRule[] = [];
    for (let i = 0; i < rules.length; i++) {
        const rule = rules[i].trim();
        // Mirror DiffGenerator.normalizeRules() empty-line filter
        if (!rule) {
            if (!options.ignoreEmptyLines) {
                result.push({ rule, originalLine: i + 1 });
            }
            continue;
        }
        // Mirror DiffGenerator.normalizeRules() comment filter
        if (options.ignoreComments && (rule.startsWith('!') || rule.startsWith('#'))) {
            continue;
        }
        const parsed = ASTViewerService.parseRule(rule);
        if (parsed.success) {
            result.push({ rule, originalLine: i + 1 });
        } else {
            errors.push({ line: i + 1, rule, message: parsed.error ?? 'Parse error' });
        }
    }
    return result;
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
    const originalItems = parseAndFilter(original, options, parseErrors.original);
    const currentItems = parseAndFilter(current, options, parseErrors.current);

    const generator = new DiffGenerator(options);
    const report = generator.generate(
        originalItems.map((item) => item.rule),
        currentItems.map((item) => item.rule),
    );

    // DiffGenerator assigns line numbers relative to the filtered arrays it receives.
    // Remap them back to the user's original 1-based input line numbers.
    for (const r of report.removed) {
        if (r.originalLine !== undefined) {
            r.originalLine = originalItems[r.originalLine - 1]?.originalLine;
        }
    }
    for (const r of report.added) {
        if (r.newLine !== undefined) {
            r.newLine = currentItems[r.newLine - 1]?.originalLine;
        }
    }

    return JsonResponse.success({
        success: true,
        parseErrors,
        report,
        duration: `${Date.now() - startTime}ms`,
    });
}
