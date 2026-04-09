#!/usr/bin/env deno run --allow-read --allow-write
/**
 * scripts/swap-domain.ts — Plug-and-play domain swap for Bloqr API + frontend.
 *
 * Usage:
 *   deno task domain:swap
 *   deno task domain:swap -- --dry-run
 *   deno task domain:swap -- --domain bloqr.jaysonknight.com
 *   deno task domain:swap -- --domain bloqr.jaysonknight.com --canonical bloqr.ai
 *
 * The script:
 *   1. Reads wrangler.toml and frontend/wrangler.toml.
 *   2. Prompts for a root domain (e.g. "bloqr.jaysonknight.com") unless
 *      --domain <value> is provided on the CLI.
 *   3. Prompts for a canonical domain (used for crawl-protection noindex logic)
 *      unless --canonical <value> is provided. Defaults to the root domain.
 *      Set a different value when the root domain is a staging subdomain but
 *      the canonical brand domain is something else (e.g. bloqr.ai).
 *   4. Derives all URL vars and CORS_ALLOWED_ORIGINS from the root domain.
 *   5. Replaces existing values in-place (idempotent — safe to run multiple times).
 *      Both [vars] and [env.dev.vars] sections are updated to keep them in sync.
 *   6. Prints the wrangler commands needed to register Cloudflare Custom Domain routes.
 *   7. Skips file writes when --dry-run is passed.
 */

import { fromFileUrl, join } from '@std/path';

// ── CLI argument parsing ─────────────────────────────────────────────────────

const args = Deno.args;
const dryRun = args.includes('--dry-run');
const domainFlagIdx = args.indexOf('--domain');
const domainArg: string | undefined = domainFlagIdx >= 0 ? args[domainFlagIdx + 1] : undefined;
const canonicalFlagIdx = args.indexOf('--canonical');
const canonicalArg: string | undefined = canonicalFlagIdx >= 0 ? args[canonicalFlagIdx + 1] : undefined;

// ── Repo root detection ──────────────────────────────────────────────────────

/** Resolve an absolute path relative to this script's parent directory (repo root). */
function repoPath(...segments: string[]): string {
    // fromFileUrl converts the file:// URL to a native filesystem path,
    // which correctly handles Windows backslash separators.
    const scriptDir = fromFileUrl(new URL('.', import.meta.url));
    return join(scriptDir, '..', ...segments);
}

const MAIN_WRANGLER = repoPath('wrangler.toml');
const FRONTEND_WRANGLER = repoPath('frontend', 'wrangler.toml');

// ── Domain derivation ────────────────────────────────────────────────────────

interface ProjectUrls {
    frontend: string;
    api: string;
    docs: string;
    landing: string;
    canonical: string;
    corsOrigins: string;
}

/**
 * Derive all project URLs and CORS origins from a root domain.
 *
 * Convention:
 *   root domain  → bloqr.jaysonknight.com  (or bloqr.ai for production)
 *   landing      → https://{root}
 *   app          → https://app.{root}
 *   api          → https://api.{root}
 *   docs         → https://docs.{root}
 *   canonical    → rootDomain itself (the full domain used as canonical base)
 *   CORS origins → localhost variants + app + api
 *
 * Note: canonical is NOT inferred from DNS labels (e.g. slice(-2)) because that
 * is incorrect for multi-label TLDs and produces the wrong value for staging
 * domains like `bloqr.jaysonknight.com` (would give `jaysonknight.com`).
 * Pass `canonicalOverride` to use a different value (e.g. when the root domain
 * is a staging subdomain but the canonical brand domain is different).
 */
function deriveUrls(rootDomain: string, canonicalOverride?: string): ProjectUrls {
    const landing = `https://${rootDomain}`;
    const frontend = `https://app.${rootDomain}`;
    const api = `https://api.${rootDomain}`;
    const docs = `https://docs.${rootDomain}`;

    // Use the provided override, or fall back to the full root domain itself.
    const canonical = canonicalOverride ?? rootDomain;

    const corsOrigins = [
        'http://localhost:4200',
        'http://localhost:8787',
        frontend,
        api,
    ].join(',');

    return { landing, frontend, api, docs, canonical, corsOrigins };
}

// ── TOML value replacement helpers ──────────────────────────────────────────

/**
 * Replace the value of a TOML key in a file's text content.
 * Handles both quoted strings and bare values on the same line as the key.
 *
 * @param content  - Full file text.
 * @param key      - TOML key name (may contain spaces around `=`).
 * @param newValue - New value (will be written with surrounding double-quotes).
 * @returns Updated file text.
 */
function replaceTomlValue(content: string, key: string, newValue: string): string {
    // Matches:   KEY = "old-value"   or   KEY = old-value
    // Anchored to start of line; stops before any inline # comment so we don't
    // accidentally replace trailing comment text alongside the value.
    // Uses the global flag (g) so that duplicate keys across multiple TOML
    // sections (e.g. [vars] and [env.dev.vars]) are all updated, keeping the
    // file idempotent and prod/dev values in sync.
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^([ \\t]*${escapedKey}[ \\t]*=[ \\t]*)(?:"[^"]*"|[^#\\r\\n]*)`, 'gm');
    const replacement = `$1"${newValue}"`;
    if (!re.test(content)) {
        // Key not present — append to end of [vars] block would be complex; warn instead.
        console.warn(`  ⚠️  Key "${key}" not found in file — skipping.`);
        return content;
    }
    re.lastIndex = 0;
    return content.replace(re, replacement);
}

/**
 * Replace the [[routes]] pattern in a TOML file.
 * Handles the `pattern = "..."` field inside the FIRST `[[routes]]` block.
 *
 * Each wrangler.toml in this repo contains exactly one `[[routes]]` block
 * (one for the API worker, one for the frontend worker). The regex matches
 * only content between `[[routes]]` and the next `[[` section header, so
 * it is not confused by brackets that appear inside TOML string values or
 * comments within the same block.
 *
 * If you add multiple `[[routes]]` blocks in the future, update this function
 * to target them by index or by an adjacent identifying comment/key.
 */
function replaceRoutePattern(content: string, newPattern: string): string {
    // Match [[routes]] … up to (but not including) the next [[ section header.
    // Using a character class [^\[] avoids matching the start of any nested [[ header.
    return content.replace(
        /(^\[\[routes\]\](?:[^\[]|\[[^\[])*?pattern\s*=\s*)"[^"]*"/ms,
        `$1"${newPattern}"`,
    );
}

// ── File read / write ────────────────────────────────────────────────────────

async function readFile(path: string): Promise<string> {
    try {
        return await Deno.readTextFile(path);
    } catch {
        console.error(`❌  Cannot read ${path}`);
        Deno.exit(1);
    }
}

async function writeFile(path: string, content: string): Promise<void> {
    if (dryRun) {
        console.log(`  [dry-run] Would write ${path}`);
        return;
    }
    await Deno.writeTextFile(path, content);
    console.log(`  ✅  Updated ${path}`);
}

// ── Diff printer ─────────────────────────────────────────────────────────────

function printDiff(label: string, before: string, after: string): void {
    if (before === after) {
        console.log(`  (no changes in ${label})`);
        return;
    }
    console.log(`\n  Changes in ${label}:`);
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    const maxLen = Math.max(beforeLines.length, afterLines.length);
    for (let i = 0; i < maxLen; i++) {
        const b = beforeLines[i] ?? '';
        const a = afterLines[i] ?? '';
        if (b !== a) {
            console.log(`    - ${b}`);
            console.log(`    + ${a}`);
        }
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    // 1. Determine root domain
    let rootDomain = domainArg;
    if (!rootDomain) {
        const input = prompt('Enter root domain (e.g. bloqr.jaysonknight.com):');
        rootDomain = input?.trim();
    }
    if (!rootDomain) {
        console.error('❌  No domain provided. Exiting.');
        Deno.exit(1);
    }

    // 2. Determine canonical domain (used for crawl-protection noindex logic).
    // Defaults to rootDomain itself.  Override with --canonical or by prompting
    // when the root domain is a staging subdomain (e.g. bloqr.jaysonknight.com)
    // but the real brand domain is different (e.g. bloqr.ai).
    let canonicalDomain = canonicalArg;
    if (!canonicalDomain) {
        const input = prompt(`Enter canonical domain for crawl protection (default: ${rootDomain}):`);
        const trimmed = input?.trim();
        canonicalDomain = trimmed && trimmed.length > 0 ? trimmed : rootDomain;
    }

    const urls = deriveUrls(rootDomain, canonicalDomain);

    console.log('\n🔧  Computed URLs:');
    console.log(`    Landing   : ${urls.landing}`);
    console.log(`    Frontend  : ${urls.frontend}`);
    console.log(`    API       : ${urls.api}`);
    console.log(`    Docs      : ${urls.docs}`);
    console.log(`    Canonical : ${urls.canonical}`);
    console.log(`    CORS      : ${urls.corsOrigins}`);
    console.log('');

    if (dryRun) {
        console.log('🔍  Dry-run mode — files will NOT be modified.\n');
    }

    // 3. Update wrangler.toml (main API worker)
    console.log(`📄  Processing ${MAIN_WRANGLER} …`);
    let main = await readFile(MAIN_WRANGLER);
    const mainBefore = main;

    main = replaceTomlValue(main, 'URL_FRONTEND', urls.frontend);
    main = replaceTomlValue(main, 'URL_API', urls.api);
    main = replaceTomlValue(main, 'URL_DOCS', urls.docs);
    main = replaceTomlValue(main, 'URL_LANDING', urls.landing);
    main = replaceTomlValue(main, 'CANONICAL_DOMAIN', urls.canonical);
    main = replaceTomlValue(main, 'CORS_ALLOWED_ORIGINS', urls.corsOrigins);
    // Route pattern must be a bare hostname — no path or wildcard allowed for
    // custom_domain = true entries (Cloudflare rejects patterns with /* suffix).
    main = replaceRoutePattern(main, `api.${rootDomain}`);

    printDiff('wrangler.toml', mainBefore, main);
    await writeFile(MAIN_WRANGLER, main);

    // 4. Update frontend/wrangler.toml
    console.log(`\n📄  Processing ${FRONTEND_WRANGLER} …`);
    let frontend = await readFile(FRONTEND_WRANGLER);
    const frontendBefore = frontend;

    frontend = replaceTomlValue(frontend, 'URL_FRONTEND', urls.frontend);
    frontend = replaceTomlValue(frontend, 'URL_API', urls.api);
    frontend = replaceTomlValue(frontend, 'URL_DOCS', urls.docs);
    frontend = replaceTomlValue(frontend, 'URL_LANDING', urls.landing);
    frontend = replaceTomlValue(frontend, 'CANONICAL_DOMAIN', urls.canonical);
    // Same bare-hostname requirement applies to the frontend worker route.
    frontend = replaceRoutePattern(frontend, `app.${rootDomain}`);

    printDiff('frontend/wrangler.toml', frontendBefore, frontend);
    await writeFile(FRONTEND_WRANGLER, frontend);

    // 5. Print wrangler commands
    console.log('\n🚀  Cloudflare Custom Domain setup commands:');
    console.log('    (Run these after `wrangler deploy` to register the custom domains)\n');
    console.log(`    wrangler deploy --config wrangler.toml`);
    console.log(`    wrangler custom-domains add api.${rootDomain} --config wrangler.toml\n`);
    console.log(`    wrangler deploy --config frontend/wrangler.toml`);
    console.log(`    wrangler custom-domains add app.${rootDomain} --config frontend/wrangler.toml\n`);

    if (dryRun) {
        console.log('✅  Dry-run complete — no files were modified.');
    } else {
        console.log('✅  Domain swap complete.');
        console.log('    Run `deno task fmt` to re-format the TOML files if needed.');
    }
}

await main();
