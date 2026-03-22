import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NEVER } from 'rxjs';
import { StorageComponent } from './storage.component';
import { AuthFacadeService } from '../../services/auth-facade.service';
import { StorageService } from '../../services/storage.service';

// ============================================================================
// Mocks
// ============================================================================

function createMockAuthFacadeService(signedIn = false) {
    return {
        isLoaded: signal(true),
        isSignedIn: signal(signedIn),
        isAdmin: signal(signedIn),
        userIdentifier: signal(signedIn ? 'admin@example.com' : null),
    };
}

function createMockStorageService() {
    return {
        getStats: vi.fn(() => NEVER),
        clearCache: vi.fn(() => NEVER),
        clearExpired: vi.fn(() => NEVER),
        vacuum: vi.fn(() => NEVER),
        exportData: vi.fn(() => NEVER),
        query: vi.fn(() => NEVER),
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('StorageComponent', () => {
    let fixture: ComponentFixture<StorageComponent>;
    let component: StorageComponent;
    let mockAuth: ReturnType<typeof createMockAuthFacadeService>;
    let mockStorage: ReturnType<typeof createMockStorageService>;

    async function setup(signedIn = false) {
        mockAuth = createMockAuthFacadeService(signedIn);
        mockStorage = createMockStorageService();

        await TestBed.configureTestingModule({
            imports: [StorageComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: AuthFacadeService, useValue: mockAuth },
                { provide: StorageService, useValue: mockStorage },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(StorageComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    }

    describe('component creation', () => {
        beforeEach(async () => { await setup(true); });

        it('should create', () => {
            expect(component).toBeTruthy();
        });
    });

    describe('destructive SQL blocking', () => {
        beforeEach(async () => { await setup(true); });

        const destructiveStatements = ['DROP TABLE users', 'DELETE FROM logs', 'INSERT INTO t VALUES(1)', 'UPDATE users SET x=1', 'TRUNCATE audit_log', 'ALTER TABLE t ADD COLUMN x'];

        for (const sql of destructiveStatements) {
            it(`should block destructive SQL — ${sql.split(' ')[0]}`, () => {
                component.sqlInput = sql;
                component.runQuery();
                expect(component.sqlWarning()).toBeTruthy();
            });
        }

        it('should clear sqlWarning for a safe SELECT query', () => {
            component.sqlInput = 'SELECT * FROM tier_configs';
            component.runQuery();
            expect(component.sqlWarning()).toBeNull();
        });

        it('should not execute query when sqlInput is empty', () => {
            component.sqlInput = '';
            component.runQuery();
            // runQuery returns early for empty input; sqlWarning stays null
            expect(component.sqlWarning()).toBeNull();
        });
    });
});
