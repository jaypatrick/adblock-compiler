/**
 * Tests for WorkflowDiagramBuilder.
 *
 * Covers:
 *  - list() returns all 4 registered workflow names
 *  - Each diagram has exactly one `start` and one `end` node
 *  - Each diagram has at least one `step` node
 *  - All edge `from`/`to` values reference valid node IDs within the same diagram
 *  - `compilation` diagram has a `conditional` node with id `cache-result`
 *  - `batch-compilation` diagram has a `parallel` node
 *  - `build()` throws for unknown workflow names
 *  - `generatedAt` is a valid ISO 8601 string
 */

import { assertEquals, assertMatch, assertThrows } from '@std/assert';
import { WorkflowDiagramBuilder } from './diagram.ts';
import type { DiagramNode, WorkflowDiagram } from './diagram.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the set of node IDs present in a diagram. */
function nodeIds(diagram: WorkflowDiagram): Set<string> {
    return new Set(diagram.nodes.map((n: DiagramNode) => n.id));
}

/** Returns all nodes matching the given kind. */
function nodesOfKind(diagram: WorkflowDiagram, kind: DiagramNode['kind']): DiagramNode[] {
    return diagram.nodes.filter((n: DiagramNode) => n.kind === kind);
}

// ── list() ────────────────────────────────────────────────────────────────────

Deno.test('WorkflowDiagramBuilder.list() — returns exactly 4 entries', () => {
    const names = WorkflowDiagramBuilder.list();
    assertEquals(names.length, 4);
});

Deno.test('WorkflowDiagramBuilder.list() — contains all expected workflow names', () => {
    const names = WorkflowDiagramBuilder.list();
    assertEquals(names.includes('compilation'), true);
    assertEquals(names.includes('batch-compilation'), true);
    assertEquals(names.includes('cache-warming'), true);
    assertEquals(names.includes('health-monitoring'), true);
});

// ── build() — shared invariants ───────────────────────────────────────────────

for (const name of WorkflowDiagramBuilder.list()) {
    Deno.test(`WorkflowDiagramBuilder.build('${name}') — has exactly one start node`, () => {
        const diagram = WorkflowDiagramBuilder.build(name);
        const startNodes = nodesOfKind(diagram, 'start');
        assertEquals(startNodes.length, 1);
        assertEquals(startNodes[0].id, 'start');
    });

    Deno.test(`WorkflowDiagramBuilder.build('${name}') — has exactly one end node`, () => {
        const diagram = WorkflowDiagramBuilder.build(name);
        const endNodes = nodesOfKind(diagram, 'end');
        assertEquals(endNodes.length, 1);
        assertEquals(endNodes[0].id, 'end');
    });

    Deno.test(`WorkflowDiagramBuilder.build('${name}') — has at least one step node`, () => {
        const diagram = WorkflowDiagramBuilder.build(name);
        const stepNodes = nodesOfKind(diagram, 'step');
        assertEquals(stepNodes.length >= 1, true);
    });

    Deno.test(`WorkflowDiagramBuilder.build('${name}') — all edge from/to reference valid node IDs`, () => {
        const diagram = WorkflowDiagramBuilder.build(name);
        const ids = nodeIds(diagram);
        for (const edge of diagram.edges) {
            assertEquals(
                ids.has(edge.from),
                true,
                `Edge from '${edge.from}' does not reference a valid node`,
            );
            assertEquals(
                ids.has(edge.to),
                true,
                `Edge to '${edge.to}' does not reference a valid node`,
            );
        }
    });

    Deno.test(`WorkflowDiagramBuilder.build('${name}') — generatedAt is a valid ISO 8601 string`, () => {
        const diagram = WorkflowDiagramBuilder.build(name);
        assertMatch(diagram.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/);
    });

    Deno.test(`WorkflowDiagramBuilder.build('${name}') — workflowName matches the requested name`, () => {
        const diagram = WorkflowDiagramBuilder.build(name);
        assertEquals(diagram.workflowName, name);
    });

    Deno.test(`WorkflowDiagramBuilder.build('${name}') — workflowClass is a non-empty string`, () => {
        const diagram = WorkflowDiagramBuilder.build(name);
        assertEquals(typeof diagram.workflowClass, 'string');
        assertEquals(diagram.workflowClass.length > 0, true);
    });
}

// ── compilation-specific ──────────────────────────────────────────────────────

Deno.test('WorkflowDiagramBuilder.build(compilation) — has a conditional node for cache-result', () => {
    const diagram = WorkflowDiagramBuilder.build('compilation');
    const conditionalNodes = nodesOfKind(diagram, 'conditional');
    assertEquals(conditionalNodes.length >= 1, true);
    const cacheResultNode = conditionalNodes.find((n: DiagramNode) => n.id === 'cache-result');
    assertEquals(cacheResultNode !== undefined, true);
});

Deno.test('WorkflowDiagramBuilder.build(compilation) — includes update-failure-metrics step', () => {
    const diagram = WorkflowDiagramBuilder.build('compilation');
    const ids = nodeIds(diagram);
    assertEquals(ids.has('update-failure-metrics'), true);
});

Deno.test('WorkflowDiagramBuilder.build(compilation) — error edge points to update-failure-metrics', () => {
    const diagram = WorkflowDiagramBuilder.build('compilation');
    const errorEdges = diagram.edges.filter((e) => e.label === 'error');
    assertEquals(errorEdges.length >= 1, true);
    const toFailureMetrics = errorEdges.find((e) => e.to === 'update-failure-metrics');
    assertEquals(toFailureMetrics !== undefined, true);
});

// ── batch-compilation-specific ────────────────────────────────────────────────

Deno.test('WorkflowDiagramBuilder.build(batch-compilation) — has a parallel node for chunk compilation', () => {
    const diagram = WorkflowDiagramBuilder.build('batch-compilation');
    const parallelNodes = nodesOfKind(diagram, 'parallel');
    assertEquals(parallelNodes.length >= 1, true);
});

Deno.test('WorkflowDiagramBuilder.build(batch-compilation) — parallel node metadata indicates Promise.allSettled', () => {
    const diagram = WorkflowDiagramBuilder.build('batch-compilation');
    const parallelNodes = nodesOfKind(diagram, 'parallel');
    assertEquals(parallelNodes.length >= 1, true);
    const node = parallelNodes[0];
    assertEquals(node.metadata?.usesPromiseAllSettled, true);
});

// ── cache-warming-specific ────────────────────────────────────────────────────

Deno.test('WorkflowDiagramBuilder.build(cache-warming) — has a loop node for chunk warming', () => {
    const diagram = WorkflowDiagramBuilder.build('cache-warming');
    const loopNodes = nodesOfKind(diagram, 'loop');
    assertEquals(loopNodes.length >= 1, true);
});

Deno.test('WorkflowDiagramBuilder.build(cache-warming) — includes check-cache-status step', () => {
    const diagram = WorkflowDiagramBuilder.build('cache-warming');
    const ids = nodeIds(diagram);
    assertEquals(ids.has('check-cache-status'), true);
});

// ── health-monitoring-specific ────────────────────────────────────────────────

Deno.test('WorkflowDiagramBuilder.build(health-monitoring) — has a loop node for source checks', () => {
    const diagram = WorkflowDiagramBuilder.build('health-monitoring');
    const loopNodes = nodesOfKind(diagram, 'loop');
    assertEquals(loopNodes.length >= 1, true);
});

Deno.test('WorkflowDiagramBuilder.build(health-monitoring) — has a conditional node for send-alerts', () => {
    const diagram = WorkflowDiagramBuilder.build('health-monitoring');
    const conditionalNodes = nodesOfKind(diagram, 'conditional');
    assertEquals(conditionalNodes.length >= 1, true);
    const sendAlertsNode = conditionalNodes.find((n: DiagramNode) => n.id === 'send-alerts');
    assertEquals(sendAlertsNode !== undefined, true);
});

Deno.test('WorkflowDiagramBuilder.build(health-monitoring) — includes store-results step', () => {
    const diagram = WorkflowDiagramBuilder.build('health-monitoring');
    const ids = nodeIds(diagram);
    assertEquals(ids.has('store-results'), true);
});

// ── error handling ────────────────────────────────────────────────────────────

Deno.test('WorkflowDiagramBuilder.build() — throws for unknown workflow name', () => {
    assertThrows(
        () => WorkflowDiagramBuilder.build('nonexistent-workflow'),
        Error,
        'Unknown workflow',
    );
});
