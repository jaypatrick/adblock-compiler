import { provideZonelessChangeDetection, PLATFORM_ID } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { API_BASE_URL } from './app/tokens';

/**
 * Returns a standard set of Angular TestBed providers for unit tests.
 *
 * Includes zoneless change detection, HTTP client (with test interceptors),
 * a default API base URL (`/api`), and a configurable platform identifier.
 *
 * @param platformId `'browser'` (default) or `'server'` for SSR path testing.
 */
export function provideTestBed(platformId: 'browser' | 'server' = 'browser') {
    return [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api' },
        { provide: PLATFORM_ID, useValue: platformId },
    ];
}
