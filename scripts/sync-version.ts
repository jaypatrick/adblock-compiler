#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * Sync version from src/version.ts to all other version files.
 *
 * This script makes src/version.ts the single source of writable truth.
 * Run this after updating the VERSION constant in src/version.ts to propagate
 * the version to deno.json, package.json, and wrangler.toml.
 *
 * Usage:
 *   deno task version:sync
 *   deno run --allow-read --allow-write scripts/sync-version.ts
 */

/**
 * Extract VERSION from src/version.ts using a regex.
 */
async function readVersionFromSource(): Promise<string> {
    const content = await Deno.readTextFile('src/version.ts');
    const match = content.match(/export const VERSION = '([^']+)'/);
    if (!match) {
        console.error("Could not find VERSION constant in src/version.ts");
        Deno.exit(1);
    }
    return match[1];
}

/**
 * Update the "version" field in a JSON file (deno.json / package.json).
 */
async function syncJsonFile(path: string, version: string): Promise<void> {
    try {
        const content = await Deno.readTextFile(path);
        const json = JSON.parse(content) as Record<string, unknown>;
        const old = json['version'] as string | undefined;
        if (old === version) {
            console.log(`  ${path}: already at ${version}, skipping`);
            return;
        }
        json['version'] = version;
        await Deno.writeTextFile(path, JSON.stringify(json, null, 4) + '\n');
        console.log(`  ${path}: ${old} → ${version}`);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
            console.warn(`  ${path}: not found, skipping`);
        } else {
            throw error;
        }
    }
}

/**
 * Update COMPILER_VERSION in wrangler.toml.
 * Anchors to start of line to avoid matching occurrences in comments.
 */
async function syncWranglerToml(path: string, version: string): Promise<void> {
    try {
        const content = await Deno.readTextFile(path);
        const oldMatch = content.match(/^COMPILER_VERSION = "([^"]+)"/m);
        const old = oldMatch?.[1];
        if (old === version) {
            console.log(`  ${path}: already at ${version}, skipping`);
            return;
        }
        const updated = content.replace(/^COMPILER_VERSION = "[^"]*"/m, `COMPILER_VERSION = "${version}"`);
        await Deno.writeTextFile(path, updated);
        console.log(`  ${path}: ${old ?? '<not found>'} → ${version}`);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
            console.warn(`  ${path}: not found, skipping`);
        } else {
            throw error;
        }
    }
}

async function main(): Promise<void> {
    const version = await readVersionFromSource();
    console.log(`Syncing version ${version} from src/version.ts to:`);

    await syncJsonFile('deno.json', version);
    await syncJsonFile('package.json', version);
    await syncWranglerToml('wrangler.toml', version);

    console.log('Done.');
}

if (import.meta.main) {
    await main();
}
