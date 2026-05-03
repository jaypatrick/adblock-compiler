import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PLATFORM_ID, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ApiDocsComponent } from './api-docs.component';
import { API_BASE_URL } from '../tokens';

describe('ApiDocsComponent', () => {
    describe('on browser platform', () => {
        let fixture: ComponentFixture<ApiDocsComponent>;
        let component: ApiDocsComponent;
        let httpTesting: HttpTestingController;

        beforeEach(async () => {
            await TestBed.configureTestingModule({
                imports: [ApiDocsComponent, NoopAnimationsModule],
                providers: [
                    provideZonelessChangeDetection(),
                    provideHttpClient(),
                    provideHttpClientTesting(),
                    { provide: API_BASE_URL, useValue: '/api' },
                    { provide: PLATFORM_ID, useValue: 'browser' },
                ],
            }).compileComponents();

            fixture = TestBed.createComponent(ApiDocsComponent);
            component = fixture.componentInstance;
            httpTesting = TestBed.inject(HttpTestingController);

            // Trigger initial change detection so httpResource fires its first request,
            // then flush it so no pending requests leak into tests or afterEach verify.
            fixture.detectChanges();
            httpTesting.match('/api/version').forEach(req => req.flush({
                name: 'bloqr-backend', version: '0.0.0',
            }));
        });

        afterEach(() => {
            httpTesting.verify();
            TestBed.resetTestingModule();
        });

        it('should create', () => {
            expect(component).toBeTruthy();
        });

        it('should have 7 endpoint groups', () => {
            expect(component.endpointGroups.length).toBe(7);
        });

        it('should have Compilation group with 7 endpoints', () => {
            const compilation = component.endpointGroups.find(g => g.title === 'Compilation');
            expect(compilation).toBeTruthy();
            expect(compilation!.endpoints.length).toBe(7);
        });

        it('should have Monitoring group', () => {
            const monitoring = component.endpointGroups.find(g => g.title === 'Monitoring');
            expect(monitoring).toBeTruthy();
        });

        it('should have Validation group with 2 endpoints', () => {
            const validation = component.endpointGroups.find(g => g.title === 'Validation');
            expect(validation).toBeTruthy();
            expect(validation!.endpoints.length).toBe(2);
            expect(validation!.endpoints[0].method).toBe('POST');
        });

        it('should mark admin endpoints as requiring auth', () => {
            const admin = component.endpointGroups.find(g => g.title.includes('Admin'));
            expect(admin).toBeTruthy();
            admin!.endpoints.forEach(ep => {
                expect(ep.auth).toBe(true);
            });
        });

        it('should have an example request with expected shape', () => {
            expect(component.exampleRequest.configuration).toBeTruthy();
            expect(component.exampleRequest.configuration.sources.length).toBe(1);
            expect(component.exampleRequest.benchmark).toBe(true);
        });

        it('should render the page heading', () => {
            const el: HTMLElement = fixture.nativeElement;
            expect(el.querySelector('h1')?.textContent).toContain('API Reference');
        });
    });

    describe('on server platform (SSR / prerender)', () => {
        let fixture: ComponentFixture<ApiDocsComponent>;
        let component: ApiDocsComponent;
        let httpTesting: HttpTestingController;

        beforeEach(async () => {
            await TestBed.configureTestingModule({
                imports: [ApiDocsComponent, NoopAnimationsModule],
                providers: [
                    provideZonelessChangeDetection(),
                    provideHttpClient(),
                    provideHttpClientTesting(),
                    { provide: API_BASE_URL, useValue: '/api' },
                    { provide: PLATFORM_ID, useValue: 'server' },
                ],
            }).compileComponents();

            fixture = TestBed.createComponent(ApiDocsComponent);
            component = fixture.componentInstance;
            httpTesting = TestBed.inject(HttpTestingController);

            // Trigger initial change detection to mirror browser behavior and
            // ensure SSR tests verify behavior after the first CD cycle.
            fixture.detectChanges();
        });

        afterEach(() => {
            httpTesting.verify();
            TestBed.resetTestingModule();
        });

        it('should create without throwing', () => {
            expect(component).toBeTruthy();
        });

        it('should not request /api/version during prerender', () => {
            httpTesting.expectNone('/api/version');
        });

        it('versionResource should remain idle on the server', () => {
            expect(component.versionResource.isLoading()).toBe(false);
            expect(component.versionResource.value()).toBeUndefined();
        });
    });
});
