import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, PLATFORM_ID } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MetricsStore } from './metrics.store';

describe('MetricsStore', () => {
    let store: MetricsStore;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
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
