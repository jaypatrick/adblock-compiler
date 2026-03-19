import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AuditLogComponent } from './audit-log.component';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_AUDIT_RESPONSE = { success: true, items: [], total: 0, limit: 25, offset: 0 };

function makeEntry(overrides: Partial<{
    id: number; actor_id: string; actor_email: string | null; action: string;
    resource_type: string; resource_id: string | null; old_values: unknown; new_values: unknown;
    ip_address: string | null; status: string; created_at: string;
}> = {}) {
    return {
        id: 1,
        actor_id: 'actor-1',
        actor_email: 'admin@example.com',
        action: 'create',
        resource_type: 'role',
        resource_id: 'role-42',
        old_values: null,
        new_values: { role_name: 'editor' },
        ip_address: '127.0.0.1',
        status: 'success',
        created_at: '2024-01-01T00:00:00Z',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AuditLogComponent', () => {
    let fixture: ComponentFixture<AuditLogComponent>;
    let component: AuditLogComponent;
    let httpTesting: HttpTestingController;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [AuditLogComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(AuditLogComponent);
        component = fixture.componentInstance;
        httpTesting = TestBed.inject(HttpTestingController);
        fixture.detectChanges();
        // Drain afterNextRender HTTP calls
        httpTesting.match(() => true).forEach(r => r.flush(EMPTY_AUDIT_RESPONSE));
    });

    afterEach(() => httpTesting.verify());

    // -----------------------------------------------------------------------
    // Baseline
    // -----------------------------------------------------------------------

    it('should create the component', () => {
        expect(component).toBeTruthy();
    });

    it('should start with correct default signal values', () => {
        expect(component.auditLogs()).toEqual([]);
        expect(component.loading()).toBe(false);
        expect(component.totalCount()).toBe(0);
        expect(component.pageIndex()).toBe(0);
    });

    it('should expose the expected filter default values', () => {
        expect(component.filterActor).toBe('');
        expect(component.filterAction).toBe('');
        expect(component.filterResourceType).toBe('');
        expect(component.filterDateFrom).toBe('');
        expect(component.filterDateTo).toBe('');
    });

    // -----------------------------------------------------------------------
    // loadData()
    // -----------------------------------------------------------------------

    describe('loadData()', () => {
        it('populates auditLogs and totalCount on success', () => {
            const entry = makeEntry();
            component.loadData();

            const req = httpTesting.expectOne(r => r.url.includes('/admin/system/audit'));
            expect(req.request.method).toBe('GET');
            req.flush({ success: true, items: [entry], total: 1, limit: 25, offset: 0 });

            expect(component.auditLogs()).toEqual([entry]);
            expect(component.totalCount()).toBe(1);
            expect(component.loading()).toBe(false);
        });

        it('sets loading true while in-flight', () => {
            component.loadData();
            expect(component.loading()).toBe(true);
            httpTesting.expectOne(r => r.url.includes('/admin/system/audit')).flush(EMPTY_AUDIT_RESPONSE);
        });

        it('clears logs and totalCount on HTTP error', () => {
            component.auditLogs.set([makeEntry()]);
            component.loadData();
            httpTesting
                .expectOne(r => r.url.includes('/admin/system/audit'))
                .flush('Server Error', { status: 500, statusText: 'Server Error' });

            expect(component.auditLogs()).toEqual([]);
            expect(component.totalCount()).toBe(0);
            expect(component.loading()).toBe(false);
        });

        it('sends limit and offset params based on pageIndex', () => {
            component.pageIndex.set(2);
            component.loadData();

            const req = httpTesting.expectOne(r => r.url.includes('/admin/system/audit'));
            expect(req.request.params.get('limit')).toBe('25');
            expect(req.request.params.get('offset')).toBe('50');
            req.flush(EMPTY_AUDIT_RESPONSE);
        });

        it('includes actor param when filterActor is set', () => {
            component.filterActor = 'alice@example.com';
            component.loadData();

            const req = httpTesting.expectOne(r => r.url.includes('/admin/system/audit'));
            expect(req.request.params.get('actor')).toBe('alice@example.com');
            req.flush(EMPTY_AUDIT_RESPONSE);
        });

        it('includes action param when filterAction is set', () => {
            component.filterAction = 'delete';
            component.loadData();

            const req = httpTesting.expectOne(r => r.url.includes('/admin/system/audit'));
            expect(req.request.params.get('action')).toBe('delete');
            req.flush(EMPTY_AUDIT_RESPONSE);
        });

        it('includes resource_type param when filterResourceType is set', () => {
            component.filterResourceType = 'role';
            component.loadData();

            const req = httpTesting.expectOne(r => r.url.includes('/admin/system/audit'));
            expect(req.request.params.get('resource_type')).toBe('role');
            req.flush(EMPTY_AUDIT_RESPONSE);
        });

        it('includes from/to date params when both date filters are set', () => {
            component.filterDateFrom = '2024-01-01';
            component.filterDateTo = '2024-12-31';
            component.loadData();

            const req = httpTesting.expectOne(r => r.url.includes('/admin/system/audit'));
            expect(req.request.params.get('from')).toBe('2024-01-01');
            expect(req.request.params.get('to')).toBe('2024-12-31');
            req.flush(EMPTY_AUDIT_RESPONSE);
        });

        it('omits optional params when filters are blank', () => {
            component.loadData();
            const req = httpTesting.expectOne(r => r.url.includes('/admin/system/audit'));
            expect(req.request.params.has('actor')).toBe(false);
            expect(req.request.params.has('action')).toBe(false);
            expect(req.request.params.has('resource_type')).toBe(false);
            expect(req.request.params.has('from')).toBe(false);
            expect(req.request.params.has('to')).toBe(false);
            req.flush(EMPTY_AUDIT_RESPONSE);
        });
    });

    // -----------------------------------------------------------------------
    // applyFilters()
    // -----------------------------------------------------------------------

    describe('applyFilters()', () => {
        it('resets pageIndex to 0 and reloads data', () => {
            component.pageIndex.set(4);
            component.applyFilters();

            expect(component.pageIndex()).toBe(0);
            httpTesting.expectOne(r => r.url.includes('/admin/system/audit')).flush(EMPTY_AUDIT_RESPONSE);
        });
    });

    // -----------------------------------------------------------------------
    // resetFilters()
    // -----------------------------------------------------------------------

    describe('resetFilters()', () => {
        it('clears all filters, resets pageIndex, and reloads', () => {
            component.filterActor = 'bob';
            component.filterAction = 'create';
            component.filterResourceType = 'user';
            component.filterDateFrom = '2024-01-01';
            component.filterDateTo = '2024-12-31';
            component.pageIndex.set(3);

            component.resetFilters();

            expect(component.filterActor).toBe('');
            expect(component.filterAction).toBe('');
            expect(component.filterResourceType).toBe('');
            expect(component.filterDateFrom).toBe('');
            expect(component.filterDateTo).toBe('');
            expect(component.pageIndex()).toBe(0);

            const req = httpTesting.expectOne(r => r.url.includes('/admin/system/audit'));
            expect(req.request.params.has('actor')).toBe(false);
            req.flush(EMPTY_AUDIT_RESPONSE);
        });
    });

    // -----------------------------------------------------------------------
    // onPage()
    // -----------------------------------------------------------------------

    describe('onPage()', () => {
        it('updates pageIndex and triggers loadData', () => {
            component.onPage({ pageIndex: 3, pageSize: 25, length: 200 });
            expect(component.pageIndex()).toBe(3);

            httpTesting.expectOne(r => r.url.includes('/admin/system/audit')).flush(EMPTY_AUDIT_RESPONSE);
        });
    });

    // -----------------------------------------------------------------------
    // exportLogs()
    // -----------------------------------------------------------------------

    describe('exportLogs()', () => {
        it('calls URL.createObjectURL and URL.revokeObjectURL without HTTP requests', () => {
            component.auditLogs.set([makeEntry()]);

            // Capture original before mocking to avoid infinite recursion
            const originalCreateElement = document.createElement.bind(document);
            const clickSpy = vi.fn();
            const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
            const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
            vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
                if (tag === 'a') {
                    const anchor = originalCreateElement('a');
                    anchor.click = clickSpy;
                    return anchor;
                }
                return originalCreateElement(tag);
            });

            component.exportLogs();

            expect(createObjectURLSpy).toHaveBeenCalledOnce();
            expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:fake-url');
            expect(clickSpy).toHaveBeenCalledOnce();

            vi.restoreAllMocks();
        });

        it('does not throw when auditLogs is empty', () => {
            component.auditLogs.set([]);
            const originalCreateElement = document.createElement.bind(document);
            vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:url');
            vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
            vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
                if (tag === 'a') {
                    const anchor = originalCreateElement('a');
                    anchor.click = vi.fn();
                    return anchor;
                }
                return originalCreateElement(tag);
            });

            expect(() => component.exportLogs()).not.toThrow();

            vi.restoreAllMocks();
        });
    });
});
