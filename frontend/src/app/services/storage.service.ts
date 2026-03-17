/**
 * StorageService — wraps the /admin/storage/* endpoints.
 *
 * Auth tokens are attached automatically by the HTTP interceptor.
 */

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ADMIN_BASE_URL } from '../tokens';

export interface StorageStats {
    readonly kvKeys: number;
    readonly r2Objects: number;
    readonly d1Tables: number;
    readonly cacheEntries: number;
    readonly totalSize?: string;
}

export interface TableInfo {
    readonly name: string;
    readonly rowCount: number;
    readonly columns: string[];
}

export interface QueryResult {
    readonly success: boolean;
    readonly columns: string[];
    readonly rows: unknown[][];
    readonly rowCount: number;
    readonly duration?: string;
}

@Injectable({
    providedIn: 'root',
})
export class StorageService {
    private readonly http = inject(HttpClient);
    private readonly adminBaseUrl = inject(ADMIN_BASE_URL);

    getStats(): Observable<StorageStats> {
        return this.http.get<StorageStats>(
            `${this.adminBaseUrl}/stats`,
        );
    }

    getTables(): Observable<TableInfo[]> {
        return this.http.get<TableInfo[]>(
            `${this.adminBaseUrl}/tables`,
        );
    }

    query(sql: string): Observable<QueryResult> {
        return this.http.post<QueryResult>(
            `${this.adminBaseUrl}/query`,
            { sql },
        );
    }

    clearCache(): Observable<{ success: boolean }> {
        return this.http.post<{ success: boolean }>(
            `${this.adminBaseUrl}/clear-cache`,
            {},
        );
    }

    clearExpired(): Observable<{ success: boolean; removed: number }> {
        return this.http.post<{ success: boolean; removed: number }>(
            `${this.adminBaseUrl}/clear-expired`,
            {},
        );
    }

    vacuum(): Observable<{ success: boolean }> {
        return this.http.post<{ success: boolean }>(
            `${this.adminBaseUrl}/vacuum`,
            {},
        );
    }

    exportData(): Observable<Blob> {
        return this.http.get(
            `${this.adminBaseUrl}/export`,
            { responseType: 'blob' },
        );
    }
}
