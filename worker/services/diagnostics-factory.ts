/**
 * Diagnostics provider factory for Cloudflare Workers.
 *
 * Reads the Worker `Env` at request time and returns a fully-configured
 * `IDiagnosticsProvider` (or composite of providers) with zero boilerplate at
 * call sites.
 *
 * ## Built-in provider selection logic
 *
 * | Env variable set                                        | Provider(s) activated                          |
 * |---------------------------------------------------------|------------------------------------------------|
 * | Neither `SENTRY_DSN` nor `OTEL_EXPORTER_OTLP_ENDPOINT` | `ConsoleDiagnosticsProvider`                   |
 * | `SENTRY_DSN` only                                       | `SentryDiagnosticsProvider`                    |
 * | `OTEL_EXPORTER_OTLP_ENDPOINT` only                      | `OpenTelemetryDiagnosticsProvider`             |
 * | Both                                                    | `CompositeDiagnosticsProvider([Sentry, OTel])` |
 *
 * ## Basic usage
 *
 * ```typescript
 * import { createDiagnosticsProvider } from './services/diagnostics-factory.ts';
 *
 * export default {
 *     async fetch(request, env, ctx) {
 *         const diagnostics = createDiagnosticsProvider(env);
 *         const span = diagnostics.startSpan('compile');
 *         try {
 *             // ... business logic ...
 *             span.end();
 *         } catch (err) {
 *             span.recordException(err as Error);
 *             diagnostics.captureError(err as Error, { url: request.url });
 *             throw err;
 *         } finally {
 *             ctx.waitUntil(diagnostics.flush());
 *         }
 *     },
 * };
 * ```
 *
 * ## Adding a custom provider at module load time
 *
 * Use `registerDiagnosticsProvider()` to extend the registry before the first
 * request arrives.  The builder function receives the full `Env` and should
 * return `null` when the required env vars are absent.
 *
 * ```typescript
 * import { registerDiagnosticsProvider } from './services/diagnostics-factory.ts';
 * import { MyDatadogProvider } from './my-datadog-provider.ts';
 *
 * registerDiagnosticsProvider((env) =>
 *     env.DD_API_KEY ? new MyDatadogProvider({ apiKey: env.DD_API_KEY }) : null
 * );
 * ```
 *
 * ## Adding a one-off extra at call time
 *
 * ```typescript
 * const diagnostics = createDiagnosticsProvider(env, [new MyCustomProvider()]);
 * ```
 */

import { CompositeDiagnosticsProvider } from '../../src/diagnostics/CompositeDiagnosticsProvider.ts';
import { ConsoleDiagnosticsProvider, NoOpDiagnosticsProvider } from '../../src/diagnostics/IDiagnosticsProvider.ts';
import type { IDiagnosticsProvider } from '../../src/diagnostics/IDiagnosticsProvider.ts';
import { OpenTelemetryDiagnosticsProvider } from '../../src/diagnostics/OpenTelemetryDiagnosticsProvider.ts';
import { SentryDiagnosticsProvider } from '../../src/diagnostics/SentryDiagnosticsProvider.ts';
import type { Env } from '../types';

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

/**
 * A function that inspects the Worker `Env` and returns either a configured
 * `IDiagnosticsProvider` or `null` when its required env vars are absent.
 *
 * @example
 * ```typescript
 * const myBuilder: ProviderBuilderFn = (env) =>
 *     env.MY_KEY ? new MyProvider({ key: env.MY_KEY }) : null;
 *
 * registerDiagnosticsProvider(myBuilder);
 * ```
 */
export type ProviderBuilderFn = (env: Env) => IDiagnosticsProvider | null;

// Module-level registry of provider builder functions.
// Built-in Sentry and OTel builders are pre-registered at module init below.
const _providerBuilders: ProviderBuilderFn[] = [];

/**
 * Register a custom diagnostics provider factory that will be included in
 * every subsequent call to `createDiagnosticsProvider()`.
 *
 * Call this once at module-load time (top-level await or module side-effect)
 * so it is ready before the first request arrives.
 *
 * @param builder - A function that returns a provider or `null`.
 *   Return `null` when the required env vars are not set.
 */
export function registerDiagnosticsProvider(builder: ProviderBuilderFn): void {
    _providerBuilders.push(builder);
}

// ---------------------------------------------------------------------------
// Built-in provider builders (pre-registered)
// ---------------------------------------------------------------------------

registerDiagnosticsProvider((env) => {
    if (!env.SENTRY_DSN) return null;
    return new SentryDiagnosticsProvider({
        dsn: env.SENTRY_DSN,
        release: env.COMPILER_VERSION,
        environment: 'production',
    });
});

registerDiagnosticsProvider((env) => {
    if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) return null;
    return new OpenTelemetryDiagnosticsProvider({
        serviceName: 'adblock-compiler',
        serviceVersion: env.COMPILER_VERSION,
    });
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create the correct `IDiagnosticsProvider` for the current environment.
 *
 * Iterates the provider registry (built-in + any registered via
 * `registerDiagnosticsProvider()`) and fan-outs to all active providers via
 * `CompositeDiagnosticsProvider`.
 *
 * @param env - Cloudflare Worker `Env` bindings.
 * @param extras - Additional providers to always include (e.g., a custom
 *   logger or a test spy). They are appended **after** registry providers.
 * @returns A single `IDiagnosticsProvider` instance.
 */
export function createDiagnosticsProvider(
    env: Env,
    extras: IDiagnosticsProvider[] = [],
): IDiagnosticsProvider {
    const providers: IDiagnosticsProvider[] = [];

    for (const builder of _providerBuilders) {
        try {
            const provider = builder(env);
            if (provider !== null) {
                providers.push(provider);
            }
        } catch {
            // A misconfigured builder must never crash the worker
        }
    }

    // Any caller-supplied extras (e.g. test spies, custom sinks)
    providers.push(...extras);

    if (providers.length === 0) {
        // No backends configured — fall back to structured console output
        // so traces are still visible in wrangler tail / Workers Logs.
        return new ConsoleDiagnosticsProvider();
    }

    if (providers.length === 1) {
        return providers[0];
    }

    return new CompositeDiagnosticsProvider(providers);
}

/**
 * Create a no-op provider.  Convenience wrapper for test environments that
 * need an `IDiagnosticsProvider` but want absolutely no output.
 */
export function createNoOpDiagnosticsProvider(): IDiagnosticsProvider {
    return new NoOpDiagnosticsProvider();
}
