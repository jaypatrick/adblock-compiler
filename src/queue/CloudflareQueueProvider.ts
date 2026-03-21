// Cloudflare Queue implementation of IQueueProvider.
// Uses Cloudflare's Queue binding for async message processing.

/// <reference types="@cloudflare/workers-types" />

import type { IBasicLogger } from '../types/index.ts';
import { silentLogger } from '../utils/logger.ts';
import type { AnyQueueMessage, IQueueProvider, QueueProviderOptions, ReceivedMessage, ReceiveResult, SendResult } from './IQueueProvider.ts';

// Cloudflare Queue provider — wraps the Workers Queue binding (env.MY_QUEUE).
export class CloudflareQueueProvider implements IQueueProvider {
    readonly name = 'cloudflare';

    private queue: Queue<unknown> | null = null;
    private options: Required<QueueProviderOptions>;
    private pendingMessages: Map<string, Message<unknown>> = new Map();
    private readonly logger: IBasicLogger;

    constructor(options?: QueueProviderOptions, logger?: IBasicLogger) {
        this.options = {
            maxBatchSize: options?.maxBatchSize ?? 100,
            visibilityTimeoutSeconds: options?.visibilityTimeoutSeconds ?? 30,
            maxRetries: options?.maxRetries ?? 3,
            deadLetterQueue: options?.deadLetterQueue ?? '',
        };
        this.logger = logger ?? silentLogger;
    }

    // Must be called before using send methods.
    setBinding(queue: Queue<unknown>): void {
        this.queue = queue;
    }

    async send<T extends AnyQueueMessage>(message: T): Promise<SendResult> {
        if (!this.queue) {
            return {
                success: false,
                messageId: message.id,
                error: 'Queue binding not initialized',
            };
        }

        try {
            await this.queue.send(message);
            return {
                success: true,
                messageId: message.id,
            };
        } catch (error) {
            return {
                success: false,
                messageId: message.id,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    async sendBatch<T extends AnyQueueMessage>(messages: T[]): Promise<SendResult[]> {
        if (!this.queue) {
            return messages.map((m) => ({
                success: false,
                messageId: m.id,
                error: 'Queue binding not initialized',
            }));
        }

        // Cloudflare Queues has a batch limit of 100 messages
        const batches: T[][] = [];
        for (let i = 0; i < messages.length; i += this.options.maxBatchSize) {
            batches.push(messages.slice(i, i + this.options.maxBatchSize));
        }

        const results: SendResult[] = [];

        for (const batch of batches) {
            try {
                await this.queue.sendBatch(batch.map((m) => ({ body: m })));
                results.push(
                    ...batch.map((m) => ({
                        success: true,
                        messageId: m.id,
                    })),
                );
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                results.push(
                    ...batch.map((m) => ({
                        success: false,
                        messageId: m.id,
                        error: errorMsg,
                    })),
                );
            }
        }

        return results;
    }

    // Process a batch of messages from a Cloudflare Queue consumer (queue event handler).
    async processBatch<T extends AnyQueueMessage>(
        batch: MessageBatch<T>,
        handler: (message: T) => Promise<void>,
    ): Promise<{ processed: number; failed: number }> {
        let processed = 0;
        let failed = 0;

        for (const msg of batch.messages) {
            try {
                await handler(msg.body);
                msg.ack();
                processed++;
            } catch (error) {
                if (msg.attempts < this.options.maxRetries) {
                    msg.retry();
                } else {
                    // Max retries exceeded — acknowledge to dequeue. Cloudflare Queues does not
                    // have a built-in DLQ, so log a structured warning with non-sensitive fields only.
                    msg.ack();
                    let payloadSummary: string;
                    try {
                        const body = msg.body as unknown as Record<string, unknown>;
                        payloadSummary = JSON.stringify({ id: body?.id, type: body?.type, requestId: body?.requestId });
                    } catch {
                        payloadSummary = '[unserializable payload]';
                    }
                    this.logger.error(
                        `[DLQ] Message ${msg.id} permanently failed after ${msg.attempts} attempts and will be dropped. ` +
                            `Payload summary: ${payloadSummary}. ` +
                            `Error: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
                failed++;
            }
        }

        return { processed, failed };
    }

    // Wrap a Cloudflare message batch for use with the generic ack/retry/fail interface.
    wrapBatch<T extends AnyQueueMessage>(
        batch: MessageBatch<T>,
    ): ReceiveResult<T> {
        const messages: ReceivedMessage<T>[] = batch.messages.map((msg) => {
            // Store reference for later operations
            this.pendingMessages.set(msg.id, msg);

            return {
                body: msg.body,
                ack: async () => {
                    msg.ack();
                    this.pendingMessages.delete(msg.id);
                },
                retry: async (_delaySeconds?: number) => {
                    // Cloudflare doesn't support custom delay on retry
                    msg.retry();
                    this.pendingMessages.delete(msg.id);
                },
                fail: async (reason: string) => {
                    this.logger.error(`Message ${msg.id} failed: ${reason}`);
                    // In Cloudflare, we ack to remove from queue
                    // DLQ handling would need to be implemented separately
                    msg.ack();
                    this.pendingMessages.delete(msg.id);
                },
            };
        });

        return {
            messages,
            hasMore: false, // Cloudflare delivers all messages in batch
        };
    }

    // These methods are not directly supported by Cloudflare Queues consumer model
    async receive<T extends AnyQueueMessage>(_maxMessages?: number): Promise<ReceiveResult<T>> {
        // Cloudflare Queues use a push model - messages are delivered to the consumer
        // This method cannot pull messages on demand
        return {
            messages: [],
            hasMore: false,
        };
    }

    async getMessageCount(): Promise<number> {
        // Cloudflare Queues doesn't expose message count API
        return -1;
    }

    async healthCheck(): Promise<boolean> {
        // If we have a queue binding, assume it's healthy
        return this.queue !== null;
    }

    async purge(): Promise<number> {
        // Cloudflare Queues doesn't support purge API
        // Messages must be consumed or expire
        return -1;
    }
}

// Factory: create a CloudflareQueueProvider, optionally pre-bound to a Queue binding.
export function createCloudflareQueueProvider(
    binding?: Queue<unknown>,
    options?: QueueProviderOptions,
    logger?: IBasicLogger,
): CloudflareQueueProvider {
    const provider = new CloudflareQueueProvider(options, logger);
    if (binding) {
        provider.setBinding(binding);
    }
    return provider;
}
