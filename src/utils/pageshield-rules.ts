/**
 * Shared ABP rule-generation utilities for Cloudflare Page Shield.
 *
 * Imported by both the Worker cron handler (`worker/handlers/scheduled.ts`)
 * and the Deno sync script (`scripts/sync-pageshield-allowlist.ts`) so that
 * threshold constants and rule-generation logic stay in one place.
 */

/** Scripts with a malicious score above this threshold are written as block rules. */
export const PAGE_SHIELD_BLOCK_THRESHOLD = 0.7;

/** Scripts with a malicious score below this threshold are written as allow rules. */
export const PAGE_SHIELD_ALLOW_THRESHOLD = 0.1;

/**
 * Converts a script URL to an ABP-format block rule (`||hostname^`).
 *
 * @param url - The script URL.
 * @returns ABP block rule string.
 */
export function toBlockRule(url: string): string {
    try {
        return `||${new URL(url).hostname}^`;
    } catch {
        return `||${url}^`;
    }
}

/**
 * Converts a script URL to an ABP-format allow rule (`@@||hostname^`).
 *
 * @param url - The script URL.
 * @returns ABP allow rule string.
 */
export function toAllowRule(url: string): string {
    try {
        return `@@||${new URL(url).hostname}^`;
    } catch {
        return `@@||${url}^`;
    }
}
