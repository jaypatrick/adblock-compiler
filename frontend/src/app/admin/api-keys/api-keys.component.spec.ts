import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ApiKeysComponent } from './api-keys.component';

/** Build a minimal AdminApiKey for use in tests. */
function makeKey(overrides: Partial<{
    id: string;
    keyPrefix: string;
    clerkUserId: string;
    name: string;
    revokedAt: string | null;
    expiresAt: string | null;
}> = {}) {
    return {
        id: overrides.id ?? 'key-1',
        keyPrefix: overrides.keyPrefix ?? 'sk_test',
        clerkUserId: overrides.clerkUserId ?? 'user_1',
        name: overrides.name ?? 'Test Key',
        scopes: [],
        rateLimitPerMinute: 60,
        lastUsedAt: null,
        expiresAt: overrides.expiresAt ?? null,
        revokedAt: overrides.revokedAt ?? null,
        createdAt: '2024-01-01T00:00:00Z',
    };
}

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST   = new Date(Date.now() - 86_400_000).toISOString();
const NOW    = new Date().toISOString();

describe('ApiKeysComponent', () => {
    let fixture: ComponentFixture<ApiKeysComponent>;
    let component: ApiKeysComponent;
    let httpTesting: HttpTestingController;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ApiKeysComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ApiKeysComponent);
        component = fixture.componentInstance;
        httpTesting = TestBed.inject(HttpTestingController);
        fixture.detectChanges();
        // Drain any afterNextRender HTTP calls (loadData → /admin/auth/api-keys)
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
        expect(fixture.nativeElement.textContent).toContain('API Key Management');
    });

    it('should start with empty API keys list', () => {
        expect(component.allKeys().length).toBe(0);
    });

    // ── loadData() ───────────────────────────────────────────────────────────
    describe('loadData()', () => {
        it('sets loading to true while the request is in flight', () => {
            component.loadData();
            expect(component.loading()).toBe(true);
            httpTesting.expectOne('/admin/auth/api-keys').flush({ success: true, keys: [], total: 0 });
        });

        it('populates allKeys and filteredKeys on success', () => {
            const keys = [makeKey({ keyPrefix: 'sk_aaa' }), makeKey({ id: 'key-2', keyPrefix: 'sk_bbb' })];
            component.loadData();
            httpTesting.expectOne('/admin/auth/api-keys').flush({ success: true, keys, total: 2 });

            expect(component.loading()).toBe(false);
            expect(component.allKeys().length).toBe(2);
            expect(component.filteredKeys().length).toBe(2);
        });

        it('leaves keys empty on HTTP error', () => {
            component.loadData();
            httpTesting.expectOne('/admin/auth/api-keys')
                .flush('Server Error', { status: 500, statusText: 'Server Error' });

            expect(component.loading()).toBe(false);
            expect(component.allKeys().length).toBe(0);
            expect(component.filteredKeys().length).toBe(0);
        });
    });

    // ── applyFilters() ────────────────────────────────────────────────────────
    describe('applyFilters()', () => {
        const keys = [
            makeKey({ id: 'k1', keyPrefix: 'sk_abc', clerkUserId: 'user_a', name: 'Alpha',   expiresAt: FUTURE }),
            makeKey({ id: 'k2', keyPrefix: 'sk_xyz', clerkUserId: 'user_b', name: 'Beta',    revokedAt: NOW   }),
            makeKey({ id: 'k3', keyPrefix: 'sk_exp', clerkUserId: 'user_c', name: 'Expired', expiresAt: PAST  }),
        ];

        beforeEach(() => {
            component.loadData();
            httpTesting.expectOne('/admin/auth/api-keys').flush({ success: true, keys, total: 3 });
        });

        it('shows all keys when searchQuery is empty and statusFilter is "all"', () => {
            component.searchQuery = '';
            component.statusFilter = 'all';
            component.applyFilters();
            expect(component.filteredKeys().length).toBe(3);
        });

        it('filters by keyPrefix substring (case-insensitive)', () => {
            component.searchQuery = 'ABC';
            component.applyFilters();
            expect(component.filteredKeys().length).toBe(1);
            expect(component.filteredKeys()[0].keyPrefix).toBe('sk_abc');
        });

        it('filters by name substring', () => {
            component.searchQuery = 'Beta';
            component.applyFilters();
            expect(component.filteredKeys().length).toBe(1);
        });

        it('filters by clerkUserId substring', () => {
            component.searchQuery = 'user_c';
            component.applyFilters();
            expect(component.filteredKeys().length).toBe(1);
        });

        it('statusFilter "active" returns only active keys', () => {
            component.statusFilter = 'active';
            component.applyFilters();
            expect(component.filteredKeys().length).toBe(1);
            expect(component.filteredKeys()[0].keyPrefix).toBe('sk_abc');
        });

        it('statusFilter "revoked" returns only revoked keys', () => {
            component.statusFilter = 'revoked';
            component.applyFilters();
            expect(component.filteredKeys().length).toBe(1);
            expect(component.filteredKeys()[0].revokedAt).not.toBeNull();
        });

        it('statusFilter "expired" returns only expired keys', () => {
            component.statusFilter = 'expired';
            component.applyFilters();
            expect(component.filteredKeys().length).toBe(1);
            expect(component.filteredKeys()[0].keyPrefix).toBe('sk_exp');
        });
    });

    // ── getKeyStatus() ────────────────────────────────────────────────────────
    describe('getKeyStatus()', () => {
        it('returns "active" for a key with a future expiry and no revocation', () => {
            expect(component.getKeyStatus(makeKey({ expiresAt: FUTURE }))).toBe('active');
        });

        it('returns "active" for a key with no expiry and no revocation', () => {
            expect(component.getKeyStatus(makeKey())).toBe('active');
        });

        it('returns "revoked" for a key with revokedAt set', () => {
            expect(component.getKeyStatus(makeKey({ revokedAt: NOW }))).toBe('revoked');
        });

        it('returns "expired" for a key whose expiresAt is in the past and is not revoked', () => {
            expect(component.getKeyStatus(makeKey({ expiresAt: PAST }))).toBe('expired');
        });

        it('returns "revoked" (not "expired") when both revokedAt and a past expiresAt are set', () => {
            expect(component.getKeyStatus(makeKey({ revokedAt: NOW, expiresAt: PAST }))).toBe('revoked');
        });
    });

    // ── formatDate() ─────────────────────────────────────────────────────────
    describe('formatDate()', () => {
        it('returns "—" for a null value', () => {
            expect(component.formatDate(null)).toBe('—');
        });

        it('returns a non-empty string for a valid ISO date string', () => {
            const result = component.formatDate('2024-06-15T12:00:00Z');
            expect(result).not.toBe('—');
            expect(result.length).toBeGreaterThan(0);
        });
    });

    // ── detail panel ─────────────────────────────────────────────────────────
    describe('detail panel', () => {
        const key = makeKey({ id: 'detail-key', keyPrefix: 'sk_detail' });

        it('openDetail sets detailKey signal', () => {
            component.openDetail(key);
            expect(component.detailKey()).toEqual(key);
        });

        it('closeDetail clears detailKey signal', () => {
            component.openDetail(key);
            component.closeDetail();
            expect(component.detailKey()).toBeNull();
        });
    });

    // ── revoke flow ───────────────────────────────────────────────────────────
    describe('revoke flow', () => {
        const key = makeKey({ id: 'rev-key-42', keyPrefix: 'sk_rev' });

        it('openRevokeConfirm sets revokingKey signal', () => {
            component.openRevokeConfirm(key);
            expect(component.revokingKey()).toEqual(key);
        });

        it('closeRevokeConfirm clears revokingKey signal', () => {
            component.openRevokeConfirm(key);
            component.closeRevokeConfirm();
            expect(component.revokingKey()).toBeNull();
        });

        it('confirmRevoke does nothing when revokingKey is null', () => {
            component.revokingKey.set(null);
            component.confirmRevoke();
            // afterEach verify() asserts no unexpected requests
        });

        it('confirmRevoke sets saving to true during the request', () => {
            component.openRevokeConfirm(key);
            component.confirmRevoke();
            expect(component.saving()).toBe(true);

            // Flush revoke then the follow-up loadData
            httpTesting.expectOne('/admin/auth/api-keys/revoke').flush({ success: true });
            httpTesting.expectOne('/admin/auth/api-keys').flush({ success: true, keys: [], total: 0 });
        });

        it('confirmRevoke posts the correct payload and reloads data on success', () => {
            component.openRevokeConfirm(key);
            component.confirmRevoke();

            const revokeReq = httpTesting.expectOne('/admin/auth/api-keys/revoke');
            expect(revokeReq.request.method).toBe('POST');
            expect(revokeReq.request.body).toEqual({ id: key.id });
            revokeReq.flush({ success: true });

            // Follow-up loadData() must also be flushed
            httpTesting.expectOne('/admin/auth/api-keys').flush({ success: true, keys: [], total: 0 });

            expect(component.saving()).toBe(false);
            expect(component.revokingKey()).toBeNull();
        });

        it('confirmRevoke handles HTTP error without closing the confirm dialog', () => {
            component.openRevokeConfirm(key);
            component.confirmRevoke();

            httpTesting.expectOne('/admin/auth/api-keys/revoke')
                .flush('Server Error', { status: 500, statusText: 'Server Error' });

            expect(component.saving()).toBe(false);
            expect(component.revokingKey()).not.toBeNull();
        });
    });

    // ── stats computed signal ────────────────────────────────────────────────
    describe('stats computed signal', () => {
        it('computes total, active, revoked, and expired counts correctly', () => {
            const keys = [
                makeKey({ id: 'a', expiresAt: FUTURE }),   // active
                makeKey({ id: 'b', revokedAt: NOW }),       // revoked
                makeKey({ id: 'c', expiresAt: PAST }),      // expired
                makeKey({ id: 'd' }),                       // active (no expiry)
            ];
            component.loadData();
            httpTesting.expectOne('/admin/auth/api-keys').flush({ success: true, keys, total: 4 });

            const stats = component.stats();
            expect(stats.total).toBe(4);
            expect(stats.active).toBe(2);
            expect(stats.revoked).toBe(1);
            expect(stats.expired).toBe(1);
        });

        it('returns all zeros when no keys are loaded', () => {
            const stats = component.stats();
            expect(stats).toEqual({ total: 0, active: 0, revoked: 0, expired: 0 });
        });
    });
});
