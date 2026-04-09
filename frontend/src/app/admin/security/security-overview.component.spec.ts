import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { SecurityOverviewComponent } from './security-overview.component';

// Minimal valid SecurityOverviewResponse used across tests
const makeOverviewResponse = (overrides: Partial<{
    total_security_events: number;
    denied: number;
    failure: number;
    analytics_engine_configured: boolean;
}> = {}) => ({
    success: true as const,
    timestamp: '2024-01-01T00:00:00Z',
    window: '24h' as const,
    total_security_events: overrides.total_security_events ?? 0,
    by_status: { denied: overrides.denied ?? 0, failure: overrides.failure ?? 0 },
    by_action: [],
    by_resource_type: [],
    recent_events: [],
    analytics_engine_tracked_events: ['auth_failure', 'rate_limit', 'turnstile_rejection'],
    analytics_engine_configured: overrides.analytics_engine_configured ?? false,
});

describe('SecurityOverviewComponent', () => {
    let fixture: ComponentFixture<SecurityOverviewComponent>;
    let component: SecurityOverviewComponent;
    let httpTesting: HttpTestingController;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [SecurityOverviewComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(SecurityOverviewComponent);
        component = fixture.componentInstance;
        httpTesting = TestBed.inject(HttpTestingController);
        fixture.detectChanges();
        // Drain the afterNextRender loadData() call
        httpTesting.match(() => true).forEach(r => r.flush(makeOverviewResponse()));
        fixture.detectChanges();
    });

    afterEach(() => httpTesting.verify());

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should render the header card with title "Security Overview"', () => {
        expect(fixture.nativeElement.textContent).toContain('Security Overview');
    });

    it('should render the Analytics Engine section', () => {
        expect(fixture.nativeElement.textContent).toContain('Real-Time Threat Telemetry');
    });

    // ── loadData() ────────────────────────────────────────────────────────────
    describe('loadData()', () => {
        it('sets loading to true while in flight', () => {
            component.loadData();
            expect(component.loading()).toBe(true);
            httpTesting.expectOne(r => r.url.includes('/api/admin/security/overview')).flush(makeOverviewResponse());
        });

        it('populates overview signal and stops loading on success', () => {
            const payload = makeOverviewResponse({ total_security_events: 42, denied: 10, failure: 32, analytics_engine_configured: true });
            component.loadData();
            httpTesting.expectOne(r => r.url.includes('/api/admin/security/overview')).flush(payload);

            expect(component.loading()).toBe(false);
            expect(component.overview()!.total_security_events).toBe(42);
            expect(component.overview()!.by_status.denied).toBe(10);
            expect(component.overview()!.by_status.failure).toBe(32);
            expect(component.overview()!.analytics_engine_configured).toBe(true);
        });

        it('clears overview and stops loading on HTTP error', () => {
            component.loadData();
            httpTesting.expectOne(r => r.url.includes('/api/admin/security/overview'))
                .flush('Server Error', { status: 500, statusText: 'Server Error' });

            expect(component.loading()).toBe(false);
            expect(component.overview()).toBeNull();
        });

        it('sends the selected time window as a query param', () => {
            component.selectedWindow = '7d';
            component.loadData();
            const req = httpTesting.expectOne(r => r.url.includes('/api/admin/security/overview'));
            expect(req.request.url).toContain('window=7d');
            req.flush(makeOverviewResponse());
        });

        it('sends 30d window when selectedWindow is "30d"', () => {
            component.selectedWindow = '30d';
            component.loadData();
            const req = httpTesting.expectOne(r => r.url.includes('/api/admin/security/overview'));
            expect(req.request.url).toContain('window=30d');
            req.flush(makeOverviewResponse());
        });
    });

    // ── getBarWidth() ─────────────────────────────────────────────────────────
    describe('getBarWidth()', () => {
        it('returns 100 for the max value in the dataset', () => {
            const dataset = [{ count: 50 }, { count: 100 }, { count: 25 }];
            expect(component.getBarWidth(100, dataset)).toBe(100);
        });

        it('returns 50 for half the max value', () => {
            const dataset = [{ count: 100 }, { count: 50 }];
            expect(component.getBarWidth(50, dataset)).toBe(50);
        });

        it('returns 100 for a single-element dataset', () => {
            expect(component.getBarWidth(10, [{ count: 10 }])).toBe(100);
        });

        it('returns 100 when the dataset is empty (max defaults to 1)', () => {
            expect(component.getBarWidth(1, [])).toBe(100);
        });
    });

    // ── getEventDescription() ─────────────────────────────────────────────────
    describe('getEventDescription()', () => {
        it('returns a description for auth_failure', () => {
            expect(component.getEventDescription('auth_failure')).toContain('Authentication');
        });

        it('returns a description for rate_limit', () => {
            expect(component.getEventDescription('rate_limit')).toContain('rate limit');
        });

        it('falls back to the event type string for unknown types', () => {
            expect(component.getEventDescription('unknown_type')).toBe('unknown_type');
        });
    });

    // ── getEventIcon() ────────────────────────────────────────────────────────
    describe('getEventIcon()', () => {
        it('returns lock_person for auth_failure', () => {
            expect(component.getEventIcon('auth_failure')).toBe('lock_person');
        });

        it('returns security as fallback for unknown event types', () => {
            expect(component.getEventIcon('totally_unknown')).toBe('security');
        });
    });

    // ── AE event chips ────────────────────────────────────────────────────────
    describe('Analytics Engine chips', () => {
        it('renders a chip for each tracked event type', () => {
            component.loadData();
            httpTesting.expectOne(r => r.url.includes('/api/admin/security/overview')).flush(
                makeOverviewResponse({ analytics_engine_configured: true }),
            );
            fixture.detectChanges();
            // 3 events in the stub response
            const chips = fixture.nativeElement.querySelectorAll('mat-chip');
            expect(chips.length).toBeGreaterThanOrEqual(3);
        });
    });
});
