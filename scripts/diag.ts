#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Diagnostic probe library for the adblock-compiler Worker.
 *
 * Exports individual probe functions that each return a DiagResult.
 * This module has NO TTY dependencies — it is safe to import in CI.
 *
 * @see scripts/diag-cli.ts  — interactive/CI CLI harness
 * @see docs/operations/diagnostics.md — full technical reference
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DiagResult {
    ok: boolean;
    label: string;
    detail?: string;
    latency_ms?: number;
    raw?: unknown;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Non-decompressing HTTP client for raw gzip byte detection.
 *
 * Deno's default `fetch()` auto-decompresses responses when `Content-Encoding:
 * gzip` is present — which hides the exact failure mode we need to detect.
 * This client bypasses auto-decompression so probes can inspect on-the-wire bytes.
 */
const RAW_HTTP_CLIENT: Deno.HttpClient = Deno.createHttpClient({ decompress: false });

/**
 * Safely fetch a URL with an AbortController timeout.
 * Returns `null` on any network or timeout error, populating `error`.
 *
 * @param client - Optional Deno.HttpClient. Pass RAW_HTTP_CLIENT to disable
 *                 auto-decompression and inspect raw response bytes.
 */
async function safeFetch(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    client?: Deno.HttpClient,
): Promise<{ res: Response; latency_ms: number } | { error: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const t0 = Date.now();
    try {
        const res = await fetch(url, { ...init, signal: controller.signal, client });
        return { res, latency_ms: Date.now() - t0 };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Check first two bytes of an ArrayBuffer for gzip magic: 0x1f 0x8b.
 */
function hasGzipMagicBytes(buf: ArrayBuffer): boolean {
    const view = new Uint8Array(buf);
    return view.length >= 2 && view[0] === 0x1f && view[1] === 0x8b;
}

// ─── Probes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/health
 * Checks HTTP 200, valid JSON, services.database.status not 'down'.
 * Also detects gzip corruption via ArrayBuffer byte inspection.
 */
export async function probeHealth(
    baseUrl: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<DiagResult> {
    const label = 'probeHealth';
    const url = `${baseUrl}/api/health`;
    // Use RAW_HTTP_CLIENT so fetch() does not auto-decompress the response.
    // Without this, Deno silently decompresses gzip bodies — hiding the exact
    // corruption that makes `curl | jq` fail in production.
    const result = await safeFetch(
        url,
        {
            headers: { 'Accept': 'application/json' },
        },
        timeoutMs,
        RAW_HTTP_CLIENT,
    );

    if ('error' in result) {
        return { ok: false, label, detail: `Request failed: ${result.error}` };
    }

    const { res, latency_ms } = result;

    if (!res.ok) {
        return { ok: false, label, latency_ms, detail: `HTTP ${res.status} ${res.statusText}` };
    }

    // Read as ArrayBuffer first to detect gzip corruption
    let buf: ArrayBuffer;
    try {
        buf = await res.arrayBuffer();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, label, latency_ms, detail: `Failed to read body: ${message}` };
    }

    if (hasGzipMagicBytes(buf)) {
        return {
            ok: false,
            label,
            latency_ms,
            detail: 'GZIP corruption detected — body starts with \\x1f\\x8b magic bytes. compress() middleware is encoding /api/health.',
        };
    }

    let body: unknown;
    try {
        const text = new TextDecoder().decode(buf);
        body = JSON.parse(text);
    } catch {
        return { ok: false, label, latency_ms, detail: 'Response is not valid JSON' };
    }

    if (typeof body !== 'object' || body === null) {
        return { ok: false, label, latency_ms, detail: 'Response JSON is not an object', raw: body };
    }

    const record = body as Record<string, unknown>;
    const services = record['services'] as Record<string, unknown> | undefined;
    if (services) {
        const db = services['database'] as Record<string, unknown> | undefined;
        if (db && db['status'] === 'down') {
            return {
                ok: false,
                label,
                latency_ms,
                detail: `Database status is 'down' — check Hyperdrive/Neon connectivity`,
                raw: body,
            };
        }
    }

    const status = String(record['status'] ?? 'unknown');
    const dbStatus = (services?.['database'] as Record<string, unknown> | undefined)?.['status'] ?? 'unknown';
    return {
        ok: true,
        label,
        latency_ms,
        detail: `status=${status} db=${dbStatus}`,
        raw: body,
    };
}

/**
 * GET /api/health/db-smoke
 * Checks HTTP 200, valid JSON `{ ok: true }`, db_name === 'adblock-compiler'.
 */
export async function probeDbSmoke(
    baseUrl: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<DiagResult> {
    const label = 'probeDbSmoke';
    const url = `${baseUrl}/api/health/db-smoke`;
    const result = await safeFetch(url, {
        headers: { 'Accept': 'application/json' },
    }, timeoutMs);

    if ('error' in result) {
        return { ok: false, label, detail: `Request failed: ${result.error}` };
    }

    const { res, latency_ms } = result;

    if (!res.ok) {
        return { ok: false, label, latency_ms, detail: `HTTP ${res.status} ${res.statusText}` };
    }

    let body: unknown;
    try {
        body = await res.json();
    } catch {
        return { ok: false, label, latency_ms, detail: 'Response is not valid JSON — Worker may be hanging' };
    }

    if (typeof body !== 'object' || body === null) {
        return { ok: false, label, latency_ms, detail: 'Response JSON is not an object', raw: body };
    }

    const record = body as Record<string, unknown>;

    if (record['ok'] !== true) {
        return { ok: false, label, latency_ms, detail: `ok is not true: ${JSON.stringify(record['ok'])}`, raw: body };
    }

    const dbNameValue = record['db_name'];
    if (typeof dbNameValue !== 'string') {
        return {
            ok: false,
            label,
            latency_ms,
            detail: `db_name missing or not a string: ${JSON.stringify(dbNameValue)}`,
            raw: body,
        };
    }

    if (dbNameValue !== 'adblock-compiler') {
        return {
            ok: false,
            label,
            latency_ms,
            detail: `db_name mismatch: expected 'adblock-compiler', got '${dbNameValue}'`,
            raw: body,
        };
    }

    return {
        ok: true,
        label,
        latency_ms,
        detail: `ok=true db=${dbNameValue}`,
        raw: body,
    };
}

/**
 * GET /api/metrics
 * Checks HTTP 200, valid JSON, response time < 5s.
 */
export async function probeMetrics(
    baseUrl: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<DiagResult> {
    const label = 'probeMetrics';
    const url = `${baseUrl}/api/metrics`;
    const METRICS_WARN_MS = 5_000;

    const result = await safeFetch(url, {
        headers: { 'Accept': 'application/json' },
    }, timeoutMs);

    if ('error' in result) {
        return { ok: false, label, detail: `Request failed: ${result.error}` };
    }

    const { res, latency_ms } = result;

    if (!res.ok) {
        return { ok: false, label, latency_ms, detail: `HTTP ${res.status} ${res.statusText}` };
    }

    let body: unknown;
    try {
        body = await res.json();
    } catch {
        return { ok: false, label, latency_ms, detail: 'Response is not valid JSON' };
    }

    if (latency_ms > METRICS_WARN_MS) {
        return {
            ok: false,
            label,
            latency_ms,
            detail: `Response time ${latency_ms}ms exceeds 5s threshold — possible waitUntil hang`,
            raw: body,
        };
    }

    return {
        ok: true,
        label,
        latency_ms,
        detail: `Metrics retrieved in ${latency_ms}ms`,
        raw: body,
    };
}

/**
 * GET /api/auth/providers
 * Checks HTTP 200, valid JSON, completes without Worker-hang.
 */
export async function probeAuthProviders(
    baseUrl: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<DiagResult> {
    const label = 'probeAuthProviders';
    const url = `${baseUrl}/api/auth/providers`;
    const result = await safeFetch(url, {
        headers: { 'Accept': 'application/json' },
    }, timeoutMs);

    if ('error' in result) {
        return { ok: false, label, detail: `Request failed: ${result.error}` };
    }

    const { res, latency_ms } = result;

    if (!res.ok) {
        return { ok: false, label, latency_ms, detail: `HTTP ${res.status} ${res.statusText}` };
    }

    let body: unknown;
    try {
        body = await res.json();
    } catch {
        return { ok: false, label, latency_ms, detail: 'Response is not valid JSON' };
    }

    return {
        ok: true,
        label,
        latency_ms,
        detail: `Auth providers endpoint responded`,
        raw: body,
    };
}

/**
 * POST /api/compile
 * Posts a minimal compile payload, expects 200 or 422 (not 5xx/hang).
 */
export async function probeCompileSmoke(
    baseUrl: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<DiagResult> {
    const label = 'probeCompileSmoke';
    const url = `${baseUrl}/api/compile`;

    const payload = {
        configuration: {
            name: 'diag-smoke',
            version: '1.0.0',
            sources: [{ source: 'https://example.com/diag-smoke.txt' }],
        },
        preFetchedContent: {
            'https://example.com/diag-smoke.txt': '||diag-smoke.example.com^',
        },
    };

    const result = await safeFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
    }, timeoutMs);

    if ('error' in result) {
        return { ok: false, label, detail: `Request failed: ${result.error}` };
    }

    const { res, latency_ms } = result;

    // 200 (success), 422 (validation), 401/403 (expected for anonymous requests —
    // auth is required but the Worker is up and routing correctly) are all acceptable.
    // None of these indicate a Worker hang or 5xx server error.
    if (res.status === 200 || res.status === 422 || res.status === 401 || res.status === 403) {
        return {
            ok: true,
            label,
            latency_ms,
            detail: `HTTP ${res.status} — endpoint reachable (not a 5xx/hang)`,
        };
    }

    if (res.status >= 500) {
        const text = await res.text().catch(() => '(unreadable)');
        return {
            ok: false,
            label,
            latency_ms,
            detail: `HTTP ${res.status} server error: ${text.slice(0, 200)}`,
        };
    }

    return {
        ok: false,
        label,
        latency_ms,
        detail: `Unexpected HTTP ${res.status} ${res.statusText}`,
    };
}

/**
 * GET /api/health with Accept-Encoding: identity
 * Detects if body starts with gzip magic bytes 0x1f 0x8b.
 * This is the primary check for the compress() middleware bug.
 */
export async function probeResponseEncoding(
    baseUrl: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<DiagResult> {
    const label = 'probeResponseEncoding';
    const url = `${baseUrl}/api/health`;
    // Use RAW_HTTP_CLIENT to bypass Deno's automatic decompression.
    // Without this, Deno would silently decompress gzip bodies and the magic-
    // byte check would never trigger — even though `curl | jq` fails on the
    // same response in production.
    const result = await safeFetch(
        url,
        {
            headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'identity',
            },
        },
        timeoutMs,
        RAW_HTTP_CLIENT,
    );

    if ('error' in result) {
        return { ok: false, label, detail: `Request failed: ${result.error}` };
    }

    const { res, latency_ms } = result;

    if (!res.ok) {
        return { ok: false, label, latency_ms, detail: `HTTP ${res.status} ${res.statusText}` };
    }

    // Belt-and-suspenders: check Content-Encoding header.
    // If the server ignores Accept-Encoding: identity and sends Content-Encoding: gzip,
    // that's the compression bug even before we inspect the bytes.
    const contentEncoding = res.headers.get('content-encoding') ?? 'none';
    if (['gzip', 'br', 'deflate'].some((enc) => contentEncoding.includes(enc))) {
        return {
            ok: false,
            label,
            latency_ms,
            detail: `Content-Encoding: ${contentEncoding} present with Accept-Encoding: identity — server ignored encoding preference`,
        };
    }

    let buf: ArrayBuffer;
    try {
        buf = await res.arrayBuffer();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, label, latency_ms, detail: `Failed to read body: ${message}` };
    }

    if (hasGzipMagicBytes(buf)) {
        return {
            ok: false,
            label,
            latency_ms,
            detail: 'GZIP corruption detected! Body starts with \\x1f\\x8b even with Accept-Encoding: identity. Fix: exempt /api/health from compress() middleware.',
        };
    }

    // Validate as JSON
    let body: unknown;
    try {
        const text = new TextDecoder().decode(buf);
        body = JSON.parse(text);
    } catch {
        return {
            ok: false,
            label,
            latency_ms,
            detail: 'Body is not gzip but also not valid JSON — unexpected encoding',
        };
    }

    return {
        ok: true,
        label,
        latency_ms,
        detail: `No gzip corruption — content-encoding: ${contentEncoding}, valid JSON received`,
        raw: body,
    };
}

// ─── Probe registry ──────────────────────────────────────────────────────────

export const PROBES = {
    probeHealth,
    probeDbSmoke,
    probeMetrics,
    probeAuthProviders,
    probeCompileSmoke,
    probeResponseEncoding,
} as const;

export type ProbeName = keyof typeof PROBES;

export const PROBE_NAMES = Object.keys(PROBES) as ProbeName[];
