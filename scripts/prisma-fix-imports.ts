#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * Prisma Import Specifier Fixer
 *
 * Rewrites relative import/export specifiers in Prisma-generated TypeScript
 * files to use `.ts` extensions, so Deno's strict resolver can find them
 * without `--sloppy-imports`.
 *
 * Prisma's code generator may emit:
 *   - Node-style `.js` extension imports (e.g. `from "./internal/class.js"`)
 *   - Extensionless imports (e.g. `from "./enums"`) — introduced in Prisma 7.5+
 *
 * Both forms are rewritten to use `.ts` in place. At runtime those `.js` / bare
 * files don't actually exist on disk — the real files are `.ts`.
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
import { dirname, resolve } from '@std/path';

const TARGET_DIRS = [
    './prisma/generated',
    './prisma/generated-d1',
];

/** Matches relative `from './path.js'` and `from "../path.js"` specifiers (import/export). */
const FROM_JS_REGEX = /(\bfrom\s+['"](?:\.\.?\/[^'"]*))\.js(['"])/g;

/** Matches relative `import('./path.js')` dynamic import specifiers. */
const DYNAMIC_IMPORT_JS_REGEX = /(\bimport\s*\(\s*['"](?:\.\.?\/[^'"]*))\.js(['"])/g;

/**
 * Matches any relative from/export specifier (with or without extension).
 * The callback decides whether to add `.ts`.
 */
const FROM_ANY_RELATIVE_REGEX = /(\bfrom\s+)(['"])(\.\.?\/[^'"]+)(\2)/g;
const EXPORT_ANY_RELATIVE_REGEX = /(\bexport\s+(?:\*|(?:\*\s+as\s+\w+)|\{[^}]*\})\s+from\s+)(['"])(\.\.?\/[^'"]+)(\2)/g;

/** Returns true if the path has no file extension in the last segment. */
function lacksExtension(specPath: string): boolean {
    const lastSegment = specPath.split('/').at(-1) ?? specPath;
    return !lastSegment.includes('.');
}

async function fixImportsInFile(filePath: string): Promise<{ changed: boolean; replacements: number }> {
    const original = await Deno.readTextFile(filePath);
    const fileDir = dirname(resolve(filePath));
    let replacements = 0;

    /**
     * Returns true only if a `.ts` source file exists at the resolved specifier path.
     * Binary artifacts (e.g. WASM-bindgen `query_compiler_fast_bg.js`) do NOT have a
     * `.ts` counterpart and must be left as `.js`.
     */
    function tsCounterpartExists(spec: string): boolean {
        try {
            Deno.statSync(resolve(fileDir, spec) + '.ts');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Extracts the relative specifier (e.g. `./internal/class`) from a capture group.
     * Returns null for non-relative paths (absolute paths, package imports).
     */
    function extractSpec(captureGroup: string): string | null {
        const m = captureGroup.match(/['"](\.[^'"]+)$/);
        const spec = m?.[1] ?? null;
        // Only handle relative imports (./ or ../)
        if (!spec || !/^\.\.?\//.test(spec)) return null;
        return spec;
    }

    const rewritten = original
        // .js → .ts  (only when a .ts source file actually exists — skip binary artifacts)
        .replace(FROM_JS_REGEX, (match, p1, p2) => {
            const spec = extractSpec(p1);
            if (!spec || !tsCounterpartExists(spec)) return match;
            replacements++;
            return `${p1}.ts${p2}`;
        })
        .replace(DYNAMIC_IMPORT_JS_REGEX, (match, p1, p2) => {
            const spec = extractSpec(p1);
            if (!spec || !tsCounterpartExists(spec)) return match;
            replacements++;
            return `${p1}.ts${p2}`;
        })
        // bare → .ts  (extensionless relative imports — Prisma 7.5+)
        .replace(FROM_ANY_RELATIVE_REGEX, (match, keyword, quote, specPath) => {
            if (lacksExtension(specPath)) {
                replacements++;
                return `${keyword}${quote}${specPath}.ts${quote}`;
            }
            return match;
        })
        .replace(EXPORT_ANY_RELATIVE_REGEX, (match, keyword, quote, specPath) => {
            if (lacksExtension(specPath)) {
                replacements++;
                return `${keyword}${quote}${specPath}.ts${quote}`;
            }
            return match;
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
        console.log(
            `✅ ${dir}: ${result.files} file${result.files === 1 ? '' : 's'} scanned, ${result.changed} changed, ${result.replacements} replacement${
                result.replacements === 1 ? '' : 's'
            }`,
        );
    }

    console.log(
        `\n🎉 Done: ${totalFiles} file${totalFiles === 1 ? '' : 's'} scanned, ${totalChanged} changed, ${totalReplacements} total replacement${totalReplacements === 1 ? '' : 's'}`,
    );
}

if (import.meta.main) {
    try {
        await main();
    } catch (error) {
        console.error(`❌ Fatal error: ${error instanceof Error ? error.message : String(error)}`);
        Deno.exit(1);
    }
}
