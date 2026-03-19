import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { SwrCacheService } from './swr-cache.service';

describe('SwrCacheService', () => {
    let service: SwrCacheService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideZonelessChangeDetection()],
        });
        service = TestBed.inject(SwrCacheService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should fetch data on first call', async () => {
        const fetcher = vi.fn().mockResolvedValue({ value: 42 });
        const entry = service.get('test', fetcher);

        expect(fetcher).toHaveBeenCalled();
        expect(entry.isRevalidating()).toBe(true);

        // Wait for fetch to complete
        await vi.waitFor(() => expect(entry.isRevalidating()).toBe(false));
        expect(entry.data()).toEqual({ value: 42 });
    });

    it('should return stale data while revalidating', async () => {
        let resolveSecond: (v: unknown) => void;
        const fetcher = vi.fn()
            .mockResolvedValueOnce({ value: 1 })
            .mockImplementationOnce(() => new Promise(r => { resolveSecond = r; }));

        const entry = service.get('test2', fetcher, 0); // TTL=0 means always stale
        await vi.waitFor(() => expect(entry.data()).toEqual({ value: 1 }));

        // Revalidate — should still have old data
        entry.revalidate();
        expect(entry.data()).toEqual({ value: 1 });
        expect(entry.isRevalidating()).toBe(true);

        resolveSecond!({ value: 2 });
        await vi.waitFor(() => expect(entry.data()).toEqual({ value: 2 }));
    });

    it('should invalidate cache', async () => {
        const fetcher = vi.fn().mockResolvedValue('data');
        const entry = service.get('inv', fetcher, 60000);
        await vi.waitFor(() => expect(entry.data()).toBe('data'));

        service.invalidate('inv');
        expect(entry.isStale()).toBe(true);
    });

    it('should clear all cache', async () => {
        const fetcher = vi.fn().mockResolvedValue('x');
        service.get('a', fetcher);
        service.get('b', fetcher);

        service.clear();
        // After clear, new get() should create fresh entries
        const entry = service.get('a', vi.fn().mockResolvedValue('y'));
        await vi.waitFor(() => expect(entry.data()).toBe('y'));
    });

    it('should handle fetch errors gracefully', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const fetcher = vi.fn().mockRejectedValue(new Error('fail'));
        const entry = service.get('err', fetcher);

        await vi.waitFor(() => expect(entry.isRevalidating()).toBe(false));
        expect(entry.data()).toBeUndefined();
        consoleSpy.mockRestore();
    });

    it('does not re-fetch when data is within TTL', async () => {
        const fetcher = vi.fn().mockResolvedValue('data');
        const largeTtl = 60_000;

        const entry = service.get('fresh-key', fetcher, largeTtl);
        await vi.waitFor(() => expect(entry.data()).toBe('data'));

        // Second get() with same key and large TTL — isStale() = false, no re-fetch
        service.get('fresh-key', fetcher, largeTtl);

        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('prevents concurrent fetches — revalidate() is a no-op while fetch is in progress', async () => {
        let resolveFetch: (v: unknown) => void;
        const fetcher = vi.fn().mockImplementationOnce(
            () => new Promise(r => { resolveFetch = r; }),
        );

        const entry = service.get('concurrent', fetcher, 0);

        // First fetch is in progress (isRevalidating guard is active)
        expect(entry.isRevalidating()).toBe(true);

        // Second call while revalidating — doFetch guard returns early
        entry.revalidate();

        expect(fetcher).toHaveBeenCalledTimes(1);

        // Resolve the first fetch
        resolveFetch!('data');
        await vi.waitFor(() => expect(entry.data()).toBe('data'));
    });

    it('re-fetches after invalidation forces isStale to true', async () => {
        const fetcher = vi.fn()
            .mockResolvedValueOnce('first')
            .mockResolvedValue('second');

        const entry = service.get('revalidate-key', fetcher, 60_000);
        await vi.waitFor(() => expect(entry.data()).toBe('first'));

        // Reset timestamp to 0 → isStale() returns true
        service.invalidate('revalidate-key');

        // Next get() sees stale data and triggers re-fetch
        const entry2 = service.get('revalidate-key', fetcher, 60_000);
        await vi.waitFor(() => expect(entry2.data()).toBe('second'));
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('invalidate on unknown key does not throw', () => {
        expect(() => service.invalidate('key-that-does-not-exist')).not.toThrow();
    });
});
