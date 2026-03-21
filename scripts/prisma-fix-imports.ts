#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * Prisma Import Specifier Fixer
 *
 * Rewrites relative `.js` import/export specifiers in Prisma-generated TypeScript
 * files to `.ts`, so Deno's strict resolver can find them without `--sloppy-imports`.
 *
 * Prisma's code generator emits Node-style `.js` extension imports (e.g.
 * `import * as $Class from "./internal/class.js"`) inside every file it writes.
 * At runtime those `.js` files don't actually exist on disk — the real files are
 * `.ts`. This script rewrites them in-place after each `prisma generate` run.
 *
 * Target directories:
 *   - ./prisma/generated
 *   - ./prisma/generated-d1
 *
 * Invocation:
 *   deno run --allow-read --allow-write scripts/prisma-fix-imports.ts
 *   deno task db:generate       (runs automatically after prisma generate)
 *   deno task db:generate:d1    (runs automatically after prisma generate)
 */

import { walk } from '@std/fs';

const TARGET_DIRS = [
    './prisma/generated',
    './prisma/generated-d1',
];

/** Matches relative `from './path.js'` and `from "../path.js"` specifiers (import/export). */
const FROM_REGEX = /(\bfrom\s+['"](?:\.\.?\/[^'"]*))\.js(['"])/g;

/** Matches relative `import('./path.js')` dynamic import specifiers. */
const DYNAMIC_IMPORT_REGEX = /(\bimport\s*\(\s*['"](?:\.\.?\/[^'"]*))\.js(['"])/g;

async function fixImportsInFile(filePath: string): Promise<{ changed: boolean; replacements: number }> {
    const original = await Deno.readTextFile(filePath);
    let replacements = 0;

    const rewritten = original
        .replace(FROM_REGEX, (_, p1, p2) => {
            replacements++;
            return `${p1}.ts${p2}`;
        })
        .replace(DYNAMIC_IMPORT_REGEX, (_, p1, p2) => {
            replacements++;
            return `${p1}.ts${p2}`;
        });

    if (replacements === 0) {
        return { changed: false, replacements: 0 };
    }

    await Deno.writeTextFile(filePath, rewritten);
    return { changed: true, replacements };
}

async function fixDirectory(dir: string): Promise<{ files: number; changed: number; replacements: number }> {
    let files = 0;
    let changed = 0;
    let replacements = 0;

    for await (const entry of walk(dir, { exts: ['.ts'], includeDirs: false })) {
        files++;
        const result = await fixImportsInFile(entry.path);
        if (result.changed) {
            changed++;
            replacements += result.replacements;
            console.log(`  🔧 ${entry.path} (${result.replacements} replacement${result.replacements === 1 ? '' : 's'})`);
        }
    }

    return { files, changed, replacements };
}

async function main(): Promise<void> {
    let totalFiles = 0;
    let totalChanged = 0;
    let totalReplacements = 0;

    for (const dir of TARGET_DIRS) {
        try {
            const stat = await Deno.stat(dir);
            if (!stat.isDirectory) {
                console.log(`⚠️  ${dir} is not a directory — skipping`);
                continue;
            }
        } catch (err) {
            if (err instanceof Deno.errors.NotFound) {
                console.log(`⚠️  ${dir} does not exist yet — skipping`);
                continue;
            }
            console.error(`❌ Failed to stat ${dir}: ${err instanceof Error ? err.message : String(err)}`);
            Deno.exit(1);
        }

        console.log(`\n🔍 Processing ${dir}...`);
        const result = await fixDirectory(dir);
        totalFiles += result.files;
        totalChanged += result.changed;
        totalReplacements += result.replacements;
        console.log(`✅ ${dir}: ${result.files} file${result.files === 1 ? '' : 's'} scanned, ${result.changed} changed, ${result.replacements} replacement${result.replacements === 1 ? '' : 's'}`);
    }

    console.log(`\n🎉 Done: ${totalFiles} file${totalFiles === 1 ? '' : 's'} scanned, ${totalChanged} changed, ${totalReplacements} total replacement${totalReplacements === 1 ? '' : 's'}`);
}

if (import.meta.main) {
    try {
        await main();
    } catch (error) {
        console.error(`❌ Fatal error: ${error instanceof Error ? error.message : String(error)}`);
        Deno.exit(1);
    }
}
