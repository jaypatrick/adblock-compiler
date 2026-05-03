/**
 * Error dead-letter queue consumer for the Cloudflare Worker.
 *
 * Persists batches of unhandled-error events to R2 (ERROR_BUCKET) as NDJSON
 * for long-term durable log storage and post-incident analysis.
 *
 * Isolation: this handler operates entirely on the ERROR_QUEUE / ERROR_BUCKET
 * bindings and shares no state with the production compile queues.
 *
 * R2 key layout:
 *   errors/YYYY/MM/DD/HH/<batchId>.ndjson.gz  (compressed batch logs)
 *   errors/YYYY/MM/DD/HH/_index.json          (hourly error summary index)
 *
 * Each line in the NDJSON file is one serialised ErrorQueueMessage.
 *
 * **Enhancements**:
 * - Gzip compression for batches >1KB to reduce R2 storage costs
 * - Error categorization and severity tracking
 * - Hourly index files for efficient querying by severity/category
 * - Metrics aggregation (error counts by severity/category)
 */

import type { Env, ErrorCategory, ErrorQueueMessage, ErrorSeverity } from '../types.ts';

// ============================================================================
// Constants
// ============================================================================

/** R2 key prefix for error log objects. */
const ERROR_LOG_PREFIX = 'errors';

/** Minimum batch size (bytes) for gzip compression. */
const COMPRESSION_THRESHOLD_BYTES = 1024;

// ============================================================================
// Types
// ============================================================================

/**
 * Hourly error summary index for efficient querying.
 * Stored at: errors/YYYY/MM/DD/HH/_index.json
 */
interface ErrorIndexEntry {
    readonly hour: string; // ISO 8601 hour (e.g., "2025-01-15T14:00:00.000Z")
    readonly totalErrors: number;
    readonly bySeverity: Record<ErrorSeverity, number>;
    readonly byCategory: Record<ErrorCategory, number>;
    readonly batches: ReadonlyArray<{
        readonly batchId: string;
        readonly key: string;
        readonly count: number;
        readonly writtenAt: string;
    }>;
    readonly lastUpdated: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Builds the R2 object key for a batch of error messages.
 *
 * Format: errors/YYYY/MM/DD/HH/<batchId>.ndjson.gz
 * This partitioning makes querying by time range efficient and avoids
 * hot-spotting a single prefix in the R2 namespace.
 */
export function buildErrorLogKey(date: Date, batchId: string, compressed: boolean): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const extension = compressed ? 'ndjson.gz' : 'ndjson';
    return `${ERROR_LOG_PREFIX}/${year}/${month}/${day}/${hour}/${batchId}.${extension}`;
}

/**
 * Builds the R2 object key for an hourly error index.
 *
 * Format: errors/YYYY/MM/DD/HH/_index.json
 */
export function buildErrorIndexKey(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    return `${ERROR_LOG_PREFIX}/${year}/${month}/${day}/${hour}/_index.json`;
}

/**
 * Serialises a batch of ErrorQueueMessage objects to NDJSON (one JSON object per line).
 */
export function serializeToNdjson(messages: readonly ErrorQueueMessage[]): string {
    return messages.map((m) => JSON.stringify(m)).join('\n');
}

/**
 * Compresses data using gzip if it exceeds the threshold.
 * Returns [compressed data, was compressed].
 */
async function maybeCompress(data: string): Promise<[ArrayBuffer | string, boolean]> {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(data);

    if (bytes.length < COMPRESSION_THRESHOLD_BYTES) {
        return [data, false];
    }

    // Use CompressionStream for gzip compression
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    const compressed = await new Response(stream).arrayBuffer();
    return [compressed, true];
}

/**
 * Aggregates error metrics by severity and category.
 */
function aggregateMetrics(messages: readonly ErrorQueueMessage[]): {
    bySeverity: Record<ErrorSeverity, number>;
    byCategory: Record<ErrorCategory, number>;
} {
    const bySeverity: Record<ErrorSeverity, number> = {
        critical: 0,
        error: 0,
        warning: 0,
        info: 0,
    };
    const byCategory: Record<ErrorCategory, number> = {
        http_error: 0,
        validation_error: 0,
        auth_error: 0,
        rate_limit_error: 0,
        compilation_error: 0,
        storage_error: 0,
        queue_error: 0,
        workflow_error: 0,
        unknown_error: 0,
    };

    for (const msg of messages) {
        const severity = msg.severity ?? 'error';
        const category = msg.category ?? 'unknown_error';
        bySeverity[severity]++;
        byCategory[category]++;
    }

    return { bySeverity, byCategory };
}

/**
 * Updates the hourly error index with a new batch entry.
 * Retrieves the existing index, appends the new batch metadata, and writes it back.
 */
async function updateErrorIndex(
    bucket: R2Bucket,
    date: Date,
    batchId: string,
    key: string,
    batchSize: number,
    metrics: ReturnType<typeof aggregateMetrics>,
    writtenAt: string,
): Promise<void> {
    const indexKey = buildErrorIndexKey(date);

    try {
        // Retrieve existing index or create new one
        const existingObj = await bucket.get(indexKey);
        let index: ErrorIndexEntry;

        if (existingObj) {
            const existingText = await existingObj.text();
            const existing = JSON.parse(existingText) as ErrorIndexEntry;

            // Merge metrics
            const mergedBySeverity: Record<ErrorSeverity, number> = { ...existing.bySeverity };
            const mergedByCategory: Record<ErrorCategory, number> = { ...existing.byCategory };

            for (const [severity, count] of Object.entries(metrics.bySeverity)) {
                mergedBySeverity[severity as ErrorSeverity] += count;
            }
            for (const [category, count] of Object.entries(metrics.byCategory)) {
                mergedByCategory[category as ErrorCategory] += count;
            }

            index = {
                hour: existing.hour,
                totalErrors: existing.totalErrors + batchSize,
                bySeverity: mergedBySeverity,
                byCategory: mergedByCategory,
                batches: [
                    ...existing.batches,
                    {
                        batchId,
                        key,
                        count: batchSize,
                        writtenAt,
                    },
                ],
                lastUpdated: new Date().toISOString(),
            };
        } else {
            // Create new index
            const hourStart = new Date(date);
            hourStart.setMinutes(0, 0, 0);

            index = {
                hour: hourStart.toISOString(),
                totalErrors: batchSize,
                bySeverity: metrics.bySeverity,
                byCategory: metrics.byCategory,
                batches: [
                    {
                        batchId,
                        key,
                        count: batchSize,
                        writtenAt,
                    },
                ],
                lastUpdated: new Date().toISOString(),
            };
        }

        // Write updated index back to R2
        await bucket.put(indexKey, JSON.stringify(index, null, 2), {
            httpMetadata: { contentType: 'application/json' },
        });
    } catch (error) {
        // Index update failure is non-fatal — batch is already persisted
        // deno-lint-ignore no-console
        console.error(
            '[ERROR-QUEUE] Failed to update hourly index:',
            error instanceof Error ? error.message : String(error),
        );
    }
}

// ============================================================================
// Consumer handler
// ============================================================================

/**
 * Queue consumer for `bloqr-backend-error-queue`.
 *
 * Called by the Worker `queue()` hook when the queue name is `bloqr-backend-error-queue`.
 * Acks every message (errors are logged, not retried) and persists the full
 * batch as a single NDJSON object in ERROR_BUCKET under the timestamped key.
 * If ERROR_BUCKET is unavailable the batch is still acked (console-only fallback).
 *
 * **Enhanced features**:
 * - Gzip compression for batches >1KB (reduces R2 storage costs ~70-90%)
 * - Error severity and category tracking
 * - Hourly index files for efficient querying
 * - Aggregated metrics (error counts by severity/category)
 */
export async function handleErrorQueue(
    batch: MessageBatch<ErrorQueueMessage>,
    env: Env,
): Promise<void> {
    const batchSize = batch.messages.length;

    // deno-lint-ignore no-console
    console.log(`[ERROR-QUEUE] Processing batch of ${batchSize} error message(s)`);

    // Collect message bodies and ack every message immediately.
    // Error events are not retried — logging is best-effort.
    const messages: ErrorQueueMessage[] = [];
    for (const message of batch.messages) {
        messages.push(message.body);
        message.ack();
    }

    if (messages.length === 0) {
        return;
    }

    // Persist the batch to R2 if ERROR_BUCKET is configured.
    if (!env.ERROR_BUCKET) {
        // deno-lint-ignore no-console
        console.warn('[ERROR-QUEUE] ERROR_BUCKET binding is not configured — batch will not be persisted to R2');
        return;
    }

    try {
        const now = new Date();
        // Use crypto.randomUUID() for collision-resistant uniqueness in high-volume scenarios.
        const batchId = `${Date.now()}-${crypto.randomUUID()}`;
        const ndjson = serializeToNdjson(messages);

        // Compress if batch is large enough to benefit
        const [body, compressed] = await maybeCompress(ndjson);
        const key = buildErrorLogKey(now, batchId, compressed);

        // Calculate metrics for index
        const metrics = aggregateMetrics(messages);

        // Write batch to R2
        await env.ERROR_BUCKET.put(key, body, {
            httpMetadata: {
                contentType: compressed ? 'application/x-ndjson' : 'application/x-ndjson',
                contentEncoding: compressed ? 'gzip' : undefined,
            },
            customMetadata: {
                batchSize: String(batchSize),
                queueName: batch.queue,
                writtenAt: now.toISOString(),
                compressed: String(compressed),
                // Include aggregated metrics in metadata for quick dashboard access
                criticalCount: String(metrics.bySeverity.critical),
                errorCount: String(metrics.bySeverity.error),
                warningCount: String(metrics.bySeverity.warning),
                infoCount: String(metrics.bySeverity.info),
            },
        });

        // deno-lint-ignore no-console
        console.log(
            `[ERROR-QUEUE] Persisted ${batchSize} error message(s) to R2 key: ${key} ` +
                `(compressed: ${compressed}, critical: ${metrics.bySeverity.critical}, ` +
                `error: ${metrics.bySeverity.error}, warning: ${metrics.bySeverity.warning})`,
        );

        // Update hourly index (non-blocking, best-effort)
        await updateErrorIndex(env.ERROR_BUCKET, now, batchId, key, batchSize, metrics, now.toISOString());
    } catch (error) {
        // deno-lint-ignore no-console
        console.error(
            '[ERROR-QUEUE] Failed to persist error batch to R2:',
            error instanceof Error ? error.message : String(error),
        );
    }
}
