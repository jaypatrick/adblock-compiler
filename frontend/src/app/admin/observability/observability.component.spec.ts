import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ObservabilityComponent } from './observability.component';

describe('ObservabilityComponent', () => {
    let fixture: ComponentFixture<ObservabilityComponent>;
    let component: ObservabilityComponent;
    let httpTesting: HttpTestingController;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ObservabilityComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ObservabilityComponent);
        component = fixture.componentInstance;
        httpTesting = TestBed.inject(HttpTestingController);
        fixture.detectChanges();
        // Drain any afterNextRender HTTP calls (loadMetrics, loadLogs, loadHealth)
        httpTesting.match(() => true).forEach(r => r.flush({ success: true, items: [], total: 0 }));
    });

    afterEach(() => httpTesting.verify());

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should render mat-card', () => {
        expect(fixture.nativeElement.querySelector('mat-card')).toBeTruthy();
    });

    it('should render panel title', () => {
        expect(fixture.nativeElement.textContent).toContain('Observability');
    });

    // ── loadMetrics() ────────────────────────────────────────────────────────
    describe('loadMetrics()', () => {
        it('sets metricsLoading to true while the request is in flight', () => {
            component.loadMetrics();
            expect(component.metricsLoading()).toBe(true);
            httpTesting.expectOne('/admin/observability/metrics').flush({
                success: true, totalRequests: 0, errorRate: 0, avgLatencyMs: 0, activeUsers: 0,
            });
        });

        it('populates metrics signal and sets metricsAvailable on success', () => {
            component.loadMetrics();
            httpTesting.expectOne('/admin/observability/metrics').flush({
                success: true,
                totalRequests: 1234,
                errorRate: 2.5,
                avgLatencyMs: 45,
                activeUsers: 88,
            });

            expect(component.metricsAvailable()).toBe(true);
            expect(component.metricsLoading()).toBe(false);
            expect(component.metrics()!.totalRequests).toBe(1234);
            expect(component.metrics()!.errorRate).toBe(2.5);
            expect(component.metrics()!.activeUsers).toBe(88);
        });

        it('sets metricsAvailable to false and stops loading on HTTP error', () => {
            component.loadMetrics();
            httpTesting.expectOne('/admin/observability/metrics')
                .flush('Server Error', { status: 500, statusText: 'Server Error' });

            expect(component.metricsAvailable()).toBe(false);
            expect(component.metricsLoading()).toBe(false);
        });

        it('sets metricsAvailable to false on 404 (Analytics Engine not configured)', () => {
            component.loadMetrics();
            httpTesting.expectOne('/admin/observability/metrics')
                .flush('Not Found', { status: 404, statusText: 'Not Found' });

            expect(component.metricsAvailable()).toBe(false);
        });
    });

    // ── loadLogs() ───────────────────────────────────────────────────────────
    describe('loadLogs()', () => {
        it('sets logsLoading to true while the request is in flight', () => {
            component.loadLogs();
            expect(component.logsLoading()).toBe(true);
            httpTesting.expectOne('/admin/observability/logs')
                .flush({ success: true, items: [], total: 0 });
        });

        it('populates allLogs and filteredLogs on success', () => {
            const items = [
                { timestamp: '2024-01-01T00:00:00Z', level: 'info',  message: 'Started',  trace_id: null },
                { timestamp: '2024-01-01T00:00:01Z', level: 'error', message: 'Crashed',  trace_id: 'trace-1' },
            ];
            component.loadLogs();
            httpTesting.expectOne('/admin/observability/logs')
                .flush({ success: true, items, total: 2 });

            expect(component.logsAvailable()).toBe(true);
            expect(component.logsLoading()).toBe(false);
            expect(component.allLogs().length).toBe(2);
            expect(component.filteredLogs().length).toBe(2);
        });

        it('sets logsAvailable to false and clears arrays on HTTP error', () => {
            component.loadLogs();
            httpTesting.expectOne('/admin/observability/logs')
                .flush('Not Found', { status: 404, statusText: 'Not Found' });

            expect(component.logsAvailable()).toBe(false);
            expect(component.logsLoading()).toBe(false);
            expect(component.allLogs().length).toBe(0);
            expect(component.filteredLogs().length).toBe(0);
        });
    });

    // ── applyLogFilter() ─────────────────────────────────────────────────────
    describe('applyLogFilter()', () => {
        const logItems = [
            { timestamp: 't1', level: 'info',  message: 'Info msg',  trace_id: null },
            { timestamp: 't2', level: 'error', message: 'Error msg', trace_id: 'abc' },
            { timestamp: 't3', level: 'debug', message: 'Debug msg', trace_id: null },
            { timestamp: 't4', level: 'error', message: 'Error 2',   trace_id: 'def' },
        ];

        beforeEach(() => {
            component.loadLogs();
            httpTesting.expectOne('/admin/observability/logs')
                .flush({ success: true, items: logItems, total: logItems.length });
        });

        it('shows all logs when logLevel is "all"', () => {
            component.logLevel = 'all';
            component.applyLogFilter();
            expect(component.filteredLogs().length).toBe(4);
        });

        it('filters to only the matching level', () => {
            component.logLevel = 'error';
            component.applyLogFilter();
            expect(component.filteredLogs().length).toBe(2);
            expect(component.filteredLogs().every(l => l.level === 'error')).toBe(true);
        });

        it('returns empty array when no logs match the selected level', () => {
            component.logLevel = 'fatal';
            component.applyLogFilter();
            expect(component.filteredLogs().length).toBe(0);
        });

        it('switches back to all entries when level is reset to "all"', () => {
            component.logLevel = 'info';
            component.applyLogFilter();
            expect(component.filteredLogs().length).toBe(1);

            component.logLevel = 'all';
            component.applyLogFilter();
            expect(component.filteredLogs().length).toBe(4);
        });
    });

    // ── loadHealth() ─────────────────────────────────────────────────────────
    describe('loadHealth()', () => {
        it('sets healthLoading to true while the request is in flight', () => {
            component.loadHealth();
            expect(component.healthLoading()).toBe(true);
            httpTesting.expectOne('/health').flush({ success: true, checks: [] });
        });

        it('populates healthChecks from the response on success', () => {
            const checks = [
                { service: 'Worker',      status: 'healthy',  latencyMs: 10, message: null },
                { service: 'D1 Database', status: 'degraded', latencyMs: 90, message: 'High load' },
            ];
            component.loadHealth();
            httpTesting.expectOne('/health').flush({ success: true, checks });

            expect(component.healthLoading()).toBe(false);
            expect(component.healthChecks().length).toBe(2);
            expect(component.healthChecks()[0].service).toBe('Worker');
            expect(component.healthChecks()[1].status).toBe('degraded');
        });

        it('uses empty checks array when response has no checks field', () => {
            component.loadHealth();
            httpTesting.expectOne('/health').flush({ success: true });

            expect(component.healthChecks().length).toBe(0);
        });

        it('falls back to four "unknown" placeholder checks on HTTP error', () => {
            component.loadHealth();
            httpTesting.expectOne('/health')
                .flush('Service Unavailable', { status: 503, statusText: 'Service Unavailable' });

            expect(component.healthLoading()).toBe(false);
            expect(component.healthChecks().length).toBe(4);
            expect(component.healthChecks().every(c => c.status === 'unknown')).toBe(true);
        });
    });
});
