import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TiersComponent } from './tiers.component';

const mockTier = {
    id: 1,
    tier_name: 'pro',
    display_name: 'Professional',
    description: 'Professional tier with advanced features',
    order_rank: 3,
    rate_limit: 500,
    features: { advanced_compile: true },
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
};

const mockListResponse = {
    success: true,
    items: [mockTier],
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

describe('TiersComponent', () => {
    let fixture: ComponentFixture<TiersComponent>;
    let component: TiersComponent;
    let httpTesting: HttpTestingController;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [TiersComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(TiersComponent);
        component = fixture.componentInstance;
        httpTesting = TestBed.inject(HttpTestingController);
        fixture.detectChanges();
        // Flush the initial GET triggered by afterNextRender
        httpTesting.expectOne('/admin/config/tiers').flush(emptyListResponse);
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
        expect(el.textContent).toContain('Tier Registry');
    });

    it('should start with empty tiers after initial load', () => {
        expect(component.tiers().length).toBe(0);
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

    it('should have deletingTier null initially', () => {
        expect(component.deletingTier()).toBeNull();
    });

    // ── loadData() ─────────────────────────────────────────────────────────────

    it('loadData() populates tiers on success', () => {
        component.loadData();
        httpTesting.expectOne('/admin/config/tiers').flush(mockListResponse);
        expect(component.tiers().length).toBe(1);
        expect(component.tiers()[0].tier_name).toBe('pro');
    });

    it('loadData() also populates sortedTiers on success', () => {
        component.loadData();
        httpTesting.expectOne('/admin/config/tiers').flush(mockListResponse);
        expect(component.sortedTiers().length).toBe(1);
    });

    it('loadData() sets loading true while in-flight', () => {
        component.loadData();
        expect(component.loading()).toBe(true);
        httpTesting.expectOne('/admin/config/tiers').flush(emptyListResponse);
    });

    it('loadData() sets loading false after success', () => {
        component.loadData();
        httpTesting.expectOne('/admin/config/tiers').flush(mockListResponse);
        expect(component.loading()).toBe(false);
    });

    it('loadData() clears both signals and sets loading false on HTTP error', () => {
        component.tiers.set([mockTier]);
        component.sortedTiers.set([mockTier]);
        component.loadData();
        httpTesting.expectOne('/admin/config/tiers').flush('Error', {
            status: 500,
            statusText: 'Internal Server Error',
        });
        expect(component.tiers().length).toBe(0);
        expect(component.sortedTiers().length).toBe(0);
        expect(component.loading()).toBe(false);
    });

    it('loadData() handles multiple tiers', () => {
        const free = { ...mockTier, id: 2, tier_name: 'free', order_rank: 1 };
        component.loadData();
        httpTesting.expectOne('/admin/config/tiers').flush({ ...emptyListResponse, items: [mockTier, free], total: 2 });
        expect(component.tiers().length).toBe(2);
    });

    // ── onSort() ───────────────────────────────────────────────────────────────

    it('onSort() sorts tiers by order_rank ascending', () => {
        const tier1 = { ...mockTier, id: 1, tier_name: 'enterprise', order_rank: 5 };
        const tier2 = { ...mockTier, id: 2, tier_name: 'free', order_rank: 1 };
        const tier3 = { ...mockTier, id: 3, tier_name: 'pro', order_rank: 3 };
        component.tiers.set([tier1, tier2, tier3]);
        component.onSort({ active: 'order_rank', direction: 'asc' });
        expect(component.sortedTiers()[0].order_rank).toBe(1);
        expect(component.sortedTiers()[1].order_rank).toBe(3);
        expect(component.sortedTiers()[2].order_rank).toBe(5);
    });

    it('onSort() sorts tiers by order_rank descending', () => {
        const tier1 = { ...mockTier, id: 1, tier_name: 'enterprise', order_rank: 5 };
        const tier2 = { ...mockTier, id: 2, tier_name: 'free', order_rank: 1 };
        component.tiers.set([tier1, tier2]);
        component.onSort({ active: 'order_rank', direction: 'desc' });
        expect(component.sortedTiers()[0].order_rank).toBe(5);
        expect(component.sortedTiers()[1].order_rank).toBe(1);
    });

    it('onSort() sorts by tier_name alphabetically ascending', () => {
        const tierZ = { ...mockTier, id: 1, tier_name: 'zzz' };
        const tierA = { ...mockTier, id: 2, tier_name: 'aaa' };
        component.tiers.set([tierZ, tierA]);
        component.onSort({ active: 'tier_name', direction: 'asc' });
        expect(component.sortedTiers()[0].tier_name).toBe('aaa');
        expect(component.sortedTiers()[1].tier_name).toBe('zzz');
    });

    it('onSort() with empty direction returns data in original order', () => {
        const tier1 = { ...mockTier, id: 1, tier_name: 'b', order_rank: 2 };
        const tier2 = { ...mockTier, id: 2, tier_name: 'a', order_rank: 1 };
        component.tiers.set([tier1, tier2]);
        component.onSort({ active: 'tier_name', direction: '' });
        // With empty direction, no sort is applied — original order is preserved
        expect(component.sortedTiers()[0].tier_name).toBe('b');
        expect(component.sortedTiers()[1].tier_name).toBe('a');
    });

    it('onSort() sorts by rate_limit numerically', () => {
        const lowRate = { ...mockTier, id: 1, tier_name: 'free', rate_limit: 10 };
        const highRate = { ...mockTier, id: 2, tier_name: 'enterprise', rate_limit: 9999 };
        component.tiers.set([highRate, lowRate]);
        component.onSort({ active: 'rate_limit', direction: 'asc' });
        expect(component.sortedTiers()[0].rate_limit).toBe(10);
        expect(component.sortedTiers()[1].rate_limit).toBe(9999);
    });

    // ── Dialog open / close ────────────────────────────────────────────────────

    it('openCreateDialog() sets dialogMode to "create"', () => {
        component.openCreateDialog();
        expect(component.dialogMode()).toBe('create');
    });

    it('openCreateDialog() clears editingTierName', () => {
        component.editingTierName.set('pro');
        component.openCreateDialog();
        expect(component.editingTierName()).toBeNull();
    });

    it('openCreateDialog() resets formData to defaults', () => {
        component.formData.tier_name = 'old_tier';
        component.formData.rate_limit = 9999;
        component.openCreateDialog();
        expect(component.formData.tier_name).toBe('');
        expect(component.formData.rate_limit).toBe(100);
        expect(component.formData.is_active).toBe(true);
        expect(component.formData.order_rank).toBe(0);
    });

    it('openEditDialog() sets dialogMode to "edit"', () => {
        component.openEditDialog(mockTier);
        expect(component.dialogMode()).toBe('edit');
    });

    it('openEditDialog() populates formData from the given tier', () => {
        const tier = { ...mockTier, tier_name: 'enterprise', display_name: 'Enterprise', description: 'Top tier', order_rank: 10, rate_limit: 1000, is_active: false };
        component.openEditDialog(tier);
        expect(component.formData.tier_name).toBe('enterprise');
        expect(component.formData.display_name).toBe('Enterprise');
        expect(component.formData.description).toBe('Top tier');
        expect(component.formData.order_rank).toBe(10);
        expect(component.formData.rate_limit).toBe(1000);
        expect(component.formData.is_active).toBe(false);
    });

    it('openEditDialog() sets editingTierName', () => {
        component.openEditDialog({ ...mockTier, tier_name: 'starter' });
        expect(component.editingTierName()).toBe('starter');
    });

    it('closeDialog() sets dialogMode to null', () => {
        component.dialogMode.set('edit');
        component.closeDialog();
        expect(component.dialogMode()).toBeNull();
    });

    // ── Delete confirm dialog ──────────────────────────────────────────────────

    it('openDeleteConfirm() sets deletingTier', () => {
        component.openDeleteConfirm(mockTier);
        expect(component.deletingTier()).toBe(mockTier);
    });

    it('closeDeleteConfirm() clears deletingTier', () => {
        component.deletingTier.set(mockTier);
        component.closeDeleteConfirm();
        expect(component.deletingTier()).toBeNull();
    });

    // ── saveTier() – create mode ───────────────────────────────────────────────

    it('saveTier() in create mode sends POST to /admin/config/tiers', () => {
        component.dialogMode.set('create');
        component.formData = { tier_name: 'starter', display_name: 'Starter', description: 'Starter tier', order_rank: 1, rate_limit: 100, is_active: true };
        component.saveTier();
        const req = httpTesting.expectOne('/admin/config/tiers');
        expect(req.request.method).toBe('POST');
        req.flush({ success: true });
        httpTesting.expectOne('/admin/config/tiers').flush(emptyListResponse);
    });

    it('saveTier() in create mode sends correct payload', () => {
        component.dialogMode.set('create');
        component.formData = { tier_name: 'new_tier', display_name: 'New', description: 'Desc', order_rank: 2, rate_limit: 250, is_active: false };
        component.saveTier();
        const req = httpTesting.expectOne('/admin/config/tiers');
        expect(req.request.body.tier_name).toBe('new_tier');
        expect(req.request.body.rate_limit).toBe(250);
        expect(req.request.body.is_active).toBe(false);
        req.flush({ success: true });
        httpTesting.expectOne('/admin/config/tiers').flush(emptyListResponse);
    });

    it('saveTier() in create mode sets saving true then false on success', () => {
        component.dialogMode.set('create');
        component.saveTier();
        expect(component.saving()).toBe(true);
        httpTesting.expectOne('/admin/config/tiers').flush({ success: true });
        expect(component.saving()).toBe(false);
        httpTesting.expectOne('/admin/config/tiers').flush(emptyListResponse);
    });

    it('saveTier() in create mode closes dialog on success', () => {
        component.dialogMode.set('create');
        component.saveTier();
        httpTesting.expectOne('/admin/config/tiers').flush({ success: true });
        expect(component.dialogMode()).toBeNull();
        httpTesting.expectOne('/admin/config/tiers').flush(emptyListResponse);
    });

    it('saveTier() in create mode calls loadData() after success', () => {
        component.dialogMode.set('create');
        component.saveTier();
        httpTesting.expectOne('/admin/config/tiers').flush({ success: true });
        const reload = httpTesting.expectOne('/admin/config/tiers');
        expect(reload.request.method).toBe('GET');
        reload.flush(emptyListResponse);
    });

    it('saveTier() in create mode sets saving false on error', () => {
        component.dialogMode.set('create');
        component.saveTier();
        httpTesting.expectOne('/admin/config/tiers').flush('Error', { status: 500, statusText: 'Server Error' });
        expect(component.saving()).toBe(false);
    });

    it('saveTier() in create mode keeps dialog open on error', () => {
        component.dialogMode.set('create');
        component.saveTier();
        httpTesting.expectOne('/admin/config/tiers').flush('Error', { status: 500, statusText: 'Server Error' });
        expect(component.dialogMode()).toBe('create');
    });

    // ── saveTier() – edit mode ─────────────────────────────────────────────────

    it('saveTier() in edit mode sends PATCH to /admin/config/tiers/{tier_name}', () => {
        component.dialogMode.set('edit');
        component.editingTierName.set('pro');
        component.formData = { tier_name: 'pro', display_name: 'Pro Updated', description: 'Updated', order_rank: 3, rate_limit: 600, is_active: true };
        component.saveTier();
        const req = httpTesting.expectOne('/admin/config/tiers/pro');
        expect(req.request.method).toBe('PATCH');
        req.flush({ success: true });
        httpTesting.expectOne('/admin/config/tiers').flush(emptyListResponse);
    });

    it('saveTier() in edit mode sends correct payload', () => {
        component.dialogMode.set('edit');
        component.editingTierName.set('free');
        component.formData = { tier_name: 'free', display_name: 'Free Tier', description: 'Basic', order_rank: 1, rate_limit: 60, is_active: true };
        component.saveTier();
        const req = httpTesting.expectOne('/admin/config/tiers/free');
        expect(req.request.body.display_name).toBe('Free Tier');
        expect(req.request.body.rate_limit).toBe(60);
        req.flush({ success: true });
        httpTesting.expectOne('/admin/config/tiers').flush(emptyListResponse);
    });

    it('saveTier() in edit mode closes dialog on success', () => {
        component.dialogMode.set('edit');
        component.editingTierName.set('pro');
        component.saveTier();
        httpTesting.expectOne('/admin/config/tiers/pro').flush({ success: true });
        expect(component.dialogMode()).toBeNull();
        httpTesting.expectOne('/admin/config/tiers').flush(emptyListResponse);
    });

    it('saveTier() in edit mode sets saving false on HTTP error', () => {
        component.dialogMode.set('edit');
        component.editingTierName.set('pro');
        component.saveTier();
        httpTesting.expectOne('/admin/config/tiers/pro').flush('Error', { status: 400, statusText: 'Bad Request' });
        expect(component.saving()).toBe(false);
    });

    it('saveTier() in edit mode keeps dialog open on error', () => {
        component.dialogMode.set('edit');
        component.editingTierName.set('pro');
        component.saveTier();
        httpTesting.expectOne('/admin/config/tiers/pro').flush('Error', { status: 500, statusText: 'Server Error' });
        expect(component.dialogMode()).toBe('edit');
    });

    // ── confirmDelete() ────────────────────────────────────────────────────────

    it('confirmDelete() sends DELETE to /admin/config/tiers/{tier_name}', () => {
        component.deletingTier.set(mockTier);
        component.confirmDelete();
        const req = httpTesting.expectOne(`/admin/config/tiers/${mockTier.tier_name}`);
        expect(req.request.method).toBe('DELETE');
        req.flush({ success: true });
        httpTesting.expectOne('/admin/config/tiers').flush(emptyListResponse);
    });

    it('confirmDelete() uses tier_name (not id) in the URL', () => {
        const tier = { ...mockTier, id: 999, tier_name: 'enterprise' };
        component.deletingTier.set(tier);
        component.confirmDelete();
        const req = httpTesting.expectOne('/admin/config/tiers/enterprise');
        expect(req.request.method).toBe('DELETE');
        req.flush({ success: true });
        httpTesting.expectOne('/admin/config/tiers').flush(emptyListResponse);
    });

    it('confirmDelete() clears deletingTier on success', () => {
        component.deletingTier.set(mockTier);
        component.confirmDelete();
        httpTesting.expectOne(`/admin/config/tiers/${mockTier.tier_name}`).flush({ success: true });
        expect(component.deletingTier()).toBeNull();
        httpTesting.expectOne('/admin/config/tiers').flush(emptyListResponse);
    });

    it('confirmDelete() calls loadData() after success', () => {
        component.deletingTier.set(mockTier);
        component.confirmDelete();
        httpTesting.expectOne(`/admin/config/tiers/${mockTier.tier_name}`).flush({ success: true });
        const reload = httpTesting.expectOne('/admin/config/tiers');
        expect(reload.request.method).toBe('GET');
        reload.flush(emptyListResponse);
    });

    it('confirmDelete() sets saving false on HTTP error', () => {
        component.deletingTier.set(mockTier);
        component.confirmDelete();
        httpTesting.expectOne(`/admin/config/tiers/${mockTier.tier_name}`).flush('Error', {
            status: 500,
            statusText: 'Server Error',
        });
        expect(component.saving()).toBe(false);
    });

    it('confirmDelete() does nothing when deletingTier is null', () => {
        component.deletingTier.set(null);
        component.confirmDelete();
        httpTesting.expectNone('/admin/config/tiers/pro');
    });
});
