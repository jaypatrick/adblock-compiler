/**
 * @module schema-2xx-helpers
 * Shared helpers for validating and patching 2xx responses in OpenAPI specifications.
 *
 * Cloudflare API Shield silently ignores operations that have no 2xx response
 * (or that have a 2xx but lack `content.application/json.schema`), causing those
 * endpoints to vanish from the dashboard.  This module is the single source of truth
 * for all "2xx response completeness" logic so that the generator, sync pipeline, and
 * CI guard all enforce the same invariant.
 */

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'] as const;

/** Minimal OpenAPI spec surface needed by the 2xx helpers. */
export interface OpenAPISpec2xx {
    // deno-lint-ignore no-explicit-any
    paths: Record<string, Record<string, any>>;
    [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Internal predicate helpers
// ---------------------------------------------------------------------------

/**
 * Return `true` if `responses` contains at least one HTTP 2xx status code.
 *
 * @param responses - The `responses` object from an OpenAPI operation.
 */
export function has2xxResponse(responses: Record<string, unknown> | undefined): boolean {
    if (!responses) {
        return false;
    }
    return Object.keys(responses).some((code) => {
        const num = parseInt(code, 10);
        return num >= 200 && num < 300;
    });
}

/**
 * Return `true` if `responses` contains at least one 2xx response that includes
 * `content.application/json.schema` — the minimum needed for Cloudflare API Shield
 * to fully parse and display the endpoint.
 *
 * @param responses - The `responses` object from an OpenAPI operation.
 */
// deno-lint-ignore no-explicit-any
export function has2xxJsonSchema(responses: Record<string, any> | undefined): boolean {
    if (!responses) {
        return false;
    }
    return Object.entries(responses).some(([code, resp]) => {
        const num = parseInt(code, 10);
        if (num < 200 || num >= 300) {
            return false;
        }
        return resp?.content?.['application/json']?.schema !== undefined;
    });
}

// ---------------------------------------------------------------------------
// Injection helper
// ---------------------------------------------------------------------------

/**
 * Walk all operations in `spec.paths` and ensure every operation has a 2xx response
 * with `content.application/json.schema`.  Three patching scenarios are handled:
 *
 * 1. **No 2xx at all** — inject a full stub `200` response.
 * 2. **2xx exists but has no `content`** — inject `content.application/json.schema`.
 * 3. **2xx exists, `content` present, but `application/json` key is absent** — add it.
 * 4. **`application/json` exists but lacks `schema`** — inject a stub schema.
 *
 * The spec is mutated in place; the function returns a list of human-readable strings
 * describing each patched operation so callers can print a diagnostic summary.
 *
 * @param spec    - The OpenAPI specification object (mutated in place).
 * @param methods - HTTP method names to inspect.
 */
export function inject2xxStubs(spec: OpenAPISpec2xx, methods: readonly string[]): string[] {
    const patched: string[] = [];
    const STUB_RESPONSE = {
        description: 'OK',
        content: { 'application/json': { schema: { type: 'object' } } },
    };

    for (const [path, pathItem] of Object.entries(spec.paths)) {
        for (const method of methods) {
            // deno-lint-ignore no-explicit-any
            const operation: Record<string, any> | undefined = pathItem[method];
            if (!operation) {
                continue;
            }

            // deno-lint-ignore no-explicit-any
            const responses: Record<string, any> = operation.responses ?? {};

            if (!has2xxResponse(responses)) {
                // Scenario 1: No 2xx at all — inject a full stub 200.
                operation.responses = { ...responses, '200': STUB_RESPONSE };
                patched.push(`${method.toUpperCase()} ${path} (injected stub 200)`);
                continue;
            }

            // A 2xx exists.  Ensure it has application/json with a schema.
            for (const [code, response] of Object.entries(responses)) {
                const num = parseInt(code, 10);
                if (num < 200 || num >= 300) {
                    continue;
                }
                // deno-lint-ignore no-explicit-any
                const resp = response as Record<string, any>;
                if (!resp.content) {
                    // Scenario 2: 2xx has no content at all.
                    resp.content = { 'application/json': { schema: { type: 'object' } } };
                    patched.push(`${method.toUpperCase()} ${path} (injected content into ${code})`);
                } else if (!resp.content?.['application/json']) {
                    // Scenario 3: content exists but application/json media type is absent.
                    resp.content['application/json'] = { schema: { type: 'object' } };
                    patched.push(`${method.toUpperCase()} ${path} (injected application/json into ${code})`);
                } else if (!resp.content['application/json']?.schema) {
                    // Scenario 4: application/json present but schema is missing.
                    resp.content['application/json'].schema = { type: 'object' };
                    patched.push(`${method.toUpperCase()} ${path} (injected schema into ${code})`);
                }
                break; // Only patch the first 2xx response.
            }
        }
    }

    return patched;
}

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

/**
 * Return a list of `"METHOD /path"` strings for every operation that is missing a
 * valid 2xx response with `content.application/json.schema`.
 *
 * This is the post-patch sanity check: after `inject2xxStubs()` runs, this list should
 * always be empty.  The same function is used by the standalone CI guard script so that
 * the generator and the CI check enforce the exact same invariant.
 *
 * @param spec    - The OpenAPI specification object to inspect (not mutated).
 * @param methods - HTTP method names to inspect.
 */
export function findInvalid2xx(spec: OpenAPISpec2xx, methods: readonly string[]): string[] {
    const invalid: string[] = [];
    for (const [path, pathItem] of Object.entries(spec.paths)) {
        for (const method of methods) {
            // deno-lint-ignore no-explicit-any
            const operation: Record<string, any> | undefined = pathItem[method];
            if (!operation) {
                continue;
            }
            if (!has2xxJsonSchema(operation.responses)) {
                invalid.push(`${method.toUpperCase()} ${path}`);
            }
        }
    }
    return invalid;
}
