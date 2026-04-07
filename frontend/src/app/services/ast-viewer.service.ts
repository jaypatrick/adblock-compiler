/**
 * AstViewerService — wraps the /api/ast/parse endpoint.
 *
 * Parses adblock filter rules into AST representations using the backend
 * AGTree parser.
 */

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { API_BASE_URL } from '../tokens';
import { AstParseResponseSchema, AstParseResponse, validateResponse } from '../schemas/api-responses';

export type { AstParseResponse, ParsedRuleInfo, AstSummary } from '../schemas/api-responses';

@Injectable({
    providedIn: 'root',
})
export class AstViewerService {
    private readonly http = inject(HttpClient);
    private readonly apiBaseUrl = inject(API_BASE_URL);

    /**
     * Parse one or more filter rules into AST representations.
     */
    parse(rules: string[]): Observable<AstParseResponse> {
        return this.http
            .post<unknown>(`${this.apiBaseUrl}/ast/parse`, { rules })
            .pipe(map((raw) => validateResponse(AstParseResponseSchema, raw, 'POST /ast/parse')));
    }

    /**
     * Parse a multi-line string of filter rules into AST representations.
     */
    parseText(text: string): Observable<AstParseResponse> {
        return this.http
            .post<unknown>(`${this.apiBaseUrl}/ast/parse`, { text })
            .pipe(map((raw) => validateResponse(AstParseResponseSchema, raw, 'POST /ast/parse')));
    }
}
