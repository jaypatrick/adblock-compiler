import { assertEquals, assertExists } from '@std/assert';
import { WorkflowEvents } from './WorkflowEvents.ts';
import type { WorkflowEventLog } from './types.ts';

class MockKvNamespace {
    private readonly store = new Map<string, string>();
    putCalls = 0;
    lastPutOptions?: KVNamespacePutOptions;

    async get<T>(key: string, type?: 'text' | 'json'): Promise<T | string | null> {
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

    await events.emitWorkflowStarted({ configName: 'EasyList' });
    await events.emitProgress(25, 'Compiling');

    assertEquals(kv.putCalls, 0);

    await events.flush();

    assertEquals(kv.putCalls, 1);
    assertEquals(kv.lastPutOptions?.expirationTtl, 3600);

    const eventLog = await events.getEvents();
    assertExists(eventLog);
    assertEquals(eventLog.events.length, 2);
    assertEquals(eventLog.events[0].type, 'workflow:started');
    assertEquals(eventLog.events[1].type, 'workflow:progress');
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
