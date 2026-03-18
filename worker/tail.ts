/**
 * Cloudflare Tail Worker for logging and observability.
 *
 * This tail worker consumes logs and events from the main adblock-compiler worker,
 * providing real-time observability for debugging, monitoring, and alerting.
 *
 * Features:
 * - Captures console logs, exceptions, and errors
 * - Stores logs in KV for persistence and analysis
 * - Forwards critical errors to external endpoints (optional)
 * - Provides structured event processing
 *
 * @see https://developers.cloudflare.com/workers/observability/logs/tail-workers/
 */

/// <reference types="@cloudflare/workers-types" />

// @sentry/cloudflare is imported lazily inside tail() — only when SENTRY_DSN is set.

/**
 * Environment bindings for the tail worker.
 */
export interface TailEnv {
    // KV namespace for storing logs
    TAIL_LOGS?: KVNamespace;

    // Optional webhook URL for forwarding critical errors
    ERROR_WEBHOOK_URL?: string;

    // Optional log retention period in seconds (default: 24 hours)
    LOG_RETENTION_TTL?: string;

    // HTTP log sink endpoint (e.g., Better Stack, Logtail, Grafana Loki)
    LOG_SINK_URL?: string;
    // Bearer token for authenticating with the log sink
    LOG_SINK_TOKEN?: string;
    // Minimum log level to forward to sink ('debug'|'info'|'warn'|'error'), default 'warn'
    LOG_SINK_MIN_LEVEL?: string;
    /**
     * Sentry DSN — when set the tail worker forwards worker exceptions captured
     * in tail events to Sentry, providing full visibility into scheduled and
     * queue handler failures that are otherwise invisible to the main Sentry SDK.
     * Store via: wrangler secret put SENTRY_DSN --config wrangler.tail.toml
     */
    SENTRY_DSN?: string;
}

/**
 * Tail event structure from Cloudflare
 */
export interface TailEvent {
    scriptName?: string | null;
    outcome: 'ok' | 'exception' | 'exceededCpu' | 'exceededMemory' | 'unknown' | 'canceled';
    eventTimestamp: number;
    logs: TailLog[];
    exceptions: TailException[];
    event?: {
        request?: {
            url: string;
            method: string;
            headers: Record<string, string>;
        };
    };
}

export interface TailLog {
    timestamp: number;
    level: 'log' | 'debug' | 'info' | 'warn' | 'error';
    message: unknown[];
}

export interface TailException {
    timestamp: number;
    message: string;
    name: string;
}

/**
 * Typed output of `createStructuredEvent()`.
 * Using a concrete type here (rather than `Record<string, unknown>`) keeps
 * downstream consumers like `formatSlackAlert` type-safe.
 */
export interface StructuredTailEvent {
    timestamp: string;
    scriptName: string;
    outcome: TailEvent['outcome'];
    url: string | undefined;
    method: string | undefined;
    logs: Array<{ timestamp: string; level: TailLog['level']; message: unknown[] }>;
    exceptions: Array<{ timestamp: string; name: string; message: string }>;
}

/**
 * Format log messages for storage
 */
export function formatLogMessage(log: TailLog): string {
    const timestamp = new Date(log.timestamp).toISOString();
    const messages = log.message.map((m) => {
        try {
            return typeof m === 'object' ? JSON.stringify(m) : String(m);
        } catch (_error) {
            // Handle circular references or other JSON.stringify errors
            return String(m);
        }
    }).join(' ');
    return `[${timestamp}] [${log.level.toUpperCase()}] ${messages}`;
}

/**
 * Check if event should be forwarded to webhook
 */
export function shouldForwardEvent(event: TailEvent): boolean {
    // Forward exceptions and critical errors, including resource limit violations
    return event.outcome === 'exception' ||
        event.outcome === 'exceededCpu' ||
        event.outcome === 'exceededMemory' ||
        event.exceptions.length > 0 ||
        event.logs.some((log) => log.level === 'error');
}

/**
 * Create a structured event for external systems
 */
export function createStructuredEvent(event: TailEvent): StructuredTailEvent {
    return {
        timestamp: new Date(event.eventTimestamp).toISOString(),
        scriptName: event.scriptName || 'adblock-compiler',
        outcome: event.outcome,
        url: event.event?.request?.url,
        method: event.event?.request?.method,
        logs: event.logs.map((log) => ({
            timestamp: new Date(log.timestamp).toISOString(),
            level: log.level,
            message: log.message,
        })),
        exceptions: event.exceptions.map((exc) => ({
            timestamp: new Date(exc.timestamp).toISOString(),
            name: exc.name,
            message: exc.message,
        })),
    };
}

/**
 * Format a structured tail event as a Slack Block Kit payload.
 *
 * Drop-in replacement for the plain-text JSON body currently sent to
 * ERROR_WEBHOOK_URL. Slack renders this with colour coding and section blocks.
 */
export function formatSlackAlert(event: StructuredTailEvent): Record<string, unknown> {
    const isError = event.outcome !== 'ok';
    const colour = isError ? '#E53E3E' : '#38A169';
    const exceptionList = event.exceptions
        .map((e) => `• *${e.name}*: ${e.message}`)
        .join('\n') || '_none_';

    return {
        attachments: [
            {
                color: colour,
                blocks: [
                    {
                        type: 'header',
                        text: {
                            type: 'plain_text',
                            text: `🚨 adblock-compiler: ${event.outcome}`,
                        },
                    },
                    {
                        type: 'section',
                        fields: [
                            { type: 'mrkdwn', text: `*URL*\n${event.url ?? '_unknown_'}` },
                            { type: 'mrkdwn', text: `*Outcome*\n${event.outcome}` },
                            { type: 'mrkdwn', text: `*Timestamp*\n${event.timestamp}` },
                            { type: 'mrkdwn', text: `*Script*\n${event.scriptName ?? 'adblock-compiler'}` },
                        ],
                    },
                    {
                        type: 'section',
                        text: { type: 'mrkdwn', text: `*Exceptions*\n${exceptionList}` },
                    },
                ],
            },
        ],
    };
}

/**
 * Forward structured log events to an external HTTP log sink (e.g., Better Stack, Logtail).
 * Only forwards events at or above the configured minimum level.
 */
export async function forwardToLogSink(event: TailEvent, env: TailEnv): Promise<void> {
    const sinkUrl = env.LOG_SINK_URL;
    if (!sinkUrl) return;

    const minLevel = env.LOG_SINK_MIN_LEVEL ?? 'warn';
    const levelOrder: Record<string, number> = { debug: 0, info: 1, log: 1, warn: 2, error: 3 };
    const minLevelNum = levelOrder[minLevel] ?? 2;

    const logsToForward = event.logs.filter((log) => (levelOrder[log.level] ?? 0) >= minLevelNum);
    const hasExceptions = event.exceptions.length > 0;

    if (logsToForward.length === 0 && !hasExceptions) return;

    const payload = {
        timestamp: new Date(event.eventTimestamp).toISOString(),
        scriptName: event.scriptName ?? 'adblock-compiler',
        outcome: event.outcome,
        url: event.event?.request?.url,
        method: event.event?.request?.method,
        logs: logsToForward.map((log) => ({
            level: log.level,
            timestamp: new Date(log.timestamp).toISOString(),
            message: log.message.map((m) => (typeof m === 'object' ? JSON.stringify(m) : String(m))).join(' '),
        })),
        exceptions: event.exceptions.map((ex) => ({ name: ex.name, message: ex.message })),
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (env.LOG_SINK_TOKEN) {
        headers['Authorization'] = `Bearer ${env.LOG_SINK_TOKEN}`;
    }

    try {
        await fetch(sinkUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
    } catch (_error) {
        // Never throw from the tail worker — swallow forwarding errors
    }
}

/**
 * Main tail handler
 */
const handler = {
    async tail(events: TailEvent[], env: TailEnv, ctx: ExecutionContext) {
        // Process each event
        const promises: Promise<void>[] = [];

        // Lazily import the Sentry SDK only when a DSN is configured.
        // This keeps tail-worker startup free of the Sentry module and prevents
        // a missing/unsupported SDK from causing a startup failure.
        let Sentry: typeof import('@sentry/cloudflare') | null = null;
        if (env.SENTRY_DSN) {
            try {
                Sentry = await import('@sentry/cloudflare');
            } catch {
                Sentry = null;
            }
        }

        for (const event of events) {
            // Store logs in KV if available
            if (env.TAIL_LOGS) {
                const logKey = `log:${event.eventTimestamp}`;
                const logData = {
                    timestamp: new Date(event.eventTimestamp).toISOString(),
                    scriptName: event.scriptName,
                    outcome: event.outcome,
                    url: event.event?.request?.url,
                    method: event.event?.request?.method,
                    logs: event.logs.map(formatLogMessage),
                    exceptions: event.exceptions,
                };

                // Get retention TTL (default to 24 hours)
                // Validate that it's a valid number, fallback to default if invalid
                let ttl = 86400; // default: 24 hours
                if (env.LOG_RETENTION_TTL) {
                    const parsedTtl = parseInt(env.LOG_RETENTION_TTL);
                    if (!isNaN(parsedTtl) && parsedTtl > 0) {
                        ttl = parsedTtl;
                    }
                }

                promises.push(
                    env.TAIL_LOGS.put(
                        logKey,
                        JSON.stringify(logData),
                        { expirationTtl: ttl },
                    ),
                );
            }

            promises.push(forwardToLogSink(event, env));

            // Forward critical errors to webhook if configured
            if (env.ERROR_WEBHOOK_URL && shouldForwardEvent(event)) {
                const structuredEvent = createStructuredEvent(event);

                promises.push(
                    fetch(env.ERROR_WEBHOOK_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(structuredEvent),
                    })
                        .then((response) => {
                            if (!response.ok) {
                                console.error(
                                    `Failed to forward event to webhook: ${response.status} ${response.statusText}`,
                                );
                            }
                        })
                        .catch((error) => {
                            console.error('Error forwarding event to webhook:', error);
                        }),
                );
            }

            // Log summary to console for visibility
            if (event.outcome !== 'ok') {
                console.log(
                    `[TAIL] ${event.outcome} - ${event.event?.request?.method} ${event.event?.request?.url} - ` +
                        `${event.exceptions.length} exceptions, ${event.logs.length} logs`,
                );
            }

            // Log exceptions and forward to Sentry if configured
            for (const exception of event.exceptions) {
                console.error(
                    `[TAIL] Exception: ${exception.name}: ${exception.message} at ${new Date(exception.timestamp).toISOString()}`,
                );
                if (Sentry) {
                    // Capture a non-null const so TypeScript narrows correctly inside the closure.
                    const sentry = Sentry;
                    try {
                        sentry.withScope((scope) => {
                            scope.setTag('outcome', event.outcome);
                            scope.setTag('scriptName', event.scriptName ?? 'unknown');
                            scope.setContext('request', {
                                url: event.event?.request?.url ?? 'unknown',
                                method: event.event?.request?.method ?? 'unknown',
                            });
                            sentry.captureException(
                                new Error(`${exception.name}: ${exception.message}`),
                            );
                        });
                    } catch {
                        // Never let Sentry failures surface in the tail worker
                    }
                }
            }

            // Log error-level messages
            for (const log of event.logs) {
                if (log.level === 'error') {
                    console.error(`[TAIL] ${formatLogMessage(log)}`);
                }
            }
        }

        // Flush buffered Sentry events before the handler returns.
        // Added to promises so ctx.waitUntil() keeps the worker alive until flushed.
        if (Sentry) {
            promises.push(
                Sentry.flush(2000).then(() => {}).catch((err) => {
                    console.warn('[TAIL] Sentry flush failed:', err);
                }),
            );
        }

        // Wait for all async operations to complete
        ctx.waitUntil(Promise.all(promises));
    },
};

// Raw handler exported for unit tests.
export const tailHandler = handler;

// Default export: lazily wraps with withSentry() only when SENTRY_DSN is set to
// avoid loading the SDK at module startup. Falls through to the plain handler
// when DSN is absent or the SDK cannot be loaded.
export default {
    async tail(events: TailEvent[], env: TailEnv, ctx: ExecutionContext): Promise<void> {
        if (env.SENTRY_DSN) {
            try {
                const dsn = env.SENTRY_DSN;
                const { withSentry } = await import('@sentry/cloudflare');
                return withSentry(
                    () => ({ dsn, tracesSampleRate: 0, integrations: [] }),
                    handler as unknown as ExportedHandler<unknown>,
                ).tail!(events as unknown as TraceItem[], env, ctx);
            } catch {
                // SDK load or init failed — fall through to the plain handler
            }
        }
        return handler.tail(events, env, ctx);
    },
};
