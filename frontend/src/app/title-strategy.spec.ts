import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, TitleStrategy, RouterStateSnapshot, ActivatedRouteSnapshot } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { AppTitleStrategy } from './title-strategy';

/** Build a minimal RouterStateSnapshot stub with optional route data. */
function makeSnapshot(data: Record<string, unknown> = {}): RouterStateSnapshot {
    const root = { data, firstChild: null } as unknown as ActivatedRouteSnapshot;
    return { root } as RouterStateSnapshot;
}

describe('AppTitleStrategy', () => {
    let strategy: AppTitleStrategy;
    let titleService: Title;
    let metaService: Meta;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideRouter([]),
                { provide: TitleStrategy, useClass: AppTitleStrategy },
            ],
        });
        strategy = TestBed.inject(TitleStrategy) as AppTitleStrategy;
        titleService = TestBed.inject(Title);
        metaService = TestBed.inject(Meta);
    });

    it('should set "Bloqr — PageName" when route has a title', () => {
        vi.spyOn(strategy, 'buildTitle').mockReturnValue('Compiler');
        strategy.updateTitle(makeSnapshot());
        expect(titleService.getTitle()).toBe('Bloqr \u2014 Compiler');
    });

    it('should set "Bloqr" when route has no title', () => {
        vi.spyOn(strategy, 'buildTitle').mockReturnValue(undefined);
        strategy.updateTitle(makeSnapshot());
        expect(titleService.getTitle()).toBe('Bloqr');
    });

    it('should set correct title for each named route', () => {
        const pages = ['Dashboard', 'Compiler', 'Performance', 'Validation', 'API Reference', 'Admin'];
        for (const page of pages) {
            vi.spyOn(strategy, 'buildTitle').mockReturnValue(page);
            strategy.updateTitle(makeSnapshot());
            expect(titleService.getTitle()).toBe(`Bloqr \u2014 ${page}`);
        }
    });

    it('should set meta description from route data', () => {
        vi.spyOn(strategy, 'buildTitle').mockReturnValue('Compiler');
        strategy.updateTitle(makeSnapshot({ metaDescription: 'Custom description for compiler page.' }));
        const tag = metaService.getTag('name="description"');
        expect(tag?.content).toBe('Custom description for compiler page.');
    });

    it('should use default description when route has no metaDescription', () => {
        vi.spyOn(strategy, 'buildTitle').mockReturnValue('Dashboard');
        strategy.updateTitle(makeSnapshot());
        const tag = metaService.getTag('name="description"');
        expect(tag?.content).toContain('AI-powered adblock list management and real-time threat intelligence');
    });
});
