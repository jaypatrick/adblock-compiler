import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ScopesComponent } from './scopes.component';

const mockScope = {
    id: 1,
    scope_name: 'compile:read',
    display_name: 'Read Compilations',
    description: 'Allows reading compiled filter lists',
    required_tier: 'free',
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
};

const mockListResponse = {
    success: true,
    items: [mockScope],
    total: 1,
    limit: 100,
    offset: 0,
};

const emptyListResponse = {
    success: true,
    items: [],
    total: 0,
    limit: 100,
    offset: 0,
};

describe('ScopesComponent', () => {
    let fixture: ComponentFixture<ScopesComponent>;
    let component: ScopesComponent;
    let httpTesting: HttpTestingController;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ScopesComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ScopesComponent);
        component = fixture.componentInstance;
        httpTesting = TestBed.inject(HttpTestingController);
        fixture.detectChanges();
        // Flush the initial GET triggered by afterNextRender
        httpTesting.expectOne('/admin/config/scopes').flush(emptyListResponse);
    });

    afterEach(() => httpTesting.verify());

    // ── Initial state ──────────────────────────────────────────────────────────

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should render mat-card', () => {
        const el: HTMLElement = fixture.nativeElement;
        expect(el.querySelector('mat-card')).toBeTruthy();
    });

    it('should render panel title', () => {
        const el: HTMLElement = fixture.nativeElement;
        expect(el.textContent).toContain('Scope Registry');
    });

    it('should start with empty scopes list after initial load', () => {
        expect(component.scopes().length).toBe(0);
    });

    it('should have loading false after initial load', () => {
        expect(component.loading()).toBe(false);
    });

    it('should have dialogMode null initially', () => {
        expect(component.dialogMode()).toBeNull();
    });

    it('should have saving false initially', () => {
        expect(component.saving()).toBe(false);
    });

    it('should have deletingScope null initially', () => {
        expect(component.deletingScope()).toBeNull();
    });

    // ── loadData() ─────────────────────────────────────────────────────────────

    it('loadData() populates scopes on success', () => {
        component.loadData();
        httpTesting.expectOne('/admin/config/scopes').flush(mockListResponse);
        expect(component.scopes().length).toBe(1);
        expect(component.scopes()[0].scope_name).toBe('compile:read');
    });

    it('loadData() sets loading true while in-flight', () => {
        component.loadData();
        expect(component.loading()).toBe(true);
        httpTesting.expectOne('/admin/config/scopes').flush(emptyListResponse);
    });

    it('loadData() sets loading false after success', () => {
        component.loadData();
        httpTesting.expectOne('/admin/config/scopes').flush(mockListResponse);
        expect(component.loading()).toBe(false);
    });

    it('loadData() clears scopes and sets loading false on HTTP error', () => {
        component.scopes.set([mockScope]);
        component.loadData();
        httpTesting.expectOne('/admin/config/scopes').flush('Error', {
            status: 500,
            statusText: 'Internal Server Error',
        });
        expect(component.scopes().length).toBe(0);
        expect(component.loading()).toBe(false);
    });

    it('loadData() handles multiple scopes', () => {
        const second = { ...mockScope, id: 2, scope_name: 'compile:write' };
        component.loadData();
        httpTesting.expectOne('/admin/config/scopes').flush({ ...emptyListResponse, items: [mockScope, second], total: 2 });
        expect(component.scopes().length).toBe(2);
    });

    // ── Dialog open / close ────────────────────────────────────────────────────

    it('openCreateDialog() sets dialogMode to "create"', () => {
        component.openCreateDialog();
        expect(component.dialogMode()).toBe('create');
    });

    it('openCreateDialog() clears editingScopeName', () => {
        component.editingScopeName.set('compile:read');
        component.openCreateDialog();
        expect(component.editingScopeName()).toBeNull();
    });

    it('openCreateDialog() resets formData to defaults', () => {
        component.formData.scope_name = 'old:scope';
        component.formData.required_tier = 'enterprise';
        component.openCreateDialog();
        expect(component.formData.scope_name).toBe('');
        expect(component.formData.required_tier).toBe('free');
    });

    it('openEditDialog() sets dialogMode to "edit"', () => {
        component.openEditDialog(mockScope);
        expect(component.dialogMode()).toBe('edit');
    });

    it('openEditDialog() populates formData from the given scope', () => {
        const scope = { ...mockScope, scope_name: 'api:admin', display_name: 'Admin API', description: 'Admin access', required_tier: 'enterprise' };
        component.openEditDialog(scope);
        expect(component.formData.scope_name).toBe('api:admin');
        expect(component.formData.display_name).toBe('Admin API');
        expect(component.formData.description).toBe('Admin access');
        expect(component.formData.required_tier).toBe('enterprise');
    });

    it('openEditDialog() sets editingScopeName', () => {
        component.openEditDialog({ ...mockScope, scope_name: 'compile:write' });
        expect(component.editingScopeName()).toBe('compile:write');
    });

    it('closeDialog() sets dialogMode to null', () => {
        component.dialogMode.set('edit');
        component.closeDialog();
        expect(component.dialogMode()).toBeNull();
    });

    // ── Delete confirm dialog ──────────────────────────────────────────────────

    it('openDeleteConfirm() sets deletingScope', () => {
        component.openDeleteConfirm(mockScope);
        expect(component.deletingScope()).toBe(mockScope);
    });

    it('closeDeleteConfirm() clears deletingScope', () => {
        component.deletingScope.set(mockScope);
        component.closeDeleteConfirm();
        expect(component.deletingScope()).toBeNull();
    });

    // ── saveScope() – create mode ──────────────────────────────────────────────

    it('saveScope() in create mode sends POST to /admin/config/scopes', () => {
        component.dialogMode.set('create');
        component.formData = { scope_name: 'new:scope', display_name: 'New Scope', description: 'Desc', required_tier: 'pro' };
        component.saveScope();
        const req = httpTesting.expectOne('/admin/config/scopes');
        expect(req.request.method).toBe('POST');
        req.flush({ success: true });
        httpTesting.expectOne('/admin/config/scopes').flush(emptyListResponse);
    });

    it('saveScope() in create mode sends correct payload', () => {
        component.dialogMode.set('create');
        component.formData = { scope_name: 'read:all', display_name: 'Read All', description: 'Full read access', required_tier: 'starter' };
        component.saveScope();
        const req = httpTesting.expectOne('/admin/config/scopes');
        expect(req.request.body.scope_name).toBe('read:all');
        expect(req.request.body.required_tier).toBe('starter');
        req.flush({ success: true });
        httpTesting.expectOne('/admin/config/scopes').flush(emptyListResponse);
    });

    it('saveScope() in create mode sets saving true then false on success', () => {
        component.dialogMode.set('create');
        component.saveScope();
        expect(component.saving()).toBe(true);
        httpTesting.expectOne('/admin/config/scopes').flush({ success: true });
        expect(component.saving()).toBe(false);
        httpTesting.expectOne('/admin/config/scopes').flush(emptyListResponse);
    });

    it('saveScope() in create mode closes dialog on success', () => {
        component.dialogMode.set('create');
        component.saveScope();
        httpTesting.expectOne('/admin/config/scopes').flush({ success: true });
        expect(component.dialogMode()).toBeNull();
        httpTesting.expectOne('/admin/config/scopes').flush(emptyListResponse);
    });

    it('saveScope() in create mode calls loadData() after success', () => {
        component.dialogMode.set('create');
        component.saveScope();
        httpTesting.expectOne('/admin/config/scopes').flush({ success: true });
        const reload = httpTesting.expectOne('/admin/config/scopes');
        expect(reload.request.method).toBe('GET');
        reload.flush(emptyListResponse);
    });

    it('saveScope() in create mode sets saving false on error', () => {
        component.dialogMode.set('create');
        component.saveScope();
        httpTesting.expectOne('/admin/config/scopes').flush('Error', { status: 500, statusText: 'Server Error' });
        expect(component.saving()).toBe(false);
    });

    it('saveScope() in create mode keeps dialog open on error', () => {
        component.dialogMode.set('create');
        component.saveScope();
        httpTesting.expectOne('/admin/config/scopes').flush('Error', { status: 500, statusText: 'Server Error' });
        expect(component.dialogMode()).toBe('create');
    });

    // ── saveScope() – edit mode ────────────────────────────────────────────────

    it('saveScope() in edit mode sends PATCH to /admin/config/scopes/{scope_name}', () => {
        component.dialogMode.set('edit');
        component.editingScopeName.set('compile:read');
        component.formData = { scope_name: 'compile:read', display_name: 'Updated', description: 'Updated desc', required_tier: 'pro' };
        component.saveScope();
        const req = httpTesting.expectOne('/admin/config/scopes/compile:read');
        expect(req.request.method).toBe('PATCH');
        req.flush({ success: true });
        httpTesting.expectOne('/admin/config/scopes').flush(emptyListResponse);
    });

    it('saveScope() in edit mode sends correct payload', () => {
        component.dialogMode.set('edit');
        component.editingScopeName.set('api:write');
        component.formData = { scope_name: 'api:write', display_name: 'Write API', description: 'Write access', required_tier: 'enterprise' };
        component.saveScope();
        const req = httpTesting.expectOne('/admin/config/scopes/api:write');
        expect(req.request.body.display_name).toBe('Write API');
        expect(req.request.body.required_tier).toBe('enterprise');
        req.flush({ success: true });
        httpTesting.expectOne('/admin/config/scopes').flush(emptyListResponse);
    });

    it('saveScope() in edit mode closes dialog on success', () => {
        component.dialogMode.set('edit');
        component.editingScopeName.set('compile:read');
        component.saveScope();
        httpTesting.expectOne('/admin/config/scopes/compile:read').flush({ success: true });
        expect(component.dialogMode()).toBeNull();
        httpTesting.expectOne('/admin/config/scopes').flush(emptyListResponse);
    });

    it('saveScope() in edit mode sets saving false on HTTP error', () => {
        component.dialogMode.set('edit');
        component.editingScopeName.set('compile:read');
        component.saveScope();
        httpTesting.expectOne('/admin/config/scopes/compile:read').flush('Error', { status: 400, statusText: 'Bad Request' });
        expect(component.saving()).toBe(false);
    });

    it('saveScope() in edit mode keeps dialog open on error', () => {
        component.dialogMode.set('edit');
        component.editingScopeName.set('compile:read');
        component.saveScope();
        httpTesting.expectOne('/admin/config/scopes/compile:read').flush('Error', { status: 500, statusText: 'Server Error' });
        expect(component.dialogMode()).toBe('edit');
    });

    // ── confirmDelete() ────────────────────────────────────────────────────────

    it('confirmDelete() sends DELETE to /admin/config/scopes/{scope_name}', () => {
        component.deletingScope.set(mockScope);
        component.confirmDelete();
        const req = httpTesting.expectOne(`/admin/config/scopes/${mockScope.scope_name}`);
        expect(req.request.method).toBe('DELETE');
        req.flush({ success: true });
        httpTesting.expectOne('/admin/config/scopes').flush(emptyListResponse);
    });

    it('confirmDelete() uses scope_name (not id) in the URL', () => {
        const scope = { ...mockScope, id: 99, scope_name: 'special:scope' };
        component.deletingScope.set(scope);
        component.confirmDelete();
        const req = httpTesting.expectOne('/admin/config/scopes/special:scope');
        expect(req.request.method).toBe('DELETE');
        req.flush({ success: true });
        httpTesting.expectOne('/admin/config/scopes').flush(emptyListResponse);
    });

    it('confirmDelete() clears deletingScope on success', () => {
        component.deletingScope.set(mockScope);
        component.confirmDelete();
        httpTesting.expectOne(`/admin/config/scopes/${mockScope.scope_name}`).flush({ success: true });
        expect(component.deletingScope()).toBeNull();
        httpTesting.expectOne('/admin/config/scopes').flush(emptyListResponse);
    });

    it('confirmDelete() calls loadData() after success', () => {
        component.deletingScope.set(mockScope);
        component.confirmDelete();
        httpTesting.expectOne(`/admin/config/scopes/${mockScope.scope_name}`).flush({ success: true });
        const reload = httpTesting.expectOne('/admin/config/scopes');
        expect(reload.request.method).toBe('GET');
        reload.flush(emptyListResponse);
    });

    it('confirmDelete() sets saving false on HTTP error', () => {
        component.deletingScope.set(mockScope);
        component.confirmDelete();
        httpTesting.expectOne(`/admin/config/scopes/${mockScope.scope_name}`).flush('Error', {
            status: 500,
            statusText: 'Server Error',
        });
        expect(component.saving()).toBe(false);
    });

    it('confirmDelete() does nothing when deletingScope is null', () => {
        component.deletingScope.set(null);
        component.confirmDelete();
        httpTesting.expectNone('/admin/config/scopes/compile:read');
    });
});
