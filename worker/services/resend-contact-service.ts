/**
 * ResendContactService — syncs user lifecycle events to Resend audiences.
 *
 * Provides fire-and-forget contact management that adds newly created users
 * to a Resend audience and removes deleted users from it. All errors are
 * caught and logged as warnings — they never propagate to callers.
 *
 * @see worker/services/resend-api-service.ts — underlying Resend API wrapper
 */

import { createResendApiService, type ResendApiService } from './resend-api-service.ts';

// ============================================================================
// Interface
// ============================================================================

/** Contact sync operations for user lifecycle events. */
export interface IResendContactService {
    /**
     * Sync a newly created user to the Resend audience.
     * Fire-and-forget — errors are logged, not re-thrown.
     */
    syncUserCreated(user: { id: string; email: string; name?: string | null }): Promise<void>;

    /**
     * Sync a deleted user removal from the Resend audience.
     * Fire-and-forget — errors are logged, not re-thrown.
     */
    syncUserDeleted(user: { id: string; email: string }): Promise<void>;
}

// ============================================================================
// ResendContactService
// ============================================================================

/**
 * Syncs user lifecycle events to a Resend audience via {@link ResendApiService}.
 *
 * Both methods are fire-and-forget: errors are caught, logged as warnings,
 * and never re-thrown. This prevents audience-sync failures from affecting
 * the primary auth/user creation path.
 */
export class ResendContactService implements IResendContactService {
    constructor(
        private readonly apiService: ResendApiService,
        private readonly audienceId: string,
    ) {}

    /** @inheritdoc */
    async syncUserCreated(user: { id: string; email: string; name?: string | null }): Promise<void> {
        try {
            // Best-effort name split: first token → firstName, remainder → lastName.
            // e.g. "Mary Anne Smith" → firstName="Mary", lastName="Anne Smith".
            // Multi-word first names (e.g. "Mary Anne") are not handled — a limitation
            // of splitting on the first space.  Whitespace-only names are treated as
            // absent so Resend does not receive empty-string fields.
            const trimmed = user.name?.trim() ?? '';
            const nameParts = trimmed ? trimmed.split(' ') : [];
            const firstName = nameParts[0] || undefined;
            const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

            await this.apiService.createContact(this.audienceId, {
                email: user.email,
                ...(firstName !== undefined && { firstName }),
                ...(lastName !== undefined && { lastName }),
                unsubscribed: false,
            });
        } catch (err) {
            // deno-lint-ignore no-console
            console.warn('[ResendContactService] syncUserCreated failed:', err);
        }
    }

    /** @inheritdoc */
    async syncUserDeleted(user: { id: string; email: string }): Promise<void> {
        try {
            await this.apiService.deleteContact(this.audienceId, user.email);
        } catch (err) {
            // deno-lint-ignore no-console
            console.warn('[ResendContactService] syncUserDeleted failed:', err);
        }
    }
}

// ============================================================================
// NullResendContactService
// ============================================================================

/**
 * No-op implementation of {@link IResendContactService}.
 *
 * Used when `RESEND_API_KEY` or `RESEND_AUDIENCE_ID` is not configured.
 * Both methods resolve immediately without making any API calls.
 */
export class NullResendContactService implements IResendContactService {
    async syncUserCreated(_user: { id: string; email: string; name?: string | null }): Promise<void> {
        // No-op — Resend audience management not configured.
    }

    async syncUserDeleted(_user: { id: string; email: string }): Promise<void> {
        // No-op — Resend audience management not configured.
    }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an {@link IResendContactService} appropriate for the current environment.
 *
 * Returns a real {@link ResendContactService} when both `RESEND_API_KEY` and
 * `RESEND_AUDIENCE_ID` are configured; otherwise returns a
 * {@link NullResendContactService} that silently no-ops.
 *
 * @param env - Subset of Worker environment bindings.
 */
export function createResendContactService(env: { RESEND_API_KEY?: string | null; RESEND_AUDIENCE_ID?: string | null }): IResendContactService {
    if (env.RESEND_API_KEY && env.RESEND_AUDIENCE_ID) {
        return new ResendContactService(createResendApiService(env.RESEND_API_KEY), env.RESEND_AUDIENCE_ID);
    }
    return new NullResendContactService();
}
