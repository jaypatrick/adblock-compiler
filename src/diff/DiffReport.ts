/**
 * Diff Report Generation
 * Generates detailed diff reports between filter list compilations.
 * Uses AGTree for semantic rule analysis, domain extraction, and optional
 * canonical-form normalization.
 */

import { PACKAGE_INFO } from '../version.ts';
import { AGTreeParser } from '../utils/AGTreeParser.ts';

/**
 * Rule category as determined by AGTree parsing.
 */
export type RuleDiffCategory = 'network' | 'cosmetic' | 'host' | 'comment' | 'unknown';

/**
 * Represents a single rule difference
 */
export interface RuleDiff {
    /** The rule text */
    rule: string;
    /** Type of change */
    type: 'added' | 'removed' | 'modified';
    /** Source of the rule (if known) */
    source?: string;
    /** Line number in original list */
    originalLine?: number;
    /** Line number in new list */
    newLine?: number;
    /**
     * Rule category detected by AGTree (network blocking rule, cosmetic/element-hiding rule,
     * hosts-file rule, comment, or unknown for invalid/unparseable rules).
     */
    category?: RuleDiffCategory;
    /**
     * Adblock syntax dialect detected by AGTree (e.g. `'AdGuard'`, `'uBlockOrigin'`,
     * `'AdblockPlus'`, `'Common'`).
     */
    syntax?: string;
    /**
     * Whether this is an exception (allowlist) rule.
     * `true` for `@@`-prefixed network rules and `#@#` cosmetic rules.
     */
    isException?: boolean;
}

/**
 * Per-category change counts for a diff summary.
 */
export interface CategoryChangeCounts {
    /** Network (blocking/exception) rule changes */
    network: { added: number; removed: number };
    /** Cosmetic / element-hiding rule changes */
    cosmetic: { added: number; removed: number };
    /** Hosts-file rule changes */
    host: { added: number; removed: number };
    /** Comment rule changes (only non-zero when `ignoreComments` is `false`) */
    comment: { added: number; removed: number };
    /** Rules that could not be categorised (invalid/unparseable) */
    unknown: { added: number; removed: number };
}

/**
 * Summary statistics for diff
 */
export interface DiffSummary {
    /** Total rules in original list */
    originalCount: number;
    /** Total rules in new list */
    newCount: number;
    /** Number of added rules */
    addedCount: number;
    /** Number of removed rules */
    removedCount: number;
    /** Number of unchanged rules */
    unchangedCount: number;
    /** Net change (positive = more rules) */
    netChange: number;
    /** Percentage change */
    percentageChange: number;
    /** Per-category breakdown of added/removed counts, populated by AGTree parsing */
    categoryBreakdown: CategoryChangeCounts;
}

/**
 * Domain-level diff information
 */
export interface DomainDiff {
    /** Domain name */
    domain: string;
    /** Number of rules added for this domain */
    added: number;
    /** Number of rules removed for this domain */
    removed: number;
}

/**
 * Complete diff report
 */
export interface DiffReport {
    /** Timestamp of comparison */
    timestamp: string;
    /** Version of generator */
    generatorVersion: string;
    /** Original list metadata */
    original: {
        name?: string;
        version?: string;
        timestamp?: string;
        ruleCount: number;
    };
    /** New list metadata */
    current: {
        name?: string;
        version?: string;
        timestamp?: string;
        ruleCount: number;
    };
    /** Summary statistics */
    summary: DiffSummary;
    /** Added rules */
    added: RuleDiff[];
    /** Removed rules */
    removed: RuleDiff[];
    /** Domain-level changes */
    domainChanges: DomainDiff[];
}

/**
 * Options for diff generation
 */
export interface DiffOptions {
    /** Include full rule lists in report */
    includeFullRules?: boolean;
    /** Maximum number of rules to include in report */
    maxRulesToInclude?: number;
    /** Include domain-level analysis */
    analyzeDomains?: boolean;
    /** Ignore comments in comparison */
    ignoreComments?: boolean;
    /** Ignore empty lines in comparison */
    ignoreEmptyLines?: boolean;
    /**
     * Normalize rules to their canonical form via AGTree AST regeneration before
     * comparing.  When `true`, two rules that are semantically identical but
     * differ in whitespace (e.g. `||example.com^ ` vs `||example.com^`) are
     * treated as the same rule.  Defaults to `false` to preserve backward-
     * compatible behaviour.
     */
    useAstNormalization?: boolean;
}

/**
 * Generates diff reports between filter list compilations
 */
export class DiffGenerator {
    private readonly options: Required<DiffOptions>;

    /**
     * Creates a new DiffGenerator
     * @param options - Optional diff generation options
     */
    constructor(options?: DiffOptions) {
        this.options = {
            includeFullRules: true,
            maxRulesToInclude: 1000,
            analyzeDomains: true,
            ignoreComments: true,
            ignoreEmptyLines: true,
            useAstNormalization: false,
            ...options,
        };
    }

    /**
     * Generates a diff report between two rule lists
     */
    generate(
        originalRules: string[],
        newRules: string[],
        metadata?: {
            originalName?: string;
            originalVersion?: string;
            originalTimestamp?: string;
            newName?: string;
            newVersion?: string;
            newTimestamp?: string;
        },
    ): DiffReport {
        // Normalize rules
        const normalizedOriginal = this.normalizeRules(originalRules);
        const normalizedNew = this.normalizeRules(newRules);

        // Create sets for fast lookup
        const originalSet = new Set(normalizedOriginal);
        const newSet = new Set(normalizedNew);

        // Find added and removed rules
        const added: RuleDiff[] = [];
        const removed: RuleDiff[] = [];

        // Per-category counters
        const categoryBreakdown: CategoryChangeCounts = {
            network: { added: 0, removed: 0 },
            cosmetic: { added: 0, removed: 0 },
            host: { added: 0, removed: 0 },
            comment: { added: 0, removed: 0 },
            unknown: { added: 0, removed: 0 },
        };

        // Find removed rules (in original but not in new)
        for (let i = 0; i < normalizedOriginal.length; i++) {
            const rule = normalizedOriginal[i];
            if (!newSet.has(rule)) {
                const info = this.categorizeRule(rule);
                removed.push({
                    rule,
                    type: 'removed',
                    originalLine: i + 1,
                    category: info.category,
                    syntax: info.syntax,
                    isException: info.isException,
                });
                categoryBreakdown[info.category].removed++;
            }
        }

        // Find added rules (in new but not in original)
        for (let i = 0; i < normalizedNew.length; i++) {
            const rule = normalizedNew[i];
            if (!originalSet.has(rule)) {
                const info = this.categorizeRule(rule);
                added.push({
                    rule,
                    type: 'added',
                    newLine: i + 1,
                    category: info.category,
                    syntax: info.syntax,
                    isException: info.isException,
                });
                categoryBreakdown[info.category].added++;
            }
        }

        // Calculate summary
        const unchangedCount = normalizedOriginal.length - removed.length;
        const summary: DiffSummary = {
            originalCount: normalizedOriginal.length,
            newCount: normalizedNew.length,
            addedCount: added.length,
            removedCount: removed.length,
            unchangedCount,
            netChange: added.length - removed.length,
            percentageChange: normalizedOriginal.length > 0 ? ((added.length - removed.length) / normalizedOriginal.length) * 100 : 0,
            categoryBreakdown,
        };

        // Analyze domain changes if requested
        const domainChanges = this.options.analyzeDomains ? this.analyzeDomainChanges(added, removed) : [];

        // Limit rules if needed
        const limitedAdded = this.options.includeFullRules ? added.slice(0, this.options.maxRulesToInclude) : [];
        const limitedRemoved = this.options.includeFullRules ? removed.slice(0, this.options.maxRulesToInclude) : [];

        return {
            timestamp: new Date().toISOString(),
            generatorVersion: PACKAGE_INFO.version,
            original: {
                name: metadata?.originalName,
                version: metadata?.originalVersion,
                timestamp: metadata?.originalTimestamp,
                ruleCount: normalizedOriginal.length,
            },
            current: {
                name: metadata?.newName,
                version: metadata?.newVersion,
                timestamp: metadata?.newTimestamp,
                ruleCount: normalizedNew.length,
            },
            summary,
            added: limitedAdded,
            removed: limitedRemoved,
            domainChanges,
        };
    }

    /**
     * Normalizes rules for comparison.
     *
     * When `useAstNormalization` is enabled, each successfully parsed rule is
     * regenerated from its AGTree AST so that semantically equivalent rules
     * with different whitespace collapse to the same string before comparison.
     */
    private normalizeRules(rules: string[]): string[] {
        return rules
            .map((rule) => rule.trim())
            .filter((rule) => {
                if (!rule && this.options.ignoreEmptyLines) {
                    return false;
                }
                if (this.options.ignoreComments && (rule.startsWith('!') || rule.startsWith('#'))) {
                    return false;
                }
                return true;
            })
            .map((rule) => {
                if (!this.options.useAstNormalization) {
                    return rule;
                }
                const parseResult = AGTreeParser.parse(rule);
                if (parseResult.success && parseResult.ast) {
                    return AGTreeParser.generate(parseResult.ast);
                }
                return rule;
            });
    }

    /**
     * Uses AGTree to determine the category, detected syntax, and exception
     * status of a rule.  Falls back to `'unknown'` for rules that cannot be
     * parsed.
     */
    private categorizeRule(rule: string): { category: RuleDiffCategory; syntax?: string; isException?: boolean } {
        const parseResult = AGTreeParser.parse(rule);

        if (!parseResult.success || !parseResult.ast) {
            return { category: 'unknown' };
        }

        const ast = parseResult.ast;

        if (AGTreeParser.isComment(ast)) {
            return { category: 'comment', syntax: String(ast.syntax) };
        }

        if (AGTreeParser.isEmpty(ast)) {
            return { category: 'unknown' };
        }

        if (AGTreeParser.isHostRule(ast)) {
            return { category: 'host', syntax: String(ast.syntax) };
        }

        if (AGTreeParser.isNetworkRule(ast)) {
            const props = AGTreeParser.extractNetworkRuleProperties(ast);
            return {
                category: 'network',
                syntax: String(ast.syntax),
                isException: props.isException,
            };
        }

        if (AGTreeParser.isCosmeticRule(ast)) {
            const props = AGTreeParser.extractCosmeticRuleProperties(ast);
            return {
                category: 'cosmetic',
                syntax: String(ast.syntax),
                isException: props.isException,
            };
        }

        return { category: 'unknown', syntax: ast.syntax ? String(ast.syntax) : undefined };
    }

    /**
     * Analyzes domain-level changes.
     *
     * Uses AGTree for accurate domain extraction from all rule types
     * (network, host, and cosmetic rules).
     */
    private analyzeDomainChanges(added: RuleDiff[], removed: RuleDiff[]): DomainDiff[] {
        const domainMap = new Map<string, { added: number; removed: number }>();

        // Count added rules by domain
        for (const rule of added) {
            const domain = this.extractDomain(rule.rule);
            if (domain) {
                const existing = domainMap.get(domain) ?? { added: 0, removed: 0 };
                existing.added++;
                domainMap.set(domain, existing);
            }
        }

        // Count removed rules by domain
        for (const rule of removed) {
            const domain = this.extractDomain(rule.rule);
            if (domain) {
                const existing = domainMap.get(domain) ?? { added: 0, removed: 0 };
                existing.removed++;
                domainMap.set(domain, existing);
            }
        }

        // Convert to array and sort by total changes
        return Array.from(domainMap.entries())
            .map(([domain, counts]) => ({
                domain,
                added: counts.added,
                removed: counts.removed,
            }))
            .sort((a, b) => (b.added + b.removed) - (a.added + a.removed))
            .slice(0, 100); // Top 100 domains
    }

    /**
     * Extracts a representative domain from a rule using AGTree AST parsing.
     *
     * - **Network rules** – extracted via pattern regex
     * - **Host rules** – first hostname from AST
     * - **Cosmetic rules** – first non-negated domain from AST
     * - Falls back to legacy regex for rules that AGTree cannot parse.
     */
    private extractDomain(rule: string): string | null {
        const parseResult = AGTreeParser.parse(rule);

        if (parseResult.success && parseResult.ast) {
            const ast = parseResult.ast;

            // Host rules: use the first hostname directly from the AST
            if (AGTreeParser.isHostRule(ast)) {
                const props = AGTreeParser.extractHostRuleProperties(ast);
                return props.hostnames[0]?.toLowerCase() ?? null;
            }

            // Cosmetic rules: use the first non-negated domain from the AST
            if (AGTreeParser.isCosmeticRule(ast)) {
                const props = AGTreeParser.extractCosmeticRuleProperties(ast);
                const firstDomain = props.domains.find((d) => !d.startsWith('~'));
                return firstDomain?.toLowerCase() ?? null;
            }

            // Network rules: extract the domain from the pattern string
            if (AGTreeParser.isNetworkRule(ast)) {
                const props = AGTreeParser.extractNetworkRuleProperties(ast);
                const match = props.pattern.match(/^\|\|([a-z0-9.-]+)[\^/?]/i);
                if (match) {
                    return match[1].toLowerCase();
                }
            }
        }

        // Fallback: legacy regex for rules AGTree cannot parse
        const match = rule.match(/^\|\|([a-z0-9.-]+)\^?/i);
        if (match) {
            return match[1].toLowerCase();
        }
        const hostsMatch = rule.match(/^[\d.]+\s+([a-z0-9.-]+)/i);
        if (hostsMatch) {
            return hostsMatch[1].toLowerCase();
        }

        return null;
    }

    /**
     * Exports diff report as Markdown
     */
    exportAsMarkdown(report: DiffReport): string {
        const lines: string[] = [];

        lines.push('# Filter List Diff Report');
        lines.push('');
        lines.push(`Generated: ${report.timestamp}`);
        lines.push(`Generator: ${PACKAGE_INFO.name} v${report.generatorVersion}`);
        lines.push('');

        lines.push('## Summary');
        lines.push('');
        lines.push('| Metric | Value |');
        lines.push('|--------|-------|');
        lines.push(`| Original Rules | ${report.original.ruleCount} |`);
        lines.push(`| New Rules | ${report.current.ruleCount} |`);
        lines.push(`| Added | +${report.summary.addedCount} |`);
        lines.push(`| Removed | -${report.summary.removedCount} |`);
        lines.push(`| Unchanged | ${report.summary.unchangedCount} |`);
        lines.push(`| Net Change | ${report.summary.netChange >= 0 ? '+' : ''}${report.summary.netChange} (${report.summary.percentageChange.toFixed(2)}%) |`);
        lines.push('');

        const cb = report.summary.categoryBreakdown;
        const hasCategoryData = cb.network.added + cb.network.removed +
                cb.cosmetic.added + cb.cosmetic.removed +
                cb.host.added + cb.host.removed +
                cb.comment.added + cb.comment.removed > 0;

        if (hasCategoryData) {
            lines.push('## Rule Type Breakdown');
            lines.push('');
            lines.push('| Rule Type | Added | Removed |');
            lines.push('|-----------|-------|---------|');
            if (cb.network.added + cb.network.removed > 0) {
                lines.push(`| Network | +${cb.network.added} | -${cb.network.removed} |`);
            }
            if (cb.cosmetic.added + cb.cosmetic.removed > 0) {
                lines.push(`| Cosmetic | +${cb.cosmetic.added} | -${cb.cosmetic.removed} |`);
            }
            if (cb.host.added + cb.host.removed > 0) {
                lines.push(`| Host | +${cb.host.added} | -${cb.host.removed} |`);
            }
            if (cb.comment.added + cb.comment.removed > 0) {
                lines.push(`| Comment | +${cb.comment.added} | -${cb.comment.removed} |`);
            }
            if (cb.unknown.added + cb.unknown.removed > 0) {
                lines.push(`| Unknown | +${cb.unknown.added} | -${cb.unknown.removed} |`);
            }
            lines.push('');
        }

        if (report.domainChanges.length > 0) {
            lines.push('## Top Domain Changes');
            lines.push('');
            lines.push('| Domain | Added | Removed |');
            lines.push('|--------|-------|---------|');
            for (const domain of report.domainChanges.slice(0, 20)) {
                lines.push(`| ${domain.domain} | +${domain.added} | -${domain.removed} |`);
            }
            lines.push('');
        }

        if (report.added.length > 0) {
            lines.push('## Added Rules');
            lines.push('');
            lines.push('```');
            for (const rule of report.added.slice(0, 50)) {
                lines.push(`+ ${rule.rule}`);
            }
            if (report.added.length > 50) {
                lines.push(`... and ${report.added.length - 50} more`);
            }
            lines.push('```');
            lines.push('');
        }

        if (report.removed.length > 0) {
            lines.push('## Removed Rules');
            lines.push('');
            lines.push('```');
            for (const rule of report.removed.slice(0, 50)) {
                lines.push(`- ${rule.rule}`);
            }
            if (report.removed.length > 50) {
                lines.push(`... and ${report.removed.length - 50} more`);
            }
            lines.push('```');
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Exports diff report as JSON
     */
    exportAsJson(report: DiffReport): string {
        return JSON.stringify(report, null, 2);
    }
}

/**
 * Convenience function to generate a diff report
 */
export function generateDiff(
    originalRules: string[],
    newRules: string[],
    options?: DiffOptions,
): DiffReport {
    const generator = new DiffGenerator(options);
    return generator.generate(originalRules, newRules);
}

/**
 * Convenience function to generate a markdown diff report
 */
export function generateDiffMarkdown(
    originalRules: string[],
    newRules: string[],
    options?: DiffOptions,
): string {
    const generator = new DiffGenerator(options);
    const report = generator.generate(originalRules, newRules);
    return generator.exportAsMarkdown(report);
}
