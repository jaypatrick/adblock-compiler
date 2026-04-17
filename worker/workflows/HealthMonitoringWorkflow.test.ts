/// <reference types="@cloudflare/workers-types" />

import { assertEquals } from '@std/assert';
import { readResponseSample } from './HealthMonitoringWorkflow.ts';

function createChunkedResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    let index = 0;

    const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (index >= chunks.length) {
                controller.close();
                return;
            }

            controller.enqueue(encoder.encode(chunks[index]));
            index += 1;
        },
    });

    return new Response(stream, { status: 200 });
}

Deno.test('readResponseSample enforces max byte bound', async () => {
    const response = createChunkedResponse([
        'a'.repeat(5000),
        'b'.repeat(5000),
    ]);

    const sample = await readResponseSample(response, 8192);
    assertEquals(sample.length, 8192);
    assertEquals(sample.slice(0, 1), 'a');
    assertEquals(sample.slice(-1), 'b');
});

Deno.test('readResponseSample returns entire payload when shorter than limit', async () => {
    const response = createChunkedResponse(['line1\nline2\nline3']);
    const sample = await readResponseSample(response, 8192);
    assertEquals(sample, 'line1\nline2\nline3');
});

Deno.test('readResponseSample returns empty string when response has no body', async () => {
    const sample = await readResponseSample(new Response(null, { status: 200 }), 8192);
    assertEquals(sample, '');
});
