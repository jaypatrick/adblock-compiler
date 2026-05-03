import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { NotFoundComponent } from './not-found.component';
import { AuthFacadeService } from '../services/auth-facade.service';
import { provideTestBed } from '../../test-utils';

describe('NotFoundComponent', () => {
    let mockAuth: { isAdmin: ReturnType<typeof signal<boolean>> };

    beforeEach(() => {
        mockAuth = { isAdmin: signal(false) };

        TestBed.configureTestingModule({
            imports: [NotFoundComponent],
            providers: [
                ...provideTestBed('browser'),
                provideRouter([]),
                { provide: AuthFacadeService, useValue: mockAuth },
            ],
        });
    });

    it('should create', () => {
        const fixture = TestBed.createComponent(NotFoundComponent);
        expect(fixture.componentInstance).toBeTruthy();
    });

    it('should display 404 heading', () => {
        const fixture = TestBed.createComponent(NotFoundComponent);
        fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement;
        expect(el.textContent).toContain('404');
    });

    it('should render Go Home button', () => {
        const fixture = TestBed.createComponent(NotFoundComponent);
        fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement;
        expect(el.textContent).toContain('Go Home');
    });

    it('should render Go Back button', () => {
        const fixture = TestBed.createComponent(NotFoundComponent);
        fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement;
        expect(el.textContent).toContain('Go Back');
    });

    it('should NOT show admin path chip when isAdmin is false', () => {
        const fixture = TestBed.createComponent(NotFoundComponent);
        fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement;
        expect(el.querySelector('.nf-admin-chip')).toBeNull();
    });

    it('should show admin path chip when isAdmin is true', () => {
        mockAuth.isAdmin.set(true);
        const fixture = TestBed.createComponent(NotFoundComponent);
        fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement;
        expect(el.querySelector('.nf-admin-chip')).not.toBeNull();
    });
});
