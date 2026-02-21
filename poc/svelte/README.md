# Svelte 5 PoC — Adblock Compiler

This is the Svelte 5 proof-of-concept implementation of the Adblock Compiler frontend.

## Technology Stack

- **Svelte 5** — Compiler-first framework with runes reactivity
- **Vite 6** — Build tool and dev server
- **@sveltejs/vite-plugin-svelte** — Svelte integration for Vite

## Key Patterns Demonstrated

- **`$state()`** — Mutable reactive state (replaces `let` + reactive stores)
- **`$derived()`** — Computed values (replaces `$:` reactive declarations)
- **`$effect()`** — Side effects (replaces `onMount` / reactive statements)
- Hash-based client-side routing (no external router dependency)
- CSS custom properties for dark/light theme with `localStorage` persistence
- Async API integration with fetch and mock fallback
- Benchmark page using `performance.now()` for accurate timing

## How to Run

```bash
cd poc/svelte
npm install
npm run dev
# Visit: http://localhost:4201
```

## Routes

| Route | Description |
| ----- | ----------- |
| `#/` | Home dashboard with framework info |
| `#/compiler` | Compiler form with API integration |
| `#/benchmark` | Performance benchmark with statistics |
| `#/runes` | Interactive Svelte 5 runes demonstration |

## Svelte 5 Runes vs Previous Syntax

| Svelte 4 | Svelte 5 Runes |
| -------- | -------------- |
| `let count = 0` | `let count = $state(0)` |
| `$: doubled = count * 2` | `let doubled = $derived(count * 2)` |
| `$: { console.log(count) }` | `$effect(() => { console.log(count) })` |
| Svelte stores (`writable`) | `$state()` in shared modules |

## Advantages

- 🚀 **No virtual DOM** — Svelte compiles to vanilla JS, minimal runtime
- 📦 **Tiny bundle size** — ~5 KB runtime vs React's ~40 KB
- ⚡ **Fine-grained reactivity** — Only the affected DOM nodes update
- 🧹 **Less boilerplate** — No hooks rules, no `useCallback`, no `useMemo`
- 🔒 **Explicit reactivity** — Runes make reactive dependencies visible

## Considerations

- Requires a build step (unlike the React/Vue CDN PoCs)
- Smaller ecosystem than React
- Svelte 5 runes are a significant change from Svelte 4 syntax
- Less enterprise adoption than Angular
