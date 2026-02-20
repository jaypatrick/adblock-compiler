/**
 * Tests for Zod schemas used in request validation
 */

import { assertEquals } from '@std/assert';
import {
    BatchRequestAsyncSchema,
    BatchRequestSyncSchema,
    CompileRequestSchema,
    ConfigurationSchema,
    HttpFetcherOptionsSchema,
    PlatformCompilerOptionsSchema,
    SourceSchema,
    ValidationErrorSchema,
    ValidationErrorTypeSchema,
    ValidationReportSchema,
    ValidationResultSchema,
    ValidationSeveritySchema,
} from './schemas.ts';
import { SourceType, TransformationType } from '../types/index.ts';

// SourceSchema tests
Deno.test('SourceSchema - should validate minimal source', () => {
    const source = { source: 'https://example.com/list.txt' };
    const result = SourceSchema.safeParse(source);
    assertEquals(result.success, true);
});

Deno.test('SourceSchema - should validate full source', () => {
    const source = {
        source: 'https://example.com/list.txt',
        name: 'Example List',
        type: SourceType.Adblock,
        transformations: [TransformationType.RemoveComments],
    };
    const result = SourceSchema.safeParse(source);
    assertEquals(result.success, true);
});

Deno.test('SourceSchema - should reject empty source string', () => {
    const source = { source: '' };
    const result = SourceSchema.safeParse(source);
    assertEquals(result.success, false);
});

Deno.test('SourceSchema - should reject unknown property', () => {
    const source = {
        source: 'https://example.com/list.txt',
        unknownProp: 'value',
    };
    const result = SourceSchema.safeParse(source);
    assertEquals(result.success, false);
});

// ConfigurationSchema tests
Deno.test('ConfigurationSchema - should validate minimal configuration', () => {
    const config = {
        name: 'Test Config',
        sources: [{ source: 'https://example.com/list.txt' }],
    };
    const result = ConfigurationSchema.safeParse(config);
    assertEquals(result.success, true);
});

Deno.test('ConfigurationSchema - should reject empty sources', () => {
    const config = {
        name: 'Test Config',
        sources: [],
    };
    const result = ConfigurationSchema.safeParse(config);
    assertEquals(result.success, false);
});

// CompileRequestSchema tests
Deno.test('CompileRequestSchema - should validate request', () => {
    const request = {
        configuration: {
            name: 'Test',
            sources: [{ source: 'https://example.com/list.txt' }],
        },
    };
    const result = CompileRequestSchema.safeParse(request);
    assertEquals(result.success, true);
});

Deno.test('CompileRequestSchema - should validate with all fields', () => {
    const request = {
        configuration: {
            name: 'Test',
            sources: [{ source: 'https://example.com/list.txt' }],
        },
        preFetchedContent: { 'https://example.com/list.txt': 'content' },
        benchmark: true,
        priority: 'high' as const,
        turnstileToken: 'token123',
    };
    const result = CompileRequestSchema.safeParse(request);
    assertEquals(result.success, true);
});

// BatchRequestSyncSchema tests
Deno.test('BatchRequestSyncSchema - should validate batch with unique IDs', () => {
    const batch = {
        requests: [
            { id: '1', configuration: { name: 'Test', sources: [{ source: 'https://example.com/1.txt' }] } },
            { id: '2', configuration: { name: 'Test', sources: [{ source: 'https://example.com/2.txt' }] } },
        ],
    };
    const result = BatchRequestSyncSchema.safeParse(batch);
    assertEquals(result.success, true);
});

Deno.test('BatchRequestSyncSchema - should reject duplicate IDs', () => {
    const batch = {
        requests: [
            { id: '1', configuration: { name: 'Test', sources: [{ source: 'https://example.com/1.txt' }] } },
            { id: '1', configuration: { name: 'Test', sources: [{ source: 'https://example.com/2.txt' }] } },
        ],
    };
    const result = BatchRequestSyncSchema.safeParse(batch);
    assertEquals(result.success, false);
});

Deno.test('BatchRequestSyncSchema - should reject more than 10 requests', () => {
    const requests = Array.from({ length: 11 }, (_, i) => ({
        id: String(i),
        configuration: { name: 'Test', sources: [{ source: `https://example.com/${i}.txt` }] },
    }));
    const batch = { requests };
    const result = BatchRequestSyncSchema.safeParse(batch);
    assertEquals(result.success, false);
});

Deno.test('BatchRequestSyncSchema - should accept 10 requests', () => {
    const requests = Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        configuration: { name: 'Test', sources: [{ source: `https://example.com/${i}.txt` }] },
    }));
    const batch = { requests };
    const result = BatchRequestSyncSchema.safeParse(batch);
    assertEquals(result.success, true);
});

// BatchRequestAsyncSchema tests
Deno.test('BatchRequestAsyncSchema - should reject more than 100 requests', () => {
    const requests = Array.from({ length: 101 }, (_, i) => ({
        id: String(i),
        configuration: { name: 'Test', sources: [{ source: `https://example.com/${i}.txt` }] },
    }));
    const batch = { requests };
    const result = BatchRequestAsyncSchema.safeParse(batch);
    assertEquals(result.success, false);
});

Deno.test('BatchRequestAsyncSchema - should accept 100 requests', () => {
    const requests = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        configuration: { name: 'Test', sources: [{ source: `https://example.com/${i}.txt` }] },
    }));
    const batch = { requests };
    const result = BatchRequestAsyncSchema.safeParse(batch);
    assertEquals(result.success, true);
});

Deno.test('BatchRequestAsyncSchema - should validate with priority', () => {
    const batch = {
        requests: [
            { id: '1', configuration: { name: 'Test', sources: [{ source: 'https://example.com/1.txt' }] } },
        ],
        priority: 'high' as const,
    };
    const result = BatchRequestAsyncSchema.safeParse(batch);
    assertEquals(result.success, true);
});

// HttpFetcherOptionsSchema tests
Deno.test('HttpFetcherOptionsSchema - should validate empty options', () => {
    const options = {};
    const result = HttpFetcherOptionsSchema.safeParse(options);
    assertEquals(result.success, true);
});

Deno.test('HttpFetcherOptionsSchema - should validate full options', () => {
    const options = {
        timeout: 5000,
        userAgent: 'Mozilla/5.0',
        allowEmptyResponse: true,
        headers: {
            'Authorization': 'Bearer token',
            'Accept': 'text/plain',
        },
    };
    const result = HttpFetcherOptionsSchema.safeParse(options);
    assertEquals(result.success, true);
});

Deno.test('HttpFetcherOptionsSchema - should reject negative timeout', () => {
    const options = { timeout: -1000 };
    const result = HttpFetcherOptionsSchema.safeParse(options);
    assertEquals(result.success, false);
});

Deno.test('HttpFetcherOptionsSchema - should reject non-integer timeout', () => {
    const options = { timeout: 1500.5 };
    const result = HttpFetcherOptionsSchema.safeParse(options);
    assertEquals(result.success, false);
});

// PlatformCompilerOptionsSchema tests
Deno.test('PlatformCompilerOptionsSchema - should validate empty options', () => {
    const options = {};
    const result = PlatformCompilerOptionsSchema.safeParse(options);
    assertEquals(result.success, true);
});

Deno.test('PlatformCompilerOptionsSchema - should validate with preFetchedContent as Record', () => {
    const options = {
        preFetchedContent: {
            'https://example.com/list.txt': '||ads.com^\n||tracker.com^',
        },
    };
    const result = PlatformCompilerOptionsSchema.safeParse(options);
    assertEquals(result.success, true);
});

Deno.test('PlatformCompilerOptionsSchema - should validate with preFetchedContent as Map', () => {
    const options = {
        preFetchedContent: new Map([
            ['https://example.com/list.txt', '||ads.com^\n||tracker.com^'],
        ]),
    };
    const result = PlatformCompilerOptionsSchema.safeParse(options);
    assertEquals(result.success, true);
});

Deno.test('PlatformCompilerOptionsSchema - should validate with httpOptions', () => {
    const options = {
        httpOptions: {
            timeout: 10000,
            userAgent: 'Custom User Agent',
        },
    };
    const result = PlatformCompilerOptionsSchema.safeParse(options);
    assertEquals(result.success, true);
});

Deno.test('PlatformCompilerOptionsSchema - should allow customFetcher through passthrough', () => {
    const options = {
        customFetcher: {
            fetch: async () => 'content',
            canHandle: () => true,
        },
    };
    const result = PlatformCompilerOptionsSchema.safeParse(options);
    assertEquals(result.success, true);
});

// ValidationErrorTypeSchema tests
Deno.test('ValidationErrorTypeSchema - should validate all error types', () => {
    const errorTypes = [
        'parse_error',
        'syntax_error',
        'unsupported_modifier',
        'invalid_hostname',
        'ip_not_allowed',
        'pattern_too_short',
        'public_suffix_match',
        'invalid_characters',
        'cosmetic_not_supported',
        'modifier_validation_failed',
    ];

    for (const type of errorTypes) {
        const result = ValidationErrorTypeSchema.safeParse(type);
        assertEquals(result.success, true, `Failed to validate error type: ${type}`);
    }
});

Deno.test('ValidationErrorTypeSchema - should reject invalid error type', () => {
    const result = ValidationErrorTypeSchema.safeParse('invalid_type');
    assertEquals(result.success, false);
});

// ValidationSeveritySchema tests
Deno.test('ValidationSeveritySchema - should validate all severity levels', () => {
    const severities = ['error', 'warning', 'info'];

    for (const severity of severities) {
        const result = ValidationSeveritySchema.safeParse(severity);
        assertEquals(result.success, true, `Failed to validate severity: ${severity}`);
    }
});

Deno.test('ValidationSeveritySchema - should reject invalid severity', () => {
    const result = ValidationSeveritySchema.safeParse('critical');
    assertEquals(result.success, false);
});

// ValidationErrorSchema tests
Deno.test('ValidationErrorSchema - should validate minimal error', () => {
    const error = {
        type: 'parse_error',
        severity: 'error',
        ruleText: '||invalid rule',
        message: 'Failed to parse rule',
    };
    const result = ValidationErrorSchema.safeParse(error);
    assertEquals(result.success, true);
});

Deno.test('ValidationErrorSchema - should validate full error', () => {
    const error = {
        type: 'unsupported_modifier',
        severity: 'error',
        ruleText: '||example.com^$popup',
        lineNumber: 42,
        message: 'Unsupported modifier: popup',
        details: 'Supported modifiers: important, ~important, ctag, dnstype, dnsrewrite',
        sourceName: 'Custom Filter',
    };
    const result = ValidationErrorSchema.safeParse(error);
    assertEquals(result.success, true);
});

Deno.test('ValidationErrorSchema - should reject invalid line number', () => {
    const error = {
        type: 'parse_error',
        severity: 'error',
        ruleText: '||invalid',
        lineNumber: -1, // Invalid negative line number
        message: 'Failed to parse',
    };
    const result = ValidationErrorSchema.safeParse(error);
    assertEquals(result.success, false);
});

// ValidationReportSchema tests
Deno.test('ValidationReportSchema - should validate empty report', () => {
    const report = {
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
        errors: [],
        totalRules: 100,
        validRules: 100,
        invalidRules: 0,
    };
    const result = ValidationReportSchema.safeParse(report);
    assertEquals(result.success, true);
});

Deno.test('ValidationReportSchema - should validate report with errors', () => {
    const report = {
        errorCount: 2,
        warningCount: 1,
        infoCount: 0,
        errors: [
            {
                type: 'parse_error',
                severity: 'error',
                ruleText: '||invalid1',
                message: 'Parse error 1',
            },
            {
                type: 'syntax_error',
                severity: 'error',
                ruleText: '||invalid2',
                message: 'Syntax error 2',
            },
            {
                type: 'modifier_validation_failed',
                severity: 'warning',
                ruleText: '||example.com^$important',
                message: 'Modifier warning',
            },
        ],
        totalRules: 100,
        validRules: 97,
        invalidRules: 3,
    };
    const result = ValidationReportSchema.safeParse(report);
    assertEquals(result.success, true);
});

Deno.test('ValidationReportSchema - should reject negative counts', () => {
    const report = {
        errorCount: -1, // Invalid negative count
        warningCount: 0,
        infoCount: 0,
        errors: [],
        totalRules: 100,
        validRules: 100,
        invalidRules: 0,
    };
    const result = ValidationReportSchema.safeParse(report);
    assertEquals(result.success, false);
});

// ValidationResultSchema tests
Deno.test('ValidationResultSchema - should validate result with empty rules', () => {
    const result = {
        rules: [],
        validation: {
            errorCount: 0,
            warningCount: 0,
            infoCount: 0,
            errors: [],
            totalRules: 0,
            validRules: 0,
            invalidRules: 0,
        },
    };
    const parseResult = ValidationResultSchema.safeParse(result);
    assertEquals(parseResult.success, true);
});

Deno.test('ValidationResultSchema - should validate result with rules and errors', () => {
    const result = {
        rules: ['||example.com^', '||ads.com^'],
        validation: {
            errorCount: 1,
            warningCount: 0,
            infoCount: 0,
            errors: [
                {
                    type: 'parse_error',
                    severity: 'error',
                    ruleText: '||invalid',
                    message: 'Parse failed',
                },
            ],
            totalRules: 3,
            validRules: 2,
            invalidRules: 1,
        },
    };
    const parseResult = ValidationResultSchema.safeParse(result);
    assertEquals(parseResult.success, true);
});
