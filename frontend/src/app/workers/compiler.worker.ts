/**
 * LocalCompilerWorker — in-browser compilation Web Worker.
 *
 * Receives a compilation request containing pre-fetched source content and
 * runs the full `WorkerCompiler` transformation pipeline locally, without
 * sending source content to the cloud Worker.
 *
 * ## Protocol
 *
 * Main → Worker:
 *   ```typescript
 *   { type: 'compile', config: IConfiguration, prefetchedContent: Record<string, string> }
 *   ```
 *
 * Worker → Main:
 *   ```typescript
 *   { type: 'progress', phase: string, percent: number }
 *   { type: 'result',   result: CompileResult }
 *   { type: 'error',    message: string }
 *   ```
 *
 * ## ZTA Note
 * Source content is provided by the *caller* via `prefetchedContent`.  The
 * Worker itself never makes network calls — all CORS-restricted upstream
 * fetches are delegated to the cloud `/proxy/fetch` endpoint before this
 * Worker is invoked.
 */

// Dynamic imports are used here so that the heavy `@jk-com/adblock-compiler`
// module is lazy-loaded only when local compilation is actually requested.
// This keeps the initial Angular bundle size small.

export interface LocalCompileMessage {
    type: 'compile';
    config: {
        name: string;
        sources: Array<{ source: string }>;
        transformations: string[];
    };
    /** Map of source URL → raw text content (pre-fetched by the main thread via /proxy/fetch). */
    prefetchedContent: Record<string, string>;
}

export interface LocalProgressMessage {
    type: 'progress';
    phase: string;
    percent: number;
}

export interface LocalResultMessage {
    type: 'result';
    result: {
        success: true;
        rules: string[];
        ruleCount: number;
        compiledAt: string;
    };
}

export interface LocalErrorMessage {
    type: 'error';
    message: string;
}

export type LocalWorkerOutMessage = LocalProgressMessage | LocalResultMessage | LocalErrorMessage;

// ── Message handler ───────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<LocalCompileMessage>) => {
    if (event.data.type !== 'compile') return;

    const { config, prefetchedContent } = event.data;

    try {
        postMessage({ type: 'progress', phase: 'Initialising compiler', percent: 5 } as LocalProgressMessage);

        // Dynamic import — lazy-loads the compiler bundle only when needed.
        // NOTE: @jk-com/adblock-compiler must be available in the browser bundle.
        // It is distributed via JSR and must be added to the frontend dependencies
        // (e.g. via `pnpm add @jsr/jk-com__adblock-compiler`) before this worker
        // can be used in production.
        // @ts-expect-error — package installed at runtime; not in devDependencies
        const mod = await import('@jk-com/adblock-compiler') as {
            WorkerCompiler: new (options: { fetcher: unknown }) => {
                compile(config: unknown): Promise<{ rules: string[] }>;
            };
            PreFetchedContentFetcher: new (content: Record<string, string>) => unknown;
        };

        postMessage({ type: 'progress', phase: 'Loading source content', percent: 20 } as LocalProgressMessage);

        const fetcher = new mod.PreFetchedContentFetcher(prefetchedContent);
        const compiler = new mod.WorkerCompiler({ fetcher });

        postMessage({ type: 'progress', phase: 'Running transformations', percent: 40 } as LocalProgressMessage);

        const result = await compiler.compile(config);

        postMessage({ type: 'progress', phase: 'Complete', percent: 100 } as LocalProgressMessage);
        postMessage({
            type: 'result',
            result: {
                success: true,
                rules: result.rules,
                ruleCount: result.rules.length,
                compiledAt: new Date().toISOString(),
            },
        } as LocalResultMessage);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postMessage({ type: 'error', message } as LocalErrorMessage);
    }
};
