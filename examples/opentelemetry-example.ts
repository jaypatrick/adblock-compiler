/**
 * Example: Using OpenTelemetry tracing with the adblock-compiler
 * 
 * This example demonstrates how to integrate OpenTelemetry distributed tracing
 * into the compilation process for observability across services.
 * 
 * Usage with Deno:
 * ```bash
 * # Enable OpenTelemetry in Deno
 * OTEL_DENO=true deno run --unstable-otel --allow-net examples/opentelemetry-example.ts
 * ```
 * 
 * This will export traces to a local OpenTelemetry collector at localhost:4318
 * or to any configured OTLP endpoint.
 */

import { trace } from '@opentelemetry/api';
import {
    createOpenTelemetryExporter,
    SourceCompiler,
    TransformationPipeline,
    TransformationType,
} from '../src/index.ts';

/**
 * Example: Compile a filter list with OpenTelemetry tracing
 */
async function compileWithTracing() {
    // Create an OpenTelemetry exporter as the diagnostics collector
    const diagnostics = createOpenTelemetryExporter({
        serviceName: 'adblock-compiler',
        enableConsoleLogging: true, // Enable console output for debugging
    });

    // Create a source compiler with OpenTelemetry diagnostics
    const compiler = new SourceCompiler({
        diagnostics,
        pipeline: new TransformationPipeline([
            TransformationType.RemoveComments,
            TransformationType.Deduplicate,
            TransformationType.Validate,
        ]),
    });

    // Get the global tracer for manual instrumentation
    const tracer = trace.getTracer('adblock-compiler-example', '1.0.0');

    // Create a parent span for the entire compilation
    return tracer.startActiveSpan('compile-filter-list', async (span) => {
        try {
            span.setAttribute('example', 'opentelemetry-integration');
            span.setAttribute('source.count', 1);

            console.log('Starting compilation with OpenTelemetry tracing...');

            // Compile a test source
            const source = {
                name: 'Example Filter List',
                source: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
                transformations: [
                    TransformationType.RemoveComments,
                    TransformationType.Deduplicate,
                    TransformationType.Validate,
                ],
            };

            const rules = await compiler.compile(source, 0, 1);

            span.setAttribute('output.rules.count', rules.length);
            console.log(`✅ Compilation completed: ${rules.length} rules`);

            // Log a sample of rules
            console.log('\nSample rules:');
            rules.slice(0, 5).forEach((rule) => console.log(`  ${rule}`));

            return rules;
        } catch (error) {
            span.recordException(error as Error);
            console.error('❌ Compilation failed:', error);
            throw error;
        } finally {
            span.end();
        }
    });
}

/**
 * Example: Using manual span creation for fine-grained tracing
 */
async function manualSpanExample() {
    const tracer = trace.getTracer('adblock-compiler-example', '1.0.0');

    return tracer.startActiveSpan('manual-span-example', async (parentSpan) => {
        parentSpan.setAttribute('example.type', 'manual-instrumentation');

        // Create a nested span
        const childSpan = tracer.startSpan('child-operation', {}, trace.setSpan(trace.context.active(), parentSpan));

        childSpan.setAttribute('operation', 'data-processing');

        // Simulate work
        await new Promise((resolve) => setTimeout(resolve, 100));

        childSpan.end();
        parentSpan.end();

        console.log('✅ Manual span example completed');
    });
}

// Run the examples
if (import.meta.main) {
    console.log('=== OpenTelemetry Integration Example ===\n');

    try {
        // Example 1: Compile with automatic tracing via diagnostics collector
        await compileWithTracing();

        console.log('\n=== Manual Span Example ===\n');

        // Example 2: Manual span creation
        await manualSpanExample();

        console.log('\n✅ All examples completed successfully!');
        console.log('\nTraces have been exported to your OpenTelemetry collector.');
        console.log('If running locally, check your Jaeger/Grafana/Datadog dashboard.');
    } catch (error) {
        console.error('Error running examples:', error);
        Deno.exit(1);
    }
}
