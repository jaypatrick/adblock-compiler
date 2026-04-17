/// <reference types="@cloudflare/workers-types" />

import { assertEquals, assertExists } from '@std/assert';
import { WorkflowEvents } from './WorkflowEvents.ts';
import type { WorkflowEventLog } from './types.ts';

class MockKvNamespace {
    private readonly store = new Map<string, string>();
    putCalls = 0;
    lastPutOptions?: KVNamespacePutOptions;
    throwOnGet = false;

    async get<T>(key: string, type?: 'text' | 'json'): Promise<T | string | null> {
        if (this.throwOnGet) {
            throw new Error('KV get failed');
        }
        const value = this.store.get(key);
        if (!value) {
            return null;
        }
        if (type === 'json') {
            return JSON.parse(value) as T;
        }
        return value;
    }

    async put(key: string, value: string, options?: KVNamespacePutOptions): Promise<void> {
        this.putCalls++;
        this.store.set(key, value);
        this.lastPutOptions = options;
    }
}

Deno.test('WorkflowEvents buffers events in memory until flush is called', async () => {
    const kv = new MockKvNamespace();
    const events = new WorkflowEvents(kv as unknown as KVNamespace, 'wf-1', 'compilation');

    await events.emitStepStarted('validate');
    await events.emitSourceFetchStarted('EasyList', 'https://example.com/easylist.txt');

    assertEquals(kv.putCalls, 0);

    await events.flush();

    assertEquals(kv.putCalls, 1);
    assertEquals(kv.lastPutOptions?.expirationTtl, 3600);

    const eventLog = await events.getEvents();
    assertExists(eventLog);
    assertEquals(eventLog.events.length, 2);
    assertEquals(eventLog.events[0].type, 'workflow:step:started');
    assertEquals(eventLog.events[1].type, 'source:fetch:started');
});

Deno.test('WorkflowEvents flushes milestone events immediately for polling visibility', async () => {
    const kv = new MockKvNamespace();
    const events = new WorkflowEvents(kv as unknown as KVNamespace, 'wf-4', 'health-monitoring');

    await events.emitWorkflowStarted({ sourceCount: 5 });
    assertEquals(kv.putCalls, 1);

    await events.emitProgress(10, 'running');
    assertEquals(kv.putCalls, 2);

    await events.emitStepCompleted('load-health-history');
    assertEquals(kv.putCalls, 3);
});

Deno.test('WorkflowEvents flush stores completion timestamp from final terminal event', async () => {
    const kv = new MockKvNamespace();
    const events = new WorkflowEvents(kv as unknown as KVNamespace, 'wf-2', 'compilation');

    await events.emitWorkflowStarted();
    await events.emitWorkflowCompleted({ ruleCount: 123 });
    await events.flush();

    const eventLog = await events.getEvents();
    assertExists(eventLog);
    assertExists(eventLog.completedAt);
    assertEquals(eventLog.completedAt, eventLog.events[eventLog.events.length - 1].timestamp);
});

Deno.test('WorkflowEvents flush derives startedAt from first buffered event timestamp', async () => {
    const kv = new MockKvNamespace();
    const events = new WorkflowEvents(kv as unknown as KVNamespace, 'wf-5', 'compilation');

    await events.emitProgress(5, 'queued');
    await events.flush();

    const eventLog = await events.getEvents();
    assertExists(eventLog);
    assertEquals(eventLog.startedAt, eventLog.events[0].timestamp);
});

Deno.test('WorkflowEvents sets completedAt from terminal event even if followed by non-terminal events', async () => {
    const kv = new MockKvNamespace();
    const events = new WorkflowEvents(kv as unknown as KVNamespace, 'wf-6', 'compilation');

    await events.emit('workflow:completed', { ok: true }, { message: 'done' });
    await events.emitProgress(100, 'post-complete message');
    await events.flush();

    const eventLog = await events.getEvents();
    assertExists(eventLog);
    const completedEvent = eventLog.events.find((event) => event.type === 'workflow:completed');
    assertExists(completedEvent);
    assertEquals(eventLog.completedAt, completedEvent.timestamp);
});

Deno.test('WorkflowEvents flush trims persisted events to the configured maximum', async () => {
    const kv = new MockKvNamespace();
    const events = new WorkflowEvents(kv as unknown as KVNamespace, 'wf-3', 'batch');

    for (let i = 0; i < 105; i++) {
        await events.emitProgress(i, `Progress ${i}`);
    }
    await events.flush();

    const eventLog = await events.getEvents();
    assertExists(eventLog);
    const typedEventLog = eventLog as WorkflowEventLog;
    assertEquals(typedEventLog.events.length, 100);
    assertEquals(typedEventLog.events[0].message, 'Progress 5');
    assertEquals(typedEventLog.events[99].message, 'Progress 104');
});

Deno.test('WorkflowEvents flush swallows KV get errors and retries successfully on next flush', async () => {
    const kv = new MockKvNamespace();
    const events = new WorkflowEvents(kv as unknown as KVNamespace, 'wf-7', 'health-monitoring');

    await events.emitStepStarted('first-step');
    kv.throwOnGet = true;
    await events.flush();
    assertEquals(kv.putCalls, 0);

    kv.throwOnGet = false;
    await events.flush();
    assertEquals(kv.putCalls, 1);

    const eventLog = await events.getEvents();
    assertExists(eventLog);
    assertEquals(eventLog.events.some((event) => event.step === 'first-step'), true);
});
