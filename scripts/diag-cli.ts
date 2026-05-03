#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Interactive diagnostic CLI for the bloqr-backend Worker.
 *
 * Usage:
 *   deno task diag                         # interactive menu
 *   deno task diag:ci                      # CI mode (all probes, exit 0/1)
 *   deno task diag:prod                    # target production URL
 *   deno run --allow-net --allow-env scripts/diag-cli.ts --help
 *
 * Flags:
 *   --url      Base URL to probe (default: https://bloqr-frontend.jk-com.workers.dev)
 *   --probe    Comma-separated probe names, or "all" (default: all)
 *   --timeout  Per-probe timeout in ms (default: 15000)
 *   --ci       Non-interactive CI mode: run all probes, print table, exit 0/1
 *   --help     Print usage
 *
 * @see scripts/diag.ts             — probe library
 * @see docs/operations/diagnostics.md — technical reference
 */

import { parseArgs } from '@std/cli/parse-args';
import { type DiagResult, PROBE_NAMES, type ProbeName, PROBES } from './diag.ts';

// ─── CLI flags ────────────────────────────────────────────────────────────────

const args = parseArgs(Deno.args, {
    string: ['url', 'probe', 'timeout'],
    boolean: ['ci', 'help'],
    default: {
        url: 'https://bloqr-frontend.jk-com.workers.dev',
        probe: 'all',
        timeout: '15000',
        ci: false,
        help: false,
    },
});

if (args['help']) {
    console.log(`
bloqr-backend diagnostic CLI

Usage:
  deno run --allow-net --allow-env scripts/diag-cli.ts [flags]

Flags:
  --url       Base URL to probe (default: https://bloqr-frontend.jk-com.workers.dev)
  --probe     Comma-separated probe names, or "all" (default: all)
  --timeout   Per-probe timeout in ms (default: 15000)
  --ci        Non-interactive CI mode: run all probes, print table, exit 0/1
  --help      Print usage

Available probes:
${PROBE_NAMES.map((n) => `  ${n}`).join('\n')}
`);
    Deno.exit(0);
}

const BASE_URL: string = args['url'] as string;
const CI_MODE: boolean = args['ci'] as boolean;
const rawTimeout = parseInt(args['timeout'] as string, 10);
const TIMEOUT_MS: number = isNaN(rawTimeout) || rawTimeout <= 0 ? 15_000 : rawTimeout;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveProbes(spec: string): ProbeName[] {
    if (spec === 'all') return [...PROBE_NAMES];
    const requested = spec.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    const unknown = requested.filter((s) => !(s in PROBES));
    if (unknown.length > 0) {
        console.error(`❌ Unknown probe(s): ${unknown.join(', ')}`);
        console.error(`   Available probes: ${PROBE_NAMES.join(', ')}`);
        Deno.exit(1);
    }
    const valid = requested.filter((s): s is ProbeName => s in PROBES);
    if (valid.length === 0) {
        console.error('❌ No valid probes specified. Use --probe=all or provide probe name(s).');
        console.error(`   Available probes: ${PROBE_NAMES.join(', ')}`);
        Deno.exit(1);
    }
    return valid;
}

// ─── Table rendering ──────────────────────────────────────────────────────────

const COL_PROBE = 25;
const COL_STATUS = 8;
const COL_LATENCY = 10;
const COL_DETAIL = 45;

function pad(s: string, n: number): string {
    if (s.length >= n) return s.slice(0, n - 1) + '…';
    return s + ' '.repeat(n - s.length);
}

function printTableHeader(): void {
    const sep = (w: number) => '─'.repeat(w);
    console.log(
        `┌${sep(COL_PROBE + 2)}┬${sep(COL_STATUS + 2)}┬${sep(COL_LATENCY + 2)}┬${sep(COL_DETAIL + 2)}┐`,
    );
    console.log(
        `│ ${pad('Probe', COL_PROBE)} │ ${pad('Status', COL_STATUS)} │ ${pad('Latency', COL_LATENCY)} │ ${pad('Detail', COL_DETAIL)} │`,
    );
    console.log(
        `├${sep(COL_PROBE + 2)}┼${sep(COL_STATUS + 2)}┼${sep(COL_LATENCY + 2)}┼${sep(COL_DETAIL + 2)}┤`,
    );
}

function printTableRow(r: DiagResult): void {
    const status = r.ok ? ' ✅    ' : ' ❌    ';
    const latency = r.latency_ms !== undefined ? `${r.latency_ms}ms` : 'N/A';
    const detail = r.detail ?? '';
    console.log(
        `│ ${pad(r.label, COL_PROBE)} │${pad(status, COL_STATUS + 2)} │ ${pad(latency, COL_LATENCY)} │ ${pad(detail, COL_DETAIL)} │`,
    );
}

function printTableFooter(): void {
    const sep = (w: number) => '─'.repeat(w);
    console.log(
        `└${sep(COL_PROBE + 2)}┴${sep(COL_STATUS + 2)}┴${sep(COL_LATENCY + 2)}┴${sep(COL_DETAIL + 2)}┘`,
    );
}

// ─── Run probes ───────────────────────────────────────────────────────────────

async function runProbes(names: ProbeName[]): Promise<DiagResult[]> {
    const results: DiagResult[] = [];
    for (const name of names) {
        const probe = PROBES[name];
        Deno.stdout.writeSync(new TextEncoder().encode(`  Running ${name}…\r`));
        const result = await probe(BASE_URL, TIMEOUT_MS);
        results.push(result);
    }
    return results;
}

function printResults(results: DiagResult[]): void {
    printTableHeader();
    for (const r of results) {
        printTableRow(r);
    }
    printTableFooter();
}

// ─── CI mode ─────────────────────────────────────────────────────────────────

async function runCiMode(): Promise<void> {
    const probeNames = resolveProbes(args['probe'] as string);
    console.log('\n🔍 bloqr-backend diagnostic CLI — CI mode');
    console.log(`   URL     : ${BASE_URL}`);
    console.log(`   Timeout : ${TIMEOUT_MS}ms`);
    console.log(`   Probes  : ${probeNames.join(', ')}\n`);

    const results = await runProbes(probeNames);

    printResults(results);

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
        console.log(`\n❌ ${failed.length} probe(s) failed:`);
        for (const r of failed) {
            console.log(`   • ${r.label}: ${r.detail ?? 'no detail'}`);
        }
        Deno.exit(1);
    }

    console.log(`\n✅ All ${results.length} probe(s) passed`);
    Deno.exit(0);
}

// ─── Interactive mode ─────────────────────────────────────────────────────────

function printMenu(probeNames: ProbeName[]): void {
    console.log('\n📋 bloqr-backend diagnostic CLI');
    console.log(`   URL: ${BASE_URL}\n`);
    console.log('Select a probe to run:');
    probeNames.forEach((name, i) => {
        console.log(`  ${i + 1}. ${name}`);
    });
    console.log(`  ${probeNames.length + 1}. Run all`);
    console.log(`  ${probeNames.length + 2}. Exit`);
    console.log('');
}

async function readLine(): Promise<string> {
    const buf = new Uint8Array(256);
    const n = await Deno.stdin.read(buf);
    if (n === null) return '';
    return new TextDecoder().decode(buf.subarray(0, n)).trim();
}

async function runInteractiveMode(): Promise<void> {
    const allProbeNames = resolveProbes('all');

    // Handle Ctrl+C gracefully
    Deno.addSignalListener('SIGINT', () => {
        console.log('\n\n👋 Goodbye!');
        Deno.exit(0);
    });

    while (true) {
        printMenu(allProbeNames);
        Deno.stdout.write(new TextEncoder().encode('Enter number: '));
        const line = await readLine();
        const choice = parseInt(line, 10);

        if (isNaN(choice)) {
            console.log('  ⚠️  Invalid choice — enter a number');
            continue;
        }

        const runAllIndex = allProbeNames.length + 1;
        const exitIndex = allProbeNames.length + 2;

        if (choice === exitIndex) {
            console.log('\n👋 Goodbye!');
            Deno.exit(0);
        }

        let probeNamesToRun: ProbeName[];

        if (choice === runAllIndex) {
            probeNamesToRun = [...allProbeNames];
        } else if (choice >= 1 && choice <= allProbeNames.length) {
            const probeName = allProbeNames[choice - 1];
            if (!probeName) {
                console.log('  ⚠️  Invalid choice');
                continue;
            }
            probeNamesToRun = [probeName];
        } else {
            console.log('  ⚠️  Invalid choice');
            continue;
        }

        console.log(`\n⏳ Running ${probeNamesToRun.length} probe(s)…\n`);
        const results = await runProbes(probeNamesToRun);
        printResults(results);

        const failed = results.filter((r) => !r.ok);
        if (failed.length > 0) {
            console.log(`\n❌ ${failed.length} probe(s) failed`);
        } else {
            console.log(`\n✅ All ${results.length} probe(s) passed`);
        }
    }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (CI_MODE) {
    await runCiMode();
} else {
    await runInteractiveMode();
}
