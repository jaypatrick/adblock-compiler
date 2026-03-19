import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { FeatureFlagsComponent } from './feature-flags.component';

const mockFlag = {
    id: 1,
    flag_name: 'enable_new_feature',
    enabled: true,
    rollout_percentage: 100,
    target_tiers: ['pro', 'enterprise'],
    target_users: ['user_1', 'user_2'],
    description: 'Enables the new feature',
    created_by: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
};

const mockListResponse = {
    success: true,
    items: [mockFlag],
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

describe('FeatureFlagsComponent', () => {
    let fixture: ComponentFixture<FeatureFlagsComponent>;
    let component: FeatureFlagsComponent;
    let httpTesting: HttpTestingController;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [FeatureFlagsComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(FeatureFlagsComponent);
        component = fixture.componentInstance;
        httpTesting = TestBed.inject(HttpTestingController);
        fixture.detectChanges();
        // Flush the initial GET triggered by afterNextRender
        httpTesting.expectOne('/admin/config/feature-flags').flush(emptyListResponse);
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
        expect(el.textContent).toContain('Feature Flags');
    });

    it('should start with empty flags after initial load', () => {
        expect(component.flags().length).toBe(0);
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

    it('should have deletingFlag null initially', () => {
        expect(component.deletingFlag()).toBeNull();
    });

    // ── loadData() ─────────────────────────────────────────────────────────────

    it('loadData() populates flags on success', () => {
        component.loadData();
        httpTesting.expectOne('/admin/config/feature-flags').flush(mockListResponse);
        expect(component.flags().length).toBe(1);
        expect(component.flags()[0].flag_name).toBe('enable_new_feature');
    });

    it('loadData() sets loading true while in-flight', () => {
        component.loadData();
        expect(component.loading()).toBe(true);
        httpTesting.expectOne('/admin/config/feature-flags').flush(emptyListResponse);
    });

    it('loadData() sets loading false after success', () => {
        component.loadData();
        httpTesting.expectOne('/admin/config/feature-flags').flush(mockListResponse);
        expect(component.loading()).toBe(false);
    });

    it('loadData() clears flags and sets loading false on HTTP error', () => {
        component.flags.set([mockFlag]);
        component.loadData();
        httpTesting.expectOne('/admin/config/feature-flags').flush('Error', {
            status: 500,
            statusText: 'Internal Server Error',
        });
        expect(component.flags().length).toBe(0);
        expect(component.loading()).toBe(false);
    });

    it('loadData() handles multiple flags', () => {
        const second = { ...mockFlag, id: 2, flag_name: 'flag_two' };
        component.loadData();
        httpTesting.expectOne('/admin/config/feature-flags').flush({ ...emptyListResponse, items: [mockFlag, second], total: 2 });
        expect(component.flags().length).toBe(2);
    });

    // ── Dialog open / close ────────────────────────────────────────────────────

    it('openCreateDialog() sets dialogMode to "create"', () => {
        component.openCreateDialog();
        expect(component.dialogMode()).toBe('create');
    });

    it('openCreateDialog() clears editingFlagId', () => {
        component.editingFlagId.set(5);
        component.openCreateDialog();
        expect(component.editingFlagId()).toBeNull();
    });

    it('openCreateDialog() resets formData to defaults', () => {
        component.formData.flag_name = 'old_flag';
        component.formData.enabled = true;
        component.openCreateDialog();
        expect(component.formData.flag_name).toBe('');
        expect(component.formData.enabled).toBe(false);
        expect(component.formData.rollout_percentage).toBe(100);
    });

    it('openEditDialog() sets dialogMode to "edit"', () => {
        component.openEditDialog(mockFlag);
        expect(component.dialogMode()).toBe('edit');
    });

    it('openEditDialog() populates formData from the given flag', () => {
        const flag = { ...mockFlag, flag_name: 'my_flag', description: 'My desc', enabled: false, rollout_percentage: 50 };
        component.openEditDialog(flag);
        expect(component.formData.flag_name).toBe('my_flag');
        expect(component.formData.description).toBe('My desc');
        expect(component.formData.enabled).toBe(false);
        expect(component.formData.rollout_percentage).toBe(50);
    });

    it('openEditDialog() copies target_tiers array', () => {
        component.openEditDialog({ ...mockFlag, target_tiers: ['pro'] });
        expect(component.formData.target_tiers).toEqual(['pro']);
    });

    it('openEditDialog() joins target_users into a comma-separated string', () => {
        component.openEditDialog({ ...mockFlag, target_users: ['user_1', 'user_2'] });
        expect(component.formData.target_users).toBe('user_1, user_2');
    });

    it('openEditDialog() sets editingFlagId', () => {
        component.openEditDialog({ ...mockFlag, id: 77 });
        expect(component.editingFlagId()).toBe(77);
    });

    it('closeDialog() sets dialogMode to null', () => {
        component.dialogMode.set('create');
        component.closeDialog();
        expect(component.dialogMode()).toBeNull();
    });

    // ── Delete confirm dialog ──────────────────────────────────────────────────

    it('openDeleteConfirm() sets deletingFlag', () => {
        component.openDeleteConfirm(mockFlag);
        expect(component.deletingFlag()).toBe(mockFlag);
    });

    it('closeDeleteConfirm() clears deletingFlag', () => {
        component.deletingFlag.set(mockFlag);
        component.closeDeleteConfirm();
        expect(component.deletingFlag()).toBeNull();
    });

    // ── saveFlag() – create mode ───────────────────────────────────────────────

    it('saveFlag() in create mode sends POST to /admin/config/feature-flags', () => {
        component.dialogMode.set('create');
        component.formData = { flag_name: 'new_flag', description: 'Desc', enabled: true, rollout_percentage: 100, target_tiers: [], target_users: '' };
        component.saveFlag();
        const req = httpTesting.expectOne('/admin/config/feature-flags');
        expect(req.request.method).toBe('POST');
        req.flush({ success: true });
        httpTesting.expectOne('/admin/config/feature-flags').flush(emptyListResponse);
    });

    it('saveFlag() in create mode sends correct flag_name in payload', () => {
        component.dialogMode.set('create');
        component.formData = { flag_name: 'my_feature', description: '', enabled: false, rollout_percentage: 50, target_tiers: ['pro'], target_users: 'u1, u2' };
        component.saveFlag();
        const req = httpTesting.expectOne('/admin/config/feature-flags');
        expect(req.request.body.flag_name).toBe('my_feature');
        expect(req.request.body.rollout_percentage).toBe(50);
        expect(req.request.body.target_tiers).toEqual(['pro']);
        req.flush({ success: true });
        httpTesting.expectOne('/admin/config/feature-flags').flush(emptyListResponse);
    });

    it('saveFlag() in create mode splits target_users on comma', () => {
        component.dialogMode.set('create');
        component.formData = { flag_name: 'f', description: '', enabled: false, rollout_percentage: 100, target_tiers: [], target_users: 'user_1, user_2' };
        component.saveFlag();
        const req = httpTesting.expectOne('/admin/config/feature-flags');
        expect(req.request.body.target_users).toEqual(['user_1', 'user_2']);
        req.flush({ success: true });
        httpTesting.expectOne('/admin/config/feature-flags').flush(emptyListResponse);
    });

    it('saveFlag() in create mode sets saving true then false on success', () => {
        component.dialogMode.set('create');
        component.saveFlag();
        expect(component.saving()).toBe(true);
        httpTesting.expectOne('/admin/config/feature-flags').flush({ success: true });
        expect(component.saving()).toBe(false);
        httpTesting.expectOne('/admin/config/feature-flags').flush(emptyListResponse);
    });

    it('saveFlag() in create mode closes dialog on success', () => {
        component.dialogMode.set('create');
        component.saveFlag();
        httpTesting.expectOne('/admin/config/feature-flags').flush({ success: true });
        expect(component.dialogMode()).toBeNull();
        httpTesting.expectOne('/admin/config/feature-flags').flush(emptyListResponse);
    });

    it('saveFlag() in create mode calls loadData() after success', () => {
        component.dialogMode.set('create');
        component.saveFlag();
        httpTesting.expectOne('/admin/config/feature-flags').flush({ success: true });
        const reload = httpTesting.expectOne('/admin/config/feature-flags');
        expect(reload.request.method).toBe('GET');
        reload.flush(emptyListResponse);
    });

    it('saveFlag() in create mode sets saving false on error', () => {
        component.dialogMode.set('create');
        component.saveFlag();
        httpTesting.expectOne('/admin/config/feature-flags').flush('Error', { status: 500, statusText: 'Server Error' });
        expect(component.saving()).toBe(false);
    });

    it('saveFlag() in create mode keeps dialog open on error', () => {
        component.dialogMode.set('create');
        component.saveFlag();
        httpTesting.expectOne('/admin/config/feature-flags').flush('Error', { status: 500, statusText: 'Server Error' });
        expect(component.dialogMode()).toBe('create');
    });

    // ── saveFlag() – edit mode ─────────────────────────────────────────────────

    it('saveFlag() in edit mode sends PATCH to /admin/config/feature-flags/{id}', () => {
        component.dialogMode.set('edit');
        component.editingFlagId.set(5);
        component.formData = { flag_name: 'f', description: 'D', enabled: true, rollout_percentage: 75, target_tiers: [], target_users: '' };
        component.saveFlag();
        const req = httpTesting.expectOne('/admin/config/feature-flags/5');
        expect(req.request.method).toBe('PATCH');
        req.flush({ success: true });
        httpTesting.expectOne('/admin/config/feature-flags').flush(emptyListResponse);
    });

    it('saveFlag() in edit mode closes dialog on success', () => {
        component.dialogMode.set('edit');
        component.editingFlagId.set(1);
        component.saveFlag();
        httpTesting.expectOne('/admin/config/feature-flags/1').flush({ success: true });
        expect(component.dialogMode()).toBeNull();
        httpTesting.expectOne('/admin/config/feature-flags').flush(emptyListResponse);
    });

    it('saveFlag() in edit mode sets saving false on HTTP error', () => {
        component.dialogMode.set('edit');
        component.editingFlagId.set(1);
        component.saveFlag();
        httpTesting.expectOne('/admin/config/feature-flags/1').flush('Error', { status: 400, statusText: 'Bad Request' });
        expect(component.saving()).toBe(false);
    });

    it('saveFlag() in edit mode keeps dialog open on error', () => {
        component.dialogMode.set('edit');
        component.editingFlagId.set(1);
        component.saveFlag();
        httpTesting.expectOne('/admin/config/feature-flags/1').flush('Error', { status: 500, statusText: 'Server Error' });
        expect(component.dialogMode()).toBe('edit');
    });

    // ── toggleFlag() ───────────────────────────────────────────────────────────

    it('toggleFlag() sends PATCH with enabled payload', () => {
        component.flags.set([mockFlag]);
        component.toggleFlag(mockFlag, false);
        const req = httpTesting.expectOne(`/admin/config/feature-flags/${mockFlag.id}`);
        expect(req.request.method).toBe('PATCH');
        expect(req.request.body).toEqual({ enabled: false });
        req.flush({ success: true });
    });

    it('toggleFlag() updates the flag in the list on success', () => {
        component.flags.set([{ ...mockFlag, enabled: true }]);
        component.toggleFlag(mockFlag, false);
        httpTesting.expectOne(`/admin/config/feature-flags/${mockFlag.id}`).flush({ success: true });
        expect(component.flags()[0].enabled).toBe(false);
    });

    it('toggleFlag() enables the flag when true is passed', () => {
        const disabled = { ...mockFlag, enabled: false };
        component.flags.set([disabled]);
        component.toggleFlag(disabled, true);
        httpTesting.expectOne(`/admin/config/feature-flags/${disabled.id}`).flush({ success: true });
        expect(component.flags()[0].enabled).toBe(true);
    });

    it('toggleFlag() does not mutate the list on HTTP error', () => {
        component.flags.set([{ ...mockFlag, enabled: true }]);
        component.toggleFlag(mockFlag, false);
        httpTesting.expectOne(`/admin/config/feature-flags/${mockFlag.id}`).flush('Error', {
            status: 500,
            statusText: 'Server Error',
        });
        expect(component.flags()[0].enabled).toBe(true);
    });

    // ── confirmDelete() ────────────────────────────────────────────────────────

    it('confirmDelete() sends DELETE to /admin/config/feature-flags/{id}', () => {
        component.deletingFlag.set(mockFlag);
        component.confirmDelete();
        const req = httpTesting.expectOne(`/admin/config/feature-flags/${mockFlag.id}`);
        expect(req.request.method).toBe('DELETE');
        req.flush({ success: true });
        httpTesting.expectOne('/admin/config/feature-flags').flush(emptyListResponse);
    });

    it('confirmDelete() clears deletingFlag on success', () => {
        component.deletingFlag.set(mockFlag);
        component.confirmDelete();
        httpTesting.expectOne(`/admin/config/feature-flags/${mockFlag.id}`).flush({ success: true });
        expect(component.deletingFlag()).toBeNull();
        httpTesting.expectOne('/admin/config/feature-flags').flush(emptyListResponse);
    });

    it('confirmDelete() calls loadData() after success', () => {
        component.deletingFlag.set(mockFlag);
        component.confirmDelete();
        httpTesting.expectOne(`/admin/config/feature-flags/${mockFlag.id}`).flush({ success: true });
        const reload = httpTesting.expectOne('/admin/config/feature-flags');
        expect(reload.request.method).toBe('GET');
        reload.flush(emptyListResponse);
    });

    it('confirmDelete() sets saving false on HTTP error', () => {
        component.deletingFlag.set(mockFlag);
        component.confirmDelete();
        httpTesting.expectOne(`/admin/config/feature-flags/${mockFlag.id}`).flush('Error', {
            status: 500,
            statusText: 'Server Error',
        });
        expect(component.saving()).toBe(false);
    });

    it('confirmDelete() does nothing when deletingFlag is null', () => {
        component.deletingFlag.set(null);
        component.confirmDelete();
        httpTesting.expectNone('/admin/config/feature-flags/1');
    });
});
