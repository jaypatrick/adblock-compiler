import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { UsersComponent } from './users.component';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_USER_RESPONSE = { success: true, users: [], total: 0, limit: 25, offset: 0 };

function makeUser(overrides: Partial<{
    id: string; email: string; name: string | null;
    emailVerified: boolean; image: string | null;
    role: string; tier: string; banned: boolean;
    banReason: string | null; banExpires: string | null;
    createdAt: string; updatedAt: string;
}> = {}) {
    return {
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        emailVerified: true,
        image: null,
        role: 'user',
        tier: 'free',
        banned: false,
        banReason: null,
        banExpires: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('UsersComponent', () => {
    let fixture: ComponentFixture<UsersComponent>;
    let component: UsersComponent;
    let httpTesting: HttpTestingController;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [UsersComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(UsersComponent);
        component = fixture.componentInstance;
        httpTesting = TestBed.inject(HttpTestingController);
        fixture.detectChanges();
        // Drain any HTTP request issued by afterNextRender
        httpTesting.match(() => true).forEach(r => r.flush(EMPTY_USER_RESPONSE));
    });

    afterEach(() => httpTesting.verify());

    // -----------------------------------------------------------------------
    // Baseline
    // -----------------------------------------------------------------------

    it('should create the component', () => {
        expect(component).toBeTruthy();
    });

    it('should expose the correct default signal values', () => {
        expect(component.users()).toEqual([]);
        expect(component.loading()).toBe(false);
        expect(component.saving()).toBe(false);
        expect(component.totalCount()).toBe(0);
        expect(component.pageIndex()).toBe(0);
        expect(component.detailUser()).toBeNull();
        expect(component.tierOverlayUser()).toBeNull();
        expect(component.roleOverlayUser()).toBeNull();
    });

    // -----------------------------------------------------------------------
    // loadData()
    // -----------------------------------------------------------------------

    describe('loadData()', () => {
        it('populates users and totalCount on success', () => {
            const user = makeUser();
            component.loadData();

            const req = httpTesting.expectOne(r => r.url.includes('/api/admin/users'));
            expect(req.request.method).toBe('GET');
            req.flush({ success: true, users: [user], total: 1, limit: 25, offset: 0 });

            expect(component.users()).toEqual([user]);
            expect(component.totalCount()).toBe(1);
            expect(component.loading()).toBe(false);
        });

        it('sets loading true while request is in-flight', () => {
            component.loadData();
            expect(component.loading()).toBe(true);
            httpTesting.expectOne(r => r.url.includes('/api/admin/users')).flush(EMPTY_USER_RESPONSE);
        });

        it('clears users and totalCount on HTTP error', () => {
            component.loadData();
            httpTesting
                .expectOne(r => r.url.includes('/api/admin/users'))
                .flush('Internal Server Error', { status: 500, statusText: 'Server Error' });

            expect(component.users()).toEqual([]);
            expect(component.totalCount()).toBe(0);
            expect(component.loading()).toBe(false);
        });

        it('includes search and filter params when set', () => {
            component.searchQuery = 'alice';
            component.filterTier = 'pro';
            component.filterRole = 'admin';
            component.loadData();

            const req = httpTesting.expectOne(r => r.url.includes('/api/admin/users'));
            expect(req.request.params.get('search')).toBe('alice');
            expect(req.request.params.get('tier')).toBe('pro');
            expect(req.request.params.get('role')).toBe('admin');
            req.flush(EMPTY_USER_RESPONSE);
        });

        it('omits optional params when filters are blank', () => {
            component.loadData();
            const req = httpTesting.expectOne(r => r.url.includes('/api/admin/users'));
            expect(req.request.params.has('search')).toBe(false);
            expect(req.request.params.has('tier')).toBe(false);
            expect(req.request.params.has('role')).toBe(false);
            req.flush(EMPTY_USER_RESPONSE);
        });

        it('sends correct offset for non-zero pageIndex', () => {
            component.pageIndex.set(2);
            component.loadData();
            const req = httpTesting.expectOne(r => r.url.includes('/api/admin/users'));
            expect(req.request.params.get('offset')).toBe('50');
            req.flush(EMPTY_USER_RESPONSE);
        });
    });

    // -----------------------------------------------------------------------
    // applyFilters()
    // -----------------------------------------------------------------------

    describe('applyFilters()', () => {
        it('resets pageIndex to 0 and triggers loadData()', () => {
            component.pageIndex.set(3);
            component.applyFilters();

            expect(component.pageIndex()).toBe(0);
            httpTesting.expectOne(r => r.url.includes('/api/admin/users')).flush(EMPTY_USER_RESPONSE);
        });
    });

    // -----------------------------------------------------------------------
    // resetFilters()
    // -----------------------------------------------------------------------

    describe('resetFilters()', () => {
        it('clears all filter values, resets pageIndex, and reloads', () => {
            component.searchQuery = 'bob';
            component.filterTier = 'pro';
            component.filterRole = 'admin';
            component.pageIndex.set(5);

            component.resetFilters();

            expect(component.searchQuery).toBe('');
            expect(component.filterTier).toBe('');
            expect(component.filterRole).toBe('');
            expect(component.pageIndex()).toBe(0);

            const req = httpTesting.expectOne(r => r.url.includes('/api/admin/users'));
            expect(req.request.params.has('search')).toBe(false);
            req.flush(EMPTY_USER_RESPONSE);
        });
    });

    // -----------------------------------------------------------------------
    // onPage()
    // -----------------------------------------------------------------------

    describe('onPage()', () => {
        it('updates pageIndex and calls loadData()', () => {
            component.onPage({ pageIndex: 2, pageSize: 25, length: 100 });
            expect(component.pageIndex()).toBe(2);
            httpTesting.expectOne(r => r.url.includes('/api/admin/users')).flush(EMPTY_USER_RESPONSE);
        });
    });

    // -----------------------------------------------------------------------
    // Overlay helpers
    // -----------------------------------------------------------------------

    describe('openDetailOverlay()', () => {
        it('sets detailUser signal', () => {
            const user = makeUser();
            component.openDetailOverlay(user);
            expect(component.detailUser()).toEqual(user);
        });
    });

    describe('openTierOverlay()', () => {
        it('sets tierOverlayUser and pre-selects current tier', () => {
            const user = makeUser({ tier: 'pro' });
            component.openTierOverlay(user);
            expect(component.tierOverlayUser()).toEqual(user);
            expect(component.selectedTier).toBe('pro');
        });
    });

    describe('openRoleOverlay()', () => {
        it('sets roleOverlayUser and pre-selects current role', () => {
            const user = makeUser({ role: 'admin' });
            component.openRoleOverlay(user);
            expect(component.roleOverlayUser()).toEqual(user);
            expect(component.selectedRole).toBe('admin');
        });
    });

    describe('closeOverlays()', () => {
        it('clears all overlay signals', () => {
            const user = makeUser();
            component.openDetailOverlay(user);
            component.openTierOverlay(user);
            component.openRoleOverlay(user);

            component.closeOverlays();

            expect(component.detailUser()).toBeNull();
            expect(component.tierOverlayUser()).toBeNull();
            expect(component.roleOverlayUser()).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // saveTier()
    // -----------------------------------------------------------------------

    describe('saveTier()', () => {
        it('does nothing when no tierOverlayUser is set', () => {
            component.saveTier();
            httpTesting.expectNone(r => r.url.includes('/api/admin/users'));
        });

        it('PATCHes the correct endpoint with tier payload on success', () => {
            const user = makeUser({ id: 'u-42', tier: 'free' });
            component.openTierOverlay(user);
            component.selectedTier = 'pro';

            component.saveTier();
            expect(component.saving()).toBe(true);

            const patchReq = httpTesting.expectOne(r =>
                r.url.includes('/api/admin/users/u-42') && r.method === 'PATCH',
            );
            expect(patchReq.request.body).toEqual({ tier: 'pro' });
            patchReq.flush({ success: true });

            // saveTier calls loadData() after success
            httpTesting.match(r => r.url.includes('/api/admin/users')).forEach(r =>
                r.flush(EMPTY_USER_RESPONSE),
            );

            expect(component.saving()).toBe(false);
            expect(component.tierOverlayUser()).toBeNull();
        });

        it('resets saving flag and keeps overlay open on error', () => {
            const user = makeUser({ id: 'u-99' });
            component.openTierOverlay(user);
            component.selectedTier = 'admin';

            component.saveTier();

            httpTesting
                .expectOne(r => r.url.includes('/api/admin/users/u-99') && r.method === 'PATCH')
                .flush('Forbidden', { status: 403, statusText: 'Forbidden' });

            expect(component.saving()).toBe(false);
            // Overlay should remain open on error
            expect(component.tierOverlayUser()).toEqual(user);
        });
    });

    // -----------------------------------------------------------------------
    // saveRole()
    // -----------------------------------------------------------------------

    describe('saveRole()', () => {
        it('does nothing when no roleOverlayUser is set', () => {
            component.saveRole();
            httpTesting.expectNone(r => r.url.includes('/api/admin/users'));
        });

        it('PATCHes with role payload and reloads on success', () => {
            const user = makeUser({ id: 'u-7', role: 'user' });
            component.openRoleOverlay(user);
            component.selectedRole = 'admin';

            component.saveRole();
            expect(component.saving()).toBe(true);

            const patchReq = httpTesting.expectOne(r =>
                r.url.includes('/api/admin/users/u-7') && r.method === 'PATCH',
            );
            expect(patchReq.request.body).toEqual({ role: 'admin' });
            patchReq.flush({ success: true });

            httpTesting.match(r => r.url.includes('/api/admin/users')).forEach(r =>
                r.flush(EMPTY_USER_RESPONSE),
            );

            expect(component.saving()).toBe(false);
            expect(component.roleOverlayUser()).toBeNull();
        });

        it('resets saving flag and keeps overlay open on error', () => {
            const user = makeUser({ id: 'u-8' });
            component.openRoleOverlay(user);
            component.selectedRole = 'admin';

            component.saveRole();

            httpTesting
                .expectOne(r => r.url.includes('/api/admin/users/u-8') && r.method === 'PATCH')
                .flush('Server Error', { status: 500, statusText: 'Server Error' });

            expect(component.saving()).toBe(false);
            expect(component.roleOverlayUser()).toEqual(user);
        });
    });
});
