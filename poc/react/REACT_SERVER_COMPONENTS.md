# React Server Components in the React PoC

This document explains what React Server Components (RSC) are, how they are demonstrated in the Adblock Compiler React PoC, and why adopting RSC would benefit a production migration of this application.

## What Are React Server Components?

[React Server Components](https://react.dev/blog/2023/03/22/react-labs-what-we-have-been-working-on-march-2023#react-server-components) are a React architecture introduced in React 18 that allows individual components to be **rendered on the server** and streamed to the client as serialized UI — without shipping the component's JavaScript to the browser.

They are available today via [Next.js 14+ (App Router)](https://nextjs.org/docs/app/building-your-application/rendering/server-components).

### The Two Rendering Environments

| | Server Components | Client Components |
|---|---|---|
| **Where they run** | Node.js / Edge server | Browser |
| **Async support** | ✅ `async`/`await` at the component level | ❌ (must use `useEffect`) |
| **State / Hooks** | ❌ (`useState`, `useEffect`, etc. not allowed) | ✅ Full Hook support |
| **Event handlers** | ❌ (`onClick`, `onChange`, etc. not allowed) | ✅ Full event support |
| **Database / secrets** | ✅ Direct access, never exposed to client | ❌ Must go through an API |
| **JS shipped to browser** | ❌ Zero — only HTML is sent | ✅ Component code is bundled |
| **Directive** | None needed (default in App Router) | `'use client'` at file top |

---

## Why RSC Matters for the Adblock Compiler

The Adblock Compiler has several data flows that are currently handled client-side — meaning the browser downloads data, processes it, and renders it. RSC allows those flows to move to the server, reducing bundle size and improving performance.

### 1. Dashboard Stats Are Static at Request Time

The Home page currently displays stats (filter lists compiled, rules processed, cache hit rate). In a client-side React app these values must be fetched with `useEffect` after the page loads, causing a loading flash. With RSC:

```tsx
// app/dashboard/page.tsx — Server Component
async function DashboardPage() {
    // Runs on the server — zero client JavaScript
    const stats = await db.query('SELECT COUNT(*) FROM compilations ...');

    return <StatsGrid stats={stats} />;
    // StatsGrid is also a Server Component — it ships NO JS to the browser
}
```

The user sees the fully populated stats on first paint, with no loading spinner and no extra API round-trip from the browser.

### 2. Compiler Configuration Can Be Preloaded

The Compiler page needs to know which transformations are available. Today this is hardcoded in the client. With RSC it can be fetched from the API server-side:

```tsx
// app/compiler/page.tsx — Server Component
async function CompilerPage() {
    const availableTransformations = await fetch(
        'http://localhost:8787/api/transformations',
        { next: { revalidate: 3600 } }  // Cache for 1 hour at the edge
    ).then((r) => r.json());

    // CompilerForm is a Client Component — it needs useState for the form
    return <CompilerForm transformations={availableTransformations} />;
}
```

The transformation list is always up to date, cached at the CDN edge, and the client bundle contains no fetching logic for it.

### 3. Filter List Metadata Can Be Resolved Server-Side

When a user enters a filter list URL, the compiler currently sends it to the API and waits. With RSC + [Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations), the form submission itself runs on the server:

```tsx
// app/compiler/actions.ts — Server Action
'use server';

export async function compileFilterList(formData: FormData) {
    const urls = formData.getAll('url') as string[];
    const result = await callAdblockCompilerAPI(urls);
    return result;
}

// app/compiler/CompilerForm.tsx — Client Component
'use client';

import { compileFilterList } from './actions';

function CompilerForm() {
    return (
        <form action={compileFilterList}>
            <input name='url' type='url' />
            <button type='submit'>Compile</button>
        </form>
    );
}
```

No manual `fetch`, no `try/catch` boilerplate, no API key exposure — the Server Action runs in a trusted server environment.

### 4. Reduced JavaScript Bundle Size

Every component that becomes a Server Component is **removed from the client bundle**. For the Adblock Compiler, which currently loads React + React Router + all component code, this could reduce Time to Interactive significantly:

| Component | Client-only | With RSC |
|---|---|---|
| `DashboardPage` | Ships all stats-fetching JS | Ships zero JS |
| `StatsGrid` | Ships rendering logic | Ships zero JS |
| `Navigation` | Ships routing logic | Ships zero JS (becomes server-rendered shell) |
| `CompilerForm` | Ships form + submit JS | Still a Client Component (interactivity required) |
| `ThemeToggle` | Ships toggle JS | Still a Client Component (`localStorage` access) |

The interactive parts (`CompilerForm`, `ThemeToggle`) remain Client Components — RSC doesn't prevent interactivity, it just pushes non-interactive parts to the server.

### 5. Streaming for Perceived Performance

React Server Components work with `<Suspense>` to stream UI progressively:

```tsx
import { Suspense } from 'react';

async function DashboardPage() {
    return (
        <div>
            <Navigation />   {/* renders immediately */}
            <Suspense fallback={<StatsSkeletonLoader />}>
                <SlowStatsPanel />  {/* streams in when ready */}
            </Suspense>
        </div>
    );
}
```

The user sees the navigation instantly; the stats stream in as they become available. This is impossible with the current `useEffect`-based approach, which forces the entire component to wait before any UI is shown.

---

## How the PoC Demonstrates RSC

Because RSC requires a server runtime (Next.js, Remix, or a custom React server), it cannot be implemented in a single CDN-served HTML file. The `poc/react/index.html` PoC **simulates** the RSC pattern by:

1. **`StatsPanel` (simulated Server Component):** Receives data as a prop from its parent. It contains no `useState`, no `useEffect`, and no event handlers — exactly the constraints of a real Server Component. In a production Next.js app, it would be an `async` function that `await`s data directly.

2. **`TransformationPicker` (simulated Client Component):** Uses `useState` and `onClick` for interactivity. It is marked clearly with a `'use client'` comment and receives its initial data as a prop from the Server Component, mirroring the real RSC composition model.

3. **Async data loading in `ServerComponentsPage`:** The page component uses `useEffect` to call `fetchServerStats()` — a mock 1.2-second delay that represents a real server-side database or API call. Once resolved, the data is passed as props to `StatsPanel`, recreating the "server fetches → server component renders → client receives HTML" flow.

4. **Code snippets:** The page displays real Next.js 14 RSC code so developers can see what the actual implementation would look like when migrating from the PoC to a production app.

---

## Migration Path

To adopt RSC for the Adblock Compiler:

1. **Bootstrap Next.js 14 (App Router):**
   ```bash
   npx create-next-app@latest adblock-compiler-ui --typescript --app
   ```

2. **Move non-interactive pages to Server Components:**
   - `app/page.tsx` → `DashboardPage` (async, fetches stats)
   - `app/compiler/page.tsx` → `CompilerPage` (async, fetches available transformations)

3. **Keep interactive components as Client Components:**
   - `CompilerForm` → `'use client'` (form state, submit handler)
   - `ThemeToggle` → `'use client'` (`localStorage`, toggle state)

4. **Replace `fetch` in Client Components with Server Actions:**
   - Move `POST /api/compile` call to a Server Action
   - Remove manual `try/catch` boilerplate
   - Get type-safe end-to-end data flow

5. **Deploy to Cloudflare Workers / Pages:**
   - Next.js supports [Cloudflare Workers via `@cloudflare/next-on-pages`](https://github.com/cloudflare/next-on-pages)
   - The existing Cloudflare Worker API (`worker/worker.ts`) remains unchanged

---

## The PoC Demo Page

The `/server-components` route in `poc/react/index.html` provides a visual, interactive demonstration of the RSC concept:

| Section | What It Shows |
|---|---|
| **Concept cards** | Side-by-side comparison of Server vs Client Component constraints |
| **`StatsPanel`** | Green-bordered panel — simulates a Server Component (no hooks, no events) |
| **`TransformationPicker`** | Blue-bordered panel — a Client Component with `useState` and `onClick` |
| **Code snippet** | Actual Next.js 14 RSC syntax for `DashboardPage` and `TransformationPicker` |

---

## Alternatives to Next.js for RSC

| Framework | RSC Support | Notes |
|---|---|---|
| **Next.js 14 (App Router)** | ✅ Production-ready | Most mature, largest ecosystem |
| **Remix v2** | Partial (Loader/Action model) | Similar data-loading benefits, different API |
| **Waku** | ✅ Experimental | Minimal RSC framework from Daishi Kato |
| **Astro + React** | Partial (Islands) | Excellent for content-heavy pages |

For the Adblock Compiler, **Next.js 14 (App Router)** is the recommended path: it has first-class Cloudflare Workers support, the largest community, and the most complete RSC implementation.

---

## Further Reading

- [React Server Components RFC](https://github.com/reactjs/rfcs/blob/main/text/0188-server-components.md)
- [Next.js App Router: Server Components](https://nextjs.org/docs/app/building-your-application/rendering/server-components)
- [Next.js Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations)
- [Cloudflare next-on-pages](https://github.com/cloudflare/next-on-pages)
- [React `<Suspense>` for Data Fetching](https://react.dev/reference/react/Suspense)
