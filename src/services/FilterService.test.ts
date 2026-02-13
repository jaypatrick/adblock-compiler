import { assertEquals, assertExists, assertRejects } from '@std/assert';
import { FilterService } from './FilterService.ts';

const mockLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
};

Deno.test('FilterService - should create instance with logger', () => {
    const service = new FilterService(mockLogger);
    assertExists(service);
});

Deno.test('FilterService.downloadAll - should return empty array for empty sources', async () => {
    const service = new FilterService(mockLogger);
    const result = await service.downloadAll([]);
    assertEquals(result, []);
});

Deno.test('FilterService.downloadAll - should return empty array for null/undefined sources', async () => {
    const service = new FilterService(mockLogger);
    // @ts-ignore: Testing null/undefined handling
    const result = await service.downloadAll(null);
    assertEquals(result, []);
});

Deno.test('FilterService.prepareWildcards - should return empty array when no rules or sources', async () => {
    const service = new FilterService(mockLogger);
    const result = await service.prepareWildcards();
    assertEquals(result.length, 0);
});

Deno.test('FilterService.prepareWildcards - should return empty array for empty rules', async () => {
    const service = new FilterService(mockLogger);
    const result = await service.prepareWildcards([]);
    assertEquals(result.length, 0);
});

Deno.test('FilterService.prepareWildcards - should create wildcards from rules', async () => {
    const service = new FilterService(mockLogger);
    const result = await service.prepareWildcards(['*example*', '*test*']);

    assertEquals(result.length, 2);
    // Verify they are Wildcard instances that can test strings
    assertEquals(result[0].test('example.com'), true);
    assertEquals(result[1].test('test.org'), true);
});

Deno.test('FilterService.prepareWildcards - should deduplicate rules', async () => {
    const service = new FilterService(mockLogger);
    const result = await service.prepareWildcards(['*example*', '*example*', '*test*']);

    assertEquals(result.length, 2);
});

Deno.test('FilterService.prepareWildcards - should filter out empty/falsy rules', async () => {
    const service = new FilterService(mockLogger);
    const result = await service.prepareWildcards(['*example*', '', '*test*']);

    assertEquals(result.length, 2);
});

Deno.test('FilterService.prepareWildcards - should handle undefined rules array', async () => {
    const service = new FilterService(mockLogger);
    const result = await service.prepareWildcards(undefined, []);

    assertEquals(result.length, 0);
});

Deno.test('FilterService.prepareWildcards - should handle empty sources array', async () => {
    const service = new FilterService(mockLogger);
    const result = await service.prepareWildcards(['*example*'], []);

    assertEquals(result.length, 1);
});

Deno.test('FilterService.prepareWildcards - wildcards should match correctly', async () => {
    const service = new FilterService(mockLogger);
    const result = await service.prepareWildcards(['||example.org^', '*tracking*']);

    assertEquals(result.length, 2);
    // Test exact match
    assertEquals(result[0].test('||example.org^'), true);
    assertEquals(result[0].test('||other.org^'), false);
    // Test wildcard match
    assertEquals(result[1].test('tracking.example.com'), true);
    assertEquals(result[1].test('safe.example.com'), false);
});

// Error handling tests
Deno.test('FilterService.downloadAll - should propagate errors when download fails', async () => {
    const service = new FilterService(mockLogger);

    // Try to download from a non-existent file
    await assertRejects(
        async () => {
            await service.downloadAll(['/non/existent/file.txt']);
        },
        Error,
        'File not found',
    );
});

Deno.test('FilterService.downloadAll - should propagate network errors', async () => {
    const service = new FilterService(mockLogger);

    // Try to download from an invalid URL (should fail with network error)
    await assertRejects(
        async () => {
            await service.downloadAll(['http://this-domain-does-not-exist-12345.invalid']);
        },
        Error,
    );
});

Deno.test('FilterService.prepareWildcards - should propagate download errors from sources', async () => {
    const service = new FilterService(mockLogger);

    // Try to prepare wildcards with a failing source
    await assertRejects(
        async () => {
            await service.prepareWildcards(['*example*'], ['/non/existent/source.txt']);
        },
        Error,
        'File not found',
    );
});
