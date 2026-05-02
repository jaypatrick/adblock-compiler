/// <reference types="@cloudflare/workers-types" />

/**
 * Flash message store backed by Cloudflare KV.
 *
 * A flash message is a short-lived, one-time-read notification (e.g. "You must
 * be signed in") stored in KV under a random token. The client exchanges the
 * token for the message via GET /api/flash/:token. Reading the message deletes
 * it on first use (consume semantics — see race-condition note in getFlash).
 *
 * ## Usage (server side)
 * ```ts
 * const token = await setFlash(c.env.FLASH_STORE, 'You must be signed in', 'warn');
 * // Redirect to /sign-in?flash=<token>
 * ```
 *
 * ## Usage (client side)
 * - Angular FlashService reads ?flash= query param on startup
 * - Calls GET /api/flash/:token to retrieve and consume the message
 *
 * ## Security
 * - Tokens are crypto.randomUUID() — 122 bits of entropy
 * - TTL defaults to 30 s (enough for a redirect round-trip)
 * - Message is deleted on first read (no replay)
 * - FLASH_STORE is optional — callers must guard against absence
 */

/** Severity level for flash messages. */
export type FlashType = 'info' | 'warn' | 'error' | 'success';

/** Shape of a flash message as stored in KV and returned to clients. */
export interface FlashMessage {
    readonly message: string;
    readonly type: FlashType;
    readonly createdAt: string; // ISO-8601
}

/**
 * Write a flash message to KV.
 *
 * @param kv        The FLASH_STORE KV namespace binding.
 * @param message   Human-readable message text.
 * @param type      Severity level — defaults to 'info'.
 * @param ttlSeconds TTL in seconds — defaults to 30.
 * @returns The opaque token the client should pass to GET /api/flash/:token.
 */
export async function setFlash(
    kv: KVNamespace,
    message: string,
    type: FlashType = 'info',
    ttlSeconds = 30,
): Promise<string> {
    const token = crypto.randomUUID();
    const payload: FlashMessage = {
        message,
        type,
        createdAt: new Date().toISOString(),
    };
    // expirationTtl enforces server-side expiry even if the client never reads
    await kv.put(`flash:${token}`, JSON.stringify(payload), { expirationTtl: ttlSeconds });
    return token;
}

/**
 * Consume a flash message from KV (read + delete).
 *
 * Returns `null` if the token is unknown, already consumed, or expired.
 *
 * **Race condition:** Two concurrent requests carrying the same token may both
 * read the value before either delete completes. Pass the Worker's
 * `ExecutionContext` via `executionCtx` to use `waitUntil()` — this registers
 * the delete with the runtime so it completes even after the response is sent,
 * reducing (though not eliminating) the race window.  Without `executionCtx`
 * the delete is fire-and-forget; the 30-second TTL remains the safety net.
 *
 * @param kv           The FLASH_STORE KV namespace binding.
 * @param token        Opaque token returned by {@link setFlash}.
 * @param executionCtx Optional Worker `ExecutionContext`; when provided the KV
 *                     delete is registered via `waitUntil()`.
 */
export async function getFlash(
    kv: KVNamespace,
    token: string,
    executionCtx?: ExecutionContext,
): Promise<FlashMessage | null> {
    const key = `flash:${token}`;
    const raw = await kv.get(key, 'text');
    if (!raw) return null;

    // Delete immediately — consume semantics (one-time read).
    // Using waitUntil() when available ensures the delete is tracked by the
    // Worker runtime even after the response has been flushed.
    const deletePromise = kv.delete(key).catch((err) => {
        // Non-fatal: KV delete failure degrades to TTL-based expiry
        // deno-lint-ignore no-console
        console.warn('[flash] Failed to delete consumed flash key:', err instanceof Error ? err.message : String(err));
    });

    if (executionCtx) {
        executionCtx.waitUntil(deletePromise);
    }

    try {
        return JSON.parse(raw) as FlashMessage;
    } catch {
        return null;
    }
}
