#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write

/**
 * Cloudflare Dependency Update Script
 *
 * Fetches the latest wrangler and @cloudflare/workers-types versions from npm
 * and updates every pinned occurrence across the repository. This is the write-
 * companion to cloudflare-upgrade-check.ts (which is read-only / CI guard).
 *
 * Files updated:
 *   - deno.json             (imports alias + all wrangler task specifiers)
 *   - package.json          (devDependencies)
 *   - frontend/package.json (devDependencies)
 *   - examples/cloudflare-worker/package.json  (devDependencies)
 *   - examples/cloudflare-worker/deno.json     (imports)
 *   - .github/workflows/gradual-deploy.yml     (inline wrangler invocations)
 *   - .github/workflows/sentry-worker.yml      (inline wrangler invocation)
 *
 * After this script runs you must regenerate deno.lock and sync allowScripts:
 *   deno cache src/index.ts
 *   deno run --allow-read --allow-write scripts/ci/cloudflare-allowscripts-sync.ts
 *
 * Usage:
 *   deno run --allow-net --allow-read --allow-write scripts/ci/cloudflare-dep-update.ts
 *
 * Exit codes:
 *   0 — completed successfully (check `git diff` to see what changed)
 */

interface NpmPackageLatest {
    version: string;
}

async function fetchLatestVersion(pkg: string, attempt = 1): Promise<string> {
    const MAX_ATTEMPTS = 3;
    const TIMEOUT_MS = 10_000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
            signal: controller.signal,
        });

        if (!res.ok) {
            if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
                const delay = attempt * 2_000;
                console.log(`  ⏳ npm returned ${res.status} for "${pkg}"; retrying in ${delay / 1_000}s...`);
                await new Promise((r) => setTimeout(r, delay));
                return fetchLatestVersion(pkg, attempt + 1);
            }
            throw new Error(`Failed to fetch "${pkg}" (HTTP ${res.status} ${res.statusText}).`);
        }

        const data = (await res.json()) as NpmPackageLatest;
        return data.version;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            if (attempt < MAX_ATTEMPTS) {
                console.log(`  ⏳ npm fetch for "${pkg}" timed out; retrying (attempt ${attempt}/${MAX_ATTEMPTS})...`);
                return fetchLatestVersion(pkg, attempt + 1);
            }
            throw new Error(`npm registry fetch for "${pkg}" timed out after ${MAX_ATTEMPTS} attempts.`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Replace all regex matches in a file. Returns true if any change was made.
 */
function patchFile(path: string, pattern: RegExp, replacement: string): boolean {
    const original = Deno.readTextFileSync(path);
    const updated = original.replace(pattern, replacement);
    if (updated === original) {
        return false;
    }
    Deno.writeTextFileSync(path, updated);
    return true;
}

interface UpdateSummary {
    package: string;
    oldVersion: string | null;
    newVersion: string;
    filesChanged: string[];
    filesUnchanged: string[];
}

function updateWrangler(latestVersion: string): UpdateSummary {
    // Patterns:
    //   npm specifier (deno.json, workflow YAML):  npm:wrangler@^X.Y.Z
    //   package.json devDep:                       "wrangler": "^X.Y.Z"
    const npmPattern = /npm:wrangler@\^\d+\.\d+\.\d+/g;
    const pkgPattern = /"wrangler":\s*"\^\d+\.\d+\.\d+"/g;

    const npmFiles = [
        'deno.json',
        '.github/workflows/gradual-deploy.yml',
        '.github/workflows/sentry-worker.yml',
    ];
    const pkgFiles = [
        'package.json',
        'examples/cloudflare-worker/package.json',
    ];

    const changed: string[] = [];
    const unchanged: string[] = [];

    // Capture the old version from deno.json before patching
    const denoJsonText = Deno.readTextFileSync('deno.json');
    const oldMatch = denoJsonText.match(/npm:wrangler@\^(\d+\.\d+\.\d+)/);
    const oldVersion = oldMatch ? oldMatch[1] : null;

    for (const f of npmFiles) {
        const updated = patchFile(f, npmPattern, `npm:wrangler@^${latestVersion}`);
        (updated ? changed : unchanged).push(f);
    }
    for (const f of pkgFiles) {
        const updated = patchFile(f, pkgPattern, `"wrangler": "^${latestVersion}"`);
        (updated ? changed : unchanged).push(f);
    }

    return { package: 'wrangler', oldVersion, newVersion: latestVersion, filesChanged: changed, filesUnchanged: unchanged };
}

function updateWorkersTypes(latestVersion: string): UpdateSummary {
    // Patterns:
    //   npm specifier (deno.json):              npm:@cloudflare/workers-types@^X.Y.Z
    //   package.json devDep:                    "@cloudflare/workers-types": "^X.Y.Z"
    const npmPattern = /npm:@cloudflare\/workers-types@\^\d+\.\d+\.\d+/g;
    const pkgPattern = /"@cloudflare\/workers-types":\s*"\^\d+\.\d+\.\d+"/g;

    const npmFiles = [
        'deno.json',
        'examples/cloudflare-worker/deno.json',
    ];
    const pkgFiles = [
        'package.json',
        'frontend/package.json',
        'examples/cloudflare-worker/package.json',
    ];

    const changed: string[] = [];
    const unchanged: string[] = [];

    // Capture old version before patching
    const denoJsonText = Deno.readTextFileSync('deno.json');
    const oldMatch = denoJsonText.match(/npm:@cloudflare\/workers-types@\^(\d+\.\d+\.\d+)/);
    const oldVersion = oldMatch ? oldMatch[1] : null;

    for (const f of npmFiles) {
        const updated = patchFile(f, npmPattern, `npm:@cloudflare/workers-types@^${latestVersion}`);
        (updated ? changed : unchanged).push(f);
    }
    for (const f of pkgFiles) {
        const updated = patchFile(f, pkgPattern, `"@cloudflare/workers-types": "^${latestVersion}"`);
        (updated ? changed : unchanged).push(f);
    }

    return { package: '@cloudflare/workers-types', oldVersion, newVersion: latestVersion, filesChanged: changed, filesUnchanged: unchanged };
}

async function main(): Promise<void> {
    console.log('🔄  Cloudflare dependency update starting...\n');

    const [latestWrangler, latestWorkersTypes] = await Promise.all([
        fetchLatestVersion('wrangler'),
        fetchLatestVersion('@cloudflare/workers-types'),
    ]);

    console.log(`ℹ️  Latest wrangler on npm:                 ${latestWrangler}`);
    console.log(`ℹ️  Latest @cloudflare/workers-types on npm: ${latestWorkersTypes}\n`);

    // Run sequentially — both update deno.json (different patterns) so sequential
    // ensures each read gets the file state written by the previous step.
    const wranglerResult = updateWrangler(latestWrangler);
    const workersTypesResult = updateWorkersTypes(latestWorkersTypes);

    const results = [wranglerResult, workersTypesResult];
    const anyChanged = results.some((r) => r.filesChanged.length > 0);

    for (const r of results) {
        if (r.oldVersion === r.newVersion) {
            console.log(`✅  ${r.package} is already at ^${r.newVersion} — no changes needed`);
        } else if (r.filesChanged.length > 0) {
            const from = r.oldVersion ? `^${r.oldVersion}` : '(unknown)';
            console.log(`📦  ${r.package}: ${from} → ^${r.newVersion}`);
            for (const f of r.filesChanged) {
                console.log(`    ✏️  ${f}`);
            }
        } else {
            console.log(`ℹ️  ${r.package}: latest is ${r.newVersion} but no matching pins found to update`);
        }
    }

    if (!anyChanged) {
        console.log('\n✅  All Cloudflare dependency pins are up to date.');
    } else {
        console.log('\n✅  Pin updates complete.');
        console.log('   Next: run `deno cache src/index.ts` to regenerate deno.lock,');
        console.log('   then `deno run --allow-read --allow-write scripts/ci/cloudflare-allowscripts-sync.ts`');
        console.log('   to sync allowScripts with any new workerd versions in the lock.');
    }
}

if (import.meta.main) {
    await main();
}
