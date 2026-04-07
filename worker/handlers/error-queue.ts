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
 *   errors/YYYY/MM/DD/HH/<batchId>.ndjson
 *
 * Each line in the NDJSON file is one serialised ErrorQueueMessage.
 */

import type { Env, ErrorQueueMessage } from '../types.ts';

// ============================================================================
// Constants
// ============================================================================

/** R2 key prefix for error log objects. */
const ERROR_LOG_PREFIX = 'errors';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Builds the R2 object key for a batch of error messages.
 *
 * Format: errors/YYYY/MM/DD/HH/<batchId>.ndjson
 * This partitioning makes querying by time range efficient and avoids
 * hot-spotting a single prefix in the R2 namespace.
 */
async function persistErrorBatch(
    errors: ErrorQueueMessage[],
    env: Env,
): Promise<void> {
    if (!env.ERROR_BUCKET) {
        // deno-lint-ignore no-console
        console.warn(`${LOG_PREFIX} ERROR_BUCKET binding not available, skipping persistence`);
        return;
    }

    // Group errors by date for better organization in R2
    const errorsByDate = new Map<string, ErrorQueueMessage[]>();

    for (const error of errors) {
        const date = new Date(error.timestamp);
        const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
        if (!errorsByDate.has(dateKey)) {
            errorsByDate.set(dateKey, []);
        }
        errorsByDate.get(dateKey)!.push(error);
    }

    // Write each day's errors to a separate file in R2
    const writePromises: Promise<R2Object>[] = [];

    for (const [dateKey, dateErrors] of errorsByDate.entries()) {
        const batchId = generateRequestId('error-batch');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const key = `errors/${dateKey}/${timestamp}-${batchId}.jsonl`;

        // Convert errors to JSONL format (one JSON object per line)
        const jsonl = dateErrors.map((e) => JSON.stringify(e)).join('\n') + '\n';

        // deno-lint-ignore no-console
        console.log(`${LOG_PREFIX} Writing ${dateErrors.length} errors to ${key}`);

        writePromises.push(
            env.ERROR_BUCKET.put(key, jsonl, {
                httpMetadata: {
                    contentType: 'application/jsonl',
                },
                customMetadata: {
                    errorCount: String(dateErrors.length),
                    batchId,
                    dateKey,
                },
            }),
        );
    }

    await Promise.all(writePromises);

/**
 * Serialises a batch of ErrorQueueMessage objects to NDJSON (one JSON object per line).
 */
export function serializeToNdjson(messages: readonly ErrorQueueMessage[]): string {
    return messages.map((m) => JSON.stringify(m)).join('\n');
}

// ============================================================================
// Consumer handler
// ============================================================================

/**
 * Queue consumer for `adblock-compiler-error-queue`.
 *
 * Called by the Worker `queue()` hook when the queue name is `adblock-compiler-error-queue`.
 * Acks every message (errors are logged, not retried) and persists the full
 * batch as a single NDJSON object in ERROR_BUCKET under the timestamped key.
 * If ERROR_BUCKET is unavailable the batch is still acked (console-only fallback).
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
        const key = buildErrorLogKey(now, batchId);
        const body = serializeToNdjson(messages);

        await env.ERROR_BUCKET.put(key, body, {
            httpMetadata: { contentType: 'application/x-ndjson' },
            customMetadata: {
                batchSize: String(batchSize),
                queueName: batch.queue,
                writtenAt: now.toISOString(),
            },
        });

        // deno-lint-ignore no-console
        console.log(`[ERROR-QUEUE] Persisted ${batchSize} error message(s) to R2 key: ${key}`);
    } catch (error) {
        // deno-lint-ignore no-console
        console.error(
            '[ERROR-QUEUE] Failed to persist error batch to R2:',
            error instanceof Error ? error.message : String(error),
        );
    }
}
