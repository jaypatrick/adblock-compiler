import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MetricsStore } from './metrics.store';

describe('MetricsStore', () => {
    describe('on browser platform', () => {
        let store: MetricsStore;
        let httpMock: HttpTestingController;

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

            // Flush initial SWR fetches triggered on browser init
            httpMock.match('/api/metrics').forEach(r =>
                r.flush({ totalRequests: 100, averageDuration: 50, cacheHitRate: 80, successRate: 99 }),
            );
            httpMock.match('/api/health').forEach(r =>
                r.flush({ status: 'healthy', version: '1.0' }),
            );
            httpMock.match('/api/queue/stats').forEach(r =>
                r.flush({ depth: 0, processed: 0, failed: 0, depthHistory: [] }),
            );
        });

        afterEach(() => httpMock.verify());

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
            expect(store.isLoading).toBeDefined();
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

    describe('on server platform (SSR / prerender)', () => {
        let store: MetricsStore;
        let httpMock: HttpTestingController;

        beforeEach(() => {
            TestBed.configureTestingModule({
                providers: [
                    provideZonelessChangeDetection(),
                    provideHttpClient(),
                    provideHttpClientTesting(),
                    { provide: PLATFORM_ID, useValue: 'server' },
                ],
            });
            store = TestBed.inject(MetricsStore);
            httpMock = TestBed.inject(HttpTestingController);
        });

        afterEach(() => httpMock.verify());

        it('should be created', () => {
            expect(store).toBeTruthy();
        });

        it('should not fetch /api/metrics during prerender', () => {
            httpMock.expectNone('/api/metrics');
        });

        it('should not fetch /api/health during prerender', () => {
            httpMock.expectNone('/api/health');
        });

        it('should not fetch /api/queue/stats during prerender', () => {
            httpMock.expectNone('/api/queue/stats');
        });

        it('should return undefined for all data signals', () => {
            expect(store.metrics()).toBeUndefined();
            expect(store.health()).toBeUndefined();
            expect(store.queueStats()).toBeUndefined();
        });

        it('should report isLoading as false on the server', () => {
            expect(store.isLoading()).toBe(false);
        });

        it('should report isStale as false on the server', () => {
            expect(store.isStale()).toBe(false);
        });

        it('should expose no-op revalidation methods', () => {
            expect(() => store.refresh()).not.toThrow();
            expect(() => store.refreshMetrics()).not.toThrow();
            expect(() => store.refreshHealth()).not.toThrow();
            expect(() => store.refreshQueue()).not.toThrow();
        });
    });
});

describe('MetricsStore — server platform (SSR/prerender)', () => {
    let store: MetricsStore;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: PLATFORM_ID, useValue: 'server' },
            ],
        });
        store = TestBed.inject(MetricsStore);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    it('should be created on server without errors', () => {
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

    it('should return undefined metrics on server', () => {
        expect(store.metrics()).toBeUndefined();
    });

    it('should return undefined health on server', () => {
        expect(store.health()).toBeUndefined();
    });

    it('should return undefined queueStats on server', () => {
        expect(store.queueStats()).toBeUndefined();
    });

    it('should report isLoading as false on server', () => {
        expect(store.isLoading()).toBe(false);
    });

    it('should report isStale as false on server', () => {
        expect(store.isStale()).toBe(false);
    });

    it('should expose a refresh method that is a no-op on server', () => {
        expect(() => store.refresh()).not.toThrow();
    });
});
