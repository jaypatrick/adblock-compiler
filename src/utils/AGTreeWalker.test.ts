/**
 * Tests for the deep, structure-aware AGTree walker (AGTreeWalker).
 */

import { assertArrayIncludes, assertEquals, assertExists } from '@std/assert';
import type { FilterList, Node } from '@adguard/agtree';
import { AGTreeParser } from './AGTreeParser.ts';
import { walkAGTree } from './AGTreeWalker.ts';
import type { AGTreeTypedVisitor, WalkContext } from './AGTreeWalker.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a filter list from a newline-joined list of rules. */
function parseList(...rules: string[]): FilterList {
    return AGTreeParser.parseFilterList(rules.join('\n'));
}

/** Collect the `type` of every node visited by walkAGTree. */
function collectTypes(root: Node | Node[]): string[] {
    const types: string[] = [];
    walkAGTree(root, (node) => {
        types.push(node.type);
    });
    return types;
}

// ── Basic traversal ───────────────────────────────────────────────────────────

Deno.test('walkAGTree — visits FilterList and all child rules', () => {
    const fl = parseList('||ads.example.com^', '! comment', '');
    const types = collectTypes(fl);
    // Root FilterList is the first node visited
    assertEquals(types[0], 'FilterList');
    // Three rule nodes follow
    assertEquals(types.includes('NetworkRule'), true);
    assertEquals(types.includes('CommentRule'), true);
    assertEquals(types.includes('EmptyRule'), true);
});

Deno.test('walkAGTree — accepts single Node (non-array)', () => {
    const fl = parseList('||example.com^');
    const types = collectTypes(fl);
    assertEquals(types[0], 'FilterList');
    assertExists(types.find((t) => t === 'NetworkRule'));
});

Deno.test('walkAGTree — accepts array of nodes', () => {
    const fl = parseList('||a.com^', '||b.com^');
    const rules = fl.children;
    const types = collectTypes(rules as unknown as Node[]);
    // Two NetworkRule nodes as roots
    assertEquals(types.filter((t) => t === 'NetworkRule').length, 2);
});

// ── Deep network rule traversal ───────────────────────────────────────────────

Deno.test('walkAGTree — descends into NetworkRule pattern and modifiers', () => {
    const fl = parseList('||example.com^$third-party,domain=example.net');
    const types = collectTypes(fl);
    // Should include ModifierList, Modifier, Value nodes
    assertEquals(types.includes('ModifierList'), true);
    assertEquals(types.includes('Modifier'), true);
    assertEquals(types.includes('Value'), true);
});

Deno.test('walkAGTree — visits all Modifier nodes for a multi-modifier rule', () => {
    const fl = parseList('||example.com^$third-party,domain=example.net,image');
    const modifiers: string[] = [];
    walkAGTree(fl, {
        Modifier(mod) {
            modifiers.push(mod.name.value);
        },
    });
    assertEquals(modifiers.includes('third-party'), true);
    assertEquals(modifiers.includes('domain'), true);
    assertEquals(modifiers.includes('image'), true);
});

Deno.test('walkAGTree — descends into HostRule ip and hostnames', () => {
    const fl = parseList('127.0.0.1 ads.example.com tracker.example.net');
    const types = collectTypes(fl);
    assertEquals(types.includes('HostRule'), true);
    assertEquals(types.includes('HostnameList'), true);
    // ip and individual hostname Values
    assertEquals(types.filter((t) => t === 'Value').length >= 3, true);
});

// ── Deep cosmetic rule traversal ──────────────────────────────────────────────

Deno.test('walkAGTree — descends into ElementHidingRule body', () => {
    const fl = parseList('example.com##.banner');
    const types = collectTypes(fl);
    assertEquals(types.includes('ElementHidingRule'), true);
    assertEquals(types.includes('DomainList'), true);
    assertEquals(types.includes('ElementHidingRuleBody'), true);
    assertEquals(types.includes('Value'), true);
});

Deno.test('walkAGTree — visits Domain nodes inside DomainList', () => {
    const fl = parseList('example.com,ads.example.com##.banner');
    const domains: string[] = [];
    walkAGTree(fl, {
        Domain(d) {
            domains.push(d.value);
        },
    });
    assertArrayIncludes(domains, ['example.com']);
    assertArrayIncludes(domains, ['ads.example.com']);
});

Deno.test('walkAGTree — descends into ScriptletInjectionRule body and parameters', () => {
    const fl = parseList("example.com#%#//scriptlet('ubo-set-constant.js', 'key', 'value')");
    const types = collectTypes(fl);
    assertEquals(types.includes('ScriptletInjectionRule'), true);
    assertEquals(types.includes('ScriptletInjectionRuleBody'), true);
    assertEquals(types.includes('ParameterList'), true);
    assertEquals(types.filter((t) => t === 'Value').length >= 3, true);
});

Deno.test('walkAGTree — descends into CssInjectionRule body', () => {
    const fl = parseList('example.com#$#body { padding: 0; }');
    const types = collectTypes(fl);
    assertEquals(types.includes('CssInjectionRule'), true);
    assertEquals(types.includes('CssInjectionRuleBody'), true);
    // selectorList and declarationList are both Value nodes
    assertEquals(types.includes('Value'), true);
});

// ── Deep comment rule traversal ───────────────────────────────────────────────

Deno.test('walkAGTree — descends into CommentRule marker and text', () => {
    const fl = parseList('! This is a comment');
    const types = collectTypes(fl);
    assertEquals(types.includes('CommentRule'), true);
    // marker ('!') and text are both Value nodes
    assertEquals(types.filter((t) => t === 'Value').length >= 2, true);
});

Deno.test('walkAGTree — descends into MetadataCommentRule children', () => {
    const fl = parseList('! Title: My List');
    const types = collectTypes(fl);
    assertEquals(types.includes('MetadataCommentRule'), true);
    // marker, header, value are all Value nodes
    assertEquals(types.filter((t) => t === 'Value').length >= 3, true);
});

Deno.test('walkAGTree — descends into HintCommentRule children', () => {
    const fl = parseList('!+ NOT_OPTIMIZED PLATFORM(windows)');
    const types = collectTypes(fl);
    assertEquals(types.includes('HintCommentRule'), true);
    assertEquals(types.includes('Hint'), true);
    assertEquals(types.includes('ParameterList'), true);
    assertEquals(types.includes('Value'), true);
});

Deno.test('walkAGTree — descends into AgentCommentRule children', () => {
    const fl = parseList('[Adblock Plus 2.0]');
    const types = collectTypes(fl);
    assertEquals(types.includes('AgentCommentRule'), true);
    assertEquals(types.includes('Agent'), true);
    assertEquals(types.includes('Value'), true);
});

Deno.test('walkAGTree — descends into PreProcessorCommentRule name and params', () => {
    const fl = parseList('!#if (adguard)');
    const types = collectTypes(fl);
    assertEquals(types.includes('PreProcessorCommentRule'), true);
    assertEquals(types.includes('Value'), true);
    // Params is an ExpressionParenthesisNode wrapping a Variable
    assertEquals(types.includes('Parenthesis'), true);
});

// ── Early exit ────────────────────────────────────────────────────────────────

Deno.test('walkAGTree — returning false halts traversal immediately', () => {
    const fl = parseList('||a.com^', '||b.com^', '||c.com^');
    let count = 0;
    walkAGTree(fl, (_node) => {
        count++;
        if (count >= 2) return false;
    });
    assertEquals(count, 2);
});

Deno.test('walkAGTree — typed visitor returning false halts traversal', () => {
    const fl = parseList('||a.com^', '||b.com^');
    let networkRuleCount = 0;
    walkAGTree(fl, {
        NetworkRule() {
            networkRuleCount++;
            return false; // stop after the first NetworkRule
        },
    });
    assertEquals(networkRuleCount, 1);
});

// ── WalkContext ───────────────────────────────────────────────────────────────

Deno.test('walkAGTree — root node has depth 0 and null parent', () => {
    const fl = parseList('||example.com^');
    let rootCtx: WalkContext | undefined;
    walkAGTree(fl, (_node, ctx) => {
        if (!rootCtx) rootCtx = ctx;
        return false;
    });
    assertExists(rootCtx);
    assertEquals(rootCtx.depth, 0);
    assertEquals(rootCtx.parent, null);
    assertEquals(rootCtx.key, null);
});

Deno.test('walkAGTree — child nodes have increasing depth', () => {
    const fl = parseList('||example.com^');
    const depths: number[] = [];
    walkAGTree(fl, (_node, ctx) => {
        depths.push(ctx.depth);
    });
    // depth should start at 0 and include deeper values
    assertEquals(depths[0], 0);
    assertEquals(depths.some((d) => d > 0), true);
    assertEquals(depths.some((d) => d > 1), true);
});

Deno.test('walkAGTree — children array nodes carry their parent and index', () => {
    const fl = parseList('||example.com^$third-party,domain=example.net');
    let firstModCtx: WalkContext | undefined;
    walkAGTree(fl, (node, ctx) => {
        if (node.type === 'Modifier' && !firstModCtx) {
            firstModCtx = ctx;
        }
    });
    assertExists(firstModCtx);
    assertEquals(firstModCtx.key, 'children');
    assertEquals(firstModCtx.index, 0);
    assertExists(firstModCtx.parent);
    assertEquals((firstModCtx.parent as { type: string }).type, 'ModifierList');
});

Deno.test('walkAGTree — non-array children carry key but null index', () => {
    const fl = parseList('||example.com^$third-party');
    let modListCtx: WalkContext | undefined;
    walkAGTree(fl, (node, ctx) => {
        if (node.type === 'ModifierList' && !modListCtx) {
            modListCtx = ctx;
        }
    });
    assertExists(modListCtx);
    assertEquals(modListCtx.key, 'modifiers');
    assertEquals(modListCtx.index, null);
});

// ── Typed visitor ─────────────────────────────────────────────────────────────

Deno.test('walkAGTree — typed visitor only invokes matching handlers', () => {
    const fl = parseList('||example.com^$domain=example.net', 'example.com##.ad');
    const visited: string[] = [];
    walkAGTree(
        fl,
        {
            NetworkRule() {
                visited.push('NetworkRule');
            },
            ElementHidingRule() {
                visited.push('ElementHidingRule');
            },
        } satisfies AGTreeTypedVisitor,
    );
    assertEquals(visited, ['NetworkRule', 'ElementHidingRule']);
});

Deno.test('walkAGTree — typed visitor catch-all handles unlisted types', () => {
    const fl = parseList('||example.com^');
    const catchAll: string[] = [];
    walkAGTree(fl, {
        '*'(node) {
            catchAll.push(node.type);
        },
    });
    // All nodes hit the catch-all since no specific handlers are registered
    assertEquals(catchAll.length > 0, true);
    assertEquals(catchAll.includes('FilterList'), true);
    assertEquals(catchAll.includes('NetworkRule'), true);
});

Deno.test('walkAGTree — typed visitor specific handler takes precedence over catch-all', () => {
    const fl = parseList('||example.com^');
    const specific: string[] = [];
    const catchAll: string[] = [];
    walkAGTree(fl, {
        NetworkRule(node) {
            specific.push(node.type);
        },
        '*'(node) {
            catchAll.push(node.type);
        },
    });
    // NetworkRule is handled by the specific handler
    assertEquals(specific.includes('NetworkRule'), true);
    assertEquals(catchAll.includes('NetworkRule'), false);
    // Other nodes go to catch-all
    assertEquals(catchAll.includes('FilterList'), true);
});

// ── AGTreeParser.walkDeep convenience wrapper ─────────────────────────────────

Deno.test('AGTreeParser.walkDeep — convenience wrapper works like walkAGTree', () => {
    const fl = parseList('||example.com^$third-party', 'example.com##.ads');
    const types: string[] = [];
    AGTreeParser.walkDeep(fl, (node) => {
        types.push(node.type);
    });
    assertEquals(types[0], 'FilterList');
    assertEquals(types.includes('NetworkRule'), true);
    assertEquals(types.includes('ElementHidingRule'), true);
    assertEquals(types.includes('Modifier'), true);
    assertEquals(types.includes('Domain'), true);
});

Deno.test('AGTreeParser.walkDeep — typed visitor map works via walkDeep', () => {
    const fl = parseList('||a.com^$image', '||b.com^$script,domain=example.com');
    let modifierCount = 0;
    AGTreeParser.walkDeep(fl, {
        Modifier() {
            modifierCount++;
        },
    });
    assertEquals(modifierCount, 3); // image, script, domain
});

// ── Exception domains ─────────────────────────────────────────────────────────

Deno.test('walkAGTree — Domain exception flag is accessible in visitor', () => {
    const fl = parseList('example.com,~safe.example.com##.banner');
    const includedDomains: string[] = [];
    const excludedDomains: string[] = [];
    walkAGTree(fl, {
        Domain(d) {
            if (d.exception) {
                excludedDomains.push(d.value);
            } else {
                includedDomains.push(d.value);
            }
        },
    });
    assertArrayIncludes(includedDomains, ['example.com']);
    assertArrayIncludes(excludedDomains, ['safe.example.com']);
});

// ── Empty filter list ─────────────────────────────────────────────────────────

Deno.test('walkAGTree — empty FilterList visits only the root', () => {
    const fl = parseList('');
    const types = collectTypes(fl);
    // FilterList + EmptyRule (blank line)
    assertEquals(types[0], 'FilterList');
    assertEquals(types.includes('EmptyRule'), true);
});

Deno.test('walkAGTree — empty array input visits nothing', () => {
    const types = collectTypes([]);
    assertEquals(types, []);
});
