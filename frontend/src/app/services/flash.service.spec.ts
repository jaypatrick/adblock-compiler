/**
 * Unit tests for FlashService.
 *
 * Tests cover:
 *  - set() writes to currentFlash signal
 *  - clear() nulls the signal
 *  - consume() makes a GET request and updates the signal
 *  - consume() silently ignores HTTP errors
 *  - readFromUrl() calls consume() when ?flash= param is present
 *  - readFromUrl() is a no-op on the server platform
 */

import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { FlashService, FlashMessage } from './flash.service';
import { FLASH_ENDPOINT } from '../tokens';
import { provideTestBed } from '../../test-utils';

const BASE_FLASH_URL = '/api/flash';

describe('FlashService', () => {
    let service: FlashService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                ...provideTestBed('browser'),
                { provide: FLASH_ENDPOINT, useValue: BASE_FLASH_URL },
            ],
        });

        service = TestBed.inject(FlashService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => httpMock.verify());

    // ── set() ──────────────────────────────────────────────────────────────

    describe('set()', () => {
        it('should write a FlashMessage to currentFlash', () => {
            service.set('You must sign in', 'warn');
            const flash = service.currentFlash();
            expect(flash).not.toBeNull();
            expect(flash!.message).toBe('You must sign in');
            expect(flash!.type).toBe('warn');
        });

        it('should set createdAt to an ISO date string', () => {
            service.set('Hello', 'info');
            const flash = service.currentFlash();
            expect(new Date(flash!.createdAt).toISOString()).toBe(flash!.createdAt);
        });

        it('should overwrite a previous flash', () => {
            service.set('First', 'info');
            service.set('Second', 'error');
            expect(service.currentFlash()!.message).toBe('Second');
        });
    });

    // ── clear() ────────────────────────────────────────────────────────────

    describe('clear()', () => {
        it('should set currentFlash to null', () => {
            service.set('Hello', 'success');
            service.clear();
            expect(service.currentFlash()).toBeNull();
        });

        it('should be safe to call when already null', () => {
            expect(() => service.clear()).not.toThrow();
        });
    });

    // ── consume() ──────────────────────────────────────────────────────────

    describe('consume()', () => {
        const mockFlash: FlashMessage = {
            message: 'Token expired',
            type: 'warn',
            createdAt: new Date().toISOString(),
        };

        it('should make a GET request to the flash endpoint with the token', fakeAsync(() => {
            service.consume('abc123');
            const req = httpMock.expectOne(`${BASE_FLASH_URL}/abc123`);
            expect(req.request.method).toBe('GET');
            req.flush(mockFlash);
            tick();
        }));

        it('should update currentFlash on a successful response', fakeAsync(() => {
            service.consume('abc123');
            httpMock.expectOne(`${BASE_FLASH_URL}/abc123`).flush(mockFlash);
            tick();
            expect(service.currentFlash()).toEqual(mockFlash);
        }));

        it('should silently ignore a 404 error', fakeAsync(() => {
            service.consume('bad-token');
            httpMock.expectOne(`${BASE_FLASH_URL}/bad-token`).flush(
                { message: 'Not found' },
                { status: 404, statusText: 'Not Found' },
            );
            tick();
            expect(service.currentFlash()).toBeNull();
        }));

        it('should silently ignore a network error', fakeAsync(() => {
            service.consume('tok');
            const req = httpMock.expectOne(`${BASE_FLASH_URL}/tok`);
            req.error(new ProgressEvent('error'));
            tick();
            expect(service.currentFlash()).toBeNull();
        }));
    });

    // ── readFromUrl() ──────────────────────────────────────────────────────

    describe('readFromUrl()', () => {
        it('should call consume() when ?flash= param is present', () => {
            const consumeSpy = vi.spyOn(service, 'consume');
            Object.defineProperty(window, 'location', {
                value: { search: '?flash=tok123' },
                writable: true,
            });
            service.readFromUrl();
            expect(consumeSpy).toHaveBeenCalledWith('tok123');
        });

        it('should NOT call consume() when ?flash= param is absent', () => {
            const consumeSpy = vi.spyOn(service, 'consume');
            Object.defineProperty(window, 'location', {
                value: { search: '?other=value' },
                writable: true,
            });
            service.readFromUrl();
            expect(consumeSpy).not.toHaveBeenCalled();
        });
    });

    // ── server-side guard ──────────────────────────────────────────────────

    describe('readFromUrl() on server', () => {
        let serverService: FlashService;

        beforeEach(() => {
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    ...provideTestBed('server'),
                    { provide: FLASH_ENDPOINT, useValue: BASE_FLASH_URL },
                ],
            });
            serverService = TestBed.inject(FlashService);
        });

        it('should be a no-op on the server platform', () => {
            const consumeSpy = vi.spyOn(serverService, 'consume');
            serverService.readFromUrl();
            expect(consumeSpy).not.toHaveBeenCalled();
        });
    });
});
