/**
 * AuthedApiClientService — Typed fetch client for **authenticated** endpoints.
 *
 * Uses raw `fetch` with manually-injected auth headers so every call carries
 * `Authorization: Bearer <token>` and `X-Trace-ID`.  Response types are drawn
 * from the shared `AppType` response interfaces in `api-client.ts`.
 *
 * ## Why a separate service?
 * `ApiClientService` covers public (unauthenticated) endpoints via the Hono
 * RPC pattern.  Authenticated endpoints were previously only reachable through
 * `HttpClient`-based services (e.g. `CompilerService`, `ValidationService`) that
 * rely on Angular's `authInterceptor` to attach the Bearer token automatically.
 *
 * `AuthedApiClientService` provides the same typed call convenience while still
 * attaching auth headers — without going through the `HttpClient` pipeline.
 * This makes it suitable for cases where Angular's interceptor chain is
 * unavailable (e.g. SSR, web workers, service workers) or when callers need
 * fine-grained control over request headers.
 *
 * ## Authentication model
 * - `getHeaders()` resolves the Better Auth session token via `AuthFacadeService`.
 * - The Bearer token is attached as `Authorization: Bearer <token>`.
 * - A trace/session ID from `LogService` is attached as `X-Trace-ID` for
 *   end-to-end request correlation between frontend and Worker logs.
 *
 * ## Usage
 * ```ts
 * import { AuthedApiClientService } from './services/authed-api-client.service';
 *
 * @Component({ ... })
 * export class MyComponent {
 *   private readonly rpc = inject(AuthedApiClientService);
 *
 *   async runCompile(): Promise<void> {
 *     const result = await this.rpc.compile({
 *       configuration: {
 *         name: 'My List',
 *         sources: [{ source: 'https://easylist.to/easylist/easylist.txt' }],
 *         transformations: ['RemoveComments', 'Deduplicate'],
 *       },
 *     });
 *     console.log(result.ruleCount);
 *   }
 * }
 * ```
 *
 * ## ZTA compliance
 * - Never stores the token in component state or localStorage.
 * - Token is resolved per-call via `AuthFacadeService.getToken()` which reads
 *   the short-lived Better Auth session cookie — not a long-lived secret.
 * - Auth failure (no token when required) throws with a descriptive message.
 *
 * @see ApiClientService — public (unauthenticated) Hono RPC client
 * @see docs/architecture/hono-rpc-client.md — full usage guide
 */

import { Injectable, inject } from '@angular/core';
import { API_BASE_URL } from '../tokens';
import { AuthFacadeService } from './auth-facade.service';
import { LogService } from './log.service';
import type {
    CompileResponseData,
    AsyncCompileResponseData,
    ValidateResponseData,
    ValidateRuleResponseData,
    RulesListData,
    RuleSetData,
} from './api-client';

// ── Request shapes ────────────────────────────────────────────────────────────

/** Compile request body — mirrors the worker's `CompileRequestSchema`. */
export interface AuthedCompileRequest {
    configuration: {
        name: string;
        sources: Array<{ source: string; useBrowser?: boolean }>;
        transformations: string[];
    };
    benchmark?: boolean;
    turnstileToken?: string;
}

/** Validate request body — mirrors the worker's `ValidateRequestSchema`. */
export interface AuthedValidateRequest {
    rules: string[];
    strict?: boolean;
    turnstileToken?: string;
}

/** Validate-rule request body — mirrors the worker's `ValidateRuleRequestSchema`. */
export interface AuthedValidateRuleRequest {
    rule: string;
    turnstileToken?: string;
}

/** Rule set creation body — mirrors the worker's `RuleSetCreateSchema`. */
export interface AuthedRuleSetCreateRequest {
    name: string;
    description?: string;
    rules: string[];
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class AuthedApiClientService {
    private readonly baseUrl = inject(API_BASE_URL);
    private readonly auth = inject(AuthFacadeService);
    private readonly log = inject(LogService);

    /** Normalised worker origin (no `/api` suffix). */
    private get workerOrigin(): string {
        return this.baseUrl.replace(/\/api\/?$/, '') || '';
    }

    // ── Auth header resolution ─────────────────────────────────────────────────

    /**
     * Resolves auth headers for an authenticated API call.
     *
     * Returns `Authorization: Bearer <token>` when the user is signed in.
     * Always includes `X-Trace-ID` for end-to-end log correlation.
     *
     * Throws if the user is signed in but no token is available (session expired).
     */
    private async getHeaders(): Promise<Record<string, string>> {
        const headers: Record<string, string> = {
            'X-Trace-ID': this.log.sessionId,
        };

        if (!this.auth.isSignedIn()) {
            return headers;
        }

        const token = await this.auth.getToken();
        if (!token) {
            this.log.warn('[AuthedApiClientService] Signed in but no token available — session may have expired', 'authed-api-client');
            throw new Error('Session token unavailable — please sign in again');
        }

        headers['Authorization'] = `Bearer ${token}`;
        return headers;
    }

    // ── Authenticated endpoint wrappers ────────────────────────────────────────

    /**
     * POST /api/compile — compile filter lists into a single rule set.
     *
     * Requires Free tier or above.
     *
     * @throws If the user is not signed in or the token cannot be resolved.
     */
    async compile(request: AuthedCompileRequest): Promise<CompileResponseData> {
        const headers = await this.getHeaders();
        const res = await fetch(`${this.workerOrigin}/api/compile`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
            throw new Error(`POST /compile failed (${res.status}): ${err.error ?? res.statusText}`);
        }
        return res.json() as Promise<CompileResponseData>;
    }

    /**
     * POST /api/validate — validate filter rules against the AGTree parser.
     *
     * Requires Free tier or above.
     *
     * @throws If the user is not signed in or the token cannot be resolved.
     */
    async validateRules(request: AuthedValidateRequest): Promise<ValidateResponseData> {
        const headers = await this.getHeaders();
        const res = await fetch(`${this.workerOrigin}/api/validate`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
            throw new Error(`POST /validate failed (${res.status}): ${err.error ?? res.statusText}`);
        }
        return res.json() as Promise<ValidateResponseData>;
    }

    /**
     * POST /api/validate-rule — validate a single filter rule.
     *
     * Requires Free tier or above.
     *
     * @throws If the user is not signed in or the token cannot be resolved.
     */
    async validateRule(request: AuthedValidateRuleRequest): Promise<ValidateRuleResponseData> {
        const headers = await this.getHeaders();
        const res = await fetch(`${this.workerOrigin}/api/validate-rule`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
            throw new Error(`POST /validate-rule failed (${res.status}): ${err.error ?? res.statusText}`);
        }
        return res.json() as Promise<ValidateRuleResponseData>;
    }

    /**
     * GET /api/rules — list saved rule sets for the authenticated user.
     *
     * Requires Free tier or above.
     *
     * @throws If the user is not signed in or the token cannot be resolved.
     */
    async listRules(): Promise<RulesListData> {
        const headers = await this.getHeaders();
        const res = await fetch(`${this.workerOrigin}/api/rules`, {
            method: 'GET',
            headers,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
            throw new Error(`GET /rules failed (${res.status}): ${err.error ?? res.statusText}`);
        }
        return res.json() as Promise<RulesListData>;
    }

    /**
     * POST /api/rules — save a new rule set.
     *
     * Requires Free tier or above.
     *
     * @throws If the user is not signed in or the token cannot be resolved.
     */
    async createRuleSet(request: AuthedRuleSetCreateRequest): Promise<{ success: boolean; ruleSet: RuleSetData }> {
        const headers = await this.getHeaders();
        const res = await fetch(`${this.workerOrigin}/api/rules`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
            throw new Error(`POST /rules failed (${res.status}): ${err.error ?? res.statusText}`);
        }
        return res.json() as Promise<{ success: boolean; ruleSet: RuleSetData }>;
    }

    /**
     * POST /api/compile/async — queue a compilation job for background processing.
     *
     * Returns a `requestId` that can be polled via the queue status endpoint.
     * Requires Pro tier or above.
     *
     * @throws If the user is not signed in or the token cannot be resolved.
     */
    async compileAsync(request: AuthedCompileRequest): Promise<AsyncCompileResponseData> {
        const headers = await this.getHeaders();
        const res = await fetch(`${this.workerOrigin}/api/compile/async`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
            throw new Error(`POST /compile/async failed (${res.status}): ${err.error ?? res.statusText}`);
        }
        return res.json() as Promise<AsyncCompileResponseData>;
    }
}
