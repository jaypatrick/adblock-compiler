import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { HomeComponent } from './home.component';
import { API_BASE_URL } from '../tokens';

describe('HomeComponent', () => {
    let fixture: ComponentFixture<HomeComponent>;
    let component: HomeComponent;
    let httpTesting: HttpTestingController;

    /** Flush the initial MetricsStore HTTP requests so signals settle. */
    function flushPendingRequests(opts: { status?: 'healthy' | 'degraded' | 'unhealthy' } = {}): void {
        const status = opts.status ?? 'healthy';
        httpTesting.match('/api/metrics').forEach(req =>
            req.flush({ totalRequests: 100, averageDuration: 45.5, cacheHitRate: 85, successRate: 98 }),
        );
        httpTesting.match('/api/health').forEach(req =>
            req.flush({ status, version: '1.2.3' }),
        );
        httpTesting.match('/api/queue/stats').forEach(req =>
            req.flush({ currentDepth: 3, pending: 2, completed: 50, failed: 1, processingRate: 5, lag: 0, depthHistory: [] }),
        );
    }

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [HomeComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideRouter([]),
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: API_BASE_URL, useValue: '/api' },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(HomeComponent);
        component = fixture.componentInstance;
        httpTesting = TestBed.inject(HttpTestingController);

        flushPendingRequests();
        await fixture.whenStable();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        httpTesting.verify();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should have 6 navigation cards', () => {
        expect(component.navCards.length).toBe(6);
    });

    it('should include Compiler card', () => {
        const card = component.navCards.find(c => c.path === '/compiler');
        expect(card).toBeTruthy();
        expect(card!.label).toContain('Compiler');
    });

    it('should include Admin card with warn tag', () => {
        const card = component.navCards.find(c => c.path === '/admin');
        expect(card).toBeTruthy();
        expect(card!.tag).toBe('Admin');
    });

    it('should derive live stats from metrics', () => {
        const stats = component.liveStats();
        expect(stats.totalRequests).toContain('100');
        expect(stats.avgDuration).toContain('45.5');
        expect(stats.cacheHitRate).toContain('85.0%');
        expect(stats.successRate).toContain('98.0%');
    });

    it('should navigate when navigateTo is called', async () => {
        const router = TestBed.inject(Router);
        const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
        component.navigateTo('/compiler');
        expect(navigateSpy).toHaveBeenCalledWith(['/compiler']);
    });

    it('should open absolute external URLs in a new tab via window.open', () => {
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        component.navigateTo('https://docs.example.com/', true);
        expect(openSpy).toHaveBeenCalledWith('https://docs.example.com/', '_blank', 'noopener,noreferrer');
    });

    it('should open worker-handled relative paths in a new tab when external flag is true', () => {
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        component.navigateTo('/admin', true);
        expect(openSpy).toHaveBeenCalledWith('/admin', '_blank', 'noopener,noreferrer');
    });

    it('should NOT call window.open for internal paths without external flag', async () => {
        const router = TestBed.inject(Router);
        const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        component.navigateTo('/performance');
        expect(openSpy).not.toHaveBeenCalled();
        expect(navigateSpy).toHaveBeenCalledWith(['/performance']);
    });

    it('should navigate to performance on stat card click for Total Requests', async () => {
        const router = TestBed.inject(Router);
        const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
        component.onStatCardClicked('Total Requests');
        expect(navigateSpy).toHaveBeenCalledWith(['/performance']);
    });

    it('should navigate to performance on stat card click for Avg Response Time', async () => {
        const router = TestBed.inject(Router);
        const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
        component.onStatCardClicked('Avg Response Time');
        expect(navigateSpy).toHaveBeenCalledWith(['/performance']);
    });

    it('should not navigate for non-metric stat card clicks', async () => {
        const router = TestBed.inject(Router);
        const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
        component.onStatCardClicked('Cache Hit Rate');
        expect(navigateSpy).not.toHaveBeenCalled();
    });

    it('should show default health icon when no data', async () => {
        // After the flush in beforeEach, health is 'healthy'
        expect(component.healthIcon()).toBe('check_circle');
    });

    it('should show default health color when no data', async () => {
        // After the flush in beforeEach, health is 'healthy'
        expect(component.healthColor()).toBe('var(--app-success, #4caf50)');
    });

    it('should render the page heading', async () => {
        await fixture.whenStable();
        fixture.detectChanges();
        const h1 = fixture.nativeElement.querySelector('h1');
        expect(h1?.textContent).toContain('Bloqr Dashboard');
    });
});

