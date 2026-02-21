# React Router in the React PoC

This document explains why React Router is used in the Adblock Compiler React PoC and why it's the right tool for client-side navigation in React applications.

## What is React Router?

[React Router](https://reactrouter.com/) is the standard routing library for React. It enables **client-side navigation** — moving between pages without triggering a full browser reload — by synchronising the browser's URL with the React component tree.

The PoC uses **React Router v6** (the current major version), which simplified the API compared to v5 and introduced first-class support for nested routes and relative links.

## Why React Router is Worth Using

### 1. Single Page Application (SPA) Navigation

Without a router, every link click causes the browser to fetch a new HTML document, losing all in-memory state (form data, loaded results, theme preference) and showing a blank screen during the transition.

React Router intercepts these navigations and renders the correct component **instantly**, with no round-trip to the server. For the Adblock Compiler this means:

- The user can navigate from the Dashboard to the Compiler without losing previously entered URLs
- The loading spinner doesn't flash on every page change
- The compiled results stay visible while the user adjusts settings and recompiles

### 2. The URL as the Source of Truth

React Router keeps the browser URL in sync with what is rendered. This provides several concrete benefits:

| Benefit                    | Example                                                                           |
| -------------------------- | --------------------------------------------------------------------------------- |
| **Deep linking**           | Sharing `/compiler` sends someone directly to the Compiler page                  |
| **Browser history**        | Back/Forward buttons work exactly as users expect                                 |
| **Bookmarking**            | Users can bookmark any page in the app                                            |
| **Refreshing**             | Refreshing the browser reopens the correct page (with server-side fallback)       |
| **Accessibility**          | Screen readers and keyboard users get proper focus management on route change     |

### 3. Declarative Route Configuration

React Router v6 uses a JSX-based, declarative syntax that is easy to read and maintain:

```jsx
<Routes>
    <Route path='/' element={<HomePage />} />
    <Route path='/compiler' element={<CompilerPage />} />
</Routes>
```

Compare this to the imperative alternative — a chain of `if/else` checks or a `switch` on `window.location.pathname` — which becomes hard to maintain as the number of routes grows and provides none of the history/linking/scroll restoration features.

### 4. Active Link Detection with `useLocation`

The `useLocation` hook gives any component instant access to the current URL, enabling precise active-state styling without prop drilling:

```jsx
function Navigation() {
    const location = useLocation();
    const isActive = (path) => location.pathname === path;

    return (
        <nav>
            <Link className={isActive('/') ? 'nav-link active' : 'nav-link'} to='/'>
                🏠 Home
            </Link>
            <Link className={isActive('/compiler') ? 'nav-link active' : 'nav-link'} to='/compiler'>
                ⚙️ Compiler
            </Link>
        </nav>
    );
}
```

In vanilla JS this requires manually comparing `window.location.pathname` and re-running the comparison on every navigation event. React Router handles all of this reactively.

### 5. `<Link>` vs `<a>` — Preventing Full Reloads

React Router's `<Link>` component renders an `<a>` tag but intercepts the click event, pushing a new entry onto the history stack instead of triggering a browser navigation. This is the mechanism that makes SPA navigation seamless:

```jsx
// ✅ Client-side navigation — no page reload, no state loss
<Link to='/compiler'>⚙️ Compiler</Link>

// ❌ Full browser reload — all React state is destroyed
<a href='/compiler'>⚙️ Compiler</a>
```

### 6. Code Splitting and Lazy Loading (Production Readiness)

In a production build (Vite + React Router), routes can be lazily loaded so that only the JavaScript for the current page is downloaded initially:

```jsx
import { lazy, Suspense } from 'react';

const CompilerPage = lazy(() => import('./pages/CompilerPage'));

<Route path='/compiler' element={
    <Suspense fallback={<Spinner />}>
        <CompilerPage />
    </Suspense>
} />
```

For the Adblock Compiler, this means the heavy compiler form (checkboxes, validation logic) is only downloaded when the user actually navigates there.

### 7. Nested Routes for Shared Layouts

React Router v6 nested routes make it trivial to share layout elements (navigation bar, sidebars, footers) across pages without duplicating JSX:

```jsx
// The AppShell component is rendered once; only the inner <Outlet /> changes
function AppShell() {
    return (
        <div className='app-container'>
            <Navigation />          {/* shared — never unmounts */}
            <main className='main-content'>
                <Outlet />          {/* this changes on navigation */}
            </main>
        </div>
    );
}

<Route element={<AppShell />}>
    <Route path='/' element={<HomePage />} />
    <Route path='/compiler' element={<CompilerPage />} />
</Route>
```

The current PoC achieves the same effect by placing `<Routes>` inside `AppShell`, which is equivalent and a valid pattern for small apps.

### 8. Programmatic Navigation

The `useNavigate` hook enables redirects and navigation triggered by business logic (e.g., after a successful compile, redirect to a results page):

```jsx
const navigate = useNavigate();

const handleCompile = async (e) => {
    e.preventDefault();
    const result = await compile(payload);
    // After a successful compile, navigate to a results page
    navigate(`/results/${result.id}`);
};
```

This is far cleaner than manually setting `window.location.href` and avoids breaking the browser history stack.

## React Router in this PoC

The PoC demonstrates the following React Router v6 features:

| Feature               | Where Used                              | Purpose                                        |
| --------------------- | --------------------------------------- | ---------------------------------------------- |
| `<BrowserRouter>`     | `App` component (root)                  | Provides routing context to the whole app      |
| `<Routes>` + `<Route>`| `AppShell` component                    | Declares the Home and Compiler routes          |
| `<Link>`              | `Navigation` component                  | Client-side navigation without page reload     |
| `useLocation()`       | `Navigation` component                  | Reads current path to highlight the active link|

```jsx
const { BrowserRouter, Routes, Route, Link, useLocation } = ReactRouterDOM;
```

### CDN vs npm Package

The PoC loads React Router from the unpkg CDN for simplicity (no build step required). In a production app, install it as an npm/JSR dependency:

```bash
npm install react-router-dom@6
```

> ⚠️ **Note:** The CDN builds used in the PoC are **development** builds (larger size, extra warnings). For production, use the `*.production.min.js` variants listed at the top of `index.html`.

## When to Use React Router

Use React Router whenever your React app has **more than one view** that should be addressable by a URL. This includes:

- Multi-page dashboards (like this Adblock Compiler UI)
- Admin panels with multiple sections
- E-commerce sites with product/cart/checkout flows
- Documentation sites with multiple articles

For **truly single-view** apps (a single widget or form with no navigation), you may not need a router at all.

## Alternatives

| Library              | When to prefer it                                               |
| -------------------- | --------------------------------------------------------------- |
| **TanStack Router**  | Type-safe routing, file-based routes, first-class loaders       |
| **Wouter**           | Tiny apps that can't afford React Router's bundle footprint     |
| **Next.js router**   | SSR/SSG is needed (Next.js file-based routing is built in)      |
| **React Router**     | Standard React SPAs; widest adoption, most resources available  |

For the Adblock Compiler — a standard React SPA deployed to Cloudflare Workers — **React Router v6 is the appropriate default choice**.

## Further Reading

- [React Router Official Docs](https://reactrouter.com/en/main)
- [React Router v6 Tutorial](https://reactrouter.com/en/main/start/tutorial)
- [useLocation API](https://reactrouter.com/en/main/hooks/use-location)
- [useNavigate API](https://reactrouter.com/en/main/hooks/use-navigate)
- [Lazy Loading with React Router](https://reactrouter.com/en/main/route/lazy)
