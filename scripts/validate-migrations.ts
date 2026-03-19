#!/usr/bin/env -S deno run --allow-read

/**
 * Database Migration Validator
 *
 * Backend-agnostic validator for SQL migration files.
 * Supports Cloudflare D1 (SQLite) and PostgreSQL migration directories.
 *
 * Validates:
 *  - Naming convention: NNNN_description.sql (four-digit zero-padded prefix)
 *  - Monotonically increasing sequence with no gaps
 *  - No duplicate sequence numbers
 *  - Non-empty SQL content
 *  - No forbidden DDL in a migration file that could break atomicity
 *    (e.g. bare PRAGMA statements outside comments)
 *
 * Usage:
 *   deno run --allow-read scripts/validate-migrations.ts [dir1] [dir2] ...
 *
 * Note: SQL comment stripping uses a simple regex that may incorrectly remove
 * double-dash sequences inside string literals (e.g. `'some--text'`). Migration
 * files should not contain string literals with `--`, but treat any PRAGMA /
 * DROP TABLE warnings as advisory and verify manually when in doubt.
 *
 * Exits 0 on success, 1 on any validation error.
 */

interface MigrationFile {
    seq: number;
    name: string;
    path: string;
}

interface ValidationResult {
    dir: string;
    files: MigrationFile[];
    errors: string[];
    warnings: string[];
}

const MIGRATION_FILENAME_RE = /^(\d{4})_[a-z0-9][a-z0-9_\-]*\.sql$/;

async function validateDirectory(dir: string): Promise<ValidationResult> {
    const result: ValidationResult = { dir, files: [], errors: [], warnings: [] };

    // Check directory exists
    let entries: Deno.DirEntry[];
    try {
        entries = [];
        for await (const entry of Deno.readDir(dir)) {
            entries.push(entry);
        }
    } catch (_e) {
        result.errors.push(`Directory not found or unreadable: ${dir}`);
        return result;
    }

    // Collect .sql files
    const sqlFiles = entries
        .filter((e) => e.isFile && e.name.endsWith('.sql'))
        .map((e) => e.name)
        .sort();

    if (sqlFiles.length === 0) {
        result.warnings.push(`No .sql migration files found in ${dir}`);
        return result;
    }

    // Validate naming convention and parse sequence numbers
    const seqSeen = new Map<number, string>();

    for (const filename of sqlFiles) {
        const match = MIGRATION_FILENAME_RE.exec(filename);
        if (!match) {
            result.errors.push(
                `Invalid filename "${filename}" — expected format: NNNN_description.sql (e.g. 0001_init.sql)`,
            );
            continue;
        }

        const seq = parseInt(match[1], 10);
        const filePath = `${dir}/${filename}`;

        if (seqSeen.has(seq)) {
            result.errors.push(
                `Duplicate sequence number ${seq.toString().padStart(4, '0')}: "${seqSeen.get(seq)}" and "${filename}"`,
            );
            continue;
        }

        seqSeen.set(seq, filename);
        result.files.push({ seq, name: filename, path: filePath });
    }

    // Sort by sequence number
    result.files.sort((a, b) => a.seq - b.seq);

    // Check for sequence gaps (must be 1-indexed with no gaps)
    for (let i = 0; i < result.files.length; i++) {
        const expected = i + 1;
        if (result.files[i].seq !== expected) {
            result.errors.push(
                `Sequence gap detected: expected ${expected.toString().padStart(4, '0')} but found ${result.files[i].seq.toString().padStart(4, '0')} (${result.files[i].name})`,
            );
        }
    }

    // Validate SQL content for each file
    for (const mf of result.files) {
        let sql: string;
        try {
            sql = await Deno.readTextFile(mf.path);
        } catch (_e) {
            result.errors.push(`Cannot read file: ${mf.path}`);
            continue;
        }

        const trimmed = sql.trim();

        if (trimmed.length === 0) {
            result.errors.push(`Migration file is empty: ${mf.name}`);
            continue;
        }

        // Warn about missing final semicolons (common mistake)
        // Strip SQL comments to check effectively
        const strippedComments = trimmed
            .replace(/--[^\n]*/g, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .trim();

        if (strippedComments.length === 0) {
            result.warnings.push(
                `Migration file "${mf.name}" contains only comments and no SQL statements`,
            );
        }

        // Check for bare PRAGMA statements (D1/SQLite specific — can cause issues)
        const pragmaLines = strippedComments
            .split('\n')
            .filter((l) => /^\s*PRAGMA\s+/i.test(l));
        if (pragmaLines.length > 0) {
            result.warnings.push(
                `Migration "${mf.name}" uses PRAGMA statements which may not be transactional: ${pragmaLines.map((l) => l.trim()).join('; ')}`,
            );
        }

        // Warn about DROP TABLE without IF EXISTS (destructive and risky).
        // Note: regex does not match `DROP TABLE IF EXISTS` but will also flag
        // schema-qualified names (schema.table) — all flagged cases warrant review.
        const dropWithoutGuard = strippedComments
            .split(';')
            .map((s) => s.trim())
            .filter((s) => /^DROP\s+TABLE\s+(?!IF\s+EXISTS\s)/i.test(s) && s.length > 0);
        if (dropWithoutGuard.length > 0) {
            result.warnings.push(
                `Migration "${mf.name}" contains DROP TABLE without IF EXISTS — this is destructive and irreversible`,
            );
        }
    }

    return result;
}

function printResult(result: ValidationResult): boolean {
    const hasErrors = result.errors.length > 0;
    const hasWarnings = result.warnings.length > 0;
    const status = hasErrors ? '❌' : '✅';

    console.log(`\n${status} ${result.dir} (${result.files.length} migration(s))`);

    if (result.files.length > 0) {
        for (const mf of result.files) {
            console.log(`   [${mf.seq.toString().padStart(4, '0')}] ${mf.name}`);
        }
    }

    if (hasWarnings) {
        for (const w of result.warnings) {
            console.log(`   ⚠️  ${w}`);
        }
    }

    if (hasErrors) {
        for (const e of result.errors) {
            console.log(`   ❌ ${e}`);
        }
    }

    return !hasErrors;
}

async function main(): Promise<void> {
    // Default directories come from wrangler.toml conventions; can be overridden via args
    const args = Deno.args.length > 0 ? Deno.args : ['migrations', 'admin-migrations'];

    console.log('🔍 Validating database migration files...');
    console.log(`   Checking directories: ${args.join(', ')}`);

    let allValid = true;

    for (const dir of args) {
        const result = await validateDirectory(dir);
        const valid = printResult(result);
        if (!valid) {
            allValid = false;
        }
    }

    console.log('');

    if (allValid) {
        console.log('✅ All migration files are valid');
        Deno.exit(0);
    } else {
        console.log('❌ Migration validation failed — fix the errors above before merging');
        Deno.exit(1);
    }
}

await main();
