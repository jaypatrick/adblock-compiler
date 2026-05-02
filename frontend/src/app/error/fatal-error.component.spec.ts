import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { FatalErrorComponent } from './fatal-error.component';
import { AuthFacadeService } from '../services/auth-facade.service';
import { provideTestBed } from '../../test-utils';

describe('FatalErrorComponent', () => {
    let mockAuth: { isAdmin: ReturnType<typeof signal<boolean>> };

    beforeEach(() => {
        mockAuth = { isAdmin: signal(false) };

        TestBed.configureTestingModule({
            imports: [FatalErrorComponent],
            providers: [
                ...provideTestBed('browser'),
                provideRouter([]),
                { provide: AuthFacadeService, useValue: mockAuth },
            ],
        });
    });

    it('should create', () => {
        const fixture = TestBed.createComponent(FatalErrorComponent);
        expect(fixture.componentInstance).toBeTruthy();
    });

    it('should show generic error heading when no Router state', () => {
        const fixture = TestBed.createComponent(FatalErrorComponent);
        fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement;
        expect(el.textContent).toMatch(/something went wrong|fatal error|critical/i);
    });

    it('should display AppError message from Router state', () => {
        const router = TestBed.inject(Router);
        // Simulate navigation state — wrap in signal() since lastSuccessfulNavigation is Signal<Navigation | null>
        vi.spyOn(router, 'lastSuccessfulNavigation', 'get').mockReturnValue(
            signal({ extras: { state: { error: { message: 'DB connection lost', isFatal: true, timestamp: new Date() } } } }) as any,
        );

        const fixture = TestBed.createComponent(FatalErrorComponent);
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('DB connection lost');
    });

    it('should NOT show admin details panel when isAdmin is false', () => {
        const fixture = TestBed.createComponent(FatalErrorComponent);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.fe-admin-details')).toBeNull();
    });

    it('should show admin details panel when isAdmin is true', () => {
        const router = TestBed.inject(Router);
        vi.spyOn(router, 'lastSuccessfulNavigation', 'get').mockReturnValue(
            signal({
                extras: {
                    state: {
                        error: {
                            message: 'DB down',
                            isFatal: true,
                            code: 'SERVICE_UNAVAILABLE',
                            severity: 'fatal',
                            timestamp: new Date(),
                        },
                    },
                },
            }) as any,
        );

        mockAuth.isAdmin.set(true);
        const fixture = TestBed.createComponent(FatalErrorComponent);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.fe-admin-details')).not.toBeNull();
    });

    it('should show Reload button', () => {
        const fixture = TestBed.createComponent(FatalErrorComponent);
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Reload');
    });

    it('should show Go Home button', () => {
        const fixture = TestBed.createComponent(FatalErrorComponent);
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Go Home');
    });
});
