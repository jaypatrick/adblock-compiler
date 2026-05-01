/**
 * ResendTemplateService — manages Bloqr email templates in the Resend dashboard.
 *
 * Provides idempotent upsert, get, list, and delete operations over Resend
 * dashboard templates. Templates created here correspond to the template IDs
 * that can be referenced in `ResendEmailService` via Resend's template-send API.
 *
 * Follows ZTA: all inputs are Zod-validated before being forwarded to
 * ResendApiService; errors are structured and never reveal secret values.
 *
 * @see worker/services/resend-api-service.ts — underlying Resend API wrapper
 */

import {
    createResendApiService,
    type ResendApiService,
    type ResendCreateTemplateRequest,
    ResendCreateTemplateRequestSchema,
    type ResendTemplate,
    type ResendTemplateList,
    type ResendTemplateResponse,
    type ResendUpdateTemplateRequest,
    ResendUpdateTemplateRequestSchema,
} from './resend-api-service.ts';

// ============================================================================
// Input validation schemas (service boundary)
// ============================================================================

/** Validated input for upsertTemplate(). */
export const UpsertTemplateInputSchema = ResendCreateTemplateRequestSchema;
export type UpsertTemplateInput = ResendCreateTemplateRequest;

/** Validated input for updateTemplate(). */
export const UpdateTemplateInputSchema = ResendUpdateTemplateRequestSchema;
export type UpdateTemplateInput = ResendUpdateTemplateRequest;

// ============================================================================
// Interface
// ============================================================================

/** Template management operations for the Resend dashboard. */
export interface IResendTemplateService {
    /**
     * Idempotent upsert: creates the template if it does not exist; updates it
     * if a template with the same alias already exists.
     *
     * @param input - Template data. `name`, `html`, and `alias` are recommended.
     * @returns The created or updated template response.
     */
    upsertTemplate(input: UpsertTemplateInput): Promise<ResendTemplateResponse>;

    /**
     * Update an existing template by Resend template ID.
     *
     * @param templateId - The Resend template ID.
     * @param input - Partial update payload. At least one field required.
     * @returns The updated template response.
     */
    updateTemplate(templateId: string, input: UpdateTemplateInput): Promise<ResendTemplateResponse>;

    /**
     * Get a template by Resend template ID.
     *
     * @param templateId - The Resend template ID.
     * @returns The validated template object.
     */
    getTemplate(templateId: string): Promise<ResendTemplate>;

    /**
     * List all templates in the Resend account.
     *
     * @returns A list of templates.
     */
    listTemplates(): Promise<ResendTemplateList>;

    /**
     * Delete a template by Resend template ID.
     *
     * @param templateId - The Resend template ID.
     */
    deleteTemplate(templateId: string): Promise<void>;
}

// ============================================================================
// ResendTemplateService
// ============================================================================

/**
 * Manages Bloqr email templates in the Resend dashboard.
 *
 * All public methods validate inputs with Zod at the service boundary before
 * forwarding to {@link ResendApiService}. Input validation failures throw a
 * generic {@link Error}; downstream errors from {@link ResendApiService}
 * propagate as `ResendApiError` (non-2xx) or `ZodError` (response parse) —
 * API keys are never included in error messages.
 */
export class ResendTemplateService implements IResendTemplateService {
    constructor(private readonly apiService: ResendApiService) {}

    /** @inheritdoc */
    async upsertTemplate(input: UpsertTemplateInput): Promise<ResendTemplateResponse> {
        // Validate at service boundary — defense-in-depth even if caller is trusted.
        const parsed = UpsertTemplateInputSchema.safeParse(input);
        if (!parsed.success) {
            throw new Error(`[ResendTemplateService] upsertTemplate: invalid input — ${parsed.error.message}`);
        }

        if (parsed.data.alias) {
            // Check for an existing template with this alias to achieve idempotency.
            const existing = await this._findByAlias(parsed.data.alias);
            if (existing) {
                // Update in-place — avoid accumulating duplicate templates.
                const updateInput: ResendUpdateTemplateRequest = { ...parsed.data };
                return this.apiService.updateTemplate(existing.id, updateInput);
            }
        }

        return this.apiService.createTemplate(parsed.data);
    }

    /** @inheritdoc */
    async updateTemplate(templateId: string, input: UpdateTemplateInput): Promise<ResendTemplateResponse> {
        const parsed = UpdateTemplateInputSchema.safeParse(input);
        if (!parsed.success) {
            throw new Error(`[ResendTemplateService] updateTemplate: invalid input — ${parsed.error.message}`);
        }
        return this.apiService.updateTemplate(templateId, parsed.data);
    }

    /** @inheritdoc */
    async getTemplate(templateId: string): Promise<ResendTemplate> {
        return this.apiService.getTemplate(templateId);
    }

    /** @inheritdoc */
    async listTemplates(): Promise<ResendTemplateList> {
        return this.apiService.listTemplates();
    }

    /** @inheritdoc */
    async deleteTemplate(templateId: string): Promise<void> {
        return this.apiService.deleteTemplate(templateId);
    }

    /**
     * Find an existing template by alias (linear scan of listTemplates()).
     * Returns `undefined` if not found or if the list call fails.
     *
     * **Idempotency is best-effort**: if the list call fails, `upsertTemplate`
     * will proceed with a create, which may produce duplicate templates during
     * transient outages. A warning is logged (without secrets) when this occurs.
     *
     * @param alias - The template alias to search for.
     * @returns The matching template or `undefined`.
     */
    private async _findByAlias(alias: string): Promise<ResendTemplate | undefined> {
        try {
            const list = await this.apiService.listTemplates();
            return list.data.find((t) => t.alias === alias);
        } catch (err) {
            // Listing failed (e.g. network error or Resend API outage).
            // Log a warning so operators can detect unexpected duplication during outages,
            // but do not block the upsert — idempotency via alias is best-effort only.
            // deno-lint-ignore no-console
            console.warn(
                '[ResendTemplateService] _findByAlias: listTemplates() failed; proceeding with create (idempotency best-effort).',
                err instanceof Error ? err.message : String(err),
            );
            return undefined;
        }
    }
}

// ============================================================================
// NullResendTemplateService
// ============================================================================

/**
 * No-op implementation of {@link IResendTemplateService}.
 *
 * Used when `RESEND_API_KEY` is not configured or in test environments that
 * must not make real Resend API calls.
 */
export class NullResendTemplateService implements IResendTemplateService {
    // deno-lint-ignore require-await
    async upsertTemplate(_input: UpsertTemplateInput): Promise<ResendTemplateResponse> {
        return { id: 'null', name: _input.name ?? '', alias: _input.alias };
    }

    // deno-lint-ignore require-await
    async updateTemplate(_templateId: string, _input: UpdateTemplateInput): Promise<ResendTemplateResponse> {
        return { id: _templateId, name: '', alias: undefined };
    }

    // deno-lint-ignore require-await
    async getTemplate(_templateId: string): Promise<ResendTemplate> {
        return { id: _templateId, name: '', createdAt: new Date().toISOString() };
    }

    // deno-lint-ignore require-await
    async listTemplates(): Promise<ResendTemplateList> {
        return { data: [] };
    }

    // deno-lint-ignore require-await
    async deleteTemplate(_templateId: string): Promise<void> {
        // No-op.
    }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an {@link IResendTemplateService} appropriate for the current environment.
 *
 * Returns a real {@link ResendTemplateService} when `RESEND_API_KEY` is configured;
 * otherwise returns a {@link NullResendTemplateService} (no-op) — never `null`.
 *
 * @param env - Subset of Worker environment bindings.
 */
export function createResendTemplateService(env: { RESEND_API_KEY?: string | null }): IResendTemplateService {
    if (env.RESEND_API_KEY) {
        return new ResendTemplateService(createResendApiService(env.RESEND_API_KEY));
    }
    return new NullResendTemplateService();
}
