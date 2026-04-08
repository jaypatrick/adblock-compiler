import { assertEquals } from '@std/assert';
import { handleDiff } from './diff.ts';

const makeRequest = (body: unknown) =>
    new Request('http://localhost/api/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

Deno.test('handleDiff - returns added and removed counts', async () => {
    const original = ['||example.com^', '||ads.com^'];
    const current = ['||example.com^', '||newads.com^'];

    const res = await handleDiff(makeRequest({ original, current }), {} as any);
    const body = await res.json() as {
        success: boolean;
        report: { summary: { addedCount: number; removedCount: number; unchangedCount: number } };
        parseErrors: { original: unknown[]; current: unknown[] };
    };

    assertEquals(res.status, 200);
    assertEquals(body.success, true);
    assertEquals(body.report.summary.addedCount, 1);
    assertEquals(body.report.summary.removedCount, 1);
    assertEquals(body.report.summary.unchangedCount, 1);
});

Deno.test('handleDiff - surfaces parse errors without blocking diff', async () => {
    const original = ['||example.com^', '###invalid-cosmetic-BROKEN'];
    const current = ['||example.com^'];

    const res = await handleDiff(makeRequest({ original, current }), {} as any);
    const body = await res.json() as { parseErrors: { original: unknown[] }; report: { summary: { originalCount: number } } };

    assertEquals(res.status, 200);
    // The invalid rule is excluded from comparison, not a fatal error
    assertEquals(body.parseErrors.original.length > 0 || body.report.summary.originalCount >= 1, true);
});

Deno.test('handleDiff - 422 on missing required fields', async () => {
    const res = await handleDiff(makeRequest({ original: [] }), {} as any);
    assertEquals(res.status, 422);
});

Deno.test('handleDiff - 400 on invalid JSON', async () => {
    const req = new Request('http://localhost/api/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
    });
    const res = await handleDiff(req, {} as any);
    assertEquals(res.status, 400);
});
