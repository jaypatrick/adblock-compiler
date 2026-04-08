#!/usr/bin/env -S deno run --allow-net --allow-env --allow-write

/**
 * Full diagnostic suite for adblock-compiler Worker.
 * Runs 12 probe categories and emits a structured JSON bundle.
 *
 * Usage:
 *   deno task diag:full
 *   deno task diag:full:ci
 *   deno run --allow-net --allow-env --allow-write scripts/diag-full.ts --help
 *
 * Flags:
 *   --url       Base URL (default: https://adblock-frontend.jayson-knight.workers.dev)
 *   --timeout   Per-probe timeout in ms (default: 15000)
 *   --ci        Non-interactive CI mode: run all probes, exit 0/1
 *   --output    Write JSON bundle to diag-report-<timestamp>.json
 *   --help      Print usage
 *
 * @see scripts/diag.ts        — core probe library
 * @see scripts/diag-cli.ts    — interactive CLI
 * @see scripts/diag-report.ts — report formatter
 */

import { parseArgs } from '@std/cli/parse-args';
import { z } from 'zod';
import { PROBES } from './diag.ts';

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const DiagProbeResultSchema = z.object({
    category: z.string(),
    label: z.string(),
    ok: z.boolean(),
    latency_ms: z.number().optional(),
    detail: z.string().optional(),
    raw: z.unknown().optional(),
});

const DiagBundleMetaSchema = z.object({
    tool: z.literal('adblock-compiler-diag-full'),
    version: z.string(),
    timestamp: z.string(),
    baseUrl: z.string(),
    timeoutMs: z.number(),
    deno: z.object({
        deno: z.string(),
        v8: z.string(),
        typescript: z.string(),
    }),
    os: z.object({
        os: z.string(),
        arch: z.string(),
    }),
    cwd: z.string(),
});

export const DiagBundleSchema = z.object({
    meta: DiagBundleMetaSchema,
    summary: z.object({
        total: z.number(),
        passed: z.number(),
        failed: z.number(),
        durationMs: z.number(),
    }),
    probes: z.array(DiagProbeResultSchema),
});

export type DiagBundle = z.infer<typeof DiagBundleSchema>;
export type DiagBundleMeta = z.infer<typeof DiagBundleMetaSchema>;
export type DiagProbeResult = z.infer<typeof DiagProbeResultSchema>;

// ─── Constants ────────────────────────────────────────────────────────────────

/** Project version — kept in sync with deno.json via scripts/sync-version.ts */
// TODO(diag): Read version dynamically once --allow-read is added to diag tasks
const VERSION = '0.82.0';
const DEFAULT_BASE_URL = 'https://adblock-frontend.jayson-knight.workers.dev';
const DEFAULT_TIMEOUT_MS = 15_000;

// ─── Table rendering helpers ──────────────────────────────────────────────────

function pad(s: string, n: number): string {
    if (s.length >= n) {
        return s.slice(0, n - 1) + '…';
    }
    return s + ' '.repeat(n - s.length);
}

// ─── Internal safeFetch ───────────────────────────────────────────────────────

async function safeFetch(
    url: string,
    init: RequestInit,
    timeoutMs: number,
): Promise<{ res: Response; latency_ms: number } | { error: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const t0 = Date.now();
    try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        return { res, latency_ms: Date.now() - t0 };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
    } finally {
        clearTimeout(timer);
    }
}

// ─── Probe: environment ───────────────────────────────────────────────────────

function probeEnvironment(): DiagProbeResult {
    return {
        category: 'environment',
        label: 'environment',
        ok: true,
        detail: `deno=${Deno.version.deno} os=${Deno.build.os} arch=${Deno.build.arch}`,
        raw: {
            deno: Deno.version,
            os: Deno.build.os,
            arch: Deno.build.arch,
            cwd: Deno.cwd(),
            timestamp: new Date().toISOString(),
            args: Deno.args,
        },
    };
}

// ─── Probe: dns ───────────────────────────────────────────────────────────────

async function probeDns(baseUrl: string, timeoutMs: number): Promise<DiagProbeResult> {
    const url = `${baseUrl}/api/health`;
    const result = await safeFetch(url, { method: 'HEAD' }, Math.min(3_000, timeoutMs));
    if ('error' in result) {
        const msg = result.error.toLowerCase();
        const isTimeout = msg.includes('abort') || msg.includes('timeout');
        return {
            category: 'dns',
            label: 'dns-resolution',
            ok: false,
            detail: isTimeout ? 'timeout (3s)' : `error: ${result.error}`,
        };
    }
    const { res, latency_ms } = result;
    await res.body?.cancel().catch(() => {});
    return {
        category: 'dns',
        label: 'dns-resolution',
        ok: true,
        latency_ms,
        detail: `resolved (HTTP ${res.status})`,
    };
}

// ─── Probe: tls ───────────────────────────────────────────────────────────────

async function probeTls(baseUrl: string, timeoutMs: number): Promise<DiagProbeResult> {
    const url = `${baseUrl}/api/health`;
    const result = await safeFetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } }, timeoutMs);
    if ('error' in result) {
        return {
            category: 'tls',
            label: 'tls-certificate',
            ok: false,
            detail: `error: ${result.error}`,
        };
    }
    const { res, latency_ms } = result;
    await res.body?.cancel().catch(() => {});
    const cfRay = res.headers.get('cf-ray');
    const hsts = res.headers.get('strict-transport-security');
    return {
        category: 'tls',
        label: 'tls-certificate',
        ok: cfRay !== null && hsts !== null,
        latency_ms,
        detail: `cf-ray=${cfRay ?? 'absent'} hsts=${hsts !== null ? 'present' : 'absent'}`,
        raw: { 'cf-ray': cfRay, 'strict-transport-security': hsts },
    };
}

// ─── Probe: existing ──────────────────────────────────────────────────────────

async function runExistingProbes(baseUrl: string, timeoutMs: number): Promise<DiagProbeResult[]> {
    const results: DiagProbeResult[] = [];
    for (const [name, probe] of Object.entries(PROBES)) {
        const result = await probe(baseUrl, timeoutMs);
        results.push({
            category: 'existing',
            label: name,
            ok: result.ok,
            latency_ms: result.latency_ms,
            detail: result.detail,
            raw: result.raw,
        });
    }
    return results;
}

// ─── Probe: cors ──────────────────────────────────────────────────────────────

async function probeCors(baseUrl: string, timeoutMs: number): Promise<DiagProbeResult> {
    const url = `${baseUrl}/api/compile`;
    const result = await safeFetch(
        url,
        {
            method: 'OPTIONS',
            headers: {
                'Origin': 'https://example.com',
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'Content-Type, Authorization',
            },
        },
        timeoutMs,
    );
    if ('error' in result) {
        return {
            category: 'cors',
            label: 'cors-preflight',
            ok: false,
            detail: `error: ${result.error}`,
        };
    }
    const { res, latency_ms } = result;
    await res.body?.cancel().catch(() => {});
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const allowMethods = res.headers.get('access-control-allow-methods');
    const allowHeaders = res.headers.get('access-control-allow-headers');
    const statusOk = res.status === 204 || res.status === 200;
    const originOk = allowOrigin !== null && allowOrigin !== '*';
    return {
        category: 'cors',
        label: 'cors-preflight',
        ok: statusOk && originOk,
        latency_ms,
        detail: `status=${res.status} acao=${allowOrigin ?? 'absent'} acam=${allowMethods ?? 'absent'}`,
        raw: {
            status: res.status,
            'access-control-allow-origin': allowOrigin,
            'access-control-allow-methods': allowMethods,
            'access-control-allow-headers': allowHeaders,
        },
    };
}

// ─── Probe: rate-limit ────────────────────────────────────────────────────────

async function probeRateLimit(baseUrl: string, timeoutMs: number): Promise<DiagProbeResult> {
    const url = `${baseUrl}/api/health`;
    const RAPID_COUNT = 12;
    const latencies: number[] = [];
    let tooManyCount = 0;
    let firstTooManyAt: number | undefined;

    for (let i = 1; i <= RAPID_COUNT; i++) {
        const result = await safeFetch(url, {}, Math.min(5_000, timeoutMs));
        if ('error' in result) {
            continue;
        }
        const { res, latency_ms } = result;
        latencies.push(latency_ms);
        if (res.status === 429) {
            tooManyCount++;
            if (firstTooManyAt === undefined) {
                firstTooManyAt = i;
            }
        }
        await res.arrayBuffer().catch(() => {});
    }

    const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0;
    const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;
    const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

    return {
        category: 'rate-limit',
        label: 'rate-limit',
        ok: tooManyCount === 0,
        detail: tooManyCount > 0
            ? `${tooManyCount}/${RAPID_COUNT} returned 429, first at request #${firstTooManyAt ?? '?'}`
            : `no 429s in ${RAPID_COUNT} requests (avg=${avgLatency}ms min=${minLatency}ms max=${maxLatency}ms)`,
        raw: { total: RAPID_COUNT, tooMany: tooManyCount, firstTooManyAt, minLatency, maxLatency, avgLatency },
    };
}

// ─── Probe: auth-gate ─────────────────────────────────────────────────────────

async function probeAuthGate(baseUrl: string, timeoutMs: number): Promise<DiagProbeResult[]> {
    const checks = [
        { method: 'POST', path: '/api/compile', label: 'auth-gate-compile' },
        { method: 'POST', path: '/api/validate', label: 'auth-gate-validate' },
        { method: 'GET', path: '/api/admin/users', label: 'auth-gate-admin' },
    ];

    const results: DiagProbeResult[] = [];
    for (const check of checks) {
        const url = `${baseUrl}${check.path}`;
        const result = await safeFetch(
            url,
            {
                method: check.method,
                headers: { 'Content-Type': 'application/json' },
                body: check.method === 'POST' ? '{}' : undefined,
            },
            timeoutMs,
        );

        if ('error' in result) {
            results.push({
                category: 'auth-gate',
                label: check.label,
                ok: false,
                detail: `error: ${result.error}`,
            });
            continue;
        }

        const { res, latency_ms } = result;
        await res.body?.cancel().catch(() => {});
        const isAuthGated = res.status === 401 || res.status === 403;
        const isServerError = res.status >= 500;
        const isUnprotected = res.status === 200;

        let statusSuffix = '';
        if (isAuthGated) {
            statusSuffix = ' (auth-gated ✓)';
        } else if (isUnprotected) {
            statusSuffix = ' ⚠ UNPROTECTED';
        } else if (isServerError) {
            statusSuffix = ' (server error)';
        }

        results.push({
            category: 'auth-gate',
            label: check.label,
            ok: isAuthGated,
            latency_ms,
            detail: `HTTP ${res.status}${statusSuffix}`,
        });
    }
    return results;
}

// ─── Probe: static-assets ─────────────────────────────────────────────────────

async function probeStaticAssets(baseUrl: string, timeoutMs: number): Promise<DiagProbeResult[]> {
    const results: DiagProbeResult[] = [];

    // Root page — expect 200 text/html
    const rootResult = await safeFetch(`${baseUrl}/`, {}, timeoutMs);
    if ('error' in rootResult) {
        results.push({
            category: 'static-assets',
            label: 'static-root',
            ok: false,
            detail: `error: ${rootResult.error}`,
        });
    } else {
        const { res, latency_ms } = rootResult;
        const contentType = res.headers.get('content-type') ?? '';
        const isHtml = contentType.includes('text/html');
        await res.body?.cancel().catch(() => {});
        results.push({
            category: 'static-assets',
            label: 'static-root',
            ok: res.status === 200 && isHtml,
            latency_ms,
            detail: `HTTP ${res.status} content-type=${contentType}`,
        });
    }

    // main.js — record 200 vs 404 (informational; both are valid)
    const mainJsResult = await safeFetch(`${baseUrl}/main.js`, {}, timeoutMs);
    if ('error' in mainJsResult) {
        results.push({
            category: 'static-assets',
            label: 'static-main-js',
            ok: false,
            detail: `error: ${mainJsResult.error}`,
        });
    } else {
        const { res, latency_ms } = mainJsResult;
        await res.body?.cancel().catch(() => {});
        results.push({
            category: 'static-assets',
            label: 'static-main-js',
            ok: res.status === 200 || res.status === 404,
            latency_ms,
            detail: `HTTP ${res.status}${res.status === 200 ? ' (present)' : ' (not found)'}`,
        });
    }

    return results;
}

// ─── Probe: websocket ─────────────────────────────────────────────────────────

async function probeWebSocket(baseUrl: string, timeoutMs: number): Promise<DiagProbeResult> {
    // Replace http→ws and https→wss by swapping the `http` prefix with `ws`
    const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws/compile';
    const WS_TIMEOUT_MS = Math.min(5_000, timeoutMs);

    let ws: WebSocket;
    try {
        ws = new WebSocket(wsUrl);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            category: 'websocket',
            label: 'websocket-smoke',
            ok: false,
            detail: `failed to create WebSocket: ${message}`,
        };
    }

    return new Promise<DiagProbeResult>((resolve) => {
        let settled = false;

        const done = (result: DiagProbeResult, t?: ReturnType<typeof setTimeout>): void => {
            if (settled) {
                return;
            }
            settled = true;
            if (t !== undefined) {
                clearTimeout(t);
            }
            resolve(result);
        };

        const timer = setTimeout(() => {
            try {
                ws.close();
            } catch {
                // ignore — socket may already be closed
            }
            done({
                category: 'websocket',
                label: 'websocket-smoke',
                ok: false,
                detail: 'timeout — no upgrade response within 5s',
            });
        }, WS_TIMEOUT_MS);

        ws.addEventListener('open', () => {
            ws.close(1000, 'diag-smoke');
            done(
                {
                    category: 'websocket',
                    label: 'websocket-smoke',
                    ok: true,
                    detail: 'upgrade succeeded (101), closed cleanly',
                },
                timer,
            );
        });

        ws.addEventListener('error', () => {
            done(
                {
                    category: 'websocket',
                    label: 'websocket-smoke',
                    ok: false,
                    detail: 'connection refused or WebSocket error',
                },
                timer,
            );
        });
    });
}

// ─── Probe: queue ─────────────────────────────────────────────────────────────

async function probeQueue(baseUrl: string, timeoutMs: number): Promise<DiagProbeResult> {
    const url = `${baseUrl}/api/queue/status`;
    const result = await safeFetch(url, { headers: { 'Accept': 'application/json' } }, timeoutMs);
    if ('error' in result) {
        return {
            category: 'queue',
            label: 'queue-status',
            ok: false,
            detail: `error: ${result.error}`,
        };
    }
    const { res, latency_ms } = result;
    await res.body?.cancel().catch(() => {});
    // 401/403 confirms the route is registered; 200 means it responded
    const routeRegistered = res.status === 401 || res.status === 403 || res.status === 200;
    return {
        category: 'queue',
        label: 'queue-status',
        ok: routeRegistered,
        latency_ms,
        detail: `HTTP ${res.status}${res.status === 401 || res.status === 403 ? ' (route registered ✓)' : ''}`,
    };
}

// ─── Probe: openapi ───────────────────────────────────────────────────────────

async function probeOpenApi(baseUrl: string, timeoutMs: number): Promise<DiagProbeResult> {
    const url = `${baseUrl}/api/openapi.json`;
    const result = await safeFetch(url, { headers: { 'Accept': 'application/json' } }, timeoutMs);
    if ('error' in result) {
        return {
            category: 'openapi',
            label: 'openapi-spec',
            ok: false,
            detail: `error: ${result.error}`,
        };
    }
    const { res, latency_ms } = result;
    if (res.status !== 200) {
        await res.body?.cancel().catch(() => {});
        return {
            category: 'openapi',
            label: 'openapi-spec',
            ok: false,
            latency_ms,
            detail: `HTTP ${res.status}`,
        };
    }
    let body: unknown;
    try {
        body = await res.json();
    } catch {
        return {
            category: 'openapi',
            label: 'openapi-spec',
            ok: false,
            latency_ms,
            detail: 'response is not valid JSON',
        };
    }
    const spec = body as Record<string, unknown>;
    const version = String(spec['openapi'] ?? spec['swagger'] ?? 'unknown');
    const pathCount = Object.keys((spec['paths'] as Record<string, unknown> | undefined) ?? {}).length;
    const schemaCount = Object.keys(
        ((spec['components'] as Record<string, unknown> | undefined)?.['schemas'] as Record<string, unknown> | undefined) ?? {},
    ).length;
    return {
        category: 'openapi',
        label: 'openapi-spec',
        ok: true,
        latency_ms,
        detail: `openapi=${version} paths=${pathCount} schemas=${schemaCount}`,
        raw: { version, pathCount, schemaCount },
    };
}

// ─── Probe: config-endpoints ──────────────────────────────────────────────────

async function probeConfigEndpoints(baseUrl: string, timeoutMs: number): Promise<DiagProbeResult[]> {
    const checks = [
        { path: '/api/sentry-config', label: 'config-sentry', key: 'dsn' },
        { path: '/api/clerk-config', label: 'config-clerk', key: 'publishableKey' },
    ];

    const results: DiagProbeResult[] = [];
    for (const check of checks) {
        const url = `${baseUrl}${check.path}`;
        const result = await safeFetch(url, { headers: { 'Accept': 'application/json' } }, timeoutMs);

        if ('error' in result) {
            results.push({
                category: 'config-endpoints',
                label: check.label,
                ok: false,
                detail: `error: ${result.error}`,
            });
            continue;
        }

        const { res, latency_ms } = result;
        let body: unknown;
        let hasKey = false;

        if (res.status === 200) {
            try {
                body = await res.json();
                hasKey = typeof body === 'object' && body !== null && check.key in (body as Record<string, unknown>);
            } catch {
                body = undefined;
            }
        } else {
            await res.body?.cancel().catch(() => {});
        }

        results.push({
            category: 'config-endpoints',
            label: check.label,
            ok: res.status === 200,
            latency_ms,
            detail: `HTTP ${res.status}${res.status === 200 ? ` ${check.key}=${hasKey ? 'present' : 'absent'}` : ''}`,
            raw: body,
        });
    }
    return results;
}

// ─── Exported: buildMeta ──────────────────────────────────────────────────────

export function buildMeta(baseUrl: string, timeoutMs: number): DiagBundleMeta {
    return {
        tool: 'adblock-compiler-diag-full',
        version: VERSION,
        timestamp: new Date().toISOString(),
        baseUrl,
        timeoutMs,
        deno: Deno.version,
        os: { os: Deno.build.os, arch: Deno.build.arch },
        cwd: Deno.cwd(),
    };
}

// ─── Exported: buildBundle ────────────────────────────────────────────────────

export async function buildBundle(baseUrl: string, timeoutMs: number): Promise<DiagBundle> {
    const t0 = Date.now();
    const meta = buildMeta(baseUrl, timeoutMs);
    const probes: DiagProbeResult[] = [];

    // 1. environment
    probes.push(probeEnvironment());

    // 2. dns
    probes.push(await probeDns(baseUrl, timeoutMs));

    // 3. tls
    probes.push(await probeTls(baseUrl, timeoutMs));

    // 4. existing-probes
    for (const r of await runExistingProbes(baseUrl, timeoutMs)) {
        probes.push(r);
    }

    // 5. cors
    probes.push(await probeCors(baseUrl, timeoutMs));

    // 6. rate-limit
    probes.push(await probeRateLimit(baseUrl, timeoutMs));

    // 7. auth-gate
    for (const r of await probeAuthGate(baseUrl, timeoutMs)) {
        probes.push(r);
    }

    // 8. static-assets
    for (const r of await probeStaticAssets(baseUrl, timeoutMs)) {
        probes.push(r);
    }

    // 9. websocket
    probes.push(await probeWebSocket(baseUrl, timeoutMs));

    // 10. queue
    probes.push(await probeQueue(baseUrl, timeoutMs));

    // 11. openapi
    probes.push(await probeOpenApi(baseUrl, timeoutMs));

    // 12. config-endpoints
    for (const r of await probeConfigEndpoints(baseUrl, timeoutMs)) {
        probes.push(r);
    }

    const durationMs = Date.now() - t0;
    const passed = probes.filter((p) => p.ok).length;
    const failed = probes.filter((p) => !p.ok).length;

    return {
        meta,
        summary: { total: probes.length, passed, failed, durationMs },
        probes,
    };
}

// ─── CLI helpers ──────────────────────────────────────────────────────────────

function printHelp(): void {
    console.log(`adblock-compiler full diagnostic suite

Usage:
  deno run --allow-net --allow-env --allow-write scripts/diag-full.ts [flags]

Flags:
  --url       Base URL (default: ${DEFAULT_BASE_URL})
  --timeout   Per-probe timeout in ms (default: ${DEFAULT_TIMEOUT_MS})
  --ci        Non-interactive CI mode: run all probes, exit 0/1
  --output    Write JSON bundle to diag-report-<timestamp>.json
  --help      Print usage`);
}

function printBundleTable(bundle: DiagBundle): void {
    const COL_CAT = 18;
    const COL_LABEL = 26;
    const COL_STATUS = 6;
    const COL_LATENCY = 10;
    const COL_DETAIL = 36;
    const sep = (w: number): string => '─'.repeat(w);

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
    console.log(`\n   Total: ${total}  Passed: ${passed}  Failed: ${failed}  Duration: ${durationMs}ms`);
}

async function saveBundle(bundle: DiagBundle): Promise<void> {
    const ts = bundle.meta.timestamp.replace(/:/g, '-');
    const filename = `diag-report-${ts}.json`;
    await Deno.writeTextFile(filename, JSON.stringify(bundle, null, 2));
    console.log(`\n📄 Diagnostic report saved: ${filename}`);
    console.log(`   Paste this file's contents into a Copilot chat for automated analysis.`);
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (import.meta.main) {
    const args = parseArgs(Deno.args, {
        string: ['url', 'timeout'],
        boolean: ['ci', 'help', 'output'],
        default: {
            url: DEFAULT_BASE_URL,
            timeout: String(DEFAULT_TIMEOUT_MS),
            ci: false,
            help: false,
            output: false,
        },
    });

    if (args['help']) {
        printHelp();
        Deno.exit(0);
    }

    const baseUrl = args['url'] as string;
    const ciMode = args['ci'] as boolean;
    const outputFlag = args['output'] as boolean;
    const rawTimeout = parseInt(args['timeout'] as string, 10);
    const timeoutMs = isNaN(rawTimeout) || rawTimeout <= 0 ? DEFAULT_TIMEOUT_MS : rawTimeout;

    console.log('\n🔍 adblock-compiler full diagnostic suite');
    console.log(`   URL     : ${baseUrl}`);
    console.log(`   Timeout : ${timeoutMs}ms\n`);

    const bundle = await buildBundle(baseUrl, timeoutMs);

    printBundleTable(bundle);

    if (outputFlag) {
        await saveBundle(bundle);
    }

    if (ciMode) {
        if (bundle.summary.failed > 0) {
            console.log(`\n❌ ${bundle.summary.failed} probe(s) failed`);
            Deno.exit(1);
        }
        console.log(`\n✅ All ${bundle.summary.total} probe(s) passed (${bundle.summary.durationMs}ms)`);
        Deno.exit(0);
    }
}
