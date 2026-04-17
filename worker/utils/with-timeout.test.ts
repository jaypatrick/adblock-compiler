import { assertEquals } from '@std/assert';
import { FakeTime } from '@std/testing/time';
import { withTimeout } from './with-timeout.ts';

Deno.test('withTimeout returns wrapped value when promise resolves before timeout', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 100);
    assertEquals(result, 'ok');
});

Deno.test('withTimeout resolves to void when timeout wins', async () => {
    const fakeTime = new FakeTime();
    try {
        const never = new Promise<string>(() => {});
        const timed = withTimeout(never, 50);
        await fakeTime.tickAsync(51);
        const result = await timed;
        assertEquals(result, undefined);
    } finally {
        fakeTime.restore();
    }
});

Deno.test('withTimeout does not leak timer when promise settles first', async () => {
    const fakeTime = new FakeTime();
    try {
        const timed = withTimeout(
            new Promise<string>((resolve) => setTimeout(() => resolve('done'), 10)),
            100,
        );
        await fakeTime.tickAsync(11);
        const result = await timed;
        assertEquals(result, 'done');
    } finally {
        fakeTime.restore();
    }
});
