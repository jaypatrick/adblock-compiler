// Type shim for the cloudflare:workers ESM module.
// Provides stubs for WorkflowEntrypoint and BrowserWorker so Deno's type-checker
// can resolve imports from 'cloudflare:workers'. At runtime on Cloudflare Workers
// the actual module is used.

/// <reference types="@cloudflare/workers-types" />

// Workflow event passed to the run() method
export interface WorkflowEvent<T = unknown> {
    payload: T;
    timestamp: Date;
    instanceId: string;
}

// Workflow step for durable execution
export interface WorkflowStep {
    do<T>(
        name: string,
        callback: () => Promise<T> | T,
    ): Promise<T>;
    do<T>(
        name: string,
        options: {
            retries?: {
                limit: number;
                delay: string;
                backoff?: 'constant' | 'linear' | 'exponential';
            };
            timeout?: string;
        },
        callback: () => Promise<T> | T,
    ): Promise<T>;
    sleep(name: string, duration: string): Promise<void>;
    sleepUntil(name: string, timestamp: Date | number): Promise<void>;
}

// Base class for workflow entrypoints
export abstract class WorkflowEntrypoint<Env = unknown, Params = unknown> {
    protected env: Env;
    protected ctx: ExecutionContext;

    constructor(ctx: ExecutionContext, env: Env) {
        this.ctx = ctx;
        this.env = env;
    }

    abstract run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<unknown>;
}

// Browser Rendering binding — provides a Fetcher interface to the browser rendering service.
export interface BrowserWorker {
    fetch: typeof fetch;
}

// Stub for the module-level `env` export from `cloudflare:workers`.
// The real env is provided by the Cloudflare Workers runtime; this satisfies Deno's type-checker.
export const env: Record<string, unknown> = {};
