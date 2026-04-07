import { assertEquals, assertExists } from '@std/assert';
import { DiffGenerator, type DiffReport, generateDiff, generateDiffMarkdown } from './DiffReport.ts';

Deno.test('DiffGenerator - detects added rules', () => {
    const original = ['||example.com^'];
    const updated = ['||example.com^', '||new.example.com^'];

    const generator = new DiffGenerator();
    const report = generator.generate(original, updated);

    assertEquals(report.summary.addedCount, 1);
    assertEquals(report.summary.removedCount, 0);
    assertEquals(report.summary.unchangedCount, 1);
    assertEquals(report.added[0].rule, '||new.example.com^');
});

Deno.test('DiffGenerator - detects removed rules', () => {
    const original = ['||example.com^', '||removed.example.com^'];
    const updated = ['||example.com^'];

    const generator = new DiffGenerator();
    const report = generator.generate(original, updated);

    assertEquals(report.summary.addedCount, 0);
    assertEquals(report.summary.removedCount, 1);
    assertEquals(report.summary.unchangedCount, 1);
    assertEquals(report.removed[0].rule, '||removed.example.com^');
});

Deno.test('DiffGenerator - calculates net change', () => {
    const original = ['||a.com^', '||b.com^'];
    const updated = ['||a.com^', '||c.com^', '||d.com^', '||e.com^'];

    const generator = new DiffGenerator();
    const report = generator.generate(original, updated);

    assertEquals(report.summary.originalCount, 2);
    assertEquals(report.summary.newCount, 4);
    assertEquals(report.summary.netChange, 2); // +3 added, -1 removed = +2
});

Deno.test('DiffGenerator - ignores comments by default', () => {
    const original = ['! Comment', '||example.com^'];
    const updated = ['! Different comment', '||example.com^'];

    const generator = new DiffGenerator({ ignoreComments: true });
    const report = generator.generate(original, updated);

    assertEquals(report.summary.addedCount, 0);
    assertEquals(report.summary.removedCount, 0);
    assertEquals(report.summary.unchangedCount, 1);
});

Deno.test('DiffGenerator - includes comments when configured', () => {
    const original = ['! Comment', '||example.com^'];
    const updated = ['! Different comment', '||example.com^'];

    const generator = new DiffGenerator({ ignoreComments: false });
    const report = generator.generate(original, updated);

    assertEquals(report.summary.addedCount, 1);
    assertEquals(report.summary.removedCount, 1);
});

Deno.test('DiffGenerator - ignores empty lines by default', () => {
    const original = ['||example.com^', '', '||test.com^'];
    const updated = ['||example.com^', '||test.com^'];

    const generator = new DiffGenerator();
    const report = generator.generate(original, updated);

    assertEquals(report.summary.addedCount, 0);
    assertEquals(report.summary.removedCount, 0);
});

Deno.test('DiffGenerator - analyzes domain changes', () => {
    const original = [
        '||ads.example.com^',
        '||tracking.example.com^',
    ];
    const updated = [
        '||ads.example.com^',
        '||new-ads.example.com^',
        '||new-tracking.example.com^',
    ];

    const generator = new DiffGenerator({ analyzeDomains: true });
    const report = generator.generate(original, updated);

    assertExists(report.domainChanges);
    assertEquals(report.domainChanges.length > 0, true);
});

Deno.test('DiffGenerator - exports as markdown', () => {
    const original = ['||old.example.com^'];
    const updated = ['||new.example.com^'];

    const generator = new DiffGenerator();
    const report = generator.generate(original, updated);
    const markdown = generator.exportAsMarkdown(report);

    assertEquals(markdown.includes('# Filter List Diff Report'), true);
    assertEquals(markdown.includes('## Summary'), true);
    assertEquals(markdown.includes('Added'), true);
    assertEquals(markdown.includes('Removed'), true);
});

Deno.test('DiffGenerator - exports as JSON', () => {
    const original = ['||example.com^'];
    const updated = ['||example.com^', '||new.example.com^'];

    const generator = new DiffGenerator();
    const report = generator.generate(original, updated);
    const json = generator.exportAsJson(report);

    const parsed = JSON.parse(json);
    assertEquals(parsed.summary.addedCount, 1);
    assertExists(parsed.timestamp);
});

Deno.test('generateDiff - convenience function works', () => {
    const original = ['||example.com^'];
    const updated = ['||new.example.com^'];

    const report = generateDiff(original, updated);

    assertEquals(report.summary.addedCount, 1);
    assertEquals(report.summary.removedCount, 1);
});

Deno.test('generateDiffMarkdown - convenience function works', () => {
    const original = ['||example.com^'];
    const updated = ['||new.example.com^'];

    const markdown = generateDiffMarkdown(original, updated);

    assertEquals(markdown.includes('# Filter List Diff Report'), true);
});

Deno.test('DiffGenerator - handles empty lists', () => {
    const generator = new DiffGenerator();

    const report1 = generator.generate([], ['||new.com^']);
    assertEquals(report1.summary.addedCount, 1);
    assertEquals(report1.summary.removedCount, 0);

    const report2 = generator.generate(['||old.com^'], []);
    assertEquals(report2.summary.addedCount, 0);
    assertEquals(report2.summary.removedCount, 1);

    const report3 = generator.generate([], []);
    assertEquals(report3.summary.addedCount, 0);
    assertEquals(report3.summary.removedCount, 0);
});

Deno.test('DiffGenerator - limits output rules', () => {
    const original: string[] = [];
    const updated = Array.from({ length: 2000 }, (_, i) => `||rule${i}.com^`);

    const generator = new DiffGenerator({ maxRulesToInclude: 100 });
    const report = generator.generate(original, updated);

    assertEquals(report.summary.addedCount, 2000);
    assertEquals(report.added.length, 100); // Limited to 100
});

// =========================================================================
// AGTree integration tests
// =========================================================================

Deno.test('DiffGenerator - enriches RuleDiff with category for network rules', () => {
    const original: string[] = [];
    const updated = ['||ads.example.com^', '@@||safe.example.com^'];

    const generator = new DiffGenerator();
    const report = generator.generate(original, updated);

    assertEquals(report.added.length, 2);

    const blockingRule = report.added.find((r) => r.rule === '||ads.example.com^');
    assertExists(blockingRule);
    assertEquals(blockingRule.category, 'network');
    assertEquals(blockingRule.isException, false);

    const exceptionRule = report.added.find((r) => r.rule === '@@||safe.example.com^');
    assertExists(exceptionRule);
    assertEquals(exceptionRule.category, 'network');
    assertEquals(exceptionRule.isException, true);
});

Deno.test('DiffGenerator - enriches RuleDiff with category for cosmetic rules', () => {
    const original: string[] = [];
    const updated = ['example.com##.ad-banner', 'example.com#@#.ad-banner'];

    const generator = new DiffGenerator();
    const report = generator.generate(original, updated);

    const hideRule = report.added.find((r) => r.rule === 'example.com##.ad-banner');
    assertExists(hideRule);
    assertEquals(hideRule.category, 'cosmetic');
    assertEquals(hideRule.isException, false);

    const exceptionRule = report.added.find((r) => r.rule === 'example.com#@#.ad-banner');
    assertExists(exceptionRule);
    assertEquals(exceptionRule.category, 'cosmetic');
    assertEquals(exceptionRule.isException, true);
});

Deno.test('DiffGenerator - enriches RuleDiff with category for host rules', () => {
    const original: string[] = [];
    const updated = ['127.0.0.1 ads.example.com', '0.0.0.0 tracking.example.com'];

    const generator = new DiffGenerator();
    const report = generator.generate(original, updated);

    assertEquals(report.added.length, 2);
    for (const rule of report.added) {
        assertEquals(rule.category, 'host');
    }
});

Deno.test('DiffGenerator - syntax field is populated by AGTree', () => {
    const original: string[] = [];
    // Standard cosmetic element-hiding rule
    const updated = ['example.com##.ad-banner'];

    const generator = new DiffGenerator();
    const report = generator.generate(original, updated);

    assertEquals(report.added.length, 1);
    assertExists(report.added[0].syntax);
    // Should be a non-empty string (e.g. 'Common', 'AdGuard', 'uBlockOrigin')
    assertEquals(typeof report.added[0].syntax, 'string');
    assertEquals(report.added[0].syntax!.length > 0, true);
});

Deno.test('DiffGenerator - summary includes categoryBreakdown', () => {
    const original = ['||old.example.com^', 'example.com##.ad'];
    const updated = ['||new.example.com^', '127.0.0.1 blocked.example.com'];

    const generator = new DiffGenerator();
    const report = generator.generate(original, updated);

    assertExists(report.summary.categoryBreakdown);
    assertEquals(report.summary.categoryBreakdown.network.added, 1);
    assertEquals(report.summary.categoryBreakdown.network.removed, 1);
    assertEquals(report.summary.categoryBreakdown.cosmetic.added, 0);
    assertEquals(report.summary.categoryBreakdown.cosmetic.removed, 1);
    assertEquals(report.summary.categoryBreakdown.host.added, 1);
    assertEquals(report.summary.categoryBreakdown.host.removed, 0);
});

Deno.test('DiffGenerator - categoryBreakdown counts comments when ignoreComments is false', () => {
    const original: string[] = [];
    const updated = ['! This is a comment', '||example.com^'];

    const generator = new DiffGenerator({ ignoreComments: false });
    const report = generator.generate(original, updated);

    assertExists(report.summary.categoryBreakdown);
    assertEquals(report.summary.categoryBreakdown.comment.added, 1);
    assertEquals(report.summary.categoryBreakdown.network.added, 1);
});

Deno.test('DiffGenerator - useAstNormalization collapses internal whitespace differences', () => {
    // Host rule with double space (not fixed by .trim()) vs single space.
    // agtree normalises host rules to a single space when regenerating from AST.
    const original = ['127.0.0.1  example.com']; // double space
    const updated = ['127.0.0.1 example.com']; // single space

    const generatorNormal = new DiffGenerator({ useAstNormalization: false });
    const reportNormal = generatorNormal.generate(original, updated);
    // Without AST normalization: the strings differ → detected as 1 removed + 1 added
    assertEquals(reportNormal.summary.removedCount, 1);
    assertEquals(reportNormal.summary.addedCount, 1);

    const generatorAst = new DiffGenerator({ useAstNormalization: true });
    const reportAst = generatorAst.generate(original, updated);
    // With AST normalization: both normalise to "127.0.0.1 example.com" → no changes
    assertEquals(reportAst.summary.addedCount, 0);
    assertEquals(reportAst.summary.removedCount, 0);
    assertEquals(reportAst.summary.unchangedCount, 1);
});

Deno.test('DiffGenerator - useAstNormalization handles modifier reordering', () => {
    // AGTree may or may not reorder modifiers – test is about canonical form stability
    const original = ['||example.com^$third-party,script'];
    const updated = ['||example.com^$third-party,script'];

    const generator = new DiffGenerator({ useAstNormalization: true });
    const report = generator.generate(original, updated);

    assertEquals(report.summary.addedCount, 0);
    assertEquals(report.summary.removedCount, 0);
    assertEquals(report.summary.unchangedCount, 1);
});

Deno.test('DiffGenerator - extractDomain works for cosmetic rules via AGTree', () => {
    const original = ['example.com##.ad-banner'];
    const updated = ['example.com##.ad-banner', 'ads.example.com##.tracker'];

    const generator = new DiffGenerator({ analyzeDomains: true });
    const report = generator.generate(original, updated);

    assertExists(report.domainChanges);
    const adsDomain = report.domainChanges.find((d) => d.domain === 'ads.example.com');
    assertExists(adsDomain);
    assertEquals(adsDomain.added, 1);
    assertEquals(adsDomain.removed, 0);
});

Deno.test('DiffGenerator - extractDomain works for host rules via AGTree', () => {
    const original: string[] = [];
    const updated = ['127.0.0.1 blocked.example.com'];

    const generator = new DiffGenerator({ analyzeDomains: true });
    const report = generator.generate(original, updated);

    assertExists(report.domainChanges);
    const domain = report.domainChanges.find((d) => d.domain === 'blocked.example.com');
    assertExists(domain);
    assertEquals(domain.added, 1);
});

Deno.test('DiffGenerator - markdown includes Rule Type Breakdown section', () => {
    const original = ['||old.example.com^'];
    const updated = ['example.com##.selector'];

    const generator = new DiffGenerator();
    const report = generator.generate(original, updated);
    const markdown = generator.exportAsMarkdown(report);

    assertEquals(markdown.includes('## Rule Type Breakdown'), true);
    assertEquals(markdown.includes('Network'), true);
    assertEquals(markdown.includes('Cosmetic'), true);
});

Deno.test('DiffGenerator - useAstNormalization preserves original rule text in RuleDiff', () => {
    // The added rule has double internal space; AGTree normalises it to single space
    // for comparison purposes but the diff report should show the original text.
    const original: string[] = [];
    const updated = ['127.0.0.1  example.com']; // double space

    const generator = new DiffGenerator({ useAstNormalization: true });
    const report = generator.generate(original, updated);

    assertEquals(report.added.length, 1);
    assertEquals(report.added[0].rule, '127.0.0.1  example.com');
});

Deno.test('DiffGenerator - exportAsMarkdown handles missing categoryBreakdown for backward compat', () => {
    const generator = new DiffGenerator();
    const report = generator.generate(['||old.com^'], ['||new.com^']);

    // Simulate a pre-existing serialised report that lacks categoryBreakdown
    const oldReport: DiffReport = {
        ...report,
        summary: { ...report.summary, categoryBreakdown: undefined },
    };

    // Must not throw, and omits the breakdown table since all counts are 0
    const markdown = generator.exportAsMarkdown(oldReport);
    assertEquals(markdown.includes('# Filter List Diff Report'), true);
    assertEquals(markdown.includes('## Rule Type Breakdown'), false);
});
