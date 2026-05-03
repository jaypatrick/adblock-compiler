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
    /**
     * Shared secret token used to authenticate messages sent to this worker.
     * The main thread must include this exact token in all messages.
     */
    token: string;
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

// Shared secret token expected from any message sent to this worker.
const EXPECTED_TOKEN = 'LOCAL_COMPILER_WORKER_TOKEN';

self.onmessage = async (event: MessageEvent<any>) => {
    const data = event.data;

    // Validate that the incoming message matches the expected compile message shape
    // and is authenticated with the expected token.
    if (
        !data ||
        typeof data !== 'object' ||
        (data as any).type !== 'compile' ||
        typeof (data as any).token !== 'string' ||
        (data as any).token !== EXPECTED_TOKEN
    ) {
        return;
    }

    const { config, prefetchedContent } = data as LocalCompileMessage;

    try {
        postMessage({ type: 'progress', phase: 'Initialising compiler', percent: 5 } as LocalProgressMessage);

        // Dynamic import — lazy-loads the compiler bundle only when needed.
        // NOTE: @jk-com/adblock-compiler is a production dependency that must be
        // installed before building for production (e.g. via
        // `pnpm add @jsr/jk-com__bloqr-backend`). The @ts-expect-error below
        // suppresses a type-check error in CI environments where the package has
        // not yet been added to the frontend devDependencies.
        // @ts-expect-error — not yet in devDependencies; must be added before production use
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
