/**
 * CI lint guard — validates route-ordering invariants in `worker/hono-app.ts`.
 *
 * Checks:
 *  1. `timing()` appears before all other `app.use()` calls.
 *  2. `app.on(['POST', 'GET'], '/api/auth/*', ...)` appears before
 *     `app.route('/', agentRouter)` (Better Auth before agent routing).
 *  3. `app.route('/api', routes)` is NOT preceded by `app.route('/', routes)`
 *     (double-mount guard — bare `/` mount was removed in Phase 4).
 *  4. The compress middleware in the `routes` sub-app uses the `NO_COMPRESS_PATHS`
 *     exclusion pattern (not a bare `compress()` wildcard).
 *
 * Usage:
 *   deno run --allow-read scripts/lint-route-order.ts
 *
 * Exit codes:
 *   0 — all checks pass
 *   1 — one or more checks failed (descriptive messages printed to stderr)
 */

import { join } from 'jsr:@std/path@^1.1.4';

const HONO_APP_PATH = join(import.meta.dirname ?? '.', '..', 'worker', 'hono-app.ts');

// Read the file
let src: string;
try {
    src = await Deno.readTextFile(HONO_APP_PATH);
} catch (e) {
    console.error(`[lint-route-order] ERROR: Cannot read ${HONO_APP_PATH}:`, e);
    Deno.exit(1);
}

// Strip single-line and multi-line comments so we don't accidentally match
// commented-out code.  This is intentionally lightweight — it does not handle
// every edge case, but is sufficient for the ordered-invariant checks below.
const srcNoComments = src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/.*/g, ''); // line comments

let passed = true;

// ── Check 1: timing() is the FIRST app.use() call ────────────────────────────
// We look for the position of the first `app.use(` call and the position of
// `timing()` inside it.

const firstAppUseIdx = srcNoComments.indexOf('app.use(');
const timingCallIdx = srcNoComments.indexOf('timing()');

if (timingCallIdx === -1) {
    console.error('[lint-route-order] FAIL #1: `timing()` call not found in hono-app.ts');
    passed = false;
} else if (firstAppUseIdx === -1) {
    console.error('[lint-route-order] FAIL #1: No `app.use(` calls found in hono-app.ts');
    passed = false;
} else {
    // The timing() middleware is registered as `app.use('*', timing())`.
    // The firstAppUseIdx should be <= timingCallIdx (timing is first or included in the first call).
    const timingAppUsePattern = /app\.use\s*\([^)]*timing\s*\(\)/;
    const timingAppUseMatch = timingAppUsePattern.exec(srcNoComments);
    if (!timingAppUseMatch) {
        console.error('[lint-route-order] FAIL #1: `app.use(... timing() ...)` pattern not found');
        passed = false;
    } else {
        const timingAppUseIdx = timingAppUseMatch.index;
        if (timingAppUseIdx > firstAppUseIdx) {
            console.error(
                `[lint-route-order] FAIL #1: timing() is not the first app.use() call.\n` +
                    `  First app.use() at char ${firstAppUseIdx}, timing() app.use() at char ${timingAppUseIdx}`,
            );
            passed = false;
        } else {
            console.log('[lint-route-order] PASS #1: timing() is first app.use()');
        }
    }
}

// ── Check 2: Better Auth handler before agent router ─────────────────────────
// `app.on(['POST', 'GET'], '/api/auth/*', ...)` must appear before
// `app.route('/', agentRouter)`.

const betterAuthIdx = srcNoComments.indexOf("app.on(['POST', 'GET'], '/api/auth/*'");
const agentRouterIdx = srcNoComments.indexOf("app.route('/', agentRouter)");

if (betterAuthIdx === -1) {
    console.error("[lint-route-order] FAIL #2: `app.on(['POST', 'GET'], '/api/auth/*')` not found");
    passed = false;
} else if (agentRouterIdx === -1) {
    console.error("[lint-route-order] FAIL #2: `app.route('/', agentRouter)` not found");
    passed = false;
} else if (betterAuthIdx > agentRouterIdx) {
    console.error(
        `[lint-route-order] FAIL #2: Better Auth /api/auth/* handler appears AFTER agentRouter mount.\n` +
            `  Better Auth at char ${betterAuthIdx}, agentRouter at char ${agentRouterIdx}`,
    );
    passed = false;
} else {
    console.log('[lint-route-order] PASS #2: Better Auth registered before agentRouter');
}

// ── Check 3: No bare-path double-mount guard ──────────────────────────────────
// `app.route('/', routes)` must NOT appear anywhere in the file (the bare-path
// double-mount was intentionally removed in Phase 4).

// We specifically look for `app.route('/', routes)` (where `routes` is the local
// business-routes sub-app, not `agentRouter`).  Be precise to avoid false positives.
const doubleMount = /app\.route\s*\(\s*'\/'\s*,\s*routes\s*\)/.exec(srcNoComments);
if (doubleMount) {
    console.error(
        `[lint-route-order] FAIL #3: Bare-path double-mount detected: app.route('/', routes)\n` +
            `  This was removed in Phase 4. Only app.route('/api', routes) is allowed.\n` +
            `  Found at char ${doubleMount.index}`,
    );
    passed = false;
} else {
    console.log("[lint-route-order] PASS #3: No bare-path double-mount (app.route('/', routes) not present)");
}

// ── Check 4: Compress middleware uses NO_COMPRESS_PATHS exclusion ─────────────
// The `routes` sub-app compress middleware must reference `NO_COMPRESS_PATHS`
// (not a bare `routes.use('*', compress())` call).

const bareCompressPattern = /routes\.use\s*\(\s*'\*'\s*,\s*compress\s*\(\s*\)\s*\)/;
if (bareCompressPattern.test(srcNoComments)) {
    console.error(
        "[lint-route-order] FAIL #4: Bare compress() wildcard detected: routes.use('*', compress()).\n" +
            '  Use the NO_COMPRESS_PATHS exclusion pattern instead to skip compression on health/metrics endpoints.',
    );
    passed = false;
} else if (!srcNoComments.includes('NO_COMPRESS_PATHS')) {
    console.error(
        '[lint-route-order] FAIL #4: NO_COMPRESS_PATHS constant not found in hono-app.ts.\n' +
            '  The compress middleware must use this exclusion set to skip /health and /metrics routes.',
    );
    passed = false;
} else {
    console.log('[lint-route-order] PASS #4: Compress middleware uses NO_COMPRESS_PATHS exclusion');
}

// ── Summary ───────────────────────────────────────────────────────────────────

if (passed) {
    console.log('\n✅ All route-order checks passed.');
    Deno.exit(0);
} else {
    console.error('\n❌ One or more route-order checks failed. See errors above.');
    Deno.exit(1);
}
