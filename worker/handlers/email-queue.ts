/**
 * Email queue consumer — processes messages from `adblock-compiler-email-queue`.
 *
 * ## Role in the email delivery pipeline
 *
 * ```
 * Caller
 *   └─ QueuedEmailService.sendEmail(payload)
 *        └─ env.EMAIL_QUEUE.send(EmailQueueMessage)
 *             └─ [Cloudflare Queue] → handleEmailQueue()
 *                  └─ env.EMAIL_DELIVERY_WORKFLOW.create({ id, params })
 *                       └─ EmailDeliveryWorkflow.run(...)
 *                            ├─ step: validate payload
 *                            ├─ step: deliver (3 retries, exponential back-off)
 *                            └─ step: record receipt in KV
 * ```
 *
 * This two-stage design (Queue → Workflow) gives the best of both worlds:
 *
 * - **Queue** provides fan-out, batching, and the dead-letter queue (DLQ).
 * - **Workflow** provides crash-resistant, step-checkpointed durable execution
 *   with automatic retry and observable progress.
 *
 * ## Idempotency
 *
 * The Workflow instance ID is set to the queue message's `idempotencyKey`
 * (or `requestId` if present, falling back to a `crypto.randomUUID()`).
 * If a queue message is replayed (at-least-once delivery), the Workflow runtime
 * silently ignores the duplicate `create()` call and returns the existing instance.
 *
 * ## Dead-letter queue
 *
 * Messages that exhaust their retry budget (default: 3 retries) are forwarded
 * to `adblock-compiler-email-dlq`. Administrators can inspect the DLQ via the
 * Cloudflare dashboard or `wrangler queues messages pull adblock-compiler-email-dlq`.
 *
 * @see worker/workflows/EmailDeliveryWorkflow.ts — the workflow triggered here
 * @see worker/services/email-service.ts — `QueuedEmailService` that enqueues
 */

import { z } from 'zod';
import type { EmailQueueMessage, Env } from '../types.ts';
import { EmailPayloadSchema } from '../services/email-service.ts';

/**
 * Process a batch of messages from `adblock-compiler-email-queue`.
 *
 * For each message:
 *  1. Zod-validates the body as an `EmailQueueMessage`.
 *  2. Creates an `EmailDeliveryWorkflow` instance with a deterministic ID
 *     (idempotency key) so replayed messages don't cause duplicate sends.
 *  3. Individually acks or retries each message — a failure in one never
 *     blocks the rest of the batch.
 *
 * @param batch - Cloudflare Queue message batch.
 * @param env   - Worker environment bindings.
 */
export async function handleEmailQueue(batch: MessageBatch<EmailQueueMessage>, env: Env): Promise<void> {
    if (!env.EMAIL_DELIVERY_WORKFLOW) {
        // Workflow not configured — ack all to prevent infinite retries, log warning.
        // deno-lint-ignore no-console
        console.warn(
            '[email-queue] EMAIL_DELIVERY_WORKFLOW binding is not configured. ' +
                'All email queue messages will be dropped. ' +
                'Add a [[workflows]] entry for "email-delivery-workflow" in wrangler.toml.',
        );
        batch.ackAll();
        return;
    }

    // env.EMAIL_DELIVERY_WORKFLOW is guaranteed non-null by the early return above.
    // Capture in a local const so TypeScript's narrowing carries into the async lambda.
    const workflow = env.EMAIL_DELIVERY_WORKFLOW;

    // Process each message individually so one bad message doesn't block the batch.
    await Promise.allSettled(
        batch.messages.map(async (message) => {
            const msgId = message.id;
            try {
                // Validate message body
                const parsed = EmailQueueMessageSchema.safeParse(message.body);
                if (!parsed.success) {
                    // deno-lint-ignore no-console
                    console.error(
                        `[email-queue] Invalid message body (id=${msgId}):`,
                        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
                    );
                    // Ack malformed messages immediately — retrying won't fix a schema violation.
                    // These messages are dropped (not forwarded to the DLQ) because structural
                    // invalidity is a permanent, non-transient failure.  The DLQ receives only
                    // messages that exhaust their retry budget after transient failures.
                    message.ack();
                    return;
                }

                const { payload, idempotencyKey = `email-${msgId}`, reason } = parsed.data;

                // Create a Workflow instance. If the instance already exists with
                // this ID (replayed message), the Workflow runtime is a no-op.
                await workflow.create({
                    id: idempotencyKey,
                    params: {
                        payload,
                        idempotencyKey,
                        reason,
                    },
                });

                // deno-lint-ignore no-console
                console.log(
                    `[email-queue] Workflow created (msgId=${msgId}, idempotencyKey=${idempotencyKey}, to=${payload.to})`,
                );

                message.ack();
            } catch (err: unknown) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                // deno-lint-ignore no-console
                console.error(`[email-queue] Failed to process message (id=${msgId}):`, errorMsg);
                // Retry the message (up to the queue's maxRetries).
                message.retry();
            }
        }),
    );
}

// ============================================================================
// Zod schema for email queue message body validation
// ============================================================================

/**
 * Schema for messages placed on `adblock-compiler-email-queue`.
 *
 * Mirrors {@link EmailQueueMessage} in `worker/types.ts`.
 * Validated by the queue consumer before creating a Workflow instance.
 *
 * Fields are explicitly listed (rather than spread from `EmailDeliveryParamsSchema`)
 * to make the composition clear and avoid accidental field shadowing.
 */
export const EmailQueueMessageSchema = z.object({
    type: z.literal('email'),
    requestId: z.string().optional(),
    timestamp: z.number(),
    /** Email content to deliver — see {@link EmailPayloadSchema}. */
    payload: EmailPayloadSchema,
    /** Stable deduplication key; used as the Workflow instance ID. */
    idempotencyKey: z.string().optional(),
    /** Human-readable label for the send reason (logged in Workflow steps). */
    reason: z.string().optional(),
});
