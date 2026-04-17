/**
 * Formal adapter interfaces for AGTree (@adguard/agtree) integration.
 *
 * ## Why these interfaces exist (issue #1131)
 *
 * `@adguard/agtree` is a third-party npm package.  All internal code **must** consume
 * AGTree through these adapter interfaces — never by importing directly from
 * `@adguard/agtree`.  This provides three benefits:
 *
 * 1. **Migration safety** — if we ever fork AGTree (`packages/agtree`) or swap the
 *    parser back-end for a Rust/WASM implementation, only the concrete adapter
 *    (`AGTreeParser`) changes; every call-site stays the same.
 *
 * 2. **Testability** — tests can inject lightweight stubs that implement these
 *    interfaces instead of relying on the real AGTree library.
 *
 * 3. **API discoverability** — the interface signatures document the *expected* surface
 *    area so that contributors know exactly which operations are available and supported.
 *
 * ## Overlap with `walkAGTree` / `AGTreeParser.walkDeep`
 *
 * The `IAGTreeWalker` interface below captures the deep, structure-aware traversal
 * implemented in {@link ./AGTreeWalker.ts}.  The concrete implementation lives on
 * `AGTreeParser` as the static method `walkDeep()` which delegates to the free function
 * `walkAGTree()`.  **These are the only supported entry-points for AST walking**; direct
 * use of AGTree's internal node iteration APIs is forbidden.
 *
 * ## Concrete implementation
 *
 * `{@link AGTreeParser}` — the class in `./AGTreeParser.ts` — is the single concrete
 * implementation of all three adapter interfaces.  Import it from `'./AGTreeParser.ts'`
 * (or the barrel `'../utils/index.ts'`); never import from `@adguard/agtree` directly.
 *
 * @module
 */

import type { AdblockSyntax, AnyRule, FilterList, Node } from './AGTreeParser.ts';
import type { ParseResult, ParserOptions } from './AGTreeParser.ts';
import type { AGTreeNodeVisitor, AGTreeTypedVisitor } from './AGTreeWalker.ts';

// ── Re-export Node so callers never need to import from @adguard/agtree ───────

export type { AGTreeNodeVisitor, AGTreeTypedVisitor, WalkContext } from './AGTreeWalker.ts';
export type { ParseResult, ParserOptions } from './AGTreeParser.ts';

// ── Adapter interfaces ────────────────────────────────────────────────────────

/**
 * Adapter interface that wraps AGTree's **parsing** capabilities.
 *
 * Implementations must be able to parse individual rule strings and whole filter
 * list texts into their AST representations.  All return types are defined in terms
 * of the project's own re-exported types — never bare `@adguard/agtree` shapes.
 *
 * @see AGTreeParser for the sole concrete implementation.
 */
export interface IFilterRuleParser {
    /**
     * Parse a single adblock rule string into a typed AST node.
     *
     * @param rule    - A raw filter rule string (e.g. `"||example.org^$third-party"`).
     * @param options - Optional parser configuration.
     * @returns A {@link ParseResult} containing either the parsed AST or an error.
     */
    parse(rule: string, options?: ParserOptions): ParseResult;

    /**
     * Parse a multi-line filter list text into a `FilterList` AST node.
     *
     * Blank lines and comment lines are preserved in the tree.
     *
     * @param text    - Full filter list content (newline-separated rules).
     * @param options - Optional parser configuration.
     * @returns The root `FilterList` node, or throws on catastrophic failure.
     */
    parseFilterList(text: string, options?: ParserOptions): FilterList;

    /**
     * Detect the adblock syntax of a single rule string.
     *
     * @param rule - Raw rule string.
     * @returns An {@link AdblockSyntax} enum value.
     */
    detectSyntax(rule: string): AdblockSyntax;
}

/**
 * Adapter interface that wraps AGTree's **conversion** capabilities.
 *
 * Conversions transform rules between adblock syntaxes (e.g. uBlock Origin → AdGuard).
 * The concrete implementation delegates to AGTree's `RuleConverter` internally.
 *
 * @see AGTreeParser for the sole concrete implementation.
 */
export interface IFilterRuleConverter {
    /**
     * Convert a single rule string to the target adblock syntax.
     *
     * @param ruleText     - Raw filter rule to convert.
     * @param targetSyntax - Target syntax identifier (`'adg'` or `'ubo'`).
     * @returns Object with the converted rule text(s) and whether conversion occurred.
     */
    convertRuleText(ruleText: string, targetSyntax: string): {
        convertedRules: string[];
        isConverted: boolean;
        error?: string;
    };

    /**
     * Convert an entire multi-line filter list to AdGuard syntax.
     *
     * @param filterListText - Full filter list content.
     * @returns Object with the converted text and whether any rules were changed.
     */
    convertFilterListToAdg(filterListText: string): {
        result: string;
        isConverted: boolean;
    };
}

/**
 * Adapter interface that wraps AGTree's **serialization / generation** capabilities.
 *
 * Serialization turns AST nodes back into raw rule strings.
 *
 * @see AGTreeParser for the sole concrete implementation.
 */
export interface IFilterRuleGenerator {
    /**
     * Serialize an AGTree `AnyRule` AST node back into its canonical rule string.
     *
     * @param ast - A parsed rule node (any `AnyRule` variant).
     * @returns The serialized rule string.
     */
    serialize(ast: AnyRule): string;

    /**
     * Serialize an array of `AnyRule` nodes, joining them with newlines.
     *
     * @param rules - Array of parsed rule nodes.
     * @returns Multi-line string with one rule per line.
     */
    serializeAll(rules: AnyRule[]): string;
}

/**
 * Adapter interface that wraps the **deep, structure-aware AST walker**.
 *
 * ## Overlap note
 *
 * The free function `walkAGTree()` (in `./AGTreeWalker.ts`) and the static method
 * `AGTreeParser.walkDeep()` (in `./AGTreeParser.ts`) are **the same implementation**.
 * `walkDeep` is a thin convenience wrapper that delegates to `walkAGTree`.
 *
 * This interface formalises the walker as part of the adapter contract so that
 * alternative implementations (e.g. a WASM back-end) can substitute their own
 * traversal logic without changing call-sites.
 *
 * @see walkAGTree       for the free-function entry-point.
 * @see AGTreeParser.walkDeep for the static method on the concrete adapter class.
 */
export interface IAGTreeWalker {
    /**
     * Walk the AGTree AST rooted at `root` in a deep, structure-aware manner.
     *
     * The walker descends into every semantically meaningful child node (modifier
     * lists, domain lists, rule bodies, scriptlet parameter lists, preprocessor
     * expression trees, etc.) and invokes `visitor` for each node in pre-order
     * (parent before children) traversal.
     *
     * @param root    - A single AGTree node or an array of nodes.
     * @param visitor - Either a simple callback ({@link AGTreeNodeVisitor}) or a
     *                  per-type handler map ({@link AGTreeTypedVisitor}).
     *                  Return `false` from any handler to halt traversal early.
     *
     * @example
     * ```typescript
     * // Collect all modifier names from a filter list
     * const modifiers: string[] = [];
     * parser.walkDeep(filterList, {
     *     Modifier(m) { modifiers.push(m.name.value); },
     * });
     *
     * // Stop at the first network rule found
     * let first: Node | undefined;
     * parser.walkDeep(filterList, (node) => {
     *     if (node.type === 'NetworkRule') {
     *         first = node; // narrowed to NetworkRule at runtime
     *         return false; // halt
     *     }
     * });
     * ```
     */
    walkDeep(
        root: Node | Node[],
        visitor: AGTreeNodeVisitor | AGTreeTypedVisitor,
    ): void;
}
