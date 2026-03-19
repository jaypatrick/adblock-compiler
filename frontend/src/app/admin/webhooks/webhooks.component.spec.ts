import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { WebhooksComponent } from './webhooks.component';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_EVENTS_RESPONSE = { success: true, items: [], total: 0 };

function makeEvent(overrides: Partial<{
    id: string; event_type: string; user_id: string | null; status: string;
    processing_time_ms: number | null; error_message: string | null; created_at: string;
}> = {}) {
    return {
        id: 'evt-1',
        event_type: 'user.created',
        user_id: 'user-abc',
        status: 'processed',
        processing_time_ms: 42,
        error_message: null,
        created_at: '2024-01-01T00:00:00Z',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('WebhooksComponent', () => {
    let fixture: ComponentFixture<WebhooksComponent>;
    let component: WebhooksComponent;
    let httpTesting: HttpTestingController;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [WebhooksComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideHttpClient(),
                provideHttpClientTesting(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(WebhooksComponent);
        component = fixture.componentInstance;
        httpTesting = TestBed.inject(HttpTestingController);
        fixture.detectChanges();
        // Drain afterNextRender HTTP calls
        httpTesting.match(() => true).forEach(r => r.flush(EMPTY_EVENTS_RESPONSE));
    });

    afterEach(() => httpTesting.verify());

    // -----------------------------------------------------------------------
    // Baseline
    // -----------------------------------------------------------------------

    it('should create the component', () => {
        expect(component).toBeTruthy();
    });

    it('should start with correct default signal values', () => {
        expect(component.events()).toEqual([]);
        expect(component.dlqEvents()).toEqual([]);
        expect(component.loading()).toBe(false);
        expect(component.loadingDlq()).toBe(false);
        expect(component.apiUnavailable()).toBe(false);
    });

    // -----------------------------------------------------------------------
    // loadData()
    // -----------------------------------------------------------------------

    describe('loadData()', () => {
        it('populates events signal on success', () => {
            const event = makeEvent();
            component.loadData();

            const req = httpTesting.expectOne('/admin/webhooks/events');
            expect(req.request.method).toBe('GET');
            req.flush({ success: true, items: [event], total: 1 });

            expect(component.events()).toEqual([event]);
            expect(component.loading()).toBe(false);
            expect(component.apiUnavailable()).toBe(false);
        });

        it('sets loading true while request is in-flight', () => {
            component.loadData();
            expect(component.loading()).toBe(true);
            httpTesting.expectOne('/admin/webhooks/events').flush(EMPTY_EVENTS_RESPONSE);
        });

        it('clears apiUnavailable flag at start of each call', () => {
            component.apiUnavailable.set(true);
            component.loadData();
            expect(component.apiUnavailable()).toBe(false);
            httpTesting.expectOne('/admin/webhooks/events').flush(EMPTY_EVENTS_RESPONSE);
        });

        it('handles empty items array in response', () => {
            component.loadData();
            httpTesting.expectOne('/admin/webhooks/events').flush({ success: true, items: [], total: 0 });
            expect(component.events()).toEqual([]);
        });

        it('sets apiUnavailable on 404 error', () => {
            component.loadData();
            httpTesting
                .expectOne('/admin/webhooks/events')
                .flush('Not Found', { status: 404, statusText: 'Not Found' });

            expect(component.apiUnavailable()).toBe(true);
            expect(component.loading()).toBe(false);
        });

        it('clears events and resets loading on non-404 error', () => {
            component.events.set([makeEvent()]);
            component.loadData();
            httpTesting
                .expectOne('/admin/webhooks/events')
                .flush('Server Error', { status: 500, statusText: 'Server Error' });

            expect(component.events()).toEqual([]);
            expect(component.apiUnavailable()).toBe(false);
            expect(component.loading()).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // onTabChange() → DLQ loading
    // -----------------------------------------------------------------------

    describe('onTabChange()', () => {
        it('does NOT load DLQ when switching to tab 0', () => {
            component.onTabChange(0);
            httpTesting.expectNone('/admin/webhooks/events/dlq');
        });

        it('loads DLQ events when switching to tab 1 for the first time', () => {
            const dlqEvent = makeEvent({ id: 'dlq-1', status: 'failed', error_message: 'Oops' });
            component.onTabChange(1);

            expect(component.loadingDlq()).toBe(true);

            const req = httpTesting.expectOne('/admin/webhooks/events/dlq');
            expect(req.request.method).toBe('GET');
            req.flush({ success: true, items: [dlqEvent], total: 1 });

            expect(component.dlqEvents()).toEqual([dlqEvent]);
            expect(component.loadingDlq()).toBe(false);
        });

        it('does NOT re-fetch DLQ when tab 1 is activated a second time', () => {
            // First activation — loads DLQ
            component.onTabChange(1);
            httpTesting.expectOne('/admin/webhooks/events/dlq').flush(EMPTY_EVENTS_RESPONSE);

            // Second activation — should not trigger another request
            component.onTabChange(1);
            httpTesting.expectNone('/admin/webhooks/events/dlq');
        });

        it('clears dlqEvents and resets loadingDlq on DLQ error', () => {
            component.onTabChange(1);
            httpTesting
                .expectOne('/admin/webhooks/events/dlq')
                .flush('Server Error', { status: 500, statusText: 'Server Error' });

            expect(component.dlqEvents()).toEqual([]);
            expect(component.loadingDlq()).toBe(false);
        });
    });
});
