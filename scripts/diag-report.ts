#!/usr/bin/env -S deno run --allow-read --allow-write

/**
 * Diagnostic report formatter for bloqr-backend.
 * Reads a JSON bundle (from --file or stdin) and renders a human-readable report.
 *
 * Usage:
 *   cat diag-report-....json | deno run --allow-read scripts/diag-report.ts
 *   deno run --allow-read scripts/diag-report.ts --file diag-report-....json
 *   deno task diag:report --file diag-report-....json
 *
 * Flags:
 *   --file    Path to a saved bundle JSON file (if omitted, reads from stdin)
 *   --help    Print usage
 *
 * @see scripts/diag-full.ts — bundle generator
 */

import { parseArgs } from '@std/cli/parse-args';
import { type DiagBundle, DiagBundleSchema, type DiagProbeResult, pad, sep } from './diag-full.ts';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum characters of `raw` to display per failed probe in the failures section. */
const RAW_TRUNCATE_CHARS = 400;

// ─── Summary table ────────────────────────────────────────────────────────────

function renderSummaryTable(bundle: DiagBundle): void {
    const COL_CAT = 18;
    const COL_LABEL = 26;
    const COL_STATUS = 6;
    const COL_LATENCY = 10;
    const COL_DETAIL = 36;

    console.log('\n📊 Diagnostic Summary\n');
    console.log(
        `┌${sep(COL_CAT + 2)}┬${sep(COL_LABEL + 2)}┬${sep(COL_STATUS + 2)}┬${sep(COL_LATENCY + 2)}┬${sep(COL_DETAIL + 2)}┐`,
    );
    console.log(
        `│ ${pad('Category', COL_CAT)} │ ${pad('Probe', COL_LABEL)} │ ${pad('St', COL_STATUS)} │ ${pad('Latency', COL_LATENCY)} │ ${pad('Detail', COL_DETAIL)} │`,
    );
    console.log(
        `├${sep(COL_CAT + 2)}┼${sep(COL_LABEL + 2)}┼${sep(COL_STATUS + 2)}┼${sep(COL_LATENCY + 2)}┼${sep(COL_DETAIL + 2)}┤`,
    );

    for (const probe of bundle.probes) {
        const status = probe.ok ? '✅' : '❌';
        const latency = probe.latency_ms !== undefined ? `${probe.latency_ms}ms` : 'N/A';
        const detail = probe.detail ?? '';
        console.log(
            `│ ${pad(probe.category, COL_CAT)} │ ${pad(probe.label, COL_LABEL)} │ ${pad(status, COL_STATUS)} │ ${pad(latency, COL_LATENCY)} │ ${pad(detail, COL_DETAIL)} │`,
        );
    }

    console.log(
        `└${sep(COL_CAT + 2)}┴${sep(COL_LABEL + 2)}┴${sep(COL_STATUS + 2)}┴${sep(COL_LATENCY + 2)}┴${sep(COL_DETAIL + 2)}┘`,
    );

    const { total, passed, failed, durationMs } = bundle.summary;
    const meta = bundle.meta;
    console.log(`\n   Tool    : ${meta.tool} v${meta.version}`);
    console.log(`   URL     : ${meta.baseUrl}`);
    console.log(`   Captured: ${meta.timestamp}`);
    console.log(`   Total   : ${total}  Passed: ${passed}  Failed: ${failed}  Duration: ${durationMs}ms`);
}

// ─── Failures section ─────────────────────────────────────────────────────────

function renderFailures(probes: DiagProbeResult[]): void {
    const failed = probes.filter((p) => !p.ok);
    if (failed.length === 0) {
        console.log('\n✅ No failures to report.');
        return;
    }

    console.log(`\n❌ Failures (${failed.length})\n`);
    for (const probe of failed) {
        console.log(`  ● [${probe.category}] ${probe.label}`);
        if (probe.detail) {
            console.log(`    Detail : ${probe.detail}`);
        }
        if (probe.raw !== undefined) {
            const rawStr = JSON.stringify(probe.raw, null, 2);
            const truncated = rawStr.length > RAW_TRUNCATE_CHARS ? rawStr.slice(0, RAW_TRUNCATE_CHARS) + '\n    …(truncated)' : rawStr;
            console.log(`    Raw    :\n${truncated.split('\n').map((l) => `      ${l}`).join('\n')}`);
        }
        console.log('');
    }
}

// ─── Copilot paste block ──────────────────────────────────────────────────────

function renderCopilotBlock(bundle: DiagBundle): void {
    console.log('\n🤖 Copilot Analysis Block');
    console.log('   Copy the JSON below and paste it into a Copilot chat for automated analysis.\n');
    console.log('```json');
    console.log(JSON.stringify(bundle, null, 2));
    console.log('```');
}

// ─── Bundle reader ────────────────────────────────────────────────────────────

async function readBundle(filePath: string | undefined): Promise<DiagBundle> {
    let text: string;
    if (filePath !== undefined) {
        try {
            text = await Deno.readTextFile(filePath);
        } catch (err) {
            console.error(`❌ Could not read file "${filePath}": ${err instanceof Error ? err.message : String(err)}`);
            Deno.exit(1);
        }
    } else {
        try {
            // `new Response(readable).text()` is the idiomatic Deno way to consume
            // a full ReadableStream<Uint8Array> as a UTF-8 string in a single await.
            text = await new Response(Deno.stdin.readable).text();
        } catch (err) {
            console.error(`❌ Could not read from stdin: ${err instanceof Error ? err.message : String(err)}`);
            console.error('   Tip: pipe a bundle file or use --file <path>');
            Deno.exit(1);
        }
    }

    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        console.error('❌ Failed to parse JSON input.');
        Deno.exit(1);
    }

    const result = DiagBundleSchema.safeParse(raw);
    if (!result.success) {
        console.error('❌ Invalid diagnostic bundle:');
        for (const issue of result.error.issues) {
            console.error(`   ${issue.path.join('.')} — ${issue.message}`);
        }
        Deno.exit(1);
    }
    return result.data;
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (import.meta.main) {
    const args = parseArgs(Deno.args, {
        string: ['file'],
        boolean: ['help'],
        default: { help: false },
    });

    if (args['help']) {
        console.log(`bloqr-backend diagnostic report formatter

Usage:
  cat diag-report-....json | deno run --allow-read scripts/diag-report.ts
  deno run --allow-read scripts/diag-report.ts --file diag-report-....json

Flags:
  --file    Path to a saved bundle JSON file (if omitted, reads from stdin)
  --help    Print usage`);
        Deno.exit(0);
    }

    const filePath = args['file'] as string | undefined;
    const bundle = await readBundle(filePath);

    renderSummaryTable(bundle);
    renderFailures(bundle.probes);
    renderCopilotBlock(bundle);
}
