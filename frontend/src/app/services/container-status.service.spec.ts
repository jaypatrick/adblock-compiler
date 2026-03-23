import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ContainerStatusService, ContainerStatus } from './container-status.service';
import { API_BASE_URL } from '../tokens';

describe('ContainerStatusService', () => {
    let service: ContainerStatusService;
    let httpTesting: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: API_BASE_URL, useValue: '/api' },
            ],
        });
        service = TestBed.inject(ContainerStatusService);
        httpTesting = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        service.stopPolling();
        // Drain any outstanding requests (e.g. from startWith(0) in interval stream)
        httpTesting.match(() => true).forEach(r =>
            r.flush({ status: 'unavailable', checkedAt: new Date().toISOString() }),
        );
        httpTesting.verify();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should start with status "unknown"', () => {
        expect(service.status().status).toBe('unknown');
    });

    it('fetchOnce() should GET /api/container/status and update status signal', () => {
        const mockStatus: ContainerStatus = {
            status: 'running',
            latencyMs: 12,
            checkedAt: '2026-01-01T00:00:00.000Z',
        };

        service.fetchOnce();

        const req = httpTesting.expectOne('/api/container/status');
        expect(req.request.method).toBe('GET');
        req.flush(mockStatus);

        expect(service.status().status).toBe('running');
        expect(service.status().latencyMs).toBe(12);
    });

    it('fetchOnce() should fall back to "unavailable" on HTTP error', () => {
        service.fetchOnce();

        const req = httpTesting.expectOne('/api/container/status');
        req.error(new ProgressEvent('error'));

        expect(service.status().status).toBe('unavailable');
    });

    it('fetchOnce() should fall back to "unavailable" on Zod validation failure', () => {
        service.fetchOnce();

        const req = httpTesting.expectOne('/api/container/status');
        // Flush with invalid shape (missing required checkedAt)
        req.flush({ status: 'running' });

        expect(service.status().status).toBe('unavailable');
    });

    it('startPolling() should set isPolling to true and fire an immediate request', () => {
        service.startPolling(60000);
        expect(service.isPolling()).toBe(true);

        // startWith(0) fires immediately — drain it
        const req = httpTesting.expectOne('/api/container/status');
        req.flush({ status: 'sleeping', checkedAt: '2026-01-01T00:00:00.000Z' });
        expect(service.status().status).toBe('sleeping');
    });

    it('stopPolling() should set isPolling to false', () => {
        service.startPolling(60000);
        // Drain the immediate request
        httpTesting.expectOne('/api/container/status')
            .flush({ status: 'sleeping', checkedAt: '2026-01-01T00:00:00.000Z' });

        service.stopPolling();
        expect(service.isPolling()).toBe(false);
    });

    it('statusLabel computed — returns correct label for "running"', () => {
        service.fetchOnce();
        httpTesting.expectOne('/api/container/status')
            .flush({ status: 'running', checkedAt: '2026-01-01T00:00:00.000Z' });
        expect(service.statusLabel()).toBe('Container Running');
    });

    it('statusLabel computed — returns correct label for "starting"', () => {
        service.fetchOnce();
        httpTesting.expectOne('/api/container/status')
            .flush({ status: 'starting', checkedAt: '2026-01-01T00:00:00.000Z' });
        expect(service.statusLabel()).toBe('Container Starting…');
    });

    it('statusLabel computed — returns correct label for "sleeping"', () => {
        service.fetchOnce();
        httpTesting.expectOne('/api/container/status')
            .flush({ status: 'sleeping', checkedAt: '2026-01-01T00:00:00.000Z' });
        expect(service.statusLabel()).toBe('Container Sleeping');
    });

    it('isNoteworthyState computed — true for starting', () => {
        service.fetchOnce();
        httpTesting.expectOne('/api/container/status')
            .flush({ status: 'starting', checkedAt: '2026-01-01T00:00:00.000Z' });
        expect(service.isNoteworthyState()).toBe(true);
    });

    it('isNoteworthyState computed — true for sleeping', () => {
        service.fetchOnce();
        httpTesting.expectOne('/api/container/status')
            .flush({ status: 'sleeping', checkedAt: '2026-01-01T00:00:00.000Z' });
        expect(service.isNoteworthyState()).toBe(true);
    });

    it('isNoteworthyState computed — true for error', () => {
        service.fetchOnce();
        httpTesting.expectOne('/api/container/status')
            .flush({ status: 'error', checkedAt: '2026-01-01T00:00:00.000Z' });
        expect(service.isNoteworthyState()).toBe(true);
    });

    it('isNoteworthyState computed — false for "unknown" (initial state)', () => {
        expect(service.isNoteworthyState()).toBe(false);
    });

    it('isNoteworthyState computed — false for "running"', () => {
        service.fetchOnce();
        httpTesting.expectOne('/api/container/status')
            .flush({ status: 'running', checkedAt: '2026-01-01T00:00:00.000Z' });
        expect(service.isNoteworthyState()).toBe(false);
    });

    it('statusColor computed — returns primary for running', () => {
        service.fetchOnce();
        httpTesting.expectOne('/api/container/status')
            .flush({ status: 'running', checkedAt: '2026-01-01T00:00:00.000Z' });
        expect(service.statusColor()).toBe('var(--mat-sys-primary)');
    });
});
