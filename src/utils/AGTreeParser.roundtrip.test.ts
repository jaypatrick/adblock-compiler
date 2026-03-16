/**
 * AGTree roundtrip fidelity tests.
 *
 * Verifies that parse → generate produces the original rule text for every
 * supported rule category: network rules, host rules, cosmetic rules,
 * comments, and empty lines.
 *
 * A roundtrip is considered faithful if:
 *   generate(parse(input)) === input.trim()
 *
 * These tests complement the existing AGTreeParserPlugin.test.ts by covering
 * a wider set of rule syntaxes and edge cases.
 */

import { assert, assertEquals } from '@std/assert';
import { AdblockSyntax, AGTreeParser } from './AGTreeParser.ts';

// ============================================================================
// Helper
// ============================================================================

function assertRoundtrip(ruleText: string, description?: string) {
    const result = AGTreeParser.parse(ruleText);
    assert(result.success, `Parse failed for: ${ruleText} — ${result.error}`);
    assert(result.ast, `No AST for: ${ruleText}`);
    const generated = AGTreeParser.generate(result.ast);
    assertEquals(generated, ruleText.trim(), description ?? `Roundtrip failed for: ${ruleText}`);
}

// ============================================================================
// Network rules — standard adblock syntax
// ============================================================================

Deno.test('roundtrip: basic blocking rule', () => {
    assertRoundtrip('||example.com^');
});

Deno.test('roundtrip: blocking rule with third-party modifier', () => {
    assertRoundtrip('||ads.example.com^$third-party');
});

Deno.test('roundtrip: blocking rule with multiple modifiers', () => {
    assertRoundtrip('||cdn.tracking.io^$script,image,third-party');
});

Deno.test('roundtrip: exception rule', () => {
    assertRoundtrip('@@||safe-ads.example.com^');
});

Deno.test('roundtrip: exception rule with document modifier', () => {
    assertRoundtrip('@@||example.com/ads$document');
});

Deno.test('roundtrip: plain pattern (no anchors)', () => {
    assertRoundtrip('/ads/banner.js');
});

Deno.test('roundtrip: regex pattern', () => {
    assertRoundtrip('/^https?:\\/\\/example\\.com\\/ads/');
});

Deno.test('roundtrip: domain-specific blocking', () => {
    assertRoundtrip('||ads.example.com^$domain=foo.com|bar.com');
});

// ============================================================================
// Host rules — /etc/hosts format
// ============================================================================

Deno.test('roundtrip: hosts rule with 0.0.0.0', () => {
    assertRoundtrip('0.0.0.0 ads.example.com');
});

Deno.test('roundtrip: hosts rule with 127.0.0.1', () => {
    assertRoundtrip('127.0.0.1 malware.bad-domain.com');
});

// ============================================================================
// Cosmetic rules — element hiding
// ============================================================================

Deno.test('roundtrip: element hiding rule', () => {
    assertRoundtrip('example.com##.ad-banner');
});

Deno.test('roundtrip: element hiding with attribute selector', () => {
    assertRoundtrip('example.org##div[id="sponsored"]');
});

Deno.test('roundtrip: element hiding exception', () => {
    assertRoundtrip('example.com#@#.ad-banner');
});

Deno.test('roundtrip: generic cosmetic rule (no domain)', () => {
    assertRoundtrip('##.ads-container');
});

// ============================================================================
// Comments
// ============================================================================

Deno.test('roundtrip: simple comment', () => {
    assertRoundtrip('! This is a comment');
});

Deno.test('roundtrip: metadata comment', () => {
    assertRoundtrip('! Title: Test Filter List');
});

Deno.test('roundtrip: Adblock Plus header', () => {
    assertRoundtrip('[Adblock Plus 2.0]');
});

Deno.test('roundtrip: hash comment (hosts-style)', () => {
    assertRoundtrip('# This is a hosts-style comment');
});

// ============================================================================
// Empty lines
// ============================================================================

Deno.test('roundtrip: empty line', () => {
    const result = AGTreeParser.parse('');
    assert(result.success, 'Empty string should parse successfully');
    assert(result.ast, 'Empty string should produce an AST');
    const generated = AGTreeParser.generate(result.ast);
    assertEquals(generated, '');
});

// ============================================================================
// Filter list roundtrip (multi-line)
// ============================================================================

Deno.test('roundtrip: multi-line filter list', () => {
    const input = [
        '! Title: Roundtrip Test',
        '! Last modified: 2025-01-01',
        '',
        '||ads.example.com^',
        '||tracking.example.org^$third-party',
        '@@||safe.example.com^',
        'example.com##.ad-banner',
        '0.0.0.0 malware.test.net',
    ];

    for (const line of input) {
        if (line === '') {
            // Empty line special case
            const result = AGTreeParser.parse(line);
            assert(result.success, `Parse failed for empty line`);
            continue;
        }
        assertRoundtrip(line, `Filter list line: ${line}`);
    }
});

// ============================================================================
// Syntax detection consistency
// ============================================================================

Deno.test('detectSyntax: network rule returns Common', () => {
    const syntax = AGTreeParser.detectSyntax('||example.com^');
    assertEquals(syntax, AdblockSyntax.Common);
});

Deno.test('detectSyntax: hosts rule returns Common', () => {
    const syntax = AGTreeParser.detectSyntax('0.0.0.0 ads.example.com');
    assertEquals(syntax, AdblockSyntax.Common);
});

// ============================================================================
// Bulk fidelity check — assert ≥95% roundtrip rate across a corpus
// ============================================================================

Deno.test('roundtrip fidelity: ≥95% success rate across rule corpus', () => {
    const corpus = [
        // Network rules
        '||example.com^',
        '||ads.tracker.com^$third-party,script',
        '@@||cdn.example.com^$image',
        '/ads/banner',
        '||example.com^$domain=a.com|b.com',
        '||ads2.example.net^$third-party',
        '@@||safe.example.org^$document',
        '/tracking/pixel.gif',
        // Host rules
        '0.0.0.0 ads.example.com',
        '127.0.0.1 tracking.example.org',
        '0.0.0.0 malware.test.net',
        '127.0.0.1 spam.example.io',
        // Cosmetic rules
        'example.com##.ad-container',
        '##.sponsored-content',
        'example.com#@#.safe-ad',
        'example.org##div[class="promo"]',
        'news.example.com##aside.sidebar-ad',
        '##.cookie-banner',
        // Comments
        '! Title: Test',
        '! Homepage: https://example.com',
        '# hosts comment',
        '! Version: 1.0',
        // Empty
        '',
    ];

    let successes = 0;
    for (const rule of corpus) {
        const result = AGTreeParser.parse(rule);
        if (!result.success || !result.ast) continue;
        const generated = AGTreeParser.generate(result.ast);
        if (generated === rule.trim()) {
            successes++;
        }
    }

    const rate = successes / corpus.length;
    assert(rate >= 0.95, `Roundtrip fidelity ${(rate * 100).toFixed(1)}% is below 95% threshold`);
});
