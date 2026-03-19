import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, PLATFORM_ID } from '@angular/core';
import { TurnstileService } from './turnstile.service';

/** Minimal turnstile global stub */
function makeTurnstileGlobal(widgetId = 'widget-1') {
    return {
        render: vi.fn().mockReturnValue(widgetId),
        reset: vi.fn(),
        remove: vi.fn(),
    };
}

describe('TurnstileService', () => {
    let service: TurnstileService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                { provide: PLATFORM_ID, useValue: 'browser' },
            ],
        });
        service = TestBed.inject(TurnstileService);
    });

    afterEach(() => {
        // Clean up any turnstile global stub added during tests
        delete (globalThis as Record<string, unknown>)['turnstile'];
        vi.restoreAllMocks();
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should start with empty token', () => {
        expect(service.token()).toBe('');
    });

    it('should not be verified initially', () => {
        expect(service.isVerified()).toBe(false);
    });

    it('should expose siteKey signal starting empty', () => {
        expect(service.siteKey()).toBe('');
    });

    it('setSiteKey should update the siteKey signal', () => {
        service.setSiteKey('0x4AAAAAAA-test-key');
        expect(service.siteKey()).toBe('0x4AAAAAAA-test-key');
    });

    it('should update token signal', () => {
        service.token.set('test-token-123');
        expect(service.token()).toBe('test-token-123');
        expect(service.isVerified()).toBe(true);
    });

    it('should reset token', () => {
        service.token.set('some-token');
        service.reset();
        expect(service.token()).toBe('');
        expect(service.isVerified()).toBe(false);
    });

    it('should remove and clear token', () => {
        service.token.set('some-token');
        service.remove();
        expect(service.token()).toBe('');
    });

    it('should warn and return null when no site key is configured', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = service.render(document.createElement('div'));
        expect(result).toBeNull();
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('No site key'));
        spy.mockRestore();
    });

    // -------------------------------------------------------------------------
    // SSR platform guard
    // -------------------------------------------------------------------------

    it('should return null without rendering when platform is server', () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                { provide: PLATFORM_ID, useValue: 'server' },
            ],
        });
        const ssrService = TestBed.inject(TurnstileService);
        ssrService.setSiteKey('test-key');

        const container = document.createElement('div');
        const result = ssrService.render(container);
        expect(result).toBeNull();
    });

    // -------------------------------------------------------------------------
    // render() with mocked global turnstile
    // -------------------------------------------------------------------------

    it('should render widget and return widgetId when turnstile global is available', () => {
        const stub = makeTurnstileGlobal('widget-abc');
        (globalThis as Record<string, unknown>)['turnstile'] = stub;
        service.setSiteKey('test-key');

        const container = document.createElement('div');
        const widgetId = service.render(container);

        expect(widgetId).toBe('widget-abc');
        expect(stub.render).toHaveBeenCalledWith(
            container,
            expect.objectContaining({ sitekey: 'test-key' }),
        );
    });

    it('should call expired-callback to clear token', () => {
        let expiredCb: (() => void) | undefined;
        const stub = {
            render: vi.fn().mockImplementation((_el: HTMLElement, opts: { 'expired-callback'?: () => void }) => {
                expiredCb = opts['expired-callback'];
                return 'w-1';
            }),
            reset: vi.fn(),
            remove: vi.fn(),
        };
        (globalThis as Record<string, unknown>)['turnstile'] = stub;
        service.setSiteKey('key');
        service.token.set('existing-token');

        service.render(document.createElement('div'));
        expiredCb?.();

        expect(service.token()).toBe('');
    });

    it('should call error-callback to clear token', () => {
        let errorCb: (() => void) | undefined;
        const stub = {
            render: vi.fn().mockImplementation((_el: HTMLElement, opts: { 'error-callback'?: () => void }) => {
                errorCb = opts['error-callback'];
                return 'w-1';
            }),
            reset: vi.fn(),
            remove: vi.fn(),
        };
        (globalThis as Record<string, unknown>)['turnstile'] = stub;
        service.setSiteKey('key');
        service.token.set('existing-token');

        service.render(document.createElement('div'));
        errorCb?.();

        expect(service.token()).toBe('');
    });

    it('should return null and warn when turnstile.render throws', () => {
        const stub = {
            render: vi.fn().mockImplementation(() => { throw new Error('not loaded'); }),
            reset: vi.fn(),
            remove: vi.fn(),
        };
        (globalThis as Record<string, unknown>)['turnstile'] = stub;
        service.setSiteKey('test-key');

        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = service.render(document.createElement('div'));

        expect(result).toBeNull();
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('render failed'));
        spy.mockRestore();
    });

    // -------------------------------------------------------------------------
    // reset() / remove() with an active widgetId
    // -------------------------------------------------------------------------

    it('reset should call turnstile.reset with the widgetId', () => {
        const stub = makeTurnstileGlobal('w-reset');
        (globalThis as Record<string, unknown>)['turnstile'] = stub;
        service.setSiteKey('key');
        service.render(document.createElement('div'));
        service.token.set('tok');

        service.reset();

        expect(stub.reset).toHaveBeenCalledWith('w-reset');
        expect(service.token()).toBe('');
    });

    it('remove should call turnstile.remove with the widgetId', () => {
        const stub = makeTurnstileGlobal('w-remove');
        (globalThis as Record<string, unknown>)['turnstile'] = stub;
        service.setSiteKey('key');
        service.render(document.createElement('div'));

        service.remove();

        expect(stub.remove).toHaveBeenCalledWith('w-remove');
        expect(service.token()).toBe('');
    });

    it('remove should silently handle turnstile.remove throwing', () => {
        const stub = {
            render: vi.fn().mockReturnValue('w-err'),
            reset: vi.fn(),
            remove: vi.fn().mockImplementation(() => { throw new Error('gone'); }),
        };
        (globalThis as Record<string, unknown>)['turnstile'] = stub;
        service.setSiteKey('key');
        service.render(document.createElement('div'));

        expect(() => service.remove()).not.toThrow();
        expect(service.token()).toBe('');
    });
});
