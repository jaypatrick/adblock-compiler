/**
 * Workflow Diagram Builder — static metadata-driven diagram descriptors.
 *
 * Generates structured graph representations (nodes + edges) for each registered
 * Cloudflare Workflow based on the known step sequences in their implementation files.
 * This mirrors the step-graph model described in the Cloudflare Workflow Diagrams blog post
 * (https://blog.cloudflare.com/workflow-diagrams/) and serves as the foundation for a
 * future AST-based dynamic analyzer.
 *
 * @see worker/workflows/CompilationWorkflow.ts
 * @see worker/workflows/BatchCompilationWorkflow.ts
 * @see worker/workflows/CacheWarmingWorkflow.ts
 * @see worker/workflows/HealthMonitoringWorkflow.ts
 * @module
 */

// ── Node / Edge types ─────────────────────────────────────────────────────────

/** Structural kind of a diagram node. */
export type NodeKind = 'start' | 'end' | 'step' | 'parallel' | 'conditional' | 'loop';

/** A single node in a workflow diagram graph. */
export interface DiagramNode {
    id: string;
    label: string;
    kind: NodeKind;
    metadata?: Record<string, unknown>;
}

/** A directed edge connecting two diagram nodes. */
export interface DiagramEdge {
    from: string;
    to: string;
    label?: string;
}

/** Complete diagram descriptor for a single workflow. */
export interface WorkflowDiagram {
    workflowName: string;
    workflowClass: string;
    description: string;
    nodes: DiagramNode[];
    edges: DiagramEdge[];
    generatedAt: string;
}

// ── Known workflow names ──────────────────────────────────────────────────────

/** All registered workflow names — kept in declaration order. */
const KNOWN_WORKFLOWS = [
    'compilation',
    'batch-compilation',
    'cache-warming',
    'health-monitoring',
] as const;

type WorkflowName = (typeof KNOWN_WORKFLOWS)[number];

// ── Per-workflow diagram factories ────────────────────────────────────────────

function buildCompilationDiagram(): Pick<WorkflowDiagram, 'nodes' | 'edges'> {
    const nodes: DiagramNode[] = [
        { id: 'start', label: 'Start', kind: 'start' },
        { id: 'validate', label: 'Validate Configuration', kind: 'step' },
        { id: 'compile-sources', label: 'Compile Sources', kind: 'step' },
        {
            id: 'cache-result',
            label: 'Cache Result',
            kind: 'conditional',
            metadata: { condition: 'shouldCache' },
        },
        { id: 'update-metrics', label: 'Update Metrics', kind: 'step' },
        { id: 'update-failure-metrics', label: 'Update Failure Metrics', kind: 'step' },
        { id: 'end', label: 'End', kind: 'end' },
    ];

    const edges: DiagramEdge[] = [
        { from: 'start', to: 'validate' },
        { from: 'validate', to: 'compile-sources' },
        { from: 'compile-sources', to: 'cache-result' },
        { from: 'cache-result', to: 'update-metrics', label: 'cached' },
        { from: 'cache-result', to: 'update-metrics', label: 'skip-cache' },
        { from: 'update-metrics', to: 'end' },
        { from: 'compile-sources', to: 'update-failure-metrics', label: 'error' },
        { from: 'update-failure-metrics', to: 'end' },
    ];

    return { nodes, edges };
}

function buildBatchCompilationDiagram(): Pick<WorkflowDiagram, 'nodes' | 'edges'> {
    // BatchCompilationWorkflow processes requests in chunks.
    // Within each chunk, individual compilations fan out via Promise.allSettled —
    // represented here as a single `parallel` node for the chunk-processing phase.
    const nodes: DiagramNode[] = [
        { id: 'start', label: 'Start', kind: 'start' },
        { id: 'validate-batch', label: 'Validate Batch', kind: 'step' },
        {
            id: 'compile-chunks',
            label: 'Compile Chunks (parallel fan-out per chunk)',
            kind: 'parallel',
            metadata: { stepPattern: 'compile-chunk-${chunkNumber}', usesPromiseAllSettled: true },
        },
        { id: 'update-batch-metrics', label: 'Update Batch Metrics', kind: 'step' },
        { id: 'end', label: 'End', kind: 'end' },
    ];

    const edges: DiagramEdge[] = [
        { from: 'start', to: 'validate-batch' },
        { from: 'validate-batch', to: 'compile-chunks' },
        { from: 'compile-chunks', to: 'update-batch-metrics' },
        { from: 'update-batch-metrics', to: 'end' },
        { from: 'update-batch-metrics', to: 'end', label: 'error' },
    ];

    return { nodes, edges };
}

function buildCacheWarmingDiagram(): Pick<WorkflowDiagram, 'nodes' | 'edges'> {
    // CacheWarmingWorkflow iterates configs in chunks with a sleep between each chunk —
    // represented as a `loop` node for the warming phase.
    const nodes: DiagramNode[] = [
        { id: 'start', label: 'Start', kind: 'start' },
        { id: 'check-cache-status', label: 'Check Cache Status', kind: 'step' },
        {
            id: 'warm-chunks',
            label: 'Warm Cache Chunks (loop with inter-chunk delay)',
            kind: 'loop',
            metadata: { stepPattern: 'warm-chunk-${chunkNumber}', sleepBetweenChunks: '10 seconds' },
        },
        { id: 'update-warming-metrics', label: 'Update Warming Metrics', kind: 'step' },
        { id: 'end', label: 'End', kind: 'end' },
    ];

    const edges: DiagramEdge[] = [
        { from: 'start', to: 'check-cache-status' },
        { from: 'check-cache-status', to: 'warm-chunks' },
        { from: 'warm-chunks', to: 'update-warming-metrics' },
        { from: 'update-warming-metrics', to: 'end' },
        { from: 'update-warming-metrics', to: 'end', label: 'error' },
    ];

    return { nodes, edges };
}

function buildHealthMonitoringDiagram(): Pick<WorkflowDiagram, 'nodes' | 'edges'> {
    // HealthMonitoringWorkflow:
    // 1. load-health-history  — load recent check history from KV
    // 2. check-sources (loop) — check-source-N for each source, with sleep between
    // 3. analyze-results      — determine whether alerts are needed
    // 4. send-alerts          — conditional; only when triggeredAlerts = true
    // 5. store-results        — persist health data
    const nodes: DiagramNode[] = [
        { id: 'start', label: 'Start', kind: 'start' },
        { id: 'load-health-history', label: 'Load Health History', kind: 'step' },
        {
            id: 'check-sources',
            label: 'Check Sources (loop with delays)',
            kind: 'loop',
            metadata: { stepPattern: 'check-source-${sourceNumber}', sleepBetweenSources: '2 seconds' },
        },
        { id: 'analyze-results', label: 'Analyze Results', kind: 'step' },
        {
            id: 'send-alerts',
            label: 'Send Alerts',
            kind: 'conditional',
            metadata: { condition: 'triggeredAlerts' },
        },
        { id: 'store-results', label: 'Store Results', kind: 'step' },
        { id: 'end', label: 'End', kind: 'end' },
    ];

    const edges: DiagramEdge[] = [
        { from: 'start', to: 'load-health-history' },
        { from: 'load-health-history', to: 'check-sources' },
        { from: 'check-sources', to: 'analyze-results' },
        { from: 'analyze-results', to: 'send-alerts' },
        { from: 'send-alerts', to: 'store-results', label: 'alerts-sent' },
        { from: 'send-alerts', to: 'store-results', label: 'no-alerts' },
        { from: 'store-results', to: 'end' },
        { from: 'store-results', to: 'end', label: 'error' },
    ];

    return { nodes, edges };
}

// ── WorkflowDiagramBuilder ────────────────────────────────────────────────────

/**
 * Builds static, metadata-driven diagram descriptors for the registered Cloudflare Workflows.
 *
 * The diagrams are derived from the known step sequences declared in each workflow's
 * implementation file rather than from live AST traversal (that is tracked separately).
 * Each descriptor includes typed nodes (`start`, `end`, `step`, `parallel`, `conditional`,
 * `loop`) and directed edges that represent the control-flow topology.
 *
 * @example
 * ```ts
 * const names = WorkflowDiagramBuilder.list();        // ['compilation', ...]
 * const diagram = WorkflowDiagramBuilder.build('compilation');
 * console.log(diagram.nodes, diagram.edges);
 * ```
 */
export class WorkflowDiagramBuilder {
    /**
     * Returns the list of all known workflow names supported by `build()`.
     */
    static list(): string[] {
        return [...KNOWN_WORKFLOWS];
    }

    /**
     * Builds and returns the diagram descriptor for the given workflow name.
     *
     * @throws {Error} if `workflowName` is not a known workflow name.
     */
    static build(workflowName: string): WorkflowDiagram {
        const generatedAt = new Date().toISOString();

        switch (workflowName as WorkflowName) {
            case 'compilation': {
                const { nodes, edges } = buildCompilationDiagram();
                return {
                    workflowName: 'compilation',
                    workflowClass: 'CompilationWorkflow',
                    description: 'Durable compilation pipeline: validate → compile sources → (conditional) cache result → update metrics.',
                    nodes,
                    edges,
                    generatedAt,
                };
            }

            case 'batch-compilation': {
                const { nodes, edges } = buildBatchCompilationDiagram();
                return {
                    workflowName: 'batch-compilation',
                    workflowClass: 'BatchCompilationWorkflow',
                    description: 'Batch compilation pipeline: validate batch → compile chunks in parallel (Promise.allSettled fan-out) → update metrics.',
                    nodes,
                    edges,
                    generatedAt,
                };
            }

            case 'cache-warming': {
                const { nodes, edges } = buildCacheWarmingDiagram();
                return {
                    workflowName: 'cache-warming',
                    workflowClass: 'CacheWarmingWorkflow',
                    description: 'Scheduled cache pre-warming: check cache status → warm chunks in a loop → update warming metrics.',
                    nodes,
                    edges,
                    generatedAt,
                };
            }

            case 'health-monitoring': {
                const { nodes, edges } = buildHealthMonitoringDiagram();
                return {
                    workflowName: 'health-monitoring',
                    workflowClass: 'HealthMonitoringWorkflow',
                    description: 'Scheduled health monitoring: load history → check sources in a loop → analyze → (conditional) send alerts → store results.',
                    nodes,
                    edges,
                    generatedAt,
                };
            }

            default:
                throw new Error(`Unknown workflow: "${workflowName}". Valid values: ${KNOWN_WORKFLOWS.join(', ')}`);
        }
    }
}
