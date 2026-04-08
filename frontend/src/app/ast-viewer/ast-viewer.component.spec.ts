import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { AstViewerComponent } from './ast-viewer.component';
import { AstViewerService } from '../services/ast-viewer.service';
import { of } from 'rxjs';

const mockAstResult = {
    success: true,
    parsedRules: [
        { ruleText: '||example.com^', success: true, category: 'Network', type: 'NetworkRule', valid: true, properties: { network: { pattern: '||example.com^', isException: false, modifiers: [] } } },
        { ruleText: '! comment', success: true, category: 'Comment', type: 'CommentRule', valid: true, properties: { comment: { text: 'comment' } } },
    ],
    summary: { total: 2, successful: 2, failed: 0, byCategory: { Network: 1, Comment: 1 }, byType: {} },
};

describe('AstViewerComponent', () => {
    let fixture: ComponentFixture<AstViewerComponent>;
    let component: AstViewerComponent;
    let mockService: { parse: ReturnType<typeof vi.fn>, parseText: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        mockService = {
            parse: vi.fn().mockReturnValue(of(mockAstResult)),
            parseText: vi.fn().mockReturnValue(of(mockAstResult)),
        };

        await TestBed.configureTestingModule({
            imports: [AstViewerComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                { provide: AstViewerService, useValue: mockService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(AstViewerComponent);
        component = fixture.componentInstance;
        await fixture.whenStable();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should return 0 ruleCount for empty text', () => {
        component.rulesText.set('');
        expect(component.ruleCount()).toBe(0);
    });

    it('should count non-empty lines in ruleCount', () => {
        component.rulesText.set('||example.com^\n@@||trusted.com^\n! comment');
        expect(component.ruleCount()).toBe(3);
    });

    it('should load example rules when loadExamples is called', () => {
        component.loadExamples();
        expect(component.rulesText().length).toBeGreaterThan(0);
        expect(component.ruleCount()).toBeGreaterThan(0);
    });

    it('should default showAst to true', () => {
        expect(component.showAst()).toBe(true);
    });

    it('should toggle showAst', () => {
        component.showAst.set(false);
        expect(component.showAst()).toBe(false);
        component.showAst.set(true);
        expect(component.showAst()).toBe(true);
    });

    it('should return error color for failed rules', () => {
        const color = component.getCategoryColor({ ruleText: 'invalid', success: false });
        expect(color).toBe('var(--mat-sys-error)');
    });

    it('should return primary color for Network rules', () => {
        const color = component.getCategoryColor({ ruleText: '||x^', success: true, category: 'Network' });
        expect(color).toBe('var(--mat-sys-primary)');
    });

    it('should return pink for Cosmetic rules', () => {
        const color = component.getCategoryColor({ ruleText: 'x##.x', success: true, category: 'Cosmetic' });
        expect(color).toBe('#d63384');
    });

    it('should return error icon for failed rules', () => {
        const icon = component.getCategoryIcon({ ruleText: 'bad', success: false });
        expect(icon).toBe('error');
    });

    it('should return block icon for Network rules', () => {
        const icon = component.getCategoryIcon({ ruleText: '||x^', success: true, category: 'Network' });
        expect(icon).toBe('block');
    });
});
