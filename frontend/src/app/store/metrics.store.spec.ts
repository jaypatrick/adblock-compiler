import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, provideZonelessChangeDetection, REQUEST } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MetricsStore } from './metrics.store';

/** Flush all three SWR fetches that MetricsStore starts on initialization. */
function flushInitialRequests(httpMock: HttpTestingController): void {
    httpMock.match('/api/metrics').forEach(r =>
        r.flush({ totalRequests: 100, averageDuration: 50, cacheHitRate: 80, successRate: 99 }),
    );
    httpMock.match('/api/health').forEach(r =>
        r.flush({ status: 'healthy', version: '1.0' }),
    );
    httpMock.match('/api/queue/stats').forEach(r =>
        r.flush({ depth: 0, processing: 0, completed: 0, failed: 0, depthHistory: [] }),
    );
}

describe('MetricsStore', () => {
    let store: MetricsStore;
    let httpMock: HttpTestingController;

    describe('browser platform', () => {
        beforeEach(() => {
            TestBed.configureTestingModule({
                providers: [
                    provideZonelessChangeDetection(),
                    provideHttpClient(),
                    provideHttpClientTesting(),
                    { provide: PLATFORM_ID, useValue: 'browser' },
                ],
            });
            store = TestBed.inject(MetricsStore);
            httpMock = TestBed.inject(HttpTestingController);
        });

        afterEach(() => httpMock.verify());

        it('should be created', () => {
            expect(store).toBeTruthy();
            flushInitialRequests(httpMock);
        });

        it('should expose metrics signal', () => {
            expect(store.metrics).toBeDefined();
            flushInitialRequests(httpMock);
        });

        it('should expose health signal', () => {
            expect(store.health).toBeDefined();
            flushInitialRequests(httpMock);
        });

        it('should be loading before initial fetches complete', () => {
            // SWR starts loading immediately — signal is true before fetches complete
            expect(store.isLoading()).toBe(true);
            flushInitialRequests(httpMock);
        });

        it('should expose isStale signal', () => {
            expect(store.isStale).toBeDefined();
            flushInitialRequests(httpMock);
        });

        it('should have a refresh method', () => {
            expect(typeof store.refresh).toBe('function');
            flushInitialRequests(httpMock);
        });

        it('should have refreshMetrics method', () => {
            expect(typeof store.refreshMetrics).toBe('function');
            flushInitialRequests(httpMock);
        });

        it('should have refreshHealth method', () => {
            expect(typeof store.refreshHealth).toBe('function');
            flushInitialRequests(httpMock);
        });
    });

    describe('prerender (server platform, no REQUEST token)', () => {
        beforeEach(() => {
            TestBed.configureTestingModule({
                providers: [
                    provideZonelessChangeDetection(),
                    provideHttpClient(),
                    provideHttpClientTesting(),
                    { provide: PLATFORM_ID, useValue: 'server' },
                    // REQUEST intentionally omitted — simulates build-time prerender
                ],
            });
            store = TestBed.inject(MetricsStore);
            httpMock = TestBed.inject(HttpTestingController);
        });

        afterEach(() => httpMock.verify());

        it('should be created with inert stubs', () => {
            expect(store).toBeTruthy();
        });

        it('should make no HTTP requests to /api/metrics during prerender', () => {
            httpMock.expectNone('/api/metrics');
        });

        it('should make no HTTP requests to /api/health during prerender', () => {
            httpMock.expectNone('/api/health');
        });

        it('should make no HTTP requests to /api/queue/stats during prerender', () => {
            httpMock.expectNone('/api/queue/stats');
        });

        it('should expose undefined metrics signal (no data during prerender)', () => {
            expect(store.metrics()).toBeUndefined();
        });

        it('should not be revalidating during prerender', () => {
            expect(store.isLoading()).toBe(false);
        });

        it('should not be stale during prerender', () => {
            expect(store.isStale()).toBe(false);
        });
    });

    describe('SSR per-request (server platform, REQUEST token present)', () => {
        beforeEach(() => {
            TestBed.configureTestingModule({
                providers: [
                    provideZonelessChangeDetection(),
                    provideHttpClient(),
                    provideHttpClientTesting(),
                    { provide: PLATFORM_ID, useValue: 'server' },
                    // REQUEST present — simulates RenderMode.Server per-request SSR
                    { provide: REQUEST, useValue: new Request('https://example.workers.dev/') },
                ],
            });
            store = TestBed.inject(MetricsStore);
            httpMock = TestBed.inject(HttpTestingController);
            // Flush all three SWR fetches so no pending requests leak between tests
            flushInitialRequests(httpMock);
        });

        afterEach(() => httpMock.verify());

        it('should be created', () => {
            expect(store).toBeTruthy();
        });

        it('should have initiated SWR fetches for metrics on SSR per-request render', () => {
            // Requests were flushed in beforeEach with real data; signal reflects flushed value
            expect(store.metrics()?.totalRequests).toBe(100);
        });

        it('should have initiated SWR fetches for health on SSR per-request render', () => {
            expect(store.health()?.status).toBe('healthy');
        });

        it('should have initiated SWR fetches for queue stats on SSR per-request render', () => {
            expect(store.queueStats()?.depth).toBe(0);
        });

        it('should settle to not-loading after initial fetches complete', () => {
            // Fetches were flushed in beforeEach; microtasks have resolved by test body
            expect(store.isLoading()).toBe(false);
        });
    });
});
