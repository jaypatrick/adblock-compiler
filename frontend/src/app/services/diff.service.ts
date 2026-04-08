/**
 * DiffService — wraps the POST /api/diff endpoint.
 *
 * Compares two filter lists via the backend AGTree AST diff.
 * Returns parse errors alongside the DiffReport.
 */

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { API_BASE_URL } from '../tokens';
import { DiffApiResponseSchema, DiffApiResponse, validateResponse } from '../schemas/api-responses';

export interface DiffOptions {
    ignoreComments?:    boolean;
    ignoreEmptyLines?:  boolean;
    analyzeDomains?:    boolean;
    includeFullRules?:  boolean;
    maxRulesToInclude?: number;
}

@Injectable({ providedIn: 'root' })
export class DiffService {
    private readonly http       = inject(HttpClient);
    private readonly apiBaseUrl = inject(API_BASE_URL);

    /**
     * Compare two filter lists via AGTree AST diff.
     * Parse errors are returned alongside the report and do not block the diff.
     */
    diff(original: string[], current: string[], options?: DiffOptions): Observable<DiffApiResponse> {
        return this.http
            .post<unknown>(`${this.apiBaseUrl}/diff`, { original, current, options })
            .pipe(map((raw) => validateResponse(DiffApiResponseSchema, raw, 'POST /diff')));
    }
}
