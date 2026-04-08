/**
 * Handler for POST /api/convert-rule
 *
 * Converts a single adblock filter rule from one syntax to another
 * using AGTree's RuleConverter.
 *
 * Supported conversions:
 *   - Any syntax → AdGuard (target: 'adg')
 *   - Any syntax → uBlock Origin (target: 'ubo')
 */

import { ConvertRuleRequestSchema } from '../schemas.ts';
import { JsonResponse } from '../utils/response.ts';
import type { Env } from '../types.ts';

export async function handleConvertRule(request: Request, _env: Env): Promise<Response> {
    const startTime = Date.now();

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return JsonResponse.badRequest('Invalid JSON body');
    }

    const parsed = ConvertRuleRequestSchema.safeParse(body);
    if (!parsed.success) {
        return JsonResponse.error(parsed.error.issues.map((i) => i.message).join('; '), 422);
    }

    const { rule, targetSyntax } = parsed.data;

    try {
        const { AGTreeParser } = await import('../../src/utils/AGTreeParser.ts');
        const result = AGTreeParser.convertRuleText(rule, targetSyntax);

        return JsonResponse.success({
            rule,
            targetSyntax,
            convertedRules: result.convertedRules,
            isConverted: result.isConverted,
            ...(result.error && { error: result.error }),
            duration: `${Date.now() - startTime}ms`,
        });
    } catch (error) {
        return JsonResponse.serverError(error);
    }
}
