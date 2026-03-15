import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, provideZonelessChangeDetection, REQUEST } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MetricsStore } from './metrics.store';

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

            // Flush initial SWR fetches
            const metricsReq = httpMock.match('/api/metrics');
            metricsReq.forEach(r => r.flush({ totalRequests: 100, averageDuration: 50, cacheHitRate: 80, successRate: 99 }));
            const healthReq = httpMock.match('/api/health');
            healthReq.forEach(r => r.flush({ status: 'healthy', version: '1.0' }));
        });

        it('should be created', () => {
            expect(store).toBeTruthy();
        });

        it('should expose metrics signal', () => {
            expect(store.metrics).toBeDefined();
        });

        it('should expose health signal', () => {
            expect(store.health).toBeDefined();
        });

        it('should expose isLoading signal', () => {
            expect(store.isLoading()).toBe(true);
        });

        it('should expose isStale signal', () => {
            expect(store.isStale).toBeDefined();
        });

        it('should have a refresh method', () => {
            expect(typeof store.refresh).toBe('function');
        });

        it('should have refreshMetrics method', () => {
            expect(typeof store.refreshMetrics).toBe('function');
        });

        it('should have refreshHealth method', () => {
            expect(typeof store.refreshHealth).toBe('function');
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
        });

        it('should be created', () => {
            expect(store).toBeTruthy();
        });

        it('should initiate SWR fetches for metrics on SSR per-request render', () => {
            // Real SWR is active — at least one request to /api/metrics is expected
            const requests = httpMock.match('/api/metrics');
            expect(requests.length).toBeGreaterThan(0);
            requests.forEach(r => r.flush({ totalRequests: 0, averageDuration: 0, cacheHitRate: 0, successRate: 100 }));
        });

        it('should initiate SWR fetches for health on SSR per-request render', () => {
            const requests = httpMock.match('/api/health');
            expect(requests.length).toBeGreaterThan(0);
            requests.forEach(r => r.flush({ status: 'healthy', version: '1.0' }));
        });
    });
});
