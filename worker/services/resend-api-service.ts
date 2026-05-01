/**
 * ResendApiService — Resend Contacts/Audiences and Templates REST API wrapper.
 *
 * Wraps the Resend Contacts/Audiences and Templates REST APIs for contact and
 * template management. This is NOT for email sending — that is handled by
 * email-service.ts.
 *
 * @see https://resend.com/docs/api-reference/contacts/create-contact
 * @see https://resend.com/docs/api-reference/templates
 * @see worker/services/email-service.ts — email sending (separate concern)
 */

import { z } from 'zod';

// ============================================================================
// Schemas & Types
// ============================================================================

/** Resend contact response shape from the Contacts API. */
export const ResendContactSchema = z.object({
    id: z.string(),
    email: z.string().email(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    unsubscribed: z.boolean(),
    createdAt: z.string(),
});

/** Request payload for creating a Resend contact. */
export const ResendCreateContactRequestSchema = z.object({
    email: z.string().email(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    unsubscribed: z.boolean().optional(),
});

/** Response from creating a Resend contact. */
export const ResendCreateContactResponseSchema = z.object({
    id: z.string(),
});

/** List of Resend contacts. */
export const ResendContactListSchema = z.object({
    data: z.array(ResendContactSchema),
});

/** Resend API error response shape. */
export const ResendErrorSchema = z.object({
    name: z.string(),
    message: z.string(),
    statusCode: z.number(),
});

export type ResendContact = z.infer<typeof ResendContactSchema>;
export type ResendCreateContactRequest = z.infer<typeof ResendCreateContactRequestSchema>;
export type ResendCreateContactResponse = z.infer<typeof ResendCreateContactResponseSchema>;
export type ResendContactList = z.infer<typeof ResendContactListSchema>;

// ── Templates ──────────────────────────────────────────────────────────────

/** Resend template response shape. */
export const ResendTemplateSchema = z.object({
    id: z.string(),
    name: z.string(),
    alias: z.string().optional(),
    subject: z.string().optional(),
    createdAt: z.string(),
});

/** Request payload for creating a Resend template. */
export const ResendCreateTemplateRequestSchema = z.object({
    name: z.string().min(1).max(255),
    alias: z
        .string()
        .max(255)
        .regex(/^[a-z0-9-]+$/, 'Template alias must be lowercase alphanumeric with hyphens only')
        .optional(),
    subject: z.string().max(998).regex(/^[^\r\n]*$/, 'Subject must not contain CR or LF').optional(),
    html: z.string().min(1),
    text: z.string().optional(),
    from: z
        .string()
        .min(1)
        .max(998)
        .regex(/^[^\r\n]*$/, 'From must not contain CR or LF')
        .optional(),
    replyTo: z.string().max(998).regex(/^[^\r\n]*$/, 'ReplyTo must not contain CR or LF').optional(),
});

/** Request payload for updating a Resend template. */
export const ResendUpdateTemplateRequestSchema = ResendCreateTemplateRequestSchema.partial().refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one field must be provided for update' },
);

/** Response from creating/updating a Resend template. */
export const ResendTemplateResponseSchema = z.object({
    id: z.string(),
    name: z.string(),
    alias: z.string().optional(),
});

/** List of Resend templates. */
export const ResendTemplateListSchema = z.object({
    data: z.array(ResendTemplateSchema),
});

export type ResendTemplate = z.infer<typeof ResendTemplateSchema>;
export type ResendCreateTemplateRequest = z.infer<typeof ResendCreateTemplateRequestSchema>;
export type ResendUpdateTemplateRequest = z.infer<typeof ResendUpdateTemplateRequestSchema>;
export type ResendTemplateResponse = z.infer<typeof ResendTemplateResponseSchema>;
export type ResendTemplateList = z.infer<typeof ResendTemplateListSchema>;

// ============================================================================
// ResendApiError
// ============================================================================

/**
 * Typed error thrown by {@link ResendApiService} on non-2xx responses.
 *
 * Carries the HTTP status code and the structured error name/message from the
 * Resend API response body (falls back to `statusText` when the body is not
 * a valid Resend error shape).
 */
export class ResendApiError extends Error {
    constructor(
        /** HTTP status code returned by the Resend API (e.g. 404, 422). */
        public readonly statusCode: number,
        /** Resend error name from the response body (e.g. `'not_found'`). */
        public readonly errorName: string,
        message: string,
    ) {
        super(`Resend API error ${statusCode} (${errorName}): ${message}`);
        this.name = 'ResendApiError';
    }
}

// ============================================================================
// ResendApiService
// ============================================================================

const BASE_URL = 'https://api.resend.com';

/**
 * Typed REST API wrapper for the Resend Contacts/Audiences and Templates endpoints.
 *
 * Uses `fetch()` directly — the same approach as {@link ResendEmailService}
 * in email-service.ts — so no additional npm dependency is required.
 * This file is the single integration point for all Resend API calls;
 * extend it here rather than calling the Resend API directly elsewhere.
 *
 * All methods validate requests and responses with Zod and throw a
 * {@link ResendApiError} on non-2xx responses or schema validation failures.
 */
export class ResendApiService {
    // Resend API keys always start with `re_` followed by alphanumeric chars.
    // This guard catches obvious misconfiguration (e.g. env var swap, empty string)
    // without revealing the key value in any error message.
    private static readonly API_KEY_PATTERN = /^re_[A-Za-z0-9_]{8,}$/;

    constructor(private readonly apiKey: string) {
        if (!ResendApiService.API_KEY_PATTERN.test(apiKey)) {
            throw new Error(
                '[ResendApiService] RESEND_API_KEY does not match the expected format (re_xxxxx). ' +
                    'Verify the secret is set correctly.',
            );
        }
    }

    /**
     * Create a contact in a Resend audience.
     *
     * @param audienceId - The Resend audience ID.
     * @param data - Contact data to create.
     * @returns The created contact's ID.
     */
    async createContact(audienceId: string, data: ResendCreateContactRequest): Promise<ResendCreateContactResponse> {
        return this._request('POST', `/audiences/${audienceId}/contacts`, data, ResendCreateContactResponseSchema, ResendCreateContactRequestSchema);
    }

    /**
     * Delete a contact from a Resend audience by ID or email.
     *
     * @param audienceId - The Resend audience ID.
     * @param contactIdOrEmail - Contact ID or email address.
     */
    async deleteContact(audienceId: string, contactIdOrEmail: string): Promise<void> {
        await this._request('DELETE', `/audiences/${audienceId}/contacts/${encodeURIComponent(contactIdOrEmail)}`, undefined, z.unknown());
    }

    /**
     * Get a contact from a Resend audience by ID or email.
     *
     * @param audienceId - The Resend audience ID.
     * @param contactIdOrEmail - Contact ID or email address.
     * @returns The validated contact object.
     */
    async getContact(audienceId: string, contactIdOrEmail: string): Promise<ResendContact> {
        return this._request('GET', `/audiences/${audienceId}/contacts/${encodeURIComponent(contactIdOrEmail)}`, undefined, ResendContactSchema);
    }

    /**
     * List all contacts in a Resend audience.
     *
     * @param audienceId - The Resend audience ID.
     * @returns A list of contacts.
     */
    async listContacts(audienceId: string): Promise<ResendContactList> {
        return this._request('GET', `/audiences/${audienceId}/contacts`, undefined, ResendContactListSchema);
    }

    /**
     * Create a template in the Resend dashboard.
     *
     * @param data - Template data. `name` and `html` are required.
     * @returns The created template's ID, name, and alias.
     */
    async createTemplate(data: ResendCreateTemplateRequest): Promise<ResendTemplateResponse> {
        return this._request('POST', '/templates', data, ResendTemplateResponseSchema, ResendCreateTemplateRequestSchema);
    }

    /**
     * Update an existing template by ID.
     *
     * @param templateId - The Resend template ID.
     * @param data - Partial update payload. At least one field required.
     * @returns The updated template's ID, name, and alias.
     */
    async updateTemplate(templateId: string, data: ResendUpdateTemplateRequest): Promise<ResendTemplateResponse> {
        return this._request(
            'PATCH',
            `/templates/${encodeURIComponent(templateId)}`,
            data,
            ResendTemplateResponseSchema,
            ResendUpdateTemplateRequestSchema as z.ZodType<ResendUpdateTemplateRequest>,
        );
    }

    /**
     * Get a template by ID.
     *
     * @param templateId - The Resend template ID.
     * @returns The validated template object.
     */
    async getTemplate(templateId: string): Promise<ResendTemplate> {
        return this._request('GET', `/templates/${encodeURIComponent(templateId)}`, undefined, ResendTemplateSchema);
    }

    /**
     * List all templates in the Resend account.
     *
     * @returns A list of templates.
     */
    async listTemplates(): Promise<ResendTemplateList> {
        return this._request('GET', '/templates', undefined, ResendTemplateListSchema);
    }

    /**
     * Delete a template by ID.
     *
     * @param templateId - The Resend template ID.
     */
    async deleteTemplate(templateId: string): Promise<void> {
        await this._request('DELETE', `/templates/${encodeURIComponent(templateId)}`, undefined, z.unknown());
    }

    /**
     * Shared HTTP request helper. Handles auth headers, JSON encoding, and Zod parsing.
     *
     * @param method - HTTP method.
     * @param path - API path relative to the base URL.
     * @param body - Optional request body (will be JSON-encoded).
     * @param responseSchema - Zod schema to validate and parse the response.
     * @param requestSchema - Optional Zod schema to validate the request body at the trust boundary.
     * @returns Parsed and validated response.
     */
    private async _request<TReq, TRes>(
        method: string,
        path: string,
        body: TReq | undefined,
        responseSchema: z.ZodType<TRes>,
        requestSchema?: z.ZodType<TReq>,
    ): Promise<TRes> {
        // Validate the request body at the trust boundary before sending.
        if (body !== undefined && requestSchema !== undefined) {
            const parsed = requestSchema.safeParse(body);
            if (!parsed.success) {
                throw new Error(`[ResendApiService] Request validation failed: ${parsed.error.message}`);
            }
        }

        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
        };

        const response = await fetch(`${BASE_URL}${path}`, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
            let errorName = 'unknown_error';
            let message = response.statusText;
            try {
                const errBody = await response.json();
                const parsed = ResendErrorSchema.safeParse(errBody);
                if (parsed.success) {
                    errorName = parsed.data.name;
                    message = parsed.data.message;
                }
            } catch {
                // Ignore JSON parse failures; fall back to statusText.
            }
            throw new ResendApiError(response.status, errorName, message);
        }

        // 204 No Content — no body to parse (e.g. DELETE).
        // DELETE endpoints pass z.unknown() as the schema, which accepts undefined,
        // so returning undefined as T is safe for that call-site.
        if (response.status === 204) {
            return undefined as TRes;
        }

        const json = await response.json();
        return responseSchema.parse(json);
    }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new {@link ResendApiService} instance.
 *
 * @param apiKey - Resend API key.
 */
export function createResendApiService(apiKey: string): ResendApiService {
    return new ResendApiService(apiKey);
}
