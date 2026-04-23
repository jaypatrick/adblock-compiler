#!/usr/bin/env -S deno run --allow-net --allow-env --allow-write
// deno-lint-ignore-file no-console

/**
 * Page Shield Script Sync
 *
 * Fetches the Cloudflare Page Shield script inventory for a zone and writes
 * two ABP-format rule files to the `data/` directory:
 *
 *   data/pageshield-blocklist.txt  — scripts with malicious_score > 0.7
 *   data/pageshield-allowlist.txt  — scripts with malicious_score < 0.1
 *
 * These files are consumed as optional rule sources by the compiler pipeline
 * (see src/cli/CliApp.deno.ts → appendPageShieldSources).
 *
 * ## Environment variables (required)
 *   CF_ZONE_ID                 — Cloudflare zone ID
 *   CF_PAGE_SHIELD_API_TOKEN   — Cloudflare API token scoped to Page Shield (read)
 *
 * ## Usage
 *   deno task pageshield:sync
 */

import { createCloudflareApiService, type PageShieldScript } from '../src/services/cloudflareApiService.ts';
import { PAGE_SHIELD_ALLOW_THRESHOLD, PAGE_SHIELD_BLOCK_THRESHOLD, toAllowRule, toBlockRule } from '../src/utils/pageshield-rules.ts';

const CF_ZONE_ID = Deno.env.get('CF_ZONE_ID');
const CF_PAGE_SHIELD_API_TOKEN = Deno.env.get('CF_PAGE_SHIELD_API_TOKEN');

// ── Constants ────────────────────────────────────────────────────────────────

const BLOCKLIST_PATH = 'data/pageshield-blocklist.txt';
const ALLOWLIST_PATH = 'data/pageshield-allowlist.txt';

// ── File writers ─────────────────────────────────────────────────────────────

/**
 * Writes ABP-format rules to a file, prepending a generation header.
 *
 * @param path  - Destination file path.
 * @param rules - Array of ABP rule strings.
 * @param label - Human-readable label for the header comment.
 */
async function writeRuleFile(path: string, rules: string[], label: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const header = [
        `! Page Shield ${label}`,
        `! Generated: ${timestamp}`,
        `! Source: Cloudflare Page Shield API`,
        `! Zone: ${CF_ZONE_ID}`,
        '',
    ].join('\n');

    await Deno.writeTextFile(path, header + rules.join('\n') + '\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Fetches Page Shield scripts via CloudflareApiService and writes ABP rule files to `data/`.
 */
async function syncToAdblockRules(): Promise<void> {
    if (!CF_ZONE_ID) {
        throw new Error('CF_ZONE_ID environment variable is not set');
    }
    if (!CF_PAGE_SHIELD_API_TOKEN) {
        throw new Error('CF_PAGE_SHIELD_API_TOKEN environment variable is not set');
    }

    console.log('[pageshield:sync] Fetching Page Shield scripts…');

    // Use the shared CloudflareApiService so all Cloudflare REST calls go through
    // the official SDK (auth, retries, error handling) instead of raw fetch().
    const cfApi = createCloudflareApiService({ apiToken: CF_PAGE_SHIELD_API_TOKEN });
    const scripts = await cfApi.getPageShieldScripts(CF_ZONE_ID);
    console.log(`[pageshield:sync] Fetched ${scripts.length} scripts`);

    // Narrow once to scripts that Cloudflare has already scored, eliminating
    // the repeated `typeof s.malicious_score === 'number'` guard below.
    const scoredScripts = scripts.filter(
        (s): s is PageShieldScript & { malicious_score: number } => typeof s.malicious_score === 'number',
    );

    const malicious = scoredScripts.filter((s) => s.malicious_score > PAGE_SHIELD_BLOCK_THRESHOLD);
    const trusted = scoredScripts.filter((s) => s.malicious_score < PAGE_SHIELD_ALLOW_THRESHOLD);

    // Deduplicate by hostname
    const blockRules = [...new Set(malicious.map((s) => toBlockRule(s.url)))];
    const allowRules = [...new Set(trusted.map((s) => toAllowRule(s.url)))];

    // Ensure data/ directory exists
    try {
        await Deno.mkdir('data', { recursive: true });
    } catch {
        // Directory already exists — ignore
    }

    await writeRuleFile(BLOCKLIST_PATH, blockRules, 'Blocklist');
    await writeRuleFile(ALLOWLIST_PATH, allowRules, 'Allowlist');

    console.log(`[pageshield:sync] Wrote ${blockRules.length} block rules → ${BLOCKLIST_PATH}`);
    console.log(`[pageshield:sync] Wrote ${allowRules.length} allow rules → ${ALLOWLIST_PATH}`);
    console.log('[pageshield:sync] Done.');
}

await syncToAdblockRules();
