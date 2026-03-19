import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AnnouncementsComponent } from './announcements.component';

const mockAnnouncement = {
    id: 1,
    title: 'Test Announcement',
    body: 'Test body content',
    severity: 'info' as const,
    active_from: null,
    active_until: null,
    is_active: true,
    created_by: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
};

const mockListResponse = {
    success: true,
    items: [mockAnnouncement],
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

describe('AnnouncementsComponent', () => {
    let fixture: ComponentFixture<AnnouncementsComponent>;
    let component: AnnouncementsComponent;
    let httpTesting: HttpTestingController;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [AnnouncementsComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(AnnouncementsComponent);
        component = fixture.componentInstance;
        httpTesting = TestBed.inject(HttpTestingController);
        fixture.detectChanges();
        // Flush the initial GET triggered by afterNextRender
        httpTesting.expectOne('/admin/announcements').flush(emptyListResponse);
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
        expect(el.textContent).toContain('Announcements');
    });

    it('should start with empty announcements list after initial load', () => {
        expect(component.announcements().length).toBe(0);
    });

    it('should have loading false after initial load completes', () => {
        expect(component.loading()).toBe(false);
    });

    it('should have dialogMode null initially', () => {
        expect(component.dialogMode()).toBeNull();
    });

    it('should have saving false initially', () => {
        expect(component.saving()).toBe(false);
    });

    it('should have deletingAnnouncement null initially', () => {
        expect(component.deletingAnnouncement()).toBeNull();
    });

    // ── loadData() ─────────────────────────────────────────────────────────────

    it('loadData() should set announcements on success', () => {
        component.loadData();
        httpTesting.expectOne('/admin/announcements').flush(mockListResponse);
        expect(component.announcements().length).toBe(1);
        expect(component.announcements()[0].title).toBe('Test Announcement');
    });

    it('loadData() should set loading to true while the request is in-flight', () => {
        component.loadData();
        expect(component.loading()).toBe(true);
        httpTesting.expectOne('/admin/announcements').flush(emptyListResponse);
    });

    it('loadData() should set loading to false after success', () => {
        component.loadData();
        httpTesting.expectOne('/admin/announcements').flush(mockListResponse);
        expect(component.loading()).toBe(false);
    });

    it('loadData() should clear announcements and set loading false on HTTP error', () => {
        component.announcements.set([mockAnnouncement]);
        component.loadData();
        httpTesting.expectOne('/admin/announcements').flush('Server Error', {
            status: 500,
            statusText: 'Internal Server Error',
        });
        expect(component.announcements().length).toBe(0);
        expect(component.loading()).toBe(false);
    });

    it('loadData() should populate multiple announcements', () => {
        const second = { ...mockAnnouncement, id: 2, title: 'Second' };
        component.loadData();
        httpTesting.expectOne('/admin/announcements').flush({
            ...emptyListResponse,
            items: [mockAnnouncement, second],
            total: 2,
        });
        expect(component.announcements().length).toBe(2);
    });

    // ── severityIcon() ─────────────────────────────────────────────────────────

    it('severityIcon() returns "info" for info severity', () => {
        expect(component.severityIcon('info')).toBe('info');
    });

    it('severityIcon() returns "warning" for warning severity', () => {
        expect(component.severityIcon('warning')).toBe('warning');
    });

    it('severityIcon() returns "error" for error severity', () => {
        expect(component.severityIcon('error')).toBe('error');
    });

    it('severityIcon() returns "check_circle" for success severity', () => {
        expect(component.severityIcon('success')).toBe('check_circle');
    });

    it('severityIcon() returns "info" for an unknown severity', () => {
        expect(component.severityIcon('unknown')).toBe('info');
    });

    // ── Dialog open / close ────────────────────────────────────────────────────

    it('openCreateDialog() sets dialogMode to "create"', () => {
        component.openCreateDialog();
        expect(component.dialogMode()).toBe('create');
    });

    it('openCreateDialog() clears editingId', () => {
        component.editingId.set(99);
        component.openCreateDialog();
        expect(component.editingId()).toBeNull();
    });

    it('openCreateDialog() resets formData to defaults', () => {
        component.formData.title = 'Old title';
        component.formData.severity = 'error';
        component.openCreateDialog();
        expect(component.formData.title).toBe('');
        expect(component.formData.severity).toBe('info');
        expect(component.formData.is_active).toBe(true);
    });

    it('openEditDialog() sets dialogMode to "edit"', () => {
        component.openEditDialog(mockAnnouncement);
        expect(component.dialogMode()).toBe('edit');
    });

    it('openEditDialog() populates formData from the given announcement', () => {
        const ann = { ...mockAnnouncement, title: 'My Ann', body: 'Body text', severity: 'warning' as const, is_active: false };
        component.openEditDialog(ann);
        expect(component.formData.title).toBe('My Ann');
        expect(component.formData.body).toBe('Body text');
        expect(component.formData.severity).toBe('warning');
        expect(component.formData.is_active).toBe(false);
    });

    it('openEditDialog() sets editingId from the announcement', () => {
        component.openEditDialog({ ...mockAnnouncement, id: 42 });
        expect(component.editingId()).toBe(42);
    });

    it('openEditDialog() converts null active_from to empty string', () => {
        component.openEditDialog({ ...mockAnnouncement, active_from: null });
        expect(component.formData.active_from).toBe('');
    });

    it('openEditDialog() copies a non-null active_from', () => {
        component.openEditDialog({ ...mockAnnouncement, active_from: '2024-06-01' });
        expect(component.formData.active_from).toBe('2024-06-01');
    });

    it('closeDialog() sets dialogMode to null', () => {
        component.dialogMode.set('create');
        component.closeDialog();
        expect(component.dialogMode()).toBeNull();
    });

    // ── Delete confirm dialog ──────────────────────────────────────────────────

    it('openDeleteConfirm() sets deletingAnnouncement', () => {
        component.openDeleteConfirm(mockAnnouncement);
        expect(component.deletingAnnouncement()).toBe(mockAnnouncement);
    });

    it('closeDeleteConfirm() clears deletingAnnouncement', () => {
        component.deletingAnnouncement.set(mockAnnouncement);
        component.closeDeleteConfirm();
        expect(component.deletingAnnouncement()).toBeNull();
    });

    // ── saveAnnouncement() – create mode ───────────────────────────────────────

    it('saveAnnouncement() in create mode sends POST to /admin/announcements', () => {
        component.dialogMode.set('create');
        component.formData = { title: 'New', body: 'Body', severity: 'info', is_active: true, active_from: '', active_until: '' };
        component.saveAnnouncement();
        const req = httpTesting.expectOne('/admin/announcements');
        expect(req.request.method).toBe('POST');
        req.flush({ success: true });
        httpTesting.expectOne('/admin/announcements').flush(emptyListResponse);
    });

    it('saveAnnouncement() in create mode converts empty active_from to null in payload', () => {
        component.dialogMode.set('create');
        component.formData = { title: 'T', body: 'B', severity: 'info', is_active: true, active_from: '', active_until: '' };
        component.saveAnnouncement();
        const req = httpTesting.expectOne('/admin/announcements');
        expect(req.request.body.active_from).toBeNull();
        expect(req.request.body.active_until).toBeNull();
        req.flush({ success: true });
        httpTesting.expectOne('/admin/announcements').flush(emptyListResponse);
    });

    it('saveAnnouncement() in create mode sets saving true then false on success', () => {
        component.dialogMode.set('create');
        component.saveAnnouncement();
        expect(component.saving()).toBe(true);
        httpTesting.expectOne('/admin/announcements').flush({ success: true });
        expect(component.saving()).toBe(false);
        httpTesting.expectOne('/admin/announcements').flush(emptyListResponse);
    });

    it('saveAnnouncement() in create mode closes dialog on success', () => {
        component.dialogMode.set('create');
        component.saveAnnouncement();
        httpTesting.expectOne('/admin/announcements').flush({ success: true });
        expect(component.dialogMode()).toBeNull();
        httpTesting.expectOne('/admin/announcements').flush(emptyListResponse);
    });

    it('saveAnnouncement() in create mode calls loadData() after success', () => {
        component.dialogMode.set('create');
        component.saveAnnouncement();
        httpTesting.expectOne('/admin/announcements').flush({ success: true });
        // The subsequent loadData() GET must be present
        const reload = httpTesting.expectOne('/admin/announcements');
        expect(reload.request.method).toBe('GET');
        reload.flush(emptyListResponse);
    });

    it('saveAnnouncement() in create mode sets saving false on error', () => {
        component.dialogMode.set('create');
        component.saveAnnouncement();
        httpTesting.expectOne('/admin/announcements').flush('Bad Request', { status: 400, statusText: 'Bad Request' });
        expect(component.saving()).toBe(false);
    });

    it('saveAnnouncement() in create mode keeps dialog open on error', () => {
        component.dialogMode.set('create');
        component.saveAnnouncement();
        httpTesting.expectOne('/admin/announcements').flush('Error', { status: 500, statusText: 'Server Error' });
        expect(component.dialogMode()).toBe('create');
    });

    // ── saveAnnouncement() – edit mode ─────────────────────────────────────────

    it('saveAnnouncement() in edit mode sends PATCH to /admin/announcements/{id}', () => {
        component.dialogMode.set('edit');
        component.editingId.set(7);
        component.formData = { title: 'Updated', body: 'Updated body', severity: 'warning', is_active: false, active_from: '', active_until: '' };
        component.saveAnnouncement();
        const req = httpTesting.expectOne('/admin/announcements/7');
        expect(req.request.method).toBe('PATCH');
        req.flush({ success: true });
        httpTesting.expectOne('/admin/announcements').flush(emptyListResponse);
    });

    it('saveAnnouncement() in edit mode sends correct payload', () => {
        component.dialogMode.set('edit');
        component.editingId.set(3);
        component.formData = { title: 'T', body: 'B', severity: 'error', is_active: true, active_from: '2025-01-01', active_until: '2025-12-31' };
        component.saveAnnouncement();
        const req = httpTesting.expectOne('/admin/announcements/3');
        expect(req.request.body.severity).toBe('error');
        expect(req.request.body.active_from).toBe('2025-01-01');
        req.flush({ success: true });
        httpTesting.expectOne('/admin/announcements').flush(emptyListResponse);
    });

    it('saveAnnouncement() in edit mode closes dialog on success', () => {
        component.dialogMode.set('edit');
        component.editingId.set(1);
        component.saveAnnouncement();
        httpTesting.expectOne('/admin/announcements/1').flush({ success: true });
        expect(component.dialogMode()).toBeNull();
        httpTesting.expectOne('/admin/announcements').flush(emptyListResponse);
    });

    it('saveAnnouncement() in edit mode sets saving false on HTTP error', () => {
        component.dialogMode.set('edit');
        component.editingId.set(1);
        component.saveAnnouncement();
        httpTesting.expectOne('/admin/announcements/1').flush('Error', { status: 500, statusText: 'Server Error' });
        expect(component.saving()).toBe(false);
    });

    it('saveAnnouncement() in edit mode keeps dialog open on error', () => {
        component.dialogMode.set('edit');
        component.editingId.set(1);
        component.saveAnnouncement();
        httpTesting.expectOne('/admin/announcements/1').flush('Error', { status: 500, statusText: 'Server Error' });
        expect(component.dialogMode()).toBe('edit');
    });

    // ── toggleActive() ─────────────────────────────────────────────────────────

    it('toggleActive() sends PATCH with is_active payload', () => {
        component.announcements.set([mockAnnouncement]);
        component.toggleActive(mockAnnouncement, false);
        const req = httpTesting.expectOne(`/admin/announcements/${mockAnnouncement.id}`);
        expect(req.request.method).toBe('PATCH');
        expect(req.request.body).toEqual({ is_active: false });
        req.flush({ success: true });
    });

    it('toggleActive() updates the announcement in the list on success', () => {
        component.announcements.set([{ ...mockAnnouncement, is_active: true }]);
        component.toggleActive(mockAnnouncement, false);
        httpTesting.expectOne(`/admin/announcements/${mockAnnouncement.id}`).flush({ success: true });
        expect(component.announcements()[0].is_active).toBe(false);
    });

    it('toggleActive() activates when true is passed', () => {
        const inactive = { ...mockAnnouncement, is_active: false };
        component.announcements.set([inactive]);
        component.toggleActive(inactive, true);
        httpTesting.expectOne(`/admin/announcements/${inactive.id}`).flush({ success: true });
        expect(component.announcements()[0].is_active).toBe(true);
    });

    it('toggleActive() does not mutate the list on HTTP error', () => {
        component.announcements.set([{ ...mockAnnouncement, is_active: true }]);
        component.toggleActive(mockAnnouncement, false);
        httpTesting.expectOne(`/admin/announcements/${mockAnnouncement.id}`).flush('Error', {
            status: 500,
            statusText: 'Server Error',
        });
        expect(component.announcements()[0].is_active).toBe(true);
    });

    // ── confirmDelete() ────────────────────────────────────────────────────────

    it('confirmDelete() sends DELETE to /admin/announcements/{id}', () => {
        component.deletingAnnouncement.set(mockAnnouncement);
        component.confirmDelete();
        const req = httpTesting.expectOne(`/admin/announcements/${mockAnnouncement.id}`);
        expect(req.request.method).toBe('DELETE');
        req.flush({ success: true });
        httpTesting.expectOne('/admin/announcements').flush(emptyListResponse);
    });

    it('confirmDelete() clears deletingAnnouncement on success', () => {
        component.deletingAnnouncement.set(mockAnnouncement);
        component.confirmDelete();
        httpTesting.expectOne(`/admin/announcements/${mockAnnouncement.id}`).flush({ success: true });
        expect(component.deletingAnnouncement()).toBeNull();
        httpTesting.expectOne('/admin/announcements').flush(emptyListResponse);
    });

    it('confirmDelete() calls loadData() after success', () => {
        component.deletingAnnouncement.set(mockAnnouncement);
        component.confirmDelete();
        httpTesting.expectOne(`/admin/announcements/${mockAnnouncement.id}`).flush({ success: true });
        const reload = httpTesting.expectOne('/admin/announcements');
        expect(reload.request.method).toBe('GET');
        reload.flush(emptyListResponse);
    });

    it('confirmDelete() sets saving false on HTTP error', () => {
        component.deletingAnnouncement.set(mockAnnouncement);
        component.confirmDelete();
        httpTesting.expectOne(`/admin/announcements/${mockAnnouncement.id}`).flush('Error', {
            status: 500,
            statusText: 'Server Error',
        });
        expect(component.saving()).toBe(false);
    });

    it('confirmDelete() does nothing when deletingAnnouncement is null', () => {
        component.deletingAnnouncement.set(null);
        component.confirmDelete();
        httpTesting.expectNone('/admin/announcements/1');
    });
});
