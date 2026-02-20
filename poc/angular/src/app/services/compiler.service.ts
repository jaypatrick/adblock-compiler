/**
 * Angular PoC - Compiler API Service
 *
 * ANGULAR PATTERN: Service with Dependency Injection
 * Services are singleton instances that handle business logic and API calls
 * Injectable decorator makes this service available throughout the app
 */

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, delay } from 'rxjs/operators';

/**
 * Interface: API Request Payload
 * TypeScript interfaces provide type safety for API contracts
 */
export interface CompileRequest {
    configuration: {
        name: string;
        sources: Array<{ source: string }>;
        transformations: string[];
    };
    benchmark?: boolean;
}

/**
 * Interface: API Response
 * Defines the structure of the compilation result
 */
export interface CompileResponse {
    success: boolean;
    ruleCount: number;
    sources: number;
    transformations: string[];
    message: string;
    benchmark?: {
        duration: string;
        rulesPerSecond: number;
    };
}

/**
 * CompilerService
 * Pattern: Angular service with HttpClient for API communication
 * Uses RxJS Observables for reactive data streams
 */
@Injectable({
    providedIn: 'root', // Service is available app-wide (singleton)
})
export class CompilerService {
    private apiUrl = '/api/compile';

    /**
     * Constructor with Dependency Injection
     * Angular's DI system automatically provides HttpClient instance
     */
    constructor(private http: HttpClient) {}

    /**
     * Compile filter lists
     * Returns an Observable that components can subscribe to
     *
     * @param urls - Array of filter list URLs
     * @param transformations - Array of transformation names
     * @returns Observable<CompileResponse>
     */
    compile(urls: string[], transformations: string[]): Observable<CompileResponse> {
        const payload: CompileRequest = {
            configuration: {
                name: 'Angular PoC Compilation',
                sources: urls.map((url) => ({ source: url })),
                transformations,
            },
            benchmark: true,
        };

        const headers = new HttpHeaders({
            'Content-Type': 'application/json',
        });

        // Make HTTP POST request
        return this.http.post<CompileResponse>(this.apiUrl, payload, { headers }).pipe(
            // Error handling with RxJS operators
            catchError((error) => {
                console.log('API call failed (expected in PoC), returning mock data:', error);

                // Return mock data for demo purposes
                return of({
                    success: true,
                    ruleCount: 1234,
                    sources: urls.length,
                    transformations: transformations,
                    message: 'Mock compilation result (API not available in PoC)',
                    benchmark: {
                        duration: '123ms',
                        rulesPerSecond: 10000,
                    },
                }).pipe(delay(1000)); // Simulate network delay
            }),
        );
    }

    /**
     * Get available transformations
     * In production, this might fetch from an API
     */
    getAvailableTransformations(): string[] {
        return [
            'RemoveComments',
            'Compress',
            'RemoveModifiers',
            'Validate',
            'ValidateAllowIp',
            'Deduplicate',
            'InvertAllow',
            'RemoveEmptyLines',
            'TrimLines',
            'InsertFinalNewLine',
            'ConvertToAscii',
        ];
    }
}
