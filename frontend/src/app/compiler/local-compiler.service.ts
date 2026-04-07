/**
 * LocalCompilerService — orchestrates in-browser (local mode) compilation.
 *
 * Compilation flow for local mode:
 * 1. For each source URL, fetch raw content via the Worker `/proxy/fetch` endpoint
 *    (bypassing browser CORS restrictions).
 * 2. Pass the pre-fetched content map to the `compiler.worker.ts` Web Worker.
 * 3. The Web Worker runs the `WorkerCompiler` transformation pipeline locally.
 * 4. Emit progress events that match the SSE streaming UX of cloud mode.
 *
 * ## Offline degradation
 * When the proxy is unavailable the service emits an error event rather than
 * crashing, allowing the UI to show a clear failure message.
 *
 * ## ZTA
 * - No auth token is attached to `/proxy/fetch` calls — the proxy accepts
 *   anonymous requests protected by Turnstile (handled server-side).
 * - Source content never leaves the browser after the proxy call.
 * - The Web Worker runs in an isolated context with no DOM access.
 *
 * Angular 21 Pattern: Injectable service with functional DI via inject()
 */

import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../tokens';
import type { LocalWorkerOutMessage } from '../workers/compiler.worker';

// ── Public types ──────────────────────────────────────────────────────────────

export interface LocalCompileRequest {
    configuration: {
        name: string;
        sources: Array<{ source: string }>;
        transformations: string[];
    };
    /** Cloudflare Turnstile token for anonymous proxy requests (optional). */
    turnstileToken?: string;
}

export interface LocalCompileResult {
    success: true;
    rules: string[];
    ruleCount: number;
    compiledAt: string;
    /** Always 'local' — distinguishes from cloud results. */
    executionEnv: 'local';
}

export interface LocalCompileProgressEvent {
    type: 'progress';
    phase: string;
    percent: number;
}

export interface LocalCompileResultEvent {
    type: 'result';
    result: LocalCompileResult;
}

export interface LocalCompileErrorEvent {
    type: 'error';
    message: string;
}

export type LocalCompileEvent = LocalCompileProgressEvent | LocalCompileResultEvent | LocalCompileErrorEvent;

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class LocalCompilerService {
    private readonly platformId = inject(PLATFORM_ID);
    private readonly http = inject(HttpClient);
    private readonly apiBase = inject(API_BASE_URL);

    private worker: Worker | null = null;

    /** Whether a local compilation is in progress. */
    readonly isCompiling = signal(false);
    /** Current progress phase description. */
    readonly progressPhase = signal<string>('');
    /** Current progress percentage (0-100). */
    readonly progressPercent = signal(0);
    /** Last compilation error (null when none). */
    readonly error = signal<string | null>(null);
    /** Last compilation result (null when none). */
    readonly result = signal<LocalCompileResult | null>(null);

    /**
     * Whether local mode is supported on the current platform.
     * False during SSR or in environments without Web Worker support.
     */
    readonly isSupported = isPlatformBrowser(this.platformId) && typeof Worker !== 'undefined';

    /**
     * Run a local compilation and return the result.
     *
     * @param request - Compilation request with source URLs and transformations.
     * @param onEvent - Optional callback for streaming progress/result/error events.
     */
    async compile(
        request: LocalCompileRequest,
        onEvent?: (event: LocalCompileEvent) => void,
    ): Promise<LocalCompileResult> {
        if (!this.isSupported) {
            throw new Error('Local compilation is not supported in this environment (SSR or no Web Worker).');
        }

        this.isCompiling.set(true);
        this.error.set(null);
        this.result.set(null);
        this.progressPercent.set(0);
        this.progressPhase.set('Fetching sources');

        const emitProgress = (phase: string, percent: number) => {
            this.progressPhase.set(phase);
            this.progressPercent.set(percent);
            onEvent?.({ type: 'progress', phase, percent });
        };

        try {
            // Phase 1: Fetch source content via the CORS proxy
            emitProgress('Fetching sources via proxy', 10);
            const prefetchedContent = await this.prefetchSources(
                request.configuration.sources.map((s) => s.source),
                request.turnstileToken,
            );

            // Phase 2: Compile in Web Worker
            emitProgress('Compiling locally', 30);
            const result = await this.runWorkerCompilation(request.configuration, prefetchedContent, emitProgress);

            const localResult: LocalCompileResult = { ...result, executionEnv: 'local' };
            this.result.set(localResult);
            onEvent?.({ type: 'result', result: localResult });
            return localResult;

        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.error.set(message);
            onEvent?.({ type: 'error', message });
            throw err;
        } finally {
            this.isCompiling.set(false);
        }
    }

    /**
     * Fetch source list content via the Worker `/proxy/fetch` endpoint.
     *
     * Any URL that fails to load causes the entire compilation to fail fast,
     * matching the behaviour of cloud-mode compilation.
     */
    private async prefetchSources(
        urls: string[],
        turnstileToken?: string,
    ): Promise<Record<string, string>> {
        const results: Record<string, string> = {};

        await Promise.all(
            urls.map(async (url) => {
                const params = new URLSearchParams({ url });
                if (turnstileToken) params.set('turnstileToken', turnstileToken);

                const content = await firstValueFrom(
                    this.http.get(`${this.apiBase}/proxy/fetch?${params}`, { responseType: 'text' }),
                );
                results[url] = content;
            }),
        );

        return results;
    }

    /**
     * Dispatch a compilation job to the `compiler.worker.ts` Web Worker and
     * resolve when the worker posts a `result` or `error` message.
     */
    private runWorkerCompilation(
        config: LocalCompileRequest['configuration'],
        prefetchedContent: Record<string, string>,
        onProgress: (phase: string, percent: number) => void,
    ): Promise<Omit<LocalCompileResult, 'executionEnv'>> {
        return new Promise((resolve, reject) => {
            if (!this.worker) {
                this.worker = new Worker(
                    new URL('../workers/compiler.worker', import.meta.url),
                    { type: 'module' },
                );
            }

            const handleMessage = (event: MessageEvent<LocalWorkerOutMessage>) => {
                const data = event.data;

                if (data.type === 'progress') {
                    onProgress(data.phase, data.percent);
                    return;
                }

                if (data.type === 'result') {
                    this.worker?.removeEventListener('message', handleMessage);
                    resolve(data.result);
                    return;
                }

                if (data.type === 'error') {
                    this.worker?.removeEventListener('message', handleMessage);
                    reject(new Error(data.message));
                }
            };

            const handleError = (error: ErrorEvent) => {
                this.worker?.removeEventListener('message', handleMessage);
                this.worker?.removeEventListener('error', handleError);
                reject(new Error(error.message || 'Web Worker error'));
            };

            this.worker.addEventListener('message', handleMessage);
            this.worker.addEventListener('error', handleError);
            this.worker.postMessage({ type: 'compile', config, prefetchedContent });
        });
    }

    /** Terminate the Web Worker (called on service destruction). */
    terminate(): void {
        this.worker?.terminate();
        this.worker = null;
    }
}
