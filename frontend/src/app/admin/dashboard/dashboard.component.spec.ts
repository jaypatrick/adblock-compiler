import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DashboardComponent } from './dashboard.component';

/** Flush all four parallel requests that loadData() fires. */
function flushDashboard(
    httpTesting: HttpTestingController,
    opts: {
        auditItems?: object[];
        auditTotal?: number;
        tiersItems?: object[];
        flagsItems?: object[];
        health?: object;
        auditError?: boolean;
        tiersError?: boolean;
        flagsError?: boolean;
        healthError?: boolean;
    } = {},
): void {
    const {
        auditItems = [], auditTotal, tiersItems = [], flagsItems = [],
        health = {},
        auditError = false, tiersError = false, flagsError = false, healthError = false,
    } = opts;

    const auditReq  = httpTesting.expectOne(r => r.url.includes('/admin/audit-logs'));
    const tiersReq  = httpTesting.expectOne(r => r.url.includes('/admin/config/tiers'));
    const flagsReq  = httpTesting.expectOne(r => r.url.includes('/admin/config/feature-flags'));
    const healthReq = httpTesting.expectOne(r => r.url.includes('/health'));

    if (auditError) {
        auditReq.flush('error', { status: 500, statusText: 'Server Error' });
    } else {
        auditReq.flush({ success: true, items: auditItems, total: auditTotal ?? auditItems.length, limit: 10, offset: 0 });
    }

    if (tiersError) {
        tiersReq.flush('error', { status: 500, statusText: 'Server Error' });
    } else {
        tiersReq.flush({ success: true, items: tiersItems, total: tiersItems.length });
    }

    if (flagsError) {
        flagsReq.flush('error', { status: 500, statusText: 'Server Error' });
    } else {
        flagsReq.flush({ success: true, items: flagsItems, total: flagsItems.length });
    }

    if (healthError) {
        healthReq.flush('error', { status: 503, statusText: 'Service Unavailable' });
    } else {
        healthReq.flush(health);
    }
}

describe('DashboardComponent', () => {
    let fixture: ComponentFixture<DashboardComponent>;
    let component: DashboardComponent;
    let httpTesting: HttpTestingController;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [DashboardComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(DashboardComponent);
        component = fixture.componentInstance;
        httpTesting = TestBed.inject(HttpTestingController);
        fixture.detectChanges();
        // Drain any afterNextRender HTTP calls (4 parallel requests from loadData)
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
        expect(fixture.nativeElement.textContent).toContain('Dashboard');
    });

    // ── loadData() ───────────────────────────────────────────────────────────
    describe('loadData()', () => {
        it('sets loading to true while requests are pending', () => {
            component.loadData();
            expect(component.loading()).toBe(true);
            flushDashboard(httpTesting);
        });

        it('sets loading to false after all four requests complete', () => {
            component.loadData();
            flushDashboard(httpTesting);
            expect(component.loading()).toBe(false);
        });

        it('populates metricCards from tiers and feature-flag responses', () => {
            const tiersItems  = [{ id: 1, tier_name: 'free', is_active: true }, { id: 2, tier_name: 'pro', is_active: true }];
            const flagsItems  = [{ id: 1, enabled: true }, { id: 2, enabled: false }, { id: 3, enabled: true }];

            component.loadData();
            flushDashboard(httpTesting, { tiersItems, flagsItems });

            const cards = component.metricCards();
            expect(cards.length).toBe(4);
            expect(cards.find(c => c.label === 'Active Tiers')?.value).toBe(2);
            expect(cards.find(c => c.label === 'Active Flags')?.value).toBe(2);   // 2 enabled
            expect(cards.find(c => c.label === 'Total Flags')?.value).toBe(3);
        });

        it('populates recentActivity from the audit-log response', () => {
            const auditItems = [
                { id: 1, actor_id: 'u1', actor_email: 'a@b.com', action: 'create', resource_type: 'key', resource_id: 'k1', status: 'success', created_at: '2024-01-01T00:00:00Z' },
                { id: 2, actor_id: 'u2', actor_email: null,       action: 'delete', resource_type: 'flag', resource_id: null, status: 'success', created_at: '2024-01-02T00:00:00Z' },
            ];
            component.loadData();
            flushDashboard(httpTesting, { auditItems, auditTotal: 42 });

            expect(component.recentActivity().length).toBe(2);
            expect(component.recentActivity()[0].action).toBe('create');
            // auditTotal (42) should appear in the Audit Events card
            expect(component.metricCards().find(c => c.label === 'Audit Events')?.value).toBe(42);
        });

        it('maps all-healthy services to green health checks', () => {
            const health = {
                status: 'healthy',
                services: {
                    gateway:  { status: 'healthy' },
                    database: { status: 'healthy', latency_ms: 12 },
                    compiler: { status: 'healthy' },
                    auth:     { status: 'healthy', provider: 'better-auth' },
                    cache:    { status: 'healthy' },
                },
            };
            component.loadData();
            flushDashboard(httpTesting, { health });

            const checks = component.healthChecks();
            expect(checks.every(c => c.status === 'green')).toBe(true);
            expect(checks.find(c => c.label === 'Database')?.detail).toBe('12 ms');
            expect(checks.find(c => c.label === 'Auth Service')?.detail).toBe('Clerk (Active)');
        });

        it('maps degraded services to yellow health checks', () => {
            const health = {
                status: 'degraded',
                services: {
                    gateway:  { status: 'degraded' },
                    database: { status: 'healthy', latency_ms: 5 },
                    compiler: { status: 'degraded' },
                    auth:     { status: 'healthy', provider: 'local' },
                    cache:    { status: 'healthy' },
                },
            };
            component.loadData();
            flushDashboard(httpTesting, { health });

            const checks = component.healthChecks();
            expect(checks.find(c => c.label === 'API Gateway')?.status).toBe('yellow');
            expect(checks.find(c => c.label === 'Compiler Engine')?.status).toBe('yellow');
            expect(checks.find(c => c.label === 'Auth Service')?.detail).toBe('Local JWT (Active)');
        });

        it('maps down services to red health checks', () => {
            const health = {
                status: 'down',
                services: {
                    gateway:  { status: 'down' },
                    database: { status: 'down' },
                    compiler: { status: 'down' },
                    auth:     { status: 'down', provider: 'none' },
                    cache:    { status: 'down' },
                },
            };
            component.loadData();
            flushDashboard(httpTesting, { health });

            const checks = component.healthChecks();
            expect(checks.every(c => c.status === 'red')).toBe(true);
            expect(checks.find(c => c.label === 'Auth Service')?.detail).toBe('Unconfigured');
        });

        it('uses yellow for all checks when health request errors', () => {
            component.loadData();
            flushDashboard(httpTesting, { healthError: true });

            expect(component.healthChecks().every(c => c.status === 'yellow')).toBe(true);
        });

        it('still finalises (loading=false) when audit-log request fails', () => {
            component.loadData();
            flushDashboard(httpTesting, { auditError: true });
            expect(component.loading()).toBe(false);
        });

        it('still finalises when tiers request fails', () => {
            component.loadData();
            flushDashboard(httpTesting, { tiersError: true });
            expect(component.loading()).toBe(false);
        });

        it('still finalises when feature-flags request fails', () => {
            component.loadData();
            flushDashboard(httpTesting, { flagsError: true });
            expect(component.loading()).toBe(false);
        });
    });

    // ── getActionIcon() ───────────────────────────────────────────────────────
    describe('getActionIcon()', () => {
        it.each([
            ['create', 'add_circle'],
            ['update', 'edit'],
            ['delete', 'remove_circle'],
            ['toggle', 'toggle_on'],
            ['login',  'login'],
            ['revoke', 'block'],
        ])('action "%s" → icon "%s"', (action, icon) => {
            expect(component.getActionIcon(action)).toBe(icon);
        });

        it('returns "info" for an unrecognised action', () => {
            expect(component.getActionIcon('something_new')).toBe('info');
        });
    });
});
