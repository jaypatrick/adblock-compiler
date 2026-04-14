/**
 * MetricsService
 *
 * Wraps /api/metrics and /api/health endpoints. Centralises API calls
 * that were previously made directly in HomeComponent via HttpClient.
 */

import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { API_BASE_URL } from '../tokens';
import { HealthResponseSchema, MetricsResponseSchema, validateResponse } from '../schemas/api-responses';

/** Metrics response from /api/metrics */
export interface MetricsResponse {
    readonly totalRequests: number;
    readonly averageDuration: number;
    readonly cacheHitRate: number;
    readonly successRate: number;
}

/** Health response from /api/health */
export interface HealthResponse {
    readonly status: 'healthy' | 'degraded' | 'unhealthy';
    readonly version: string;
}

@Injectable({ providedIn: 'root' })
export class MetricsService {
    private readonly http = inject(HttpClient);
    private readonly apiBaseUrl = inject(API_BASE_URL);

    /** Fetch compilation metrics */
    getMetrics(): Observable<MetricsResponse> {
        return this.http.get<unknown>(`${this.apiBaseUrl}/metrics`).pipe(
            map(raw => validateResponse(MetricsResponseSchema, raw, 'GET /metrics')),
            catchError(() => of({ totalRequests: 0, averageDuration: 0, cacheHitRate: 0, successRate: 0 })),
        );
    }

    /** Fetch system health status */
    getHealth(): Observable<HealthResponse> {
        return this.http.get<unknown>(`${this.apiBaseUrl}/health`).pipe(
            map(raw => validateResponse(HealthResponseSchema, raw, 'GET /health')),
            catchError(() => of({ status: 'degraded' as const, version: 'unknown' })),
        );
    }
}
