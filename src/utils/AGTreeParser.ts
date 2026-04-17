/**
 * AGTree Parser Wrapper
 *
 * Provides a simplified interface to @adguard/agtree for parsing and validating
 * adblock filter rules. This wrapper handles the complexity of the AGTree API
 * and provides type-safe access to parsed rule data.
 *
 * @see https://github.com/AdguardTeam/tsurlfilter/tree/main/packages/agtree
 */

import {
    AdblockSyntax,
    AdblockSyntaxError,
    type AgentCommentRule,
    type AnyCommentRule,
    type AnyCosmeticRule,
    type AnyNetworkRule,
    type AnyRule,
    type CommentRule,
    CommentRuleType,
    type ConfigCommentRule,
    type CosmeticRule,
    CosmeticRuleType,
    type EmptyRule,
    type FilterList,
    FilterListParser,
    type HintCommentRule,
    type HostRule,
    type MetadataCommentRule,
    type Modifier,
    type ModifierList,
    type NetworkRule,
    NetworkRuleType,
    type Node,
    type ParserOptions,
    type PreProcessorCommentRule,
    RawFilterListConverter,
    RawRuleConverter,
    RuleCategory,
    RuleConversionError,
    RuleConverter,
    RuleGenerator,
    RuleParser,
} from '@adguard/agtree';
import { type AGTreeNodeVisitor, type AGTreeTypedVisitor, walkAGTree } from './AGTreeWalker.ts';

/**
 * Result of parsing a rule with error information.
 */
export interface ParseResult {
    /** The parsed AST node, or null if parsing failed */
    ast: AnyRule | null;
    /** Whether parsing was successful */
    success: boolean;
    /** Error message if parsing failed */
    error?: string;
    /** Original rule text */
    ruleText: string;
}

/**
 * Extracted modifier information from a network rule.
 */
export interface ExtractedModifier {
    /** Modifier name (e.g., 'domain', 'third-party') */
    name: string;
    /** Modifier value if present (e.g., 'example.com' for domain=example.com) */
    value: string | null;
    /** Whether the modifier is negated (e.g., ~third-party) */
    exception: boolean;
}

/**
 * Simplified network rule properties extracted from AST.
 */
export interface NetworkRuleProperties {
    /** The rule pattern (e.g., '||example.com^') */
    pattern: string;
    /** Whether this is an exception rule (starts with @@) */
    isException: boolean;
    /** List of modifiers */
    modifiers: ExtractedModifier[];
    /** Detected syntax (AdGuard, uBlock Origin, etc.) */
    syntax: AdblockSyntax;
    /** Original rule text */
    ruleText: string;
}

/**
 * Simplified host rule properties extracted from AST.
 */
export interface HostRuleProperties {
    /** IP address (e.g., '127.0.0.1', '0.0.0.0') */
    ip: string;
    /** List of hostnames */
    hostnames: string[];
    /** Inline comment if present */
    comment: string | null;
    /** Original rule text */
    ruleText: string;
}

/**
 * Simplified cosmetic rule properties extracted from AST.
 */
export interface CosmeticRuleProperties {
    /** Domains the rule applies to */
    domains: string[];
    /** The cosmetic rule separator (##, #@#, etc.) */
    separator: string;
    /** Whether this is an exception rule */
    isException: boolean;
    /** The rule body (selector, scriptlet, etc.) */
    body: string;
    /** Type of cosmetic rule */
    type: CosmeticRuleType;
    /** Detected syntax */
    syntax: AdblockSyntax;
    /** Original rule text */
    ruleText: string;
}

/**
 * Target syntax for rule conversion.
 */
export type ConversionTarget = 'adg' | 'ubo';

/**
 * Result of a rule conversion operation.
 */
export interface ConversionResult {
    /** Converted rule text(s) */
    convertedRules: string[];
    /** Whether the rule was actually converted (false if already in target syntax) */
    isConverted: boolean;
    /** Error message if conversion failed */
    error?: string;
    /** Original rule text */
    originalRule: string;
    /** Target syntax */
    targetSyntax: ConversionTarget;
}

/**
 * Default parser options for AGTree.
 */
const DEFAULT_PARSER_OPTIONS: ParserOptions = {
    /** Parse /etc/hosts style rules */
    parseHostRules: true,
    /** Include location information in AST nodes */
    includeRaws: true,
    /** Don't throw on syntax errors, return InvalidRule instead */
    tolerant: true,
};

/**
 * AGTree Parser wrapper class providing simplified access to adblock rule parsing.
 *
 * @example
 * ```typescript
 * // Parse a single rule
 * const result = AGTreeParser.parse('||example.com^$third-party');
 * if (result.success && AGTreeParser.isNetworkRule(result.ast!)) {
 *     const props = AGTreeParser.extractNetworkRuleProperties(result.ast);
 *     console.log(props.pattern); // '||example.com^'
 *     console.log(props.modifiers); // [{ name: 'third-party', value: null, exception: false }]
 * }
 *
 * // Parse a filter list
 * const filterList = AGTreeParser.parseFilterList(rawText);
 * for (const rule of filterList.children) {
 *     // Process each rule
 * }
 * ```
 */
export class AGTreeParser {
    // =========================================================================
    // Parsing Methods
    // =========================================================================

    /**
     * Parse a single adblock rule into an AST node.
     *
     * @param ruleText - The raw rule text to parse
     * @param options - Optional parser options to override defaults
     * @returns ParseResult with AST node and success status
     */
    static parse(ruleText: string, options?: Partial<ParserOptions>): ParseResult {
        try {
            const mergedOptions = { ...DEFAULT_PARSER_OPTIONS, ...options };
            const ast = RuleParser.parse(ruleText.trim(), mergedOptions);

            // Check if the rule was parsed as invalid (tolerant mode)
            if (ast.category === RuleCategory.Invalid) {
                const rawError = 'error' in ast ? ast.error : undefined;
                const errorMsg = rawError && typeof rawError === 'object' && 'message' in rawError
                    ? String((rawError as { message: unknown }).message)
                    : rawError !== undefined
                    ? String(rawError)
                    : 'Invalid rule syntax';
                return {
                    ast,
                    success: false,
                    error: errorMsg,
                    ruleText,
                };
            }

            return {
                ast,
                success: true,
                ruleText,
            };
        } catch (error) {
            const errorMessage = error instanceof AdblockSyntaxError ? error.message : error instanceof Error ? error.message : String(error);

            return {
                ast: null,
                success: false,
                error: errorMessage,
                ruleText,
            };
        }
    }

    /**
     * Parse a single rule, throwing on error (strict mode).
     *
     * @param ruleText - The raw rule text to parse
     * @param options - Optional parser options
     * @returns The parsed AST node
     * @throws AdblockSyntaxError if parsing fails
     */
    static parseStrict(ruleText: string, options?: Partial<ParserOptions>): AnyRule {
        const mergedOptions = { ...DEFAULT_PARSER_OPTIONS, ...options, tolerant: false };
        return RuleParser.parse(ruleText.trim(), mergedOptions);
    }

    /**
     * Parse an entire filter list into an AST.
     *
     * @param filterListText - The raw filter list text
     * @param options - Optional parser options
     * @returns FilterList AST node containing all parsed rules
     */
    static parseFilterList(filterListText: string, options?: Partial<ParserOptions>): FilterList {
        const mergedOptions = { ...DEFAULT_PARSER_OPTIONS, ...options };
        return FilterListParser.parse(filterListText, mergedOptions);
    }

    // =========================================================================
    // Type Guards
    // =========================================================================

    /**
     * Check if a rule is empty (blank line).
     */
    static isEmpty(rule: AnyRule): rule is EmptyRule {
        return rule.category === RuleCategory.Empty;
    }

    /**
     * Check if a rule is a comment.
     */
    static isComment(rule: AnyRule): rule is AnyCommentRule {
        return rule.category === RuleCategory.Comment;
    }

    /**
     * Check if a rule is a simple comment (not metadata, hint, etc.).
     */
    static isSimpleComment(rule: AnyRule): rule is CommentRule {
        return rule.category === RuleCategory.Comment && rule.type === CommentRuleType.CommentRule;
    }

    /**
     * Check if a rule is a metadata comment (e.g., ! Title: ...).
     */
    static isMetadataComment(rule: AnyRule): rule is MetadataCommentRule {
        return rule.category === RuleCategory.Comment && rule.type === CommentRuleType.MetadataCommentRule;
    }

    /**
     * Check if a rule is a hint comment (e.g., !+ NOT_OPTIMIZED).
     */
    static isHintComment(rule: AnyRule): rule is HintCommentRule {
        return rule.category === RuleCategory.Comment && rule.type === CommentRuleType.HintCommentRule;
    }

    /**
     * Check if a rule is a preprocessor comment (e.g., !#if).
     */
    static isPreProcessorComment(rule: AnyRule): rule is PreProcessorCommentRule {
        return rule.category === RuleCategory.Comment && rule.type === CommentRuleType.PreProcessorCommentRule;
    }

    /**
     * Check if a rule is an agent comment (e.g., [Adblock Plus 2.0]).
     */
    static isAgentComment(rule: AnyRule): rule is AgentCommentRule {
        return rule.category === RuleCategory.Comment && rule.type === CommentRuleType.AgentCommentRule;
    }

    /**
     * Check if a rule is a config comment (e.g., ! aglint-disable).
     */
    static isConfigComment(rule: AnyRule): rule is ConfigCommentRule {
        return rule.category === RuleCategory.Comment && rule.type === CommentRuleType.ConfigCommentRule;
    }

    /**
     * Check if a rule is a network rule (blocking or exception).
     */
    static isNetworkRule(rule: AnyRule): rule is NetworkRule {
        return rule.category === RuleCategory.Network && rule.type === NetworkRuleType.NetworkRule;
    }

    /**
     * Check if a rule is a host rule (/etc/hosts format).
     */
    static isHostRule(rule: AnyRule): rule is HostRule {
        return rule.category === RuleCategory.Network && rule.type === NetworkRuleType.HostRule;
    }

    /**
     * Check if a rule is any network-category rule (network or host).
     */
    static isAnyNetworkRule(rule: AnyRule): rule is AnyNetworkRule {
        return rule.category === RuleCategory.Network;
    }

    /**
     * Check if a rule is a cosmetic rule.
     */
    static isCosmeticRule(rule: AnyRule): rule is AnyCosmeticRule {
        return rule.category === RuleCategory.Cosmetic;
    }

    /**
     * Check if a rule is an element hiding rule.
     */
    static isElementHidingRule(rule: AnyRule): rule is AnyCosmeticRule {
        return rule.category === RuleCategory.Cosmetic && rule.type === CosmeticRuleType.ElementHidingRule;
    }

    /**
     * Check if a rule is a CSS injection rule.
     */
    static isCssInjectionRule(rule: AnyRule): rule is AnyCosmeticRule {
        return rule.category === RuleCategory.Cosmetic && rule.type === CosmeticRuleType.CssInjectionRule;
    }

    /**
     * Check if a rule is a scriptlet injection rule.
     */
    static isScriptletRule(rule: AnyRule): rule is AnyCosmeticRule {
        return rule.category === RuleCategory.Cosmetic && rule.type === CosmeticRuleType.ScriptletInjectionRule;
    }

    /**
     * Check if a rule is an exception rule (allowlist).
     */
    static isExceptionRule(rule: AnyRule): boolean {
        if (this.isNetworkRule(rule)) {
            return rule.exception;
        }
        if (this.isCosmeticRule(rule)) {
            return rule.exception;
        }
        return false;
    }

    /**
     * Check if a rule is syntactically valid.
     */
    static isValid(rule: AnyRule): boolean {
        return rule.category !== RuleCategory.Invalid;
    }

    // =========================================================================
    // Property Extraction Methods
    // =========================================================================

    /**
     * Extract properties from a network rule.
     *
     * @param rule - A NetworkRule AST node
     * @returns Simplified network rule properties
     */
    static extractNetworkRuleProperties(rule: NetworkRule): NetworkRuleProperties {
        const modifiers: ExtractedModifier[] = [];

        if (rule.modifiers) {
            for (const mod of rule.modifiers.children) {
                modifiers.push({
                    name: mod.name.value,
                    value: mod.value?.value ?? null,
                    exception: mod.exception ?? false,
                });
            }
        }

        return {
            pattern: rule.pattern.value,
            isException: rule.exception,
            modifiers,
            syntax: rule.syntax,
            ruleText: rule.raws?.text ?? RuleGenerator.generate(rule),
        };
    }

    /**
     * Extract properties from a host rule.
     *
     * @param rule - A HostRule AST node
     * @returns Simplified host rule properties
     */
    static extractHostRuleProperties(rule: HostRule): HostRuleProperties {
        return {
            ip: rule.ip.value,
            hostnames: rule.hostnames.children.map((h) => h.value),
            comment: rule.comment?.value ?? null,
            ruleText: rule.raws?.text ?? RuleGenerator.generate(rule),
        };
    }

    /**
     * Extract properties from a cosmetic rule.
     *
     * @param rule - A CosmeticRule AST node
     * @returns Simplified cosmetic rule properties
     */
    static extractCosmeticRuleProperties(rule: AnyCosmeticRule): CosmeticRuleProperties {
        const domains = rule.domains.children.map((d) => (d.exception ? `~${d.value}` : d.value));

        // Extract body based on rule type
        let body = '';
        if ('body' in rule && rule.body) {
            if (typeof rule.body === 'object' && 'value' in rule.body) {
                body = rule.body.value;
            } else if (typeof rule.body === 'object' && 'selectorList' in rule.body) {
                // In v4.0.0, selectorList no longer has .value property
                // Generate the full rule and extract the body part after the separator
                const fullRule = rule.raws?.text ?? RuleGenerator.generate(rule);
                const separatorIndex = fullRule.indexOf(rule.separator.value);
                if (separatorIndex !== -1) {
                    body = fullRule.substring(separatorIndex + rule.separator.value.length);
                }
            }
        }

        return {
            domains,
            separator: rule.separator.value,
            isException: rule.exception,
            body,
            type: rule.type as CosmeticRuleType,
            syntax: rule.syntax,
            ruleText: rule.raws?.text ?? RuleGenerator.generate(rule),
        };
    }

    // =========================================================================
    // Modifier Utilities
    // =========================================================================

    /**
     * Get the modifier list from a network rule.
     *
     * @param rule - A NetworkRule AST node
     * @returns ModifierList or undefined if no modifiers
     */
    static getModifiers(rule: NetworkRule): ModifierList | undefined {
        return rule.modifiers;
    }

    /**
     * Find a specific modifier by name in a network rule.
     *
     * @param rule - A NetworkRule AST node
     * @param name - The modifier name to find
     * @returns The Modifier if found, undefined otherwise
     */
    static findModifier(rule: NetworkRule, name: string): Modifier | undefined {
        if (!rule.modifiers) {
            return undefined;
        }
        return rule.modifiers.children.find((mod) => mod.name.value === name);
    }

    /**
     * Check if a network rule has a specific modifier.
     *
     * @param rule - A NetworkRule AST node
     * @param name - The modifier name to check
     * @returns True if the modifier exists
     */
    static hasModifier(rule: NetworkRule, name: string): boolean {
        return this.findModifier(rule, name) !== undefined;
    }

    /**
     * Get the value of a specific modifier.
     *
     * @param rule - A NetworkRule AST node
     * @param name - The modifier name
     * @returns The modifier value or null if not found or no value
     */
    static getModifierValue(rule: NetworkRule, name: string): string | null {
        const mod = this.findModifier(rule, name);
        return mod?.value?.value ?? null;
    }

    // =========================================================================
    // Validation Methods
    // =========================================================================

    /**
     * Validate a modifier against known modifier definitions.
     *
     * @param modifierName - The modifier name to validate
     * @param modifierValue - Optional modifier value
     * @param syntax - The adblock syntax context
     * @returns Validation result with any errors
     */
    static validateModifier(
        modifierName: string,
        modifierValue?: string,
        _syntax: AdblockSyntax = AdblockSyntax.Common,
    ): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        // Basic validation - check if modifier name is non-empty
        if (!modifierName || modifierName.trim() === '') {
            errors.push('Modifier name cannot be empty');
        }

        // Note: modifierValidator.validate() requires AnyPlatform type, not AdblockSyntax
        // For now, we do basic validation. Full validation can be added when needed.
        if (modifierValue !== undefined && modifierValue.trim() === '') {
            // Empty value with = is suspicious but not necessarily invalid
        }

        return {
            valid: errors.length === 0,
            errors,
        };
    }

    /**
     * Validate all modifiers in a network rule.
     *
     * @param rule - A NetworkRule AST node
     * @returns Validation result with any errors
     */
    static validateNetworkRuleModifiers(rule: NetworkRule): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (rule.modifiers) {
            for (const mod of rule.modifiers.children) {
                const result = this.validateModifier(
                    mod.name.value,
                    mod.value?.value,
                    rule.syntax,
                );
                errors.push(...result.errors);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
        };
    }

    // =========================================================================
    // Generation Methods
    // =========================================================================

    /**
     * Generate rule text from an AST node.
     *
     * @param rule - Any rule AST node
     * @returns The generated rule text
     */
    static generate(rule: AnyRule): string {
        return RuleGenerator.generate(rule);
    }

    // =========================================================================
    // Syntax Detection
    // =========================================================================

    /**
     * Detect the syntax of a rule.
     *
     * @param ruleText - The raw rule text
     * @returns The detected AdblockSyntax
     */
    static detectSyntax(ruleText: string): AdblockSyntax {
        const result = this.parse(ruleText);
        if (result.success && result.ast) {
            return result.ast.syntax;
        }
        return AdblockSyntax.Common;
    }

    /**
     * Check if a rule uses AdGuard-specific syntax.
     */
    static isAdGuardSyntax(rule: AnyRule): boolean {
        return rule.syntax === AdblockSyntax.Adg;
    }

    /**
     * Check if a rule uses uBlock Origin-specific syntax.
     */
    static isUBlockSyntax(rule: AnyRule): boolean {
        return rule.syntax === AdblockSyntax.Ubo;
    }

    /**
     * Check if a rule uses Adblock Plus-specific syntax.
     */
    static isAbpSyntax(rule: AnyRule): boolean {
        return rule.syntax === AdblockSyntax.Abp;
    }

    // =========================================================================
    // Conversion Methods
    // =========================================================================

    /**
     * Convert a rule text to a target adblock syntax using AGTree's converter.
     *
     * @param ruleText - The raw rule text to convert
     * @param target - Target syntax: 'adg' for AdGuard, 'ubo' for uBlock Origin
     * @returns ConversionResult with converted rules and status
     */
    static convertRuleText(ruleText: string, target: ConversionTarget): ConversionResult {
        try {
            if (target === 'adg') {
                const result = RawRuleConverter.convertToAdg(ruleText.trim());
                return {
                    convertedRules: result.result,
                    isConverted: result.isConverted,
                    originalRule: ruleText,
                    targetSyntax: target,
                };
            }
            // For uBO target, parse first then convert
            const parseResult = this.parse(ruleText);
            if (!parseResult.success || !parseResult.ast) {
                return {
                    convertedRules: [],
                    isConverted: false,
                    error: parseResult.error ?? 'Failed to parse rule',
                    originalRule: ruleText,
                    targetSyntax: target,
                };
            }
            const result = RuleConverter.convertToUbo(parseResult.ast);
            return {
                convertedRules: result.result.map((r) => RuleGenerator.generate(r)),
                isConverted: result.isConverted,
                originalRule: ruleText,
                targetSyntax: target,
            };
        } catch (err) {
            const message = err instanceof RuleConversionError ? err.message : err instanceof Error ? err.message : String(err);
            return {
                convertedRules: [],
                isConverted: false,
                error: message,
                originalRule: ruleText,
                targetSyntax: target,
            };
        }
    }

    /**
     * Convert an entire filter list text to AdGuard syntax.
     *
     * @param filterListText - Multi-line filter list content
     * @returns Object with the converted text and whether any rules were converted
     */
    static convertFilterListToAdg(filterListText: string): { result: string; isConverted: boolean } {
        return RawFilterListConverter.convertToAdg(filterListText);
    }

    // =========================================================================
    // Deep Walker
    // =========================================================================

    /**
     * Walk the AGTree AST rooted at `root` in a deep, structure-aware manner,
     * calling `visitor` for every node encountered in pre-order (depth-first)
     * traversal.
     *
     * This is a convenience wrapper around {@link walkAGTree} that lives on
     * `AGTreeParser` for discoverability.  It understands the schema of every
     * AGTree node type and descends into semantically meaningful child nodes
     * (modifiers, domain lists, bodies, scriptlet parameter lists, etc.) rather
     * than blindly reflecting over all object properties.
     *
     * @param root    - A single AGTree {@link Node} or an array of nodes.
     * @param visitor - Either a simple {@link AGTreeNodeVisitor} callback or a
     *                  {@link AGTreeTypedVisitor} map of per-type handlers.
     *
     * @example
     * ```typescript
     * const filterList = AGTreeParser.parseFilterList(rawText);
     *
     * // Collect all domain names from the filter list
     * const domains: string[] = [];
     * AGTreeParser.walkDeep(filterList, {
     *     Domain(d) { domains.push(d.value); },
     * });
     *
     * // Count every modifier across all rules
     * let modCount = 0;
     * AGTreeParser.walkDeep(filterList, (node) => {
     *     if (node.type === 'Modifier') modCount++;
     * });
     * ```
     */
    static walkDeep(root: Node | Node[], visitor: AGTreeNodeVisitor | AGTreeTypedVisitor): void {
        walkAGTree(root, visitor);
    }
}

// Re-export commonly used types from AGTree for convenience
export {
    AdblockSyntax,
    AdblockSyntaxError,
    type AnyCommentRule,
    type AnyCosmeticRule,
    type AnyNetworkRule,
    type AnyRule,
    type CommentRule,
    CommentRuleType,
    type CosmeticRule,
    CosmeticRuleType,
    type EmptyRule,
    type FilterList,
    type HostRule,
    type MetadataCommentRule,
    type Modifier,
    type ModifierList,
    type NetworkRule,
    NetworkRuleType,
    type Node,
    type ParserOptions,
    RuleCategory,
    RuleConversionError,
};

// Re-export walker types and function
export { type AGTreeNodeVisitor, type AGTreeTypedVisitor, walkAGTree, type WalkContext } from './AGTreeWalker.ts';
