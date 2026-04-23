/**
 * Unit tests for the Page Shield ABP rule-generation utilities.
 *
 * @see src/utils/pageshield-rules.ts
 */

import { assertEquals, assertMatch } from '@std/assert';
import { PAGE_SHIELD_ALLOW_THRESHOLD, PAGE_SHIELD_BLOCK_THRESHOLD, toAllowRule, toBlockRule } from './pageshield-rules.ts';

// ── Threshold constants ───────────────────────────────────────────────────────

Deno.test('PAGE_SHIELD_BLOCK_THRESHOLD is 0.7', () => {
    assertEquals(PAGE_SHIELD_BLOCK_THRESHOLD, 0.7);
});

Deno.test('PAGE_SHIELD_ALLOW_THRESHOLD is 0.1', () => {
    assertEquals(PAGE_SHIELD_ALLOW_THRESHOLD, 0.1);
});

Deno.test('BLOCK threshold is greater than ALLOW threshold', () => {
    assertEquals(PAGE_SHIELD_BLOCK_THRESHOLD > PAGE_SHIELD_ALLOW_THRESHOLD, true);
});

// ── toBlockRule ───────────────────────────────────────────────────────────────

Deno.test('toBlockRule — HTTPS URL returns ||hostname^', () => {
    assertEquals(toBlockRule('https://evil.example.com/tracker.js'), '||evil.example.com^');
});

Deno.test('toBlockRule — HTTP URL returns ||hostname^', () => {
    assertEquals(toBlockRule('http://cdn.example.org/lib.js'), '||cdn.example.org^');
});

Deno.test('toBlockRule — URL with path strips path component', () => {
    const rule = toBlockRule('https://tracker.example.com/v3/pixel.gif?id=123');
    assertEquals(rule, '||tracker.example.com^');
});

Deno.test('toBlockRule — URL with port strips port from pattern', () => {
    // ABP hostname rules should match the hostname regardless of port.
    const rule = toBlockRule('https://cdn.example.com:8443/script.js');
    assertEquals(rule, '||cdn.example.com^');
});

Deno.test('toBlockRule — bare hostname (no scheme) falls back to raw value', () => {
    // A bare hostname is not a valid URL; toBlockRule falls back gracefully.
    const rule = toBlockRule('just-a-hostname');
    assertEquals(rule, '||just-a-hostname^');
});

Deno.test('toBlockRule — empty string falls back to ||^', () => {
    const rule = toBlockRule('');
    assertEquals(rule, '||^');
});

Deno.test('toBlockRule — result starts with || and ends with ^', () => {
    const rule = toBlockRule('https://example.com/script.js');
    assertMatch(rule, /^\|\|.+\^$/);
});

// ── toAllowRule ───────────────────────────────────────────────────────────────

Deno.test('toAllowRule — HTTPS URL returns @@||hostname^', () => {
    assertEquals(toAllowRule('https://trusted.cdn.example.com/lib.js'), '@@||trusted.cdn.example.com^');
});

Deno.test('toAllowRule — HTTP URL returns @@||hostname^', () => {
    assertEquals(toAllowRule('http://static.example.net/fonts.css'), '@@||static.example.net^');
});

Deno.test('toAllowRule — URL with path strips path component', () => {
    const rule = toAllowRule('https://cdn.example.com/v2/bundle.min.js?cb=abc');
    assertEquals(rule, '@@||cdn.example.com^');
});

Deno.test('toAllowRule — bare hostname falls back to raw value', () => {
    const rule = toAllowRule('my-local-server');
    assertEquals(rule, '@@||my-local-server^');
});

Deno.test('toAllowRule — empty string falls back to @@||^', () => {
    const rule = toAllowRule('');
    assertEquals(rule, '@@||^');
});

Deno.test('toAllowRule — result starts with @@|| and ends with ^', () => {
    const rule = toAllowRule('https://example.com/lib.js');
    assertMatch(rule, /^@@\|\|.+\^$/);
});

// ── Symmetry ──────────────────────────────────────────────────────────────────

Deno.test('toAllowRule is a strict superset of toBlockRule (same hostname, @@-prefixed)', () => {
    const url = 'https://cdn.example.com/widget.js';
    const block = toBlockRule(url);
    const allow = toAllowRule(url);
    assertEquals(allow, `@@${block}`);
});

// ── Deduplication compatibility ───────────────────────────────────────────────

Deno.test('same hostname under different paths produces identical block rules (Set-dedup safe)', () => {
    const rule1 = toBlockRule('https://tracker.example.com/pixel.gif');
    const rule2 = toBlockRule('https://tracker.example.com/event.js?v=2');
    assertEquals(rule1, rule2);
});

Deno.test('same hostname under different paths produces identical allow rules (Set-dedup safe)', () => {
    const rule1 = toAllowRule('https://cdn.example.com/jquery.min.js');
    const rule2 = toAllowRule('https://cdn.example.com/react.min.js');
    assertEquals(rule1, rule2);
});
