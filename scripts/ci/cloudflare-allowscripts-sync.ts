#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * Cloudflare allowScripts Sync
 *
 * Reads deno.lock and ensures that every workerd version present in the lock
 * file is listed in the allowScripts array of deno.json. Stale workerd entries
 * that are no longer in the lock are removed.
 *
 * This script must be run AFTER `deno cache src/index.ts` so that the lock file
 * reflects the current wrangler resolution (which pulls in workerd).
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/ci/cloudflare-allowscripts-sync.ts
 *
 * Exit codes:
 *   0 — completed (check `git diff deno.json` to see if anything changed)
 */

function readJson(path: string): Record<string, unknown> {
    const text = Deno.readTextFileSync(path);
    return JSON.parse(text) as Record<string, unknown>;
}

function main(): void {
    console.log('🔄  Syncing deno.json allowScripts with deno.lock workerd versions...\n');

    const lock = readJson('deno.lock');
    const denoJsonRaw = Deno.readTextFileSync('deno.json');

    // --- Collect workerd versions from deno.lock ---
    const npm = (lock['npm'] as Record<string, unknown>) ?? {};
    const lockedWorkerd = Object.keys(npm)
        .filter((k) => k.startsWith('workerd@'))
        .map((k) => k.replace('workerd@', ''))
        .sort();

    if (lockedWorkerd.length === 0) {
        console.log('ℹ️  No workerd entries found in deno.lock; nothing to sync.');
        return;
    }

    console.log(`ℹ️  workerd versions in deno.lock: ${lockedWorkerd.join(', ')}`);

    // --- Parse deno.json and compute new allowScripts ---
    const denoJson = JSON.parse(denoJsonRaw) as Record<string, unknown>;
    const currentAllowScripts = (denoJson['allowScripts'] as string[]) ?? [];

    const nonWorkerd = currentAllowScripts.filter((s) => !s.startsWith('npm:workerd@'));
    const newWorkerd = lockedWorkerd.map((v) => `npm:workerd@${v}`);
    const newAllowScripts = [...nonWorkerd, ...newWorkerd];

    const currentWorkerd = currentAllowScripts.filter((s) => s.startsWith('npm:workerd@'));

    if (JSON.stringify(currentWorkerd.sort()) === JSON.stringify(newWorkerd.sort())) {
        console.log('✅  allowScripts workerd entries are already in sync. No changes needed.');
        return;
    }

    // --- Build the replacement string for the allowScripts array ---
    // We do a targeted regex replacement instead of re-serializing the whole
    // deno.json to avoid any key-ordering or whitespace side effects.
    //
    // The allowScripts array in deno.json looks like:
    //     "allowScripts": [
    //         "npm:foo@1.0.0",
    //         ...
    //     ]
    //
    // The pattern `"allowScripts":\s*\[[\s\S]*?\]` is safe here because:
    //   - allowScripts entries are plain strings (no nested arrays/objects)
    //   - The non-greedy `*?` stops at the very first `]`, which is the
    //     array's closing bracket; no false early match is possible given
    //     the known deno.json schema where all entries are string literals.
    //
    // JSON.stringify with indent=4, then prepend 4 extra spaces to each
    // non-first line, produces the same layout (items at 8 spaces, closing
    // bracket at 4 spaces) matching the existing deno.json style.
    const arrJson = JSON.stringify(newAllowScripts, null, 4)
        .split('\n')
        .map((line, i) => (i === 0 ? line : '    ' + line))
        .join('\n');

    const updated = denoJsonRaw.replace(/"allowScripts":\s*\[[\s\S]*?\]/, `"allowScripts": ${arrJson}`);

    if (updated === denoJsonRaw) {
        console.log('ℹ️  Regex replacement found no match — deno.json may have unexpected formatting.');
        console.log('    Please manually update allowScripts to include:', newWorkerd);
        Deno.exit(1);
    }

    Deno.writeTextFileSync('deno.json', updated);

    const added = newWorkerd.filter((v) => !currentWorkerd.includes(v));
    const removed = currentWorkerd.filter((v) => !newWorkerd.includes(v));

    if (added.length) {
        console.log(`✅  Added:   ${added.join(', ')}`);
    }
    if (removed.length) {
        console.log(`🗑️   Removed: ${removed.join(', ')}`);
    }
    console.log('\n✅  allowScripts sync complete.');
}

if (import.meta.main) {
    main();
}
