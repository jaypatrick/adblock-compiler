import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, provideZonelessChangeDetection, REQUEST, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MetricsStore } from './metrics.store';
import { AuthFacadeService } from '../services/auth-facade.service';

/** Mock AuthFacadeService provider for signed-in users. */
function provideSignedInAuth() {
    return { provide: AuthFacadeService, useValue: { isSignedIn: signal(true) } };
}

/** Mock AuthFacadeService provider for anonymous (signed-out) users. */
function provideAnonymousAuth() {
    return { provide: AuthFacadeService, useValue: { isSignedIn: signal(false) } };
}

/** Flush all three SWR fetches that MetricsStore starts on initialization. */
function flushInitialRequests(httpMock: HttpTestingController): void {
    httpMock.match('/api/metrics').forEach(r =>
        r.flush({ totalRequests: 100, averageDuration: 50, cacheHitRate: 80, successRate: 99 }),
    );
    httpMock.match('/api/health').forEach(r =>
        r.flush({ status: 'healthy', version: '1.0' }),
    );
    httpMock.match('/api/queue/stats').forEach(r =>
        r.flush({ currentDepth: 0, pending: 0, completed: 0, failed: 0, processingRate: 0, lag: 0, depthHistory: [] }),
    );
}

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
                    provideSignedInAuth(),
                ],
            });
            store = TestBed.inject(MetricsStore);
            httpMock = TestBed.inject(HttpTestingController);
            // Flush initial SWR fetches triggered on browser init
            flushInitialRequests(httpMock);
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

    describe('on server platform — prerender (no REQUEST token)', () => {
        let store: MetricsStore;
        let httpMock: HttpTestingController;

        beforeEach(() => {
            TestBed.configureTestingModule({
                providers: [
                    provideZonelessChangeDetection(),
                    provideHttpClient(),
                    provideHttpClientTesting(),
                    { provide: PLATFORM_ID, useValue: 'server' },
                    // REQUEST intentionally omitted — simulates build-time prerender
                    provideSignedInAuth(),
                ],
            });
            store = TestBed.inject(MetricsStore);
            httpMock = TestBed.inject(HttpTestingController);
        });

        afterEach(() => httpMock.verify());

        it('should be created with inert stubs', () => {
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

    describe('on server platform — SSR per-request (REQUEST token present)', () => {
        let store: MetricsStore;
        let httpMock: HttpTestingController;

        beforeEach(() => {
            TestBed.configureTestingModule({
                providers: [
                    provideZonelessChangeDetection(),
                    provideHttpClient(),
                    provideHttpClientTesting(),
                    { provide: PLATFORM_ID, useValue: 'server' },
                    // REQUEST present — simulates RenderMode.Server per-request SSR
                    { provide: REQUEST, useValue: new Request('https://example.workers.dev/') },
                    provideSignedInAuth(),
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
            const stats = store.queueStats();
            expect(stats?.currentDepth).toBe(0);
            expect(stats?.processingRate).toBe(0);
            expect(stats?.lag).toBe(0);
        });

        it('should settle to not-loading after initial fetches complete', () => {
            // Fetches were flushed in beforeEach; microtasks have resolved by test body
            expect(store.isLoading()).toBe(false);
        });
    });

    describe('on browser platform — anonymous (signed-out) user', () => {
        let store: MetricsStore;
        let httpMock: HttpTestingController;

        beforeEach(() => {
            TestBed.configureTestingModule({
                providers: [
                    provideZonelessChangeDetection(),
                    provideHttpClient(),
                    provideHttpClientTesting(),
                    { provide: PLATFORM_ID, useValue: 'browser' },
                    provideAnonymousAuth(),
                ],
            });
            store = TestBed.inject(MetricsStore);
            httpMock = TestBed.inject(HttpTestingController);
            // Flush only the two public SWR fetches (metrics + health)
            httpMock.match('/api/metrics').forEach(r =>
                r.flush({ totalRequests: 0, averageDuration: 0, cacheHitRate: 0, successRate: 0 }),
            );
            httpMock.match('/api/health').forEach(r =>
                r.flush({ status: 'healthy', version: '1.0' }),
            );
        });

        afterEach(() => httpMock.verify());

        it('should not fetch /api/queue/stats when anonymous', () => {
            // /api/queue/stats requires Free tier — anonymous callers must not trigger
            // the request at all to avoid a 401 response and SWR revalidation error.
            httpMock.expectNone('/api/queue/stats');
        });

        it('should expose queueStats as undefined when anonymous', () => {
            expect(store.queueStats()).toBeUndefined();
        });
    });
});
