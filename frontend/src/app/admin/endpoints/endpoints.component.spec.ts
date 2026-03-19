import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { EndpointsComponent } from './endpoints.component';

/** Minimal registry endpoint factory. */
function makeEndpoint(overrides: { path?: string; method?: string; tags?: string[] } = {}) {
    return {
        path: overrides.path ?? '/api/test',
        method: overrides.method ?? 'GET',
        operationId: 'opId',
        summary: 'A summary',
        description: '',
        tags: overrides.tags ?? [],
        security: [],
        parameterCount: 0,
        hasRequestBody: false,
    };
}

describe('EndpointsComponent', () => {
    let fixture: ComponentFixture<EndpointsComponent>;
    let component: EndpointsComponent;
    let httpTesting: HttpTestingController;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [EndpointsComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(EndpointsComponent);
        component = fixture.componentInstance;
        httpTesting = TestBed.inject(HttpTestingController);
        fixture.detectChanges();
        // Drain any afterNextRender HTTP calls (loadData → /assets/endpoint-registry.json)
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
        expect(fixture.nativeElement.textContent).toContain('Endpoint Auth');
    });

    it('should start with zero endpoints', () => {
        expect(component.allEndpoints().length).toBe(0);
        expect(component.totalEndpoints()).toBe(0);
    });

    // ── loadData() ───────────────────────────────────────────────────────────
    describe('loadData()', () => {
        it('sets loading to true while the request is in flight', () => {
            component.loadData();
            expect(component.loading()).toBe(true);
            httpTesting.expectOne('/assets/endpoint-registry.json')
                .flush({ generatedAt: '', specVersion: '', endpoints: [] });
        });

        it('populates allEndpoints and totalEndpoints on success', () => {
            const endpoints = [
                makeEndpoint({ path: '/api/foo', method: 'GET' }),
                makeEndpoint({ path: '/api/bar', method: 'POST' }),
            ];
            component.loadData();
            httpTesting.expectOne('/assets/endpoint-registry.json')
                .flush({ generatedAt: '2024-01-01', specVersion: '1.0', endpoints });

            expect(component.loading()).toBe(false);
            expect(component.allEndpoints().length).toBe(2);
            expect(component.totalEndpoints()).toBe(2);
        });

        it('leaves allEndpoints empty on HTTP error', () => {
            component.loadData();
            httpTesting.expectOne('/assets/endpoint-registry.json')
                .flush('Not Found', { status: 404, statusText: 'Not Found' });

            expect(component.loading()).toBe(false);
            expect(component.allEndpoints().length).toBe(0);
        });

        it('leaves allEndpoints empty when registry has no endpoints field', () => {
            component.loadData();
            httpTesting.expectOne('/assets/endpoint-registry.json')
                .flush({ generatedAt: '', specVersion: '' });

            expect(component.allEndpoints().length).toBe(0);
        });
    });

    // ── computed filters ──────────────────────────────────────────────────────
    describe('filteredEndpoints computed (set filters before loading)', () => {
        const endpoints = [
            makeEndpoint({ path: '/admin/foo',  method: 'GET',    tags: ['admin']  }),
            makeEndpoint({ path: '/public/bar', method: 'POST',   tags: ['public'] }),
            makeEndpoint({ path: '/admin/baz',  method: 'DELETE', tags: ['admin']  }),
        ];

        it('filterPath narrows results to matching paths', () => {
            component.filterPath = '/admin';
            component.loadData();
            httpTesting.expectOne('/assets/endpoint-registry.json')
                .flush({ generatedAt: '', specVersion: '', endpoints });
            expect(component.filteredEndpoints().length).toBe(2);
        });

        it('filterTag narrows results to matching tag', () => {
            component.filterTag = 'public';
            component.loadData();
            httpTesting.expectOne('/assets/endpoint-registry.json')
                .flush({ generatedAt: '', specVersion: '', endpoints });
            expect(component.filteredEndpoints().length).toBe(1);
            expect(component.filteredEndpoints()[0].path).toBe('/public/bar');
        });

        it('filterMethod narrows results to matching HTTP method', () => {
            component.filterMethod = 'DELETE';
            component.loadData();
            httpTesting.expectOne('/assets/endpoint-registry.json')
                .flush({ generatedAt: '', specVersion: '', endpoints });
            expect(component.filteredEndpoints().length).toBe(1);
            expect(component.filteredEndpoints()[0].method).toBe('DELETE');
        });

        it('combined filters reduce results further', () => {
            component.filterPath = '/admin';
            component.filterMethod = 'GET';
            component.loadData();
            httpTesting.expectOne('/assets/endpoint-registry.json')
                .flush({ generatedAt: '', specVersion: '', endpoints });
            expect(component.filteredEndpoints().length).toBe(1);
        });

        it('no filters returns all endpoints', () => {
            component.loadData();
            httpTesting.expectOne('/assets/endpoint-registry.json')
                .flush({ generatedAt: '', specVersion: '', endpoints });
            expect(component.filteredEndpoints().length).toBe(3);
        });
    });

    // ── availableTags computed ────────────────────────────────────────────────
    describe('availableTags computed', () => {
        it('returns sorted unique tags from all endpoints', () => {
            component.loadData();
            httpTesting.expectOne('/assets/endpoint-registry.json').flush({
                generatedAt: '',
                specVersion: '',
                endpoints: [
                    makeEndpoint({ tags: ['zoo', 'admin'] }),
                    makeEndpoint({ tags: ['admin', 'public'] }),
                ],
            });
            expect(component.availableTags()).toEqual(['admin', 'public', 'zoo']);
        });
    });

    // ── override editor ───────────────────────────────────────────────────────
    describe('override editor', () => {
        const ep = makeEndpoint({ path: '/api/test', method: 'PUT' });

        it('openOverride sets editingEndpoint and resets all form fields', () => {
            component.overrideTier = 'pro';
            component.overrideScopes = ['admin'];
            component.overridePublic = true;

            component.openOverride(ep);

            expect(component.editingEndpoint()).toEqual(ep);
            expect(component.overrideTier).toBe('');
            expect(component.overrideScopes).toEqual([]);
            expect(component.overridePublic).toBe(false);
        });

        it('closeOverride clears editingEndpoint', () => {
            component.openOverride(ep);
            component.closeOverride();
            expect(component.editingEndpoint()).toBeNull();
        });

        it('toggleScope adds a scope when it is not already present', () => {
            component.overrideScopes = ['compile'];
            component.toggleScope('admin');
            expect(component.overrideScopes).toContain('admin');
            expect(component.overrideScopes).toContain('compile');
        });

        it('toggleScope removes a scope when it is already present', () => {
            component.overrideScopes = ['admin', 'compile'];
            component.toggleScope('admin');
            expect(component.overrideScopes).not.toContain('admin');
            expect(component.overrideScopes).toContain('compile');
        });

        it('saveOverride does nothing when editingEndpoint is null', () => {
            component.editingEndpoint.set(null);
            component.saveOverride();
            // verify() in afterEach confirms no requests were made
        });

        it('saveOverride sets savingOverride during the request', () => {
            component.openOverride(ep);
            component.saveOverride();
            expect(component.savingOverride()).toBe(true);
            httpTesting.expectOne('/admin/config/endpoints/override').flush({ success: true });
        });

        it('saveOverride closes the editor and resets savingOverride on success', () => {
            component.openOverride(ep);
            component.overrideTier = 'pro';
            component.overrideScopes = ['compile', 'admin'];
            component.overridePublic = false;
            component.saveOverride();

            const req = httpTesting.expectOne('/admin/config/endpoints/override');
            expect(req.request.body).toMatchObject({
                path: ep.path,
                method: ep.method,
                required_tier: 'pro',
                required_scopes: ['compile', 'admin'],
                is_public: false,
            });
            req.flush({ success: true });

            expect(component.savingOverride()).toBe(false);
            expect(component.editingEndpoint()).toBeNull();
        });

        it('saveOverride keeps editor open and resets savingOverride on HTTP error', () => {
            component.openOverride(ep);
            component.saveOverride();
            httpTesting.expectOne('/admin/config/endpoints/override')
                .flush('Server Error', { status: 500, statusText: 'Server Error' });

            expect(component.savingOverride()).toBe(false);
            expect(component.editingEndpoint()).not.toBeNull();
        });
    });
});
