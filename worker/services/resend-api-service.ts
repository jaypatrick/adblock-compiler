/**
 * ResendApiService — Resend Contacts/Audiences REST API wrapper.
 *
 * Wraps the Resend Contacts/Audiences REST API for contact management.
 * This is NOT for email sending — that is handled by email-service.ts.
 *
 * @see https://resend.com/docs/api-reference/contacts/create-contact
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
 * Typed REST API wrapper for the Resend Contacts/Audiences endpoint.
 *
 * Uses `fetch()` directly — the same approach as {@link ResendEmailService}
 * in email-service.ts — so no additional npm dependency is required.
 * This file is the single integration point for all Resend Contacts API
 * calls; extend it here rather than calling the Resend API directly elsewhere.
 *
 * All methods validate responses with Zod and throw a {@link ResendApiError} on
 * non-2xx responses or schema validation failures.
 */
export class ResendApiService {
    constructor(private readonly apiKey: string) {}

    /**
     * Create a contact in a Resend audience.
     *
     * @param audienceId - The Resend audience ID.
     * @param data - Contact data to create.
     * @returns The created contact's ID.
     */
    async createContact(audienceId: string, data: ResendCreateContactRequest): Promise<ResendCreateContactResponse> {
        return this._request('POST', `/audiences/${audienceId}/contacts`, data, ResendCreateContactResponseSchema);
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
     * Shared HTTP request helper. Handles auth headers, JSON encoding, and Zod parsing.
     *
     * @param method - HTTP method.
     * @param path - API path relative to the base URL.
     * @param body - Optional request body (will be JSON-encoded).
     * @param responseSchema - Zod schema to validate and parse the response.
     * @returns Parsed and validated response.
     */
    private async _request<T>(
        method: string,
        path: string,
        body: unknown | undefined,
        responseSchema: z.ZodType<T>,
    ): Promise<T> {
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
            return undefined as T;
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
