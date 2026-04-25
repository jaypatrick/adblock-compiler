/**
 * EmailDeliveryWorkflow — Durable, step-checkpointed email delivery via Cloudflare Workflows.
 *
 * ## Why a Workflow?
 *
 * Sending transactional email fire-and-forget via `ctx.waitUntil` is fine for
 * opportunistic sends, but for **critical notifications** (compilation-complete
 * for paying users, admin DLQ alerts) we want:
 *
 * - **Durability** — email job survives Worker restarts and isolate evictions.
 * - **Automatic retry** — configurable back-off on transient delivery failures.
 * - **Observability** — each delivery attempt is logged as a named Workflow step.
 * - **Deduplication** — callers can pass a stable `idempotencyKey` to avoid
 *   duplicate sends if a queue message is replayed.
 *
 * ## Steps
 *
 * ```
 * 1. validate    — Zod-validate the email payload (fast, no retries)
 * 2. deliver     — Send via the active email provider (3 retries, exponential back-off)
 * 3. record-send — Persist a delivery receipt to KV (best-effort, 1 retry)
 * ```
 *
 * ## Trigger (fire-and-forget from any handler)
 * ```ts
 * import { renderCompilationComplete } from '../services/email-templates.ts';
 *
 * const payload = renderCompilationComplete({ userEmail, configName, ruleCount, durationMs, requestId });
 * await env.EMAIL_DELIVERY_WORKFLOW.create({
 *     id: `email-${requestId}`,
 *     params: { payload, idempotencyKey: requestId } satisfies EmailDeliveryParams,
 * });
 * ```
 *
 * ## Queue-triggered (via email-queue consumer)
 * The `handleEmailQueue` consumer in `worker/handlers/email-queue.ts` reads
 * `EmailQueueMessage` items off `adblock-compiler-email-queue` and creates a
 * Workflow instance for each one, providing durability and retry for
 * queue-originated sends.
 *
 * @see worker/handlers/email-queue.ts — queue consumer that triggers this workflow
 * @see worker/services/email-service.ts — `QueuedEmailService` enqueues via `EMAIL_QUEUE`
 * @see worker/services/email-templates.ts — template renderers
 */

/// <reference types="@cloudflare/workers-types" />

import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { z } from 'zod';
import type { Env } from '../worker.ts';
import { createEmailService, EmailPayloadSchema } from '../services/email-service.ts';
import { captureExceptionInIsolate } from '../services/sentry-isolate-init.ts';

// ============================================================================
// Workflow parameter type
// ============================================================================

/**
 * Parameters for a single durable email delivery job.
 *
 * Passed to `env.EMAIL_DELIVERY_WORKFLOW.create({ id, params })` from either:
 * - A direct handler call (e.g. `POST /compile/async` completion)
 * - The `handleEmailQueue` consumer (for queue-triggered sends)
 */
export interface EmailDeliveryParams {
    /** Validated email payload (see {@link EmailPayloadSchema}). */
    payload: {
        to: string;
        subject: string;
        html: string;
        text: string;
    };
    /**
     * Caller-supplied idempotency key — used as the Workflow instance ID so that
     * replayed queue messages never send the same email twice.
     *
     * Recommended format: `email-<requestId>` or `email-<jobId>`.
     */
    idempotencyKey?: string;
    /**
     * Optional label describing why this email was triggered (logged in steps).
     * Examples: `compilation_complete`, `critical_error_alert`, `admin_test`.
     */
    reason?: string;
}

/**
 * Outcome returned by the workflow to the caller/dashboard.
 */
export interface EmailDeliveryResult {
    success: boolean;
    /** Workflow-level idempotency key (mirrors `params.idempotencyKey`). */
    idempotencyKey: string;
    /** Active provider name used for the send. */
    provider: 'cf_email_worker' | 'none';
    /** Recipient address (from the validated payload). */
    to: string;
    /** ISO 8601 timestamp when delivery was attempted. */
    deliveredAt: string;
    /** Total duration of the workflow (ms). */
    totalDurationMs: number;
    /** Error message if the workflow failed. */
    error?: string;
}

// ============================================================================
// Delivery-receipt KV key helpers
// ============================================================================

const RECEIPT_KEY_PREFIX = 'email:receipt:';
const RECEIPT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function receiptKey(idempotencyKey: string): string {
    return `${RECEIPT_KEY_PREFIX}${idempotencyKey}`;
}

// ============================================================================
// Workflow implementation
// ============================================================================

/**
 * Durable email delivery workflow.
 *
 * Steps:
 *  1. `validate`    — Zod-validate the incoming payload (immediate failure if invalid)
 *  2. `deliver`     — Send via the active email provider with 3 retries + exponential back-off
 *  3. `record-send` — Write a delivery receipt to `METRICS` KV (7-day TTL, best-effort)
 */
export class EmailDeliveryWorkflow extends WorkflowEntrypoint<Env, EmailDeliveryParams> {
    /**
     * Main workflow execution entry point.
     *
     * @param event - Workflow event containing {@link EmailDeliveryParams}.
     * @param step  - Cloudflare WorkflowStep for durable step execution.
     * @returns     {@link EmailDeliveryResult} written to the Workflow output.
     */
    override async run(event: WorkflowEvent<EmailDeliveryParams>, step: WorkflowStep): Promise<EmailDeliveryResult> {
        const startTime = Date.now();
        const { payload, idempotencyKey = `email-${crypto.randomUUID()}`, reason = 'unknown' } = event.payload;

        // deno-lint-ignore no-console
        console.log(
            `[WORKFLOW:EMAIL] Starting email delivery (key=${idempotencyKey}, reason=${reason}, to=${payload?.to ?? 'unknown'})`,
        );

        const result: EmailDeliveryResult = {
            success: false,
            idempotencyKey,
            provider: 'none',
            to: payload?.to ?? '',
            deliveredAt: new Date().toISOString(),
            totalDurationMs: 0,
        };

        try {
            // ─── Step 1: Validate payload ─────────────────────────────────────
            const validatedPayload = await step.do('validate', {
                retries: { limit: 0, delay: '1 second' },
            }, async () => {
                const parsed = EmailPayloadSchema.safeParse(payload);
                if (!parsed.success) {
                    throw new Error(`Invalid email payload: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
                }
                // deno-lint-ignore no-console
                console.log(`[WORKFLOW:EMAIL] Step 1 validate: payload valid (to=${parsed.data.to})`);
                return parsed.data;
            });

            result.to = validatedPayload.to;

            // ─── Step 2: Deliver ──────────────────────────────────────────────
            const deliveryResult = await step.do('deliver', {
                retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
                timeout: '30 seconds',
            }, async () => {
                // Use direct provider (bypass queue) to avoid queue→workflow→queue recursion.
                const mailer = createEmailService(this.env, { useQueue: false });

                // Determine the active provider name for the receipt
                const providerName: 'cf_email_worker' | 'none' = this.env.SEND_EMAIL ? 'cf_email_worker' : 'none';

                if (providerName === 'none') {
                    // No direct provider — throw so the step retry/backoff fires and
                    // the workflow is marked as failed rather than reporting false success.
                    throw new Error('No email provider configured for workflow delivery (SEND_EMAIL absent).');
                }

                await mailer.sendEmail(validatedPayload);
                // deno-lint-ignore no-console
                console.log(
                    `[WORKFLOW:EMAIL] Step 2 deliver: sent via ${providerName} to ${validatedPayload.to}`,
                );

                return { providerName, deliveredAt: new Date().toISOString() };
            });

            result.provider = deliveryResult.providerName;
            result.deliveredAt = deliveryResult.deliveredAt;
            result.success = true;

            // ─── Step 3: Record delivery receipt in KV and D1 ────────────────
            await step.do('record-send', {
                retries: { limit: 1, delay: '5 seconds' },
            }, async () => {
                const now = new Date().toISOString();
                const completedAtEpoch = Math.floor(Date.now() / 1000);

                // 3a. Persist to KV (fast edge cache, 7-day TTL)
                if (this.env.METRICS) {
                    const receipt = {
                        idempotencyKey,
                        to: validatedPayload.to,
                        subject: validatedPayload.subject,
                        provider: result.provider,
                        reason,
                        deliveredAt: result.deliveredAt,
                        success: true,
                    };
                    await this.env.METRICS.put(receiptKey(idempotencyKey), JSON.stringify(receipt), {
                        expirationTtl: RECEIPT_TTL_SECONDS,
                    });
                }

                // 3b. Persist to D1 edge database (durable audit log + fast idempotency checks)
                if (this.env.DB) {
                    try {
                        // Write to the lightweight edge email_log_edge table
                        await this.env.DB.prepare(
                            `INSERT INTO email_log_edge
                                (id, idempotency_key, provider, to_address, subject, status, reason, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                             ON CONFLICT (idempotency_key) DO NOTHING`,
                        ).bind(
                            crypto.randomUUID(),
                            idempotencyKey,
                            result.provider,
                            validatedPayload.to,
                            validatedPayload.subject.substring(0, 255),
                            'sent',
                            reason ?? null,
                            completedAtEpoch,
                        ).run();

                        // Register the idempotency key so the queue consumer can skip replays.
                        // workflow_id = idempotencyKey because email-queue.ts sets the Workflow
                        // instance id to the idempotency key (env.EMAIL_DELIVERY_WORKFLOW.create({ id: idempotencyKey })).
                        const expiresAt = completedAtEpoch + RECEIPT_TTL_SECONDS;
                        await this.env.DB.prepare(
                            `INSERT INTO email_idempotency_keys
                                (key, workflow_id, processed_at, expires_at)
                             VALUES (?, ?, ?, ?)
                             ON CONFLICT (key) DO NOTHING`,
                        ).bind(
                            idempotencyKey,
                            idempotencyKey,
                            completedAtEpoch,
                            expiresAt,
                        ).run();
                    } catch (dbErr: unknown) {
                        // Non-fatal — D1 write failure must not fail the delivery.
                        // deno-lint-ignore no-console
                        console.warn(
                            '[WORKFLOW:EMAIL] Step 3 D1 write failed (non-fatal):',
                            dbErr instanceof Error ? dbErr.message : String(dbErr),
                        );
                    }
                }

                // deno-lint-ignore no-console
                console.log(
                    `[WORKFLOW:EMAIL] Step 3 record-send: receipt stored (key=${idempotencyKey}, now=${now})`,
                );
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            result.error = message;
            result.success = false;
            // deno-lint-ignore no-console
            console.error(`[WORKFLOW:EMAIL] Delivery failed (key=${idempotencyKey}):`, message);
            await captureExceptionInIsolate(this.env, error instanceof Error ? error : new Error(message));
        }

        result.totalDurationMs = Date.now() - startTime;
        // deno-lint-ignore no-console
        console.log(
            `[WORKFLOW:EMAIL] Completed (key=${idempotencyKey}, success=${result.success}, ` +
                `provider=${result.provider}, durationMs=${result.totalDurationMs})`,
        );
        return result;
    }
}

// ============================================================================
// Zod schema for incoming queue messages (used by the queue consumer)
// ============================================================================

export const EmailDeliveryParamsSchema = z.object({
    payload: EmailPayloadSchema,
    idempotencyKey: z.string().optional(),
    reason: z.string().optional(),
});
