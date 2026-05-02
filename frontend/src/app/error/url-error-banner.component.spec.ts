import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';

import { UrlErrorBannerComponent } from './url-error-banner.component';
import { FlashService } from '../services/flash.service';
import { AuthFacadeService } from '../services/auth-facade.service';
import { FLASH_ENDPOINT } from '../tokens';
import { provideTestBed } from '../../test-utils';

describe('UrlErrorBannerComponent', () => {
    let mockFlash: { currentFlash: ReturnType<typeof signal<null>>; clear: ReturnType<typeof vi.fn> };
    let mockAuth: { isAdmin: ReturnType<typeof signal<boolean>> };

    beforeEach(() => {
        mockFlash = { currentFlash: signal(null), clear: vi.fn() };
        mockAuth = { isAdmin: signal(false) };

        TestBed.configureTestingModule({
            imports: [UrlErrorBannerComponent],
            providers: [
                ...provideTestBed('browser'),
                provideRouter([]),
                { provide: FlashService, useValue: mockFlash },
                { provide: AuthFacadeService, useValue: mockAuth },
                { provide: FLASH_ENDPOINT, useValue: '/api/flash' },
            ],
        });
    });

    it('should create the component', () => {
        const fixture = TestBed.createComponent(UrlErrorBannerComponent);
        expect(fixture.componentInstance).toBeTruthy();
    });

    it('should not render a banner when no flash and no error param', () => {
        const fixture = TestBed.createComponent(UrlErrorBannerComponent);
        fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement;
        expect(el.querySelector('.ueb-banner')).toBeNull();
    });

    it('should render banner when FlashService has a message', () => {
        mockFlash.currentFlash.set({ message: 'Token expired', type: 'warn', createdAt: new Date().toISOString() });
        const fixture = TestBed.createComponent(UrlErrorBannerComponent);
        fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement;
        expect(el.querySelector('.ueb-banner')).not.toBeNull();
        expect(el.textContent).toContain('Token expired');
    });

    it('should show admin chip only when isAdmin() is true', () => {
        mockFlash.currentFlash.set({ message: 'Test', type: 'info', createdAt: new Date().toISOString() });
        const fixture = TestBed.createComponent(UrlErrorBannerComponent);
        fixture.detectChanges();
        const el: HTMLElement = fixture.nativeElement;
        expect(el.querySelector('.ueb-admin-chip')).toBeNull();

        mockAuth.isAdmin.set(true);
        fixture.detectChanges();
        expect(el.querySelector('.ueb-admin-chip')).not.toBeNull();
    });

    it('should call flash.clear() when dismiss is clicked', fakeAsync(() => {
        mockFlash.currentFlash.set({ message: 'Dismiss me', type: 'info', createdAt: new Date().toISOString() });
        const fixture = TestBed.createComponent(UrlErrorBannerComponent);
        fixture.detectChanges();
        const btn: HTMLButtonElement | null = fixture.nativeElement.querySelector('.ueb-close-btn');
        btn?.click();
        tick();
        expect(mockFlash.clear).toHaveBeenCalled();
    }));
});
