/**
 * Deep, structure-aware AGTree AST walker.
 *
 * Implements a visitor pattern for traversing all nodes of an AGTree abstract
 * syntax tree. Unlike a shallow loop over rule arrays, this walker descends
 * into every structural child sub-node (modifier lists, domain lists, rule
 * bodies, scriptlet parameter lists, etc.) and invokes the provided visitor
 * for each one in pre-order (depth-first) traversal.
 *
 * @example
 * ```typescript
 * import { walkAGTree } from './AGTreeWalker.ts';
 * import { AGTreeParser } from './AGTreeParser.ts';
 *
 * const filterList = AGTreeParser.parseFilterList(rawText);
 *
 * // Simple callback – receives every node:
 * walkAGTree(filterList, (node, ctx) => {
 *     console.log(ctx.depth, node.type);
 * });
 *
 * // Typed visitor map – only the specified handlers are invoked:
 * walkAGTree(filterList, {
 *     Modifier(modifier, ctx) {
 *         console.log('Modifier:', modifier.name.value);
 *     },
 *     Domain(domain, ctx) {
 *         if (domain.exception) console.log('Excluded domain:', domain.value);
 *     },
 * });
 * ```
 *
 * @module
 */

import type {
    Agent,
    AgentCommentRule,
    AnyExpressionNode,
    CommentRule,
    ConfigCommentRule,
    CosmeticRule,
    CssInjectionRule,
    CssInjectionRuleBody,
    Domain,
    DomainList,
    ElementHidingRule,
    ElementHidingRuleBody,
    EmptyRule,
    FilterList,
    Hint,
    HintCommentRule,
    HostnameList,
    HostRule,
    HtmlFilteringRule,
    JsInjectionRule,
    MetadataCommentRule,
    Modifier,
    ModifierList,
    NetworkRule,
    Node,
    ParameterList,
    PreProcessorCommentRule,
    ScriptletInjectionRule,
    ScriptletInjectionRuleBody,
    Value,
} from '@adguard/agtree';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Context provided to every visitor callback during tree traversal.
 */
export interface WalkContext {
    /** The parent node, or `null` if this is the root. */
    parent: Node | null;
    /** The property name on the parent that holds this node (e.g. `'children'`, `'body'`, `'modifiers'`). */
    key: string | null;
    /** The zero-based index within the parent array property (when applicable); `null` for non-array properties. */
    index: number | null;
    /** Zero-based traversal depth (root node = 0). */
    depth: number;
}

/**
 * Generic visitor callback. Called once per node in pre-order.
 *
 * Return `false` to halt the entire traversal immediately.
 */
export type AGTreeNodeVisitor = (node: Node, ctx: WalkContext) => void | false;

/**
 * Typed visitor map. Each key is an AGTree node `type` string; the value is a
 * callback invoked **only** for nodes of that type.
 *
 * Return `false` from any callback to halt traversal immediately.
 * Use `"*"` as a catch-all for node types that are not explicitly listed.
 */
export interface AGTreeTypedVisitor {
    // ── Root ──────────────────────────────────────────────────────────────
    FilterList?: (node: FilterList, ctx: WalkContext) => void | false;

    // ── Network rules ─────────────────────────────────────────────────────
    NetworkRule?: (node: NetworkRule, ctx: WalkContext) => void | false;
    HostRule?: (node: HostRule, ctx: WalkContext) => void | false;
    ModifierList?: (node: ModifierList, ctx: WalkContext) => void | false;
    Modifier?: (node: Modifier, ctx: WalkContext) => void | false;
    HostnameList?: (node: HostnameList, ctx: WalkContext) => void | false;

    // ── Cosmetic rules ────────────────────────────────────────────────────
    ElementHidingRule?: (node: ElementHidingRule, ctx: WalkContext) => void | false;
    CssInjectionRule?: (node: CssInjectionRule, ctx: WalkContext) => void | false;
    ScriptletInjectionRule?: (node: ScriptletInjectionRule, ctx: WalkContext) => void | false;
    HtmlFilteringRule?: (node: HtmlFilteringRule, ctx: WalkContext) => void | false;
    JsInjectionRule?: (node: JsInjectionRule, ctx: WalkContext) => void | false;
    DomainList?: (node: DomainList, ctx: WalkContext) => void | false;
    Domain?: (node: Domain, ctx: WalkContext) => void | false;

    // ── Comment rules ─────────────────────────────────────────────────────
    CommentRule?: (node: CommentRule, ctx: WalkContext) => void | false;
    MetadataCommentRule?: (node: MetadataCommentRule, ctx: WalkContext) => void | false;
    HintCommentRule?: (node: HintCommentRule, ctx: WalkContext) => void | false;
    ConfigCommentRule?: (node: ConfigCommentRule, ctx: WalkContext) => void | false;
    AgentCommentRule?: (node: AgentCommentRule, ctx: WalkContext) => void | false;
    PreProcessorCommentRule?: (node: PreProcessorCommentRule, ctx: WalkContext) => void | false;
    EmptyRule?: (node: EmptyRule, ctx: WalkContext) => void | false;

    // ── Low-level / structural nodes ──────────────────────────────────────
    Value?: (node: Value, ctx: WalkContext) => void | false;
    ParameterList?: (node: ParameterList, ctx: WalkContext) => void | false;
    Hint?: (node: Hint, ctx: WalkContext) => void | false;
    Agent?: (node: Agent, ctx: WalkContext) => void | false;

    // ── Catch-all ─────────────────────────────────────────────────────────
    /** Called for every node whose `type` is not explicitly handled by the visitor map. */
    '*'?: (node: Node, ctx: WalkContext) => void | false;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Dispatch `node` to the matching typed handler (or `'*'`). Returns `false` to stop. */
function dispatchTyped(node: Node, visitor: AGTreeTypedVisitor, ctx: WalkContext): boolean {
    const nodeType = (node as { type?: string }).type ?? '';
    const map = visitor as Record<string, ((n: Node, c: WalkContext) => void | false) | undefined>;
    const handler = map[nodeType] ?? visitor['*'];
    if (handler) {
        return handler(node, ctx) !== false;
    }
    return true;
}

/**
 * Visit `node` with the provided visitor, then walk its structural children.
 * Returns `false` if traversal should stop.
 */
function visitNode(node: Node, visitor: AGTreeNodeVisitor | AGTreeTypedVisitor, ctx: WalkContext): boolean {
    const proceed = typeof visitor === 'function' ? (visitor as AGTreeNodeVisitor)(node, ctx) !== false : dispatchTyped(node, visitor, ctx);

    if (!proceed) return false;

    return walkChildren(node, visitor, ctx.depth + 1);
}

/**
 * Walk the structural children of `node` according to its `type` discriminant.
 * Returns `false` if traversal should stop early.
 */
function walkChildren(
    node: Node,
    visitor: AGTreeNodeVisitor | AGTreeTypedVisitor,
    childDepth: number,
): boolean {
    const nodeType = (node as { type?: string }).type ?? '';

    /** Visit a required child node. */
    const req = (child: Node, key: string, idx?: number): boolean => visitNode(child, visitor, { parent: node, key, index: idx ?? null, depth: childDepth });

    /** Visit an optional child node (no-op when falsy). */
    const opt = (child: Node | undefined | null, key: string, idx?: number): boolean => child != null ? req(child, key, idx) : true;

    switch (nodeType) {
        // ── Root ─────────────────────────────────────────────────────────
        case 'FilterList': {
            const fl = node as FilterList;
            for (let i = 0; i < fl.children.length; i++) {
                if (!req(fl.children[i] as unknown as Node, 'children', i)) return false;
            }
            break;
        }

        // ── Network rules ─────────────────────────────────────────────────
        case 'NetworkRule': {
            const nr = node as NetworkRule;
            if (!req(nr.pattern, 'pattern')) return false;
            if (!opt(nr.modifiers as unknown as Node | undefined, 'modifiers')) return false;
            break;
        }

        case 'HostRule': {
            const hr = node as HostRule;
            if (!req(hr.ip, 'ip')) return false;
            if (!req(hr.hostnames as unknown as Node, 'hostnames')) return false;
            if (!opt(hr.comment as unknown as Node | undefined, 'comment')) return false;
            break;
        }

        case 'ModifierList': {
            const ml = node as ModifierList;
            for (let i = 0; i < ml.children.length; i++) {
                if (!req(ml.children[i] as unknown as Node, 'children', i)) return false;
            }
            break;
        }

        case 'Modifier': {
            const mod = node as unknown as Modifier;
            if (!req(mod.name, 'name')) return false;
            if (!opt(mod.value as unknown as Node | undefined, 'value')) return false;
            break;
        }

        case 'HostnameList': {
            const hl = node as unknown as HostnameList;
            for (let i = 0; i < hl.children.length; i++) {
                if (!req(hl.children[i], 'children', i)) return false;
            }
            break;
        }

        // ── Cosmetic rules ────────────────────────────────────────────────
        case 'ElementHidingRule':
        case 'CssInjectionRule':
        case 'ScriptletInjectionRule':
        case 'HtmlFilteringRule':
        case 'JsInjectionRule': {
            const cr = node as unknown as CosmeticRule;
            if (!req(cr.domains as unknown as Node, 'domains')) return false;
            if (!opt(cr.modifiers as unknown as Node | undefined, 'modifiers')) return false;
            if (!req(cr.separator, 'separator')) return false;
            if (!opt(cr.body as unknown as Node | undefined, 'body')) return false;
            break;
        }

        case 'DomainList': {
            const dl = node as unknown as DomainList;
            for (let i = 0; i < dl.children.length; i++) {
                if (!req(dl.children[i] as unknown as Node, 'children', i)) return false;
            }
            break;
        }

        // ── Comment rules ─────────────────────────────────────────────────
        case 'CommentRule': {
            const cr = node as CommentRule;
            if (!req(cr.marker, 'marker')) return false;
            if (!req(cr.text, 'text')) return false;
            break;
        }

        case 'MetadataCommentRule': {
            const mcr = node as MetadataCommentRule;
            if (!req(mcr.marker, 'marker')) return false;
            if (!req(mcr.header, 'header')) return false;
            if (!req(mcr.value, 'value')) return false;
            break;
        }

        case 'ConfigCommentRule': {
            const ccr = node as ConfigCommentRule;
            if (!req(ccr.marker, 'marker')) return false;
            if (!req(ccr.command, 'command')) return false;
            if (!opt(ccr.params as unknown as Node | undefined, 'params')) return false;
            if (!opt(ccr.comment as unknown as Node | undefined, 'comment')) return false;
            break;
        }

        case 'PreProcessorCommentRule': {
            const ppcr = node as PreProcessorCommentRule;
            if (!req(ppcr.name, 'name')) return false;
            if (!opt(ppcr.params as unknown as Node | undefined, 'params')) return false;
            break;
        }

        case 'AgentCommentRule': {
            const acr = node as AgentCommentRule;
            for (let i = 0; i < acr.children.length; i++) {
                if (!req(acr.children[i] as unknown as Node, 'children', i)) return false;
            }
            break;
        }

        case 'HintCommentRule': {
            const hcr = node as HintCommentRule;
            for (let i = 0; i < hcr.children.length; i++) {
                if (!req(hcr.children[i] as unknown as Node, 'children', i)) return false;
            }
            break;
        }

        // ── Body / structural nodes ───────────────────────────────────────
        case 'ElementHidingRuleBody': {
            const body = node as unknown as ElementHidingRuleBody;
            if (!req(body.selectorList, 'selectorList')) return false;
            break;
        }

        case 'CssInjectionRuleBody': {
            const body = node as unknown as CssInjectionRuleBody;
            if (!opt(body.mediaQueryList as unknown as Node | undefined, 'mediaQueryList')) return false;
            if (!req(body.selectorList, 'selectorList')) return false;
            if (!opt(body.declarationList as unknown as Node | undefined, 'declarationList')) return false;
            break;
        }

        case 'ScriptletInjectionRuleBody': {
            const body = node as unknown as ScriptletInjectionRuleBody;
            for (let i = 0; i < body.children.length; i++) {
                if (!req(body.children[i] as unknown as Node, 'children', i)) return false;
            }
            break;
        }

        case 'ParameterList': {
            const pl = node as unknown as ParameterList;
            for (let i = 0; i < pl.children.length; i++) {
                if (!opt(pl.children[i], 'children', i)) return false;
            }
            break;
        }

        case 'Hint': {
            const hint = node as unknown as Hint;
            if (!req(hint.name, 'name')) return false;
            if (!opt(hint.params as unknown as Node | undefined, 'params')) return false;
            break;
        }

        case 'Agent': {
            const agent = node as unknown as Agent;
            if (!req(agent.adblock, 'adblock')) return false;
            if (!opt(agent.version as unknown as Node | undefined, 'version')) return false;
            break;
        }

        // ── Expression nodes (preprocessor conditions) ────────────────────
        case 'Operator': {
            // ExpressionOperatorNode: left and right are AnyExpressionNode
            const expr = node as unknown as AnyExpressionNode & { left: Node; right?: Node };
            if (!req(expr.left, 'left')) return false;
            if (!opt(expr.right, 'right')) return false;
            break;
        }

        case 'Parenthesis': {
            // ExpressionParenthesisNode: expression is AnyExpressionNode
            const expr = node as unknown as { expression: Node };
            if (!req(expr.expression, 'expression')) return false;
            break;
        }

        // ── Leaf nodes (no structural Node children) ──────────────────────
        case 'Value':
        case 'EmptyRule':
        case 'InvalidRule':
        case 'Domain':
        case 'App':
        case 'Method':
        case 'StealthOption':
        case 'Variable': // ExpressionVariableNode — `name` is a plain string, not a Node
        case 'ConfigNode': // Config comment param node — `value` is an object, not a Node
            break;

        default:
            // Unknown / unhandled node type — silently skip children.
            break;
    }

    return true;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Walk the AGTree AST rooted at `root`, calling `visitor` for every node
 * encountered in pre-order (depth-first) traversal.
 *
 * The walker is **structure-aware**: it understands the schema of every AGTree
 * node type and only descends into semantically meaningful child nodes rather
 * than blindly reflecting over all object properties.
 *
 * @param root    - A single AGTree {@link Node} or an array of nodes to walk.
 * @param visitor - Either a simple {@link AGTreeNodeVisitor} callback or a
 *                  {@link AGTreeTypedVisitor} map of per-type handlers.
 *
 * @example
 * ```typescript
 * // Collect all domain names from a filter list
 * const domains: string[] = [];
 * walkAGTree(filterList, {
 *     Domain(d) { domains.push(d.value); },
 * });
 *
 * // Halt traversal when a specific rule is found
 * let found: NetworkRule | undefined;
 * walkAGTree(filterList, (node, ctx) => {
 *     if (node.type === 'NetworkRule') {
 *         found = node as NetworkRule;
 *         return false; // stop
 *     }
 * });
 * ```
 */
export function walkAGTree(root: Node | Node[], visitor: AGTreeNodeVisitor | AGTreeTypedVisitor): void {
    const nodes = Array.isArray(root) ? root : [root];
    for (let i = 0; i < nodes.length; i++) {
        const ctx: WalkContext = { parent: null, key: null, index: nodes.length > 1 ? i : null, depth: 0 };
        if (!visitNode(nodes[i], visitor, ctx)) return;
    }
}
