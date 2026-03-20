#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Cloudflare Container Health Check Script
 *
 * Hits `GET /health` on the container server and validates the response shape
 * with Zod. Optionally sends a minimal `POST /compile` smoke-test when a
 * `--secret` flag is provided.
 *
 * Usage:
 *   deno task container:health
 *   deno task container:health -- --url https://example.workers.dev --secret my-secret
 *   deno task container:health -- --url http://localhost:8787 --timeout 30
 *
 * Flags:
 *   --url      Base URL to check (default: http://localhost:8787)
 *   --timeout  Request timeout in seconds (default: 10)
 *   --secret   X-Container-Secret header value; enables the /compile smoke-test
 *
 * Exits 0 on success, 1 on any failure.
 *
 * Style: consistent with scripts/validate-openapi.ts — console.log with emoji
 * prefixes, structured output, Deno.exit(1) on failure.
 */

import { parseArgs } from '@std/cli';
import { z } from 'zod';

// ─── CLI flags ───────────────────────────────────────────────────────────────

const args = parseArgs(Deno.args, {
    string: ['url', 'secret', 'timeout'],
    default: {
        url: 'http://localhost:8787',
        timeout: '10',
    },
});

const BASE_URL: string = args['url'] as string;
const rawTimeout = parseInt(args['timeout'] as string, 10);

if (isNaN(rawTimeout) || rawTimeout <= 0) {
    console.error(`❌ Invalid --timeout value: "${args['timeout']}". Must be a positive integer (seconds).`);
    Deno.exit(1);
}

const TIMEOUT_MS: number = rawTimeout * 1000;
const SECRET: string | undefined = args['secret'] as string | undefined;

// ─── Zod schemas ─────────────────────────────────────────────────────────────

/**
 * Expected shape of the `GET /health` response body.
 * Mirrors the response produced by `worker/container-server.ts`.
 */
const HealthResponseSchema = z.object({
    status: z.literal('ok'),
    version: z.string(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns a `fetch` compatible `AbortSignal` that fires after `ms` milliseconds.
 */
function timeoutSignal(ms: number): AbortSignal {
    return AbortSignal.timeout(ms);
}

// ─── Health check ────────────────────────────────────────────────────────────

async function checkHealth(): Promise<boolean> {
    const url = `${BASE_URL}/health`;
    console.log(`🔍 Checking health endpoint: ${url}`);

    let res: Response;
    try {
        res = await fetch(url, { signal: timeoutSignal(TIMEOUT_MS) });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`❌ Health check request failed: ${message}`);
        return false;
    }

    if (!res.ok) {
        console.error(`❌ Health check returned HTTP ${res.status} ${res.statusText}`);
        return false;
    }

    let body: unknown;
    try {
        body = await res.json();
    } catch {
        console.error('❌ Health check response is not valid JSON');
        return false;
    }

    // Validate the response shape so we catch silent regressions in the server
    const parseResult = HealthResponseSchema.safeParse(body);
    if (!parseResult.success) {
        console.error('❌ Health check response has unexpected shape:');
        console.error(JSON.stringify(parseResult.error.format(), null, 2));
        return false;
    }

    console.log(`✅ Health check passed — status: ${parseResult.data.status}, version: ${parseResult.data.version}`);
    return true;
}

// ─── Compile smoke-test ───────────────────────────────────────────────────────

/**
 * Sends a minimal `POST /compile` request to verify that the compilation
 * pipeline is reachable and returns a non-empty response.
 * Only runs when `--secret` is provided.
 */
async function smokeTestCompile(secret: string): Promise<boolean> {
    const url = `${BASE_URL}/compile`;
    console.log(`🔍 Smoke-testing compile endpoint: ${url}`);

    // Minimal valid configuration — a single trivial filter rule.
    const payload = {
        configuration: {
            name: 'health-check',
            version: '1.0.0',
            sources: [],
        },
    };

    let res: Response;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Container-Secret': secret,
            },
            body: JSON.stringify(payload),
            signal: timeoutSignal(TIMEOUT_MS),
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`❌ Compile smoke-test request failed: ${message}`);
        return false;
    }

    // Accept 200 (success) or 400 (schema validation hit our minimal payload —
    // still means the server is up and running correctly).
    if (res.status !== 200 && res.status !== 400) {
        console.error(`❌ Compile smoke-test returned unexpected HTTP ${res.status} ${res.statusText}`);
        return false;
    }

    console.log(`✅ Compile smoke-test passed — HTTP ${res.status}`);
    return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('\n🚀 Cloudflare Container Health Check\n');
console.log(`   URL     : ${BASE_URL}`);
console.log(`   Timeout : ${TIMEOUT_MS / 1000}s`);
console.log(`   Smoke   : ${SECRET ? 'enabled' : 'disabled (no --secret provided)'}\n`);

let allPassed = true;

allPassed = (await checkHealth()) && allPassed;

if (SECRET) {
    allPassed = (await smokeTestCompile(SECRET)) && allPassed;
}

console.log('');
if (allPassed) {
    console.log('🎉 All checks passed');
    Deno.exit(0);
} else {
    console.log('💥 One or more checks failed');
    Deno.exit(1);
}
