import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { DiffService } from './diff.service';
import { API_BASE_URL } from '../tokens';
import { firstValueFrom } from 'rxjs';

const mockDiffResponse = {
    success: true,
    parseErrors: { original: [], current: [] },
    report: {
        timestamp: '2026-01-01T00:00:00.000Z',
        generatorVersion: '1.0.0',
        original: { ruleCount: 2 },
        current:  { ruleCount: 2 },
        summary: {
            originalCount: 2, newCount: 2,
            addedCount: 1, removedCount: 1, unchangedCount: 1,
            netChange: 0, percentageChange: 0,
        },
        added:         [{ rule: '||newads.com^', type: 'added' }],
        removed:       [{ rule: '||oldads.com^', type: 'removed' }],
        domainChanges: [],
    },
    duration: '5ms',
};

describe('DiffService', () => {
    let service: DiffService;
    let http: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
                { provide: API_BASE_URL, useValue: '/api' },
            ],
        });
        service = TestBed.inject(DiffService);
        http    = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should POST to /api/diff and return a validated response', async () => {
        const original = ['||example.com^', '||oldads.com^'];
        const current  = ['||example.com^', '||newads.com^'];

        const promise = firstValueFrom(service.diff(original, current));
        const req = http.expectOne('/api/diff');
        expect(req.request.method).toBe('POST');
        expect(req.request.body).toEqual({ original, current, options: undefined });
        req.flush(mockDiffResponse);

        const result = await promise;
        expect(result.report.summary.addedCount).toBe(1);
        expect(result.report.summary.removedCount).toBe(1);
    });

    it('should pass options to the request body', () => {
        service.diff(['||a.com^'], ['||b.com^'], { analyzeDomains: false }).subscribe();
        const req = http.expectOne('/api/diff');
        expect(req.request.body.options).toEqual({ analyzeDomains: false });
        req.flush(mockDiffResponse);
    });
});
