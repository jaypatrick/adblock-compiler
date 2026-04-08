import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DiffComponent } from './diff.component';
import { API_BASE_URL } from '../tokens';

describe('DiffComponent', () => {
    let fixture: ComponentFixture<DiffComponent>;
    let component: DiffComponent;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [DiffComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: API_BASE_URL, useValue: '/api' },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(DiffComponent);
        component = fixture.componentInstance;
        await fixture.whenStable();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should start with empty input texts', () => {
        expect(component.originalText()).toBe('');
        expect(component.currentText()).toBe('');
    });

    it('should default analyzeDomains and includeFullRules to true', () => {
        expect(component.opts.analyzeDomains).toBeTrue();
        expect(component.opts.includeFullRules).toBeTrue();
    });

    it('should count rules from originalText', () => {
        component.originalText.set('||example.com^\n||ads.com^\n');
        expect(component.originalCount()).toBe(2);
    });

    it('should count rules from currentText', () => {
        component.currentText.set('||example.com^\n');
        expect(component.currentCount()).toBe(1);
    });

    it('should not allow compare when both lists are empty', () => {
        expect(component.canCompare()).toBeFalse();
    });

    it('should not allow compare when only one list has rules', () => {
        component.originalText.set('||example.com^');
        expect(component.canCompare()).toBeFalse();
    });

    it('should allow compare when both lists have rules', () => {
        component.originalText.set('||a.com^');
        component.currentText.set('||b.com^');
        expect(component.canCompare()).toBeTrue();
    });

    it('should not trigger diff on compare() with empty inputs', () => {
        component.compare();
        expect(component.diffResource.value()).toBeUndefined();
    });

    it('should render the page heading', async () => {
        await fixture.whenStable();
        const el: HTMLElement = fixture.nativeElement;
        expect(el.querySelector('h1')?.textContent).toContain('Filter List Diff');
    });
});
