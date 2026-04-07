/**
 * Error queue consumer handler for persisting error logs to R2.
 * Implements the dead-letter pattern for durable error logging.
 *
 * This queue is isolated from production compile queues and handles:
 * - Batching error messages for efficient R2 writes
 * - Long-term storage of error logs in R2 ERROR_BUCKET
 * - Error aggregation and metadata extraction
 *
 * Reference: https://hono.dev/examples/cloudflare-queue/
 */

import type { Env, ErrorQueueMessage } from '../types.ts';
import { generateRequestId } from '../utils/index.ts';

// ============================================================================
// Constants
// ============================================================================

const LOG_PREFIX = '[ERROR-QUEUE]';

// ============================================================================
// Error Log Persistence
// ============================================================================

/**
 * Persist a batch of error logs to R2 bucket.
 * Groups errors by day and writes them as JSONL for efficient querying.
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
    const writePromises: Promise<unknown>[] = [];

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

    // deno-lint-ignore no-console
    console.log(`${LOG_PREFIX} Successfully persisted ${errors.length} errors across ${errorsByDate.size} date(s)`);
}

// ============================================================================
// Queue Consumer Handler
// ============================================================================

/**
 * Error queue consumer handler for processing error log batches.
 * Cloudflare Queues will call this function with batches of error messages.
 *
 * @param batch - Batch of error messages from the error queue
 * @param env - Worker environment bindings
 */
export async function handleErrorQueue(
    batch: MessageBatch<ErrorQueueMessage>,
    env: Env,
): Promise<void> {
    const batchStartTime = Date.now();
    const batchSize = batch.messages.length;

    // deno-lint-ignore no-console
    console.log(`${LOG_PREFIX} Processing batch of ${batchSize} error messages`);

    const errors: ErrorQueueMessage[] = [];
    let acked = 0;
    let retried = 0;

    for (const message of batch.messages) {
        try {
            const errorMsg = message.body;

            // Basic validation
            if (!errorMsg.errorId || !errorMsg.timestamp || !errorMsg.errorMessage) {
                // deno-lint-ignore no-console
                console.warn(`${LOG_PREFIX} Invalid error message structure, skipping:`, errorMsg);
                message.ack();
                acked++;
                continue;
            }

            errors.push(errorMsg);
            message.ack();
            acked++;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            // deno-lint-ignore no-console
            console.error(`${LOG_PREFIX} Failed to process message, will retry: ${errorMessage}`);
            message.retry();
            retried++;
        }
    }

    // Persist all valid errors to R2
    if (errors.length > 0) {
        try {
            await persistErrorBatch(errors, env);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            // deno-lint-ignore no-console
            console.error(`${LOG_PREFIX} Failed to persist error batch: ${errorMessage}`);
            // Note: Messages were already acked, so this failure is logged but not retried
            // to avoid infinite retry loops. Consider implementing a secondary DLQ if needed.
        }
    }

    const batchDuration = Date.now() - batchStartTime;
    const avgDuration = Math.round(batchDuration / batchSize);

    // deno-lint-ignore no-console
    console.log(
        `${LOG_PREFIX} Batch complete: ${batchSize} messages processed in ${batchDuration}ms ` +
            `(avg ${avgDuration}ms per message). Acked: ${acked}, Retried: ${retried}`,
    );
}
