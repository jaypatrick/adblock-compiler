import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, DOCUMENT, PLATFORM_ID } from '@angular/core';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
    let service: ThemeService;
    let doc: Document;

    beforeEach(() => {
        localStorage.clear();
        TestBed.configureTestingModule({
            providers: [provideZonelessChangeDetection()],
        });
        service = TestBed.inject(ThemeService);
        doc = TestBed.inject(DOCUMENT);
        // Ensure clean state
        doc.body.classList.remove('dark-theme');
        doc.documentElement.removeAttribute('data-theme');
    });

    afterEach(() => {
        localStorage.clear();
        doc.body.classList.remove('dark-theme');
        doc.documentElement.removeAttribute('data-theme');
        vi.restoreAllMocks();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should default to light mode', () => {
        expect(service.isDark()).toBe(false);
    });

    it('should toggle to dark mode', () => {
        service.toggle();
        expect(service.isDark()).toBe(true);
        expect(doc.body.classList.contains('dark-theme')).toBe(true);
    });

    it('should toggle back to light mode', () => {
        service.toggle(); // → dark
        service.toggle(); // → light
        expect(service.isDark()).toBe(false);
        expect(doc.body.classList.contains('dark-theme')).toBe(false);
    });

    it('should persist theme preference to localStorage', () => {
        service.toggle();
        expect(localStorage.getItem('theme')).toBe('dark');

        service.toggle();
        expect(localStorage.getItem('theme')).toBe('light');
    });

    it('should load dark theme from localStorage', () => {
        localStorage.setItem('theme', 'dark');
        service.loadPreferences();
        expect(service.isDark()).toBe(true);
        expect(doc.body.classList.contains('dark-theme')).toBe(true);
    });

    it('should load light theme from localStorage', () => {
        localStorage.setItem('theme', 'light');
        service.loadPreferences();
        expect(service.isDark()).toBe(false);
        expect(doc.body.classList.contains('dark-theme')).toBe(false);
    });

    it('should default to light when localStorage is empty', () => {
        service.loadPreferences();
        expect(service.isDark()).toBe(false);
    });

    // -------------------------------------------------------------------------
    // data-theme attribute
    // -------------------------------------------------------------------------

    it('should set data-theme="dark" on <html> when toggling to dark', () => {
        service.toggle();
        expect(doc.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('should set data-theme="light" on <html> when toggling back to light', () => {
        service.toggle(); // dark
        service.toggle(); // light
        expect(doc.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('should set data-theme="dark" when loading dark preference', () => {
        localStorage.setItem('theme', 'dark');
        service.loadPreferences();
        expect(doc.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('should set data-theme="light" when loading light preference', () => {
        localStorage.setItem('theme', 'light');
        service.loadPreferences();
        expect(doc.documentElement.getAttribute('data-theme')).toBe('light');
    });

    // -------------------------------------------------------------------------
    // Error resilience
    // -------------------------------------------------------------------------

    it('should update signal and DOM even when localStorage.setItem throws during toggle', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('QuotaExceededError');
        });
        expect(() => service.toggle()).not.toThrow();
        expect(service.isDark()).toBe(true);
        expect(doc.body.classList.contains('dark-theme')).toBe(true);
    });

    it('should fall back to light theme when localStorage.getItem throws during loadPreferences', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('SecurityError');
        });
        expect(() => service.loadPreferences()).not.toThrow();
        expect(service.isDark()).toBe(false);
    });

    // -------------------------------------------------------------------------
    // SSR platform guard
    // -------------------------------------------------------------------------

    it('should skip localStorage and DOM on server platform', () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                { provide: PLATFORM_ID, useValue: 'server' },
            ],
        });
        const ssrService = TestBed.inject(ThemeService);
        const getSpy = vi.spyOn(Storage.prototype, 'getItem');

        expect(() => ssrService.loadPreferences()).not.toThrow();
        expect(getSpy).not.toHaveBeenCalled();
        expect(ssrService.isDark()).toBe(false);
    });
});
