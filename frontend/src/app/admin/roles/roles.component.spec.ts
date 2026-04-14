import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { RolesComponent } from './roles.component';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_ROLES_RESPONSE = { success: true, items: [], total: 0, limit: 25, offset: 0 };
const EMPTY_ASSIGNMENTS_RESPONSE = { success: true, items: [], total: 0 };

function makeRole(overrides: Partial<{
    id: number; role_name: string; display_name: string; description: string;
    permissions: string[]; is_active: boolean; created_at: string; updated_at: string;
}> = {}) {
    return {
        id: 1,
        role_name: 'editor',
        display_name: 'Editor',
        description: 'Can edit content',
        permissions: ['admin:users:read'],
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        ...overrides,
    };
}

function makeAssignment(overrides: Partial<{
    id: number; user_id: string; role_name: string;
    assigned_by: string; assigned_at: string; expires_at: string | null;
}> = {}) {
    return {
        id: 10,
        user_id: 'user-abc',
        role_name: 'editor',
        assigned_by: 'admin@example.com',
        assigned_at: '2024-01-02T00:00:00Z',
        expires_at: null,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RolesComponent', () => {
    let fixture: ComponentFixture<RolesComponent>;
    let component: RolesComponent;
    let httpTesting: HttpTestingController;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [RolesComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(RolesComponent);
        component = fixture.componentInstance;
        httpTesting = TestBed.inject(HttpTestingController);
        fixture.detectChanges();
        // Drain afterNextRender HTTP calls
        httpTesting.match(() => true).forEach(r => r.flush(EMPTY_ROLES_RESPONSE));
    });

    afterEach(() => httpTesting.verify());

    // -----------------------------------------------------------------------
    // Baseline
    // -----------------------------------------------------------------------

    it('should create the component', () => {
        expect(component).toBeTruthy();
    });

    it('should start with correct default signal values', () => {
        expect(component.roles()).toEqual([]);
        expect(component.selectedRole()).toBeNull();
        expect(component.roleAssignments()).toEqual([]);
        expect(component.loading()).toBe(false);
        expect(component.saving()).toBe(false);
        expect(component.dialogMode()).toBeNull();
        expect(component.showAssignDialog()).toBe(false);
    });

    // -----------------------------------------------------------------------
    // loadData()
    // -----------------------------------------------------------------------

    describe('loadData()', () => {
        it('populates roles signal on success', () => {
            const role = makeRole();
            component.loadData();

            httpTesting
                .expectOne(r => r.url.includes('/admin/roles') && r.method === 'GET')
                .flush({ success: true, items: [role], total: 1, limit: 25, offset: 0 });

            expect(component.roles()).toEqual([role]);
            expect(component.loading()).toBe(false);
        });

        it('clears roles on HTTP error', () => {
            component.loadData();
            httpTesting
                .expectOne(r => r.url.includes('/admin/roles') && r.method === 'GET')
                .flush('Server Error', { status: 500, statusText: 'Server Error' });

            expect(component.roles()).toEqual([]);
            expect(component.loading()).toBe(false);
        });

        it('re-selects previously selected role and reloads its assignments', () => {
            const role = makeRole({ id: 5, role_name: 'moderator' });
            component.selectedRole.set(role);

            component.loadData();

            httpTesting
                .expectOne(r => r.url.includes('/admin/roles') && r.method === 'GET')
                .flush({ success: true, items: [role], total: 1, limit: 25, offset: 0 });

            expect(component.selectedRole()?.id).toBe(5);

            // loadData should have triggered loadAssignments
            httpTesting
                .expectOne(r => r.url.includes('/admin/roles/assignments'))
                .flush(EMPTY_ASSIGNMENTS_RESPONSE);
        });
    });

    // -----------------------------------------------------------------------
    // selectRole()
    // -----------------------------------------------------------------------

    describe('selectRole()', () => {
        it('sets selectedRole and triggers loadAssignments', () => {
            const role = makeRole({ role_name: 'viewer' });
            component.selectRole(role);

            expect(component.selectedRole()).toEqual(role);

            const req = httpTesting.expectOne(r => r.url.includes('/admin/roles/assignments'));
            expect(req.request.params.get('role_name')).toBe('viewer');
            req.flush(EMPTY_ASSIGNMENTS_RESPONSE);
        });
    });

    // -----------------------------------------------------------------------
    // loadAssignments()
    // -----------------------------------------------------------------------

    describe('loadAssignments()', () => {
        it('populates roleAssignments on success', () => {
            const assignment = makeAssignment();
            component.loadAssignments('editor');

            httpTesting
                .expectOne(r => r.url.includes('/admin/roles/assignments'))
                .flush({ success: true, items: [assignment], total: 1 });

            expect(component.roleAssignments()).toEqual([assignment]);
        });

        it('clears roleAssignments on error', () => {
            component.loadAssignments('editor');
            httpTesting
                .expectOne(r => r.url.includes('/admin/roles/assignments'))
                .flush('Not Found', { status: 404, statusText: 'Not Found' });

            expect(component.roleAssignments()).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // Dialog helpers
    // -----------------------------------------------------------------------

    describe('openCreateDialog()', () => {
        it('resets formData and sets dialogMode to "create"', () => {
            component.formData.role_name = 'existing';
            component.openCreateDialog();

            expect(component.dialogMode()).toBe('create');
            expect(component.formData.role_name).toBe('');
            expect(component.formData.permissions).toEqual([]);
        });
    });

    describe('openEditDialog()', () => {
        it('populates formData from role and sets dialogMode to "edit"', () => {
            const role = makeRole({
                role_name: 'superuser',
                display_name: 'Super User',
                description: 'All access',
                permissions: ['admin:users:read', 'admin:users:write'],
            });
            component.openEditDialog(role);

            expect(component.dialogMode()).toBe('edit');
            expect(component.formData.role_name).toBe('superuser');
            expect(component.formData.display_name).toBe('Super User');
            expect(component.formData.permissions).toEqual(['admin:users:read', 'admin:users:write']);
        });
    });

    describe('closeDialog()', () => {
        it('sets dialogMode back to null', () => {
            component.openCreateDialog();
            component.closeDialog();
            expect(component.dialogMode()).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // togglePermission()
    // -----------------------------------------------------------------------

    describe('togglePermission()', () => {
        it('adds a permission when checked is true', () => {
            component.formData.permissions = [];
            component.togglePermission('admin:users:read', true);
            expect(component.formData.permissions).toContain('admin:users:read');
        });

        it('does not add a duplicate permission', () => {
            component.formData.permissions = ['admin:users:read'];
            component.togglePermission('admin:users:read', true);
            expect(component.formData.permissions.filter(p => p === 'admin:users:read').length).toBe(1);
        });

        it('removes a permission when checked is false', () => {
            component.formData.permissions = ['admin:users:read', 'admin:roles:read'];
            component.togglePermission('admin:users:read', false);
            expect(component.formData.permissions).not.toContain('admin:users:read');
            expect(component.formData.permissions).toContain('admin:roles:read');
        });
    });

    // -----------------------------------------------------------------------
    // saveRole() — create
    // -----------------------------------------------------------------------

    describe('saveRole() – create mode', () => {
        beforeEach(() => {
            component.openCreateDialog();
            component.formData.role_name = 'new-role';
            component.formData.display_name = 'New Role';
            component.formData.description = 'A brand-new role';
            component.formData.permissions = ['admin:users:read'];
        });

        it('POSTs to /admin/roles with correct payload on success', () => {
            component.saveRole();
            expect(component.saving()).toBe(true);

            const req = httpTesting.expectOne(r =>
                r.url.includes('/admin/roles') && r.method === 'POST',
            );
            expect(req.request.body).toEqual({
                role_name: 'new-role',
                display_name: 'New Role',
                description: 'A brand-new role',
                permissions: ['admin:users:read'],
            });
            req.flush({ success: true });

            // saveRole calls loadData() after success
            httpTesting
                .match(r => r.url.includes('/admin/roles') && r.method === 'GET')
                .forEach(r => r.flush(EMPTY_ROLES_RESPONSE));

            expect(component.saving()).toBe(false);
            expect(component.dialogMode()).toBeNull();
        });

        it('resets saving flag and keeps dialog open on error', () => {
            component.saveRole();
            httpTesting
                .expectOne(r => r.url.includes('/admin/roles') && r.method === 'POST')
                .flush('Conflict', { status: 409, statusText: 'Conflict' });

            expect(component.saving()).toBe(false);
            expect(component.dialogMode()).toBe('create');
        });
    });

    // -----------------------------------------------------------------------
    // saveRole() — edit
    // -----------------------------------------------------------------------

    describe('saveRole() – edit mode', () => {
        const role = makeRole({ role_name: 'editor' });

        beforeEach(() => {
            component.openEditDialog(role);
        });

        it('PATCHes /admin/roles/{role_name} on success', () => {
            component.saveRole();

            const req = httpTesting.expectOne(r =>
                r.url.includes('/admin/roles/editor') && r.method === 'PATCH',
            );
            expect(req.request.body.role_name).toBe('editor');
            req.flush({ success: true });

            httpTesting
                .match(r => r.url.includes('/admin/roles') && r.method === 'GET')
                .forEach(r => r.flush(EMPTY_ROLES_RESPONSE));

            expect(component.saving()).toBe(false);
            expect(component.dialogMode()).toBeNull();
        });

        it('resets saving flag on error without closing the dialog', () => {
            component.saveRole();
            httpTesting
                .expectOne(r => r.url.includes('/admin/roles/editor') && r.method === 'PATCH')
                .flush('Server Error', { status: 500, statusText: 'Server Error' });

            expect(component.saving()).toBe(false);
            expect(component.dialogMode()).toBe('edit');
        });
    });

    // -----------------------------------------------------------------------
    // Assign-dialog helpers
    // -----------------------------------------------------------------------

    describe('openAssignDialog()', () => {
        it('clears assignUserId and shows the dialog', () => {
            component.assignUserId = 'leftover';
            component.openAssignDialog();
            expect(component.showAssignDialog()).toBe(true);
            expect(component.assignUserId).toBe('');
        });
    });

    describe('closeAssignDialog()', () => {
        it('hides the dialog', () => {
            component.openAssignDialog();
            component.closeAssignDialog();
            expect(component.showAssignDialog()).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // confirmAssign()
    // -----------------------------------------------------------------------

    describe('confirmAssign()', () => {
        it('does nothing when no role is selected', () => {
            component.selectedRole.set(null);
            component.assignUserId = 'some-user';
            component.confirmAssign();
            httpTesting.expectNone(r => r.url.includes('/admin/roles/assignments'));
        });

        it('does nothing when assignUserId is blank', () => {
            component.selectedRole.set(makeRole());
            component.assignUserId = '   ';
            component.confirmAssign();
            httpTesting.expectNone(r => r.url.includes('/admin/roles/assignments'));
        });

        it('POSTs assignment and reloads assignments on success', () => {
            const role = makeRole({ role_name: 'editor' });
            component.selectedRole.set(role);
            component.assignUserId = 'user-xyz';

            component.confirmAssign();
            expect(component.saving()).toBe(true);

            const req = httpTesting.expectOne(r =>
                r.url.includes('/admin/roles/assignments') && r.method === 'POST',
            );
            expect(req.request.body).toEqual({
                user_id: 'user-xyz',
                role_name: 'editor',
            });
            req.flush({ success: true });

            expect(component.saving()).toBe(false);
            expect(component.showAssignDialog()).toBe(false);

            // confirmAssign calls loadAssignments
            httpTesting
                .expectOne(r => r.url.includes('/admin/roles/assignments') && r.method === 'GET')
                .flush(EMPTY_ASSIGNMENTS_RESPONSE);
        });

        it('resets saving flag and keeps dialog open on error', () => {
            const role = makeRole({ role_name: 'editor' });
            component.selectedRole.set(role);
            component.openAssignDialog();
            // Set assignUserId AFTER openAssignDialog() so it isn't cleared
            component.assignUserId = 'user-xyz';

            component.confirmAssign();
            httpTesting
                .expectOne(r => r.url.includes('/admin/roles/assignments') && r.method === 'POST')
                .flush('Forbidden', { status: 403, statusText: 'Forbidden' });

            expect(component.saving()).toBe(false);
            expect(component.showAssignDialog()).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // revokeAssignment()
    // -----------------------------------------------------------------------

    describe('revokeAssignment()', () => {
        it('DELETEs the assignment and reloads assignments on success', () => {
            const role = makeRole({ role_name: 'editor' });
            component.selectedRole.set(role);
            const assignment = makeAssignment({ user_id: 'user-del' });

            component.revokeAssignment(assignment);
            expect(component.saving()).toBe(true);

            const req = httpTesting.expectOne(r =>
                r.url.includes('/admin/roles/assignments/user-del') && r.method === 'DELETE',
            );
            req.flush({ success: true });

            expect(component.saving()).toBe(false);

            httpTesting
                .expectOne(r => r.url.includes('/admin/roles/assignments') && r.method === 'GET')
                .flush(EMPTY_ASSIGNMENTS_RESPONSE);
        });

        it('resets saving flag on error', () => {
            const role = makeRole({ role_name: 'editor' });
            component.selectedRole.set(role);
            const assignment = makeAssignment({ user_id: 'user-del' });

            component.revokeAssignment(assignment);
            httpTesting
                .expectOne(r => r.url.includes('/admin/roles/assignments/user-del') && r.method === 'DELETE')
                .flush('Not Found', { status: 404, statusText: 'Not Found' });

            expect(component.saving()).toBe(false);
        });
    });
});
