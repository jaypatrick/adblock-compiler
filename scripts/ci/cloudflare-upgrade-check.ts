#!/usr/bin/env -S deno run --allow-net --allow-read

/**
 * Cloudflare Upgrade Check
 *
 * Scans the project's Cloudflare-related dependencies and allowScripts to detect:
 *   1. Outdated wrangler/workerd versions relative to npm latest
 *   2. workerd versions present in deno.lock but missing from deno.json allowScripts
 *
 * Usage:
 *   deno task ci:cloudflare-check
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed (version lag or missing allowScripts entry)
 */

interface NpmPackageLatest {
    version: string;
}

async function fetchLatestVersion(pkg: string): Promise<string> {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`);
    if (!res.ok) {
        throw new Error(`Failed to fetch ${pkg} from npm: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as NpmPackageLatest;
    return data.version;
}

async function readDenoJson(): Promise<Record<string, unknown>> {
    const text = await Deno.readTextFile('deno.json');
    return JSON.parse(text) as Record<string, unknown>;
}

async function readDenoLock(): Promise<Record<string, unknown> | null> {
    try {
        const text = await Deno.readTextFile('deno.lock');
        return JSON.parse(text) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function extractVersion(specifier: string): string {
    // Handles strings like "4.81.1_@cloudflare+workers-types@4.20260411.1" → "4.81.1"
    return specifier.split('_')[0];
}

function semverGt(a: string, b: string): boolean {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] ?? 0;
        const nb = pb[i] ?? 0;
        if (na !== nb) {
            return na > nb;
        }
    }
    return false;
}

interface CheckResult {
    passed: boolean;
    messages: string[];
}

async function checkWranglerVersion(lock: Record<string, unknown> | null): Promise<CheckResult> {
    const messages: string[] = [];
    let passed = true;

    const latestWrangler = await fetchLatestVersion('wrangler');
    console.log(`ℹ️  Latest wrangler on npm: ${latestWrangler}`);

    if (lock) {
        const specifiers = (lock['specifiers'] as Record<string, string>) ?? {};
        for (const [spec, resolved] of Object.entries(specifiers)) {
            if (!spec.includes('wrangler')) {
                continue;
            }
            const resolvedVersion = extractVersion(resolved);
            console.log(`ℹ️  Lock: ${spec} → ${resolvedVersion}`);
            if (semverGt(latestWrangler, resolvedVersion)) {
                messages.push(
                    `⚠️  Wrangler is outdated: locked to ${resolvedVersion}, latest is ${latestWrangler}. ` +
                        `Update the wrangler specifier in deno.json and package.json then regenerate deno.lock.`,
                );
                passed = false;
            }
        }
    }

    return { passed, messages };
}

async function checkWorkerdAllowScripts(
    denoJson: Record<string, unknown>,
    lock: Record<string, unknown> | null,
): Promise<CheckResult> {
    const messages: string[] = [];
    let passed = true;

    const allowScripts = (denoJson['allowScripts'] as string[]) ?? [];
    const allowedWorkerd = new Set(
        allowScripts.filter((s) => s.startsWith('npm:workerd@')).map((s) => s.replace('npm:workerd@', '')),
    );

    const latestWorkerd = await fetchLatestVersion('workerd');
    console.log(`ℹ️  Latest workerd on npm: ${latestWorkerd}`);
    console.log(`ℹ️  Allowed workerd versions in allowScripts: ${[...allowedWorkerd].join(', ')}`);

    if (!allowedWorkerd.has(latestWorkerd)) {
        messages.push(
            `⚠️  workerd@${latestWorkerd} is not in deno.json allowScripts. ` +
                `Add "npm:workerd@${latestWorkerd}" to the allowScripts array.`,
        );
        passed = false;
    }

    if (lock) {
        const npm = (lock['npm'] as Record<string, unknown>) ?? {};
        for (const key of Object.keys(npm)) {
            if (!key.startsWith('workerd@')) {
                continue;
            }
            const version = key.replace('workerd@', '');
            if (!allowedWorkerd.has(version)) {
                messages.push(
                    `⚠️  workerd@${version} is in deno.lock but missing from deno.json allowScripts. ` +
                        `Add "npm:workerd@${version}" to the allowScripts array.`,
                );
                passed = false;
            }
        }
    }

    return { passed, messages };
}

async function checkWorkersTypesVersion(denoJson: Record<string, unknown>): Promise<CheckResult> {
    const messages: string[] = [];
    const passed = true;

    const imports = (denoJson['imports'] as Record<string, string>) ?? {};
    const workersTypesImport = imports['@cloudflare/workers-types'] ?? '';
    const match = workersTypesImport.match(/@(\d+\.\d+\.\d+)/);
    const pinnedVersion = match ? match[1] : null;

    const latestWorkersTypes = await fetchLatestVersion('@cloudflare/workers-types');
    console.log(`ℹ️  Latest @cloudflare/workers-types on npm: ${latestWorkersTypes}`);

    if (pinnedVersion && semverGt(latestWorkersTypes, pinnedVersion)) {
        // Warning only — not a hard failure, just log for visibility.
        console.log(
            `⚠️  @cloudflare/workers-types is outdated: pinned to ^${pinnedVersion}, latest is ${latestWorkersTypes}. ` +
                `Update the pin in deno.json imports.`,
        );
    }

    return { passed, messages };
}

async function main(): Promise<void> {
    console.log('🔍 Cloudflare upgrade check starting...\n');

    const [denoJson, lock] = await Promise.all([readDenoJson(), readDenoLock()]);

    const [wranglerResult, workerdResult, workersTypesResult] = await Promise.all([
        checkWranglerVersion(lock),
        checkWorkerdAllowScripts(denoJson, lock),
        checkWorkersTypesVersion(denoJson),
    ]);

    const allResults = [wranglerResult, workerdResult, workersTypesResult];
    const allMessages = allResults.flatMap((r) => r.messages);
    const allPassed = allResults.every((r) => r.passed);

    console.log();

    if (allMessages.length > 0) {
        console.log('Issues found:');
        for (const msg of allMessages) {
            console.log(`  ${msg}`);
        }
        console.log();
    }

    if (allPassed) {
        console.log('✅ All Cloudflare dependency checks passed.');
        Deno.exit(0);
    } else {
        console.log('❌ Cloudflare dependency checks failed. See above for required actions.');
        Deno.exit(1);
    }
}

if (import.meta.main) {
    await main();
}
