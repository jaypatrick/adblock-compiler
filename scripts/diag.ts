/**
 * Standalone diagnostic tool for adblock-compiler Worker endpoints.
 *
 * Usage:
 *   deno run -A scripts/diag.ts
 *   deno run -A scripts/diag.ts --env staging
 *   deno run -A scripts/diag.ts --base-url https://adblock-frontend.jayson-knight.workers.dev
 *
 * Exit codes:
 *   0 — all checks passed (or only degraded/warnings)
 *   1 — one or more checks failed
 */

import { bold, cyan, green, red, yellow } from 'jsr:@std/fmt/colors';

// ── Environment base-URL map ──────────────────────────────────────────────────

const ENV_URLS: Record<string, string> = {
    production: 'https://adblock-frontend.jayson-knight.workers.dev',
    staging: 'https://adblock-compiler-staging.jayson-knight.workers.dev',
};

// ── Interfaces ────────────────────────────────────────────────────────────────

interface CheckResult {
    endpoint: string;
    label: string;
    ok: boolean;
    httpStatus?: number;
    latencyMs: number;
    error?: string;
    warnings: string[];
    data?: unknown;
}

interface CheckDef {
    path: string;
    label: string;
    validate: (data: unknown) => string[];
}

// ── Check definitions ─────────────────────────────────────────────────────────

const CHECKS: CheckDef[] = [
    {
        path: '/api/health',
        label: '/api/health',
        validate: (data) => {
            const warnings: string[] = [];
            if (!data || typeof data !== 'object') return ['Response is not a JSON object'];
            const d = data as Record<string, unknown>;
            if (!['healthy', 'degraded', 'unhealthy'].includes(d['status'] as string)) {
                warnings.push(`status field is "${d['status']}" — expected healthy/degraded/unhealthy`);
            }
            if (d['status'] === 'unhealthy') {
                warnings.push('Overall status is unhealthy');
            }
            // Check each service's status if present
            const services = d['services'] as Record<string, unknown> | undefined;
            if (services && typeof services === 'object') {
                for (const [name, svc] of Object.entries(services)) {
                    const s = svc as Record<string, unknown>;
                    if (s && s['status'] === 'down') {
                        warnings.push(`${name}.status = "down" (service unavailable)`);
                    }
                }
            }
            return warnings;
        },
    },
    {
        path: '/api/health/db-smoke',
        label: '/api/health/db-smoke',
        validate: (data) => {
            const warnings: string[] = [];
            if (!data || typeof data !== 'object') return ['Response is not a JSON object'];
            const d = data as Record<string, unknown>;
            if (d['ok'] !== true) {
                warnings.push(`ok = ${JSON.stringify(d['ok'])} — expected true`);
            }
            if (d['db_name']) warnings.push(`db_name: ${d['db_name']}`);
            if (typeof d['latency_ms'] === 'number') {
                warnings.push(`latency_ms: ${d['latency_ms']}ms`);
            }
            return warnings;
        },
    },
    {
        path: '/api/metrics',
        label: '/api/metrics',
        validate: (data) => {
            if (!data || typeof data !== 'object') return ['Response is not a JSON object'];
            return [];
        },
    },
    {
        path: '/api/version',
        label: '/api/version',
        validate: (data) => {
            const warnings: string[] = [];
            if (!data || typeof data !== 'object') return ['Response is not a JSON object'];
            const d = data as Record<string, unknown>;
            const ver = d['version'] ?? d['tag'] ?? d['commit'];
            if (ver) warnings.push(`version: ${ver}`);
            return warnings;
        },
    },
    {
        path: '/api/health/latest',
        label: '/api/health/latest',
        validate: (data) => {
            const warnings: string[] = [];
            if (!data || typeof data !== 'object') return ['Response is not a JSON object'];
            const d = data as Record<string, unknown>;
            if (d['timestamp'] || d['checkedAt'] || d['lastCheck']) {
                const ts = d['timestamp'] ?? d['checkedAt'] ?? d['lastCheck'];
                warnings.push(`last check: ${ts}`);
            }
            return warnings;
        },
    },
];

// ── Core check function ───────────────────────────────────────────────────────

async function checkEndpoint(baseUrl: string, check: CheckDef): Promise<CheckResult> {
    const url = `${baseUrl}${check.path}`;
    const start = Date.now();
    const result: CheckResult = {
        endpoint: check.path,
        label: check.label,
        ok: false,
        latencyMs: 0,
        warnings: [],
    };

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        let response: Response;
        try {
            response = await fetch(url, {
                signal: controller.signal,
                headers: { 'Accept-Encoding': 'identity', 'Accept': 'application/json' },
            });
        } finally {
            clearTimeout(timeout);
        }

        result.latencyMs = Date.now() - start;
        result.httpStatus = response.status;

        // Read raw bytes for gzip detection
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);

        // Detect gzip magic bytes \x1f\x8b
        if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
            result.error = 'Response is gzip-encoded (compression middleware bug)';
            const hexPreview = Array.from(bytes.slice(0, 8))
                .map((b) => b.toString(16).padStart(2, '0'))
                .join(' ');
            result.warnings.push(`Raw bytes: ${hexPreview} ...`);
            // Attempt decompression to show underlying JSON
            try {
                const ds = new DecompressionStream('gzip');
                const writer = ds.writable.getWriter();
                const reader = ds.readable.getReader();
                writer.write(bytes);
                writer.close();
                const chunks: Uint8Array[] = [];
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                }
                const total = chunks.reduce((a, c) => a + c.length, 0);
                const merged = new Uint8Array(total);
                let offset = 0;
                for (const c of chunks) {
                    merged.set(c, offset);
                    offset += c.length;
                }
                const text = new TextDecoder().decode(merged);
                result.warnings.push(`Decompressed body: ${text.slice(0, 200)}`);
            } catch {
                result.warnings.push('Could not decompress gzip body');
            }
            return result;
        }

        const rawText = new TextDecoder().decode(bytes);

        // Detect NaN/Infinity tokens — invalid JSON
        const nanMatch = rawText.match(/:\s*(NaN|-?Infinity)/);
        if (nanMatch) {
            result.warnings.push(`Response contains invalid JSON token: ${nanMatch[1]}`);
        }

        if (response.status < 200 || response.status >= 300) {
            result.error = `HTTP ${response.status}`;
            return result;
        }

        let data: unknown;
        try {
            data = JSON.parse(rawText);
        } catch (e) {
            result.error = `JSON parse error: ${(e as Error).message}`;
            result.warnings.push(`Raw body (first 200 chars): ${rawText.slice(0, 200)}`);
            return result;
        }

        result.data = data;
        const validationResult = check.validate(data) as
            | string[]
            | {
                  warnings?: string[];
                  fatal?: boolean;
                  fatalMessage?: string;
              };
        let fatal = false;
        let fatalMessage: string | undefined;
        let warnings: string[] = [];

        if (Array.isArray(validationResult)) {
            warnings = validationResult;
        } else if (validationResult && typeof validationResult === 'object') {
            if (Array.isArray(validationResult.warnings)) {
                warnings = validationResult.warnings;
            }
            if (validationResult.fatal === true) {
                fatal = true;
                fatalMessage = validationResult.fatalMessage;
            }
        }

        result.warnings.push(...warnings);
        if (fatal) {
            result.ok = false;
            result.error = fatalMessage ?? 'Domain-level health check failed';
        } else {
            result.ok = true;
        }
        result.latencyMs = Date.now() - start;
    } catch (e) {
        result.latencyMs = Date.now() - start;
        if ((e as Error).name === 'AbortError') {
            result.error = 'Timeout after 10s';
        } else {
            result.error = (e as Error).message;
        }
    }

    return result;
}

// ── Output helpers ────────────────────────────────────────────────────────────

// Patterns that identify informational (non-problem) warning messages.
// Kept as a module-level constant so `statusIcon` and `isRealWarning` stay in sync.
const INFO_WARNING_PATTERNS: RegExp[] = [/^version:/, /^last check:/, /^latency_ms:/, /^db_name:/];

function statusIcon(result: CheckResult): string {
    if (!result.ok) return red('❌');
    if (result.warnings.some((w) => INFO_WARNING_PATTERNS.some((p) => p.test(w)))) return green('✅');
    if (result.warnings.length > 0) return yellow('⚠️');
    return green('✅');
}

function printSummary(results: CheckResult[]): void {
    const passed = results.filter((r) => r.ok && r.warnings.filter(isRealWarning).length === 0).length;
    const warned = results.filter((r) => r.ok && r.warnings.filter(isRealWarning).length > 0).length;
    const failed = results.filter((r) => !r.ok).length;

    console.log('');
    console.log('─'.repeat(60));

    const col1 = 30;
    const col2 = 8;
    const col3 = 10;

    console.log(
        bold('  ENDPOINT'.padEnd(col1)) +
            bold('STATUS'.padEnd(col2)) +
            bold('LATENCY'.padEnd(col3)) +
            bold('NOTE'),
    );
    console.log('─'.repeat(60));

    for (const r of results) {
        const icon = statusIcon(r);
        const status = r.httpStatus ? String(r.httpStatus) : '—';
        const latency = `${r.latencyMs}ms`;
        const note = r.error ?? r.warnings.find(isRealWarning) ?? '';
        console.log(
            `  ${icon}  ${r.label.padEnd(col1 - 4)}${status.padEnd(col2)}${latency.padEnd(col3)}${note}`,
        );
        // Print additional info-level warnings (version, latency etc.)
        for (const w of r.warnings) {
            if (!isRealWarning(w)) {
                console.log(`       ${cyan('ℹ')}  ${w}`);
            }
        }
        if (r.error && r.warnings.length > 0) {
            for (const w of r.warnings) {
                console.log(`       ${yellow('!')}  ${w}`);
            }
        }
    }

    console.log('─'.repeat(60));
    const summaryParts: string[] = [];
    if (passed > 0) summaryParts.push(green(`${passed} passed`));
    if (warned > 0) summaryParts.push(yellow(`${warned} warning${warned > 1 ? 's' : ''}`));
    if (failed > 0) summaryParts.push(red(`${failed} failed`));
    console.log(`  SUMMARY: ${summaryParts.join(', ')}`);
    console.log(`  Exit code: ${failed > 0 ? red('1') : green('0')}`);
    console.log('');
}

function isRealWarning(w: string): boolean {
    // Info-level messages that should not count as warnings in summary
    return !INFO_WARNING_PATTERNS.some((p) => p.test(w));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const args = Deno.args;

    let baseUrl: string | undefined;
    let env = 'production';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--base-url' && args[i + 1]) {
            baseUrl = args[++i];
        } else if (args[i] === '--env' && args[i + 1]) {
            env = args[++i];
        }
    }

    if (!baseUrl) {
        baseUrl = ENV_URLS[env];
        if (!baseUrl) {
            console.error(red(`Unknown --env "${env}". Known envs: ${Object.keys(ENV_URLS).join(', ')}`));
            Deno.exit(1);
        }
    }

    console.log('');
    console.log(bold(`🔍 adblock-compiler diagnostic — ${cyan(baseUrl)}`));
    console.log('');

    const results: CheckResult[] = [];

    for (const check of CHECKS) {
        Deno.stdout.writeSync(new TextEncoder().encode(`  Checking ${check.path} ...`));
        const result = await checkEndpoint(baseUrl, check);
        results.push(result);

        const icon = statusIcon(result);
        const status = result.httpStatus ? ` ${result.httpStatus}` : '';
        const latency = `  ${result.latencyMs}ms`;
        // Clear line and print result
        console.log(`\r  ${icon}  ${result.label.padEnd(35)}${status.padEnd(6)}${latency}`);

        if (result.error) {
            console.log(`       ${red('✗')}  ${result.error}`);
        }
        for (const w of result.warnings.filter(isRealWarning)) {
            console.log(`       ${yellow('⚠')}  ${w}`);
        }
        for (const w of result.warnings.filter((w) => !isRealWarning(w))) {
            console.log(`       ${cyan('ℹ')}  ${w}`);
        }
    }

    printSummary(results);

    const anyFailed = results.some((r) => !r.ok);
    Deno.exit(anyFailed ? 1 : 0);
}

await main();
