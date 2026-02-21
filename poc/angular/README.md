# Angular PoC - Adblock Compiler Frontend

This is a proof-of-concept implementation of the Adblock Compiler frontend using **Angular 19** (tested with 19.2.18) with standalone components.

## 🏗️ Architecture Overview

### Key Angular Patterns Demonstrated

1. **Standalone Components** (Angular 19)
   - No NgModules required
   - Components are self-contained with their own imports
   - Simpler application structure

2. **Reactive Forms**
   - `FormBuilder` for creating form controls
   - `FormArray` for dynamic URL list
   - `FormGroup` for nested form structures
   - Built-in validation

3. **Dependency Injection**
   - Services injected via constructor
   - `providedIn: 'root'` for singleton services
   - Type-safe dependency resolution

4. **RxJS Observables**
   - Reactive data streams for async operations
   - Observable-based HTTP client
   - Operators for error handling and transformation

5. **Declarative Routing**
   - File-based route configuration
   - Router outlet for nested routes
   - `RouterLink` and `RouterLinkActive` directives

6. **Component Architecture**
   - Separation of concerns (component, service, routing)
   - Component encapsulation with scoped styles
   - TypeScript interfaces for type safety

## 📁 Project Structure

```
src/
├── app/
│   ├── compiler/
│   │   └── compiler.component.ts      # Compiler form component
│   ├── home/
│   │   └── home.component.ts          # Home/Dashboard component
│   ├── services/
│   │   └── compiler.service.ts        # API service with HTTP client
│   ├── app.component.ts               # Root component with nav
│   └── app.routes.ts                  # Route configuration
├── main.ts                            # Application bootstrap
├── index.html                         # HTML entry point
└── styles.css                         # Global styles
```

## 🚀 Setup Instructions

### Prerequisites

- Node.js 18+ and npm
- Angular CLI 19+ (will be installed as dev dependency)

### Installation

1. Navigate to the Angular PoC directory:
   ```bash
   cd poc/angular
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   ```

4. Open your browser to `http://localhost:4200`

### Alternative: Using Angular CLI directly

```bash
# Install Angular CLI globally (optional)
npm install -g @angular/cli

# Run development server
ng serve

# Build for production
ng build --configuration production
```

## 🎨 Features Demonstrated

### Home Page

- Dashboard with statistics cards
- `*ngFor` structural directive for list rendering
- Interpolation binding with `{{ }}`
- Component-scoped styles

### Compiler Page

- **Reactive Forms** with `FormBuilder`
- **Dynamic Form Controls** with `FormArray`
- **Checkbox Group** with nested `FormGroup`
- **Form Validation** with `Validators`
- **Loading/Error States** with `*ngIf`
- **API Integration** via `CompilerService`
- **RxJS Observables** for async operations

### Navigation & Theming

- Client-side routing with Angular Router
- `routerLink` directive for navigation
- `routerLinkActive` for active link highlighting
- Theme toggle with localStorage persistence
- CSS custom properties for theming

## 🔧 Key Files Explained

### `main.ts` - Application Bootstrap

```typescript
bootstrapApplication(AppComponent, {
    providers: [
        provideRouter(routes),
        provideHttpClient(),
    ],
});
```

- Standalone bootstrap (no NgModule)
- Functional providers for router and HTTP client

### `app.component.ts` - Root Component

- App shell with navigation
- Router outlet for nested routes
- Theme toggle functionality

### `compiler.component.ts` - Compiler Form

- Reactive Forms with FormBuilder
- FormArray for dynamic URL inputs
- FormGroup for transformation checkboxes
- Service injection for API calls
- RxJS subscription handling

### `compiler.service.ts` - API Service

- Injectable service with HttpClient
- Type-safe interfaces for request/response
- RxJS operators for error handling
- Mock data fallback for demo

### `app.routes.ts` - Route Configuration

```typescript
export const routes: Routes = [
    { path: '', component: HomeComponent },
    { path: 'compiler', component: CompilerComponent },
];
```

## 🎯 Angular-Specific Advantages

### 1. **TypeScript First**

- Full type safety throughout the application
- Interfaces for data contracts
- Better IDE support and refactoring

### 2. **Dependency Injection**

- Built-in DI system
- Easy testing with mock services
- Singleton services for shared state

### 3. **Reactive Forms**

- Strongly-typed form controls
- Built-in validation
- Testable form logic
- Dynamic form generation

### 4. **RxJS Integration**

- Powerful reactive programming
- Observable-based data streams
- Rich operator library for transformations

### 5. **Component Encapsulation**

- Scoped styles by default
- Clear component boundaries
- Shadow DOM support (optional)

### 6. **Structural Directives**

- `*ngIf` for conditional rendering
- `*ngFor` for list rendering
- `*ngSwitch` for multi-conditional rendering

## 🗺️ Angular Router Deep Dive

Angular Router is a first-party, full-featured client-side routing library built into
Angular. Below is a summary of the features demonstrated in this PoC and why each one
is worth using.

### Why Angular Router Instead of Vanilla Multi-Page Navigation?

| Problem (Vanilla MPA)                              | Solution (Angular Router SPA)                               |
| -------------------------------------------------- | ----------------------------------------------------------- |
| Every link triggers a full page reload             | Navigation happens in-memory – no reload, no flash          |
| Browser fetches a new HTML document per page       | Only data changes; the shell (nav, theme) persists          |
| Form state is lost when navigating away            | Component state survives in-memory navigation               |
| No concept of active-link highlighting             | `routerLinkActive` adds CSS class automatically             |
| Deep-linking requires server-side rendering        | Every URL maps to a component; the server serves `index.html` |
| Code splitting requires manual effort              | `loadComponent` splits bundles automatically by route       |

---

### Features Demonstrated in This PoC

#### 1. Lazy Loading with `loadComponent`

```typescript
// app.routes.ts
{
    path: 'compiler',
    loadComponent: () =>
        import('./compiler/compiler.component').then((m) => m.CompilerComponent),
}
```

Angular compiles each lazily-loaded component into a **separate JavaScript chunk**.
The browser only downloads that chunk when the user navigates to the route for the
first time. This reduces the **initial bundle size** and improves **Time-to-Interactive**.

#### 2. Route Titles

```typescript
{ path: '', ..., title: 'Home - Adblock Compiler' }
```

The `title` property automatically updates `document.title` (the browser tab label)
when the route changes — no manual `document.title = '...'` calls needed.

#### 3. Route Data (Static Metadata)

```typescript
{
    path: 'compiler',
    data: { description: 'Configure and run filter list compilations' },
}
```

Attach arbitrary metadata to a route. Components read it via `ActivatedRoute.snapshot.data`.
Useful for breadcrumbs, page descriptions, role-based access hints, and more.

#### 4. Declarative Navigation with `routerLink`

```html
<!-- home.component.ts template -->
<a routerLink="/compiler" class="btn btn-secondary">Open Compiler</a>
```

The `routerLink` directive converts an `<a>` or `<button>` into a router-aware link.
Clicking it uses `History.pushState` — **no full page reload**.

#### 5. Active-Link Highlighting with `routerLinkActive`

```html
<!-- app.component.ts template -->
<a routerLink="/compiler" routerLinkActive="active">⚙️ Compiler</a>
```

`routerLinkActive` adds the given CSS class when the route is active, enabling
**automatic active-link highlighting** without any imperative code.

#### 6. Programmatic Navigation with `Router.navigate()`

```typescript
// home.component.ts
constructor(private router: Router) {}

goToCompiler(): void {
    this.router.navigate(['/compiler']);
}
```

Use `Router.navigate()` when navigation must happen as a result of **application logic**
rather than a direct user click — e.g., redirect after login, navigate after a form save,
or respond to a timer.

#### 7. Reading Query Parameters with `ActivatedRoute`

```typescript
// compiler.component.ts
constructor(private route: ActivatedRoute) {}

ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
        const urlParam = params.get('url');
        if (urlParam) {
            this.urlsArray.at(0).setValue(urlParam);
        }
    });
}
```

`ActivatedRoute.queryParamMap` is an Observable that emits whenever the query string
changes. This makes the page **deep-linkable**: another app can link to
`/compiler?url=https://easylist.to/easylist/easylist.txt` and the first URL input will
be pre-populated automatically.

#### 8. Updating the URL Without Navigating Away

```typescript
// compiler.component.ts — after successful compile
this.router.navigate([], {
    relativeTo: this.route,
    queryParams: { url: urls[0] },
    queryParamsHandling: 'merge',
});
```

Passing an empty commands array (`[]`) with `relativeTo: this.route` updates **only the
query string** of the current URL. This makes the compilation result **bookmarkable and
shareable** without navigating to a different page.

---

### What Is Not Yet Demonstrated (Recommended Next Steps)

| Feature              | When to Add It                                              |
| -------------------- | ----------------------------------------------------------- |
| **Route Guards**     | Add authentication; protect `/admin` routes with `canActivate` |
| **Route Resolvers**  | Pre-fetch data before a component renders (eliminates loading spinners) |
| **Lazy Modules**     | Group related routes into a feature module with `loadChildren` |
| **Route Animations** | Animate page transitions via `RouterOutlet` + Angular Animations |
| **Child Routes**     | Nest routes inside a parent layout component               |
| **Route Parameters** | Dynamic segments like `/filter/:id` for detail views        |

## 📊 Comparison with Existing Stack

| Feature              | Current (Vanilla)        | Angular                 |
| -------------------- | ------------------------ | ----------------------- |
| **State Management** | Manual DOM manipulation  | Reactive data binding   |
| **Routing**          | Multi-page (page reload) | Single-page (no reload) |
| **Forms**            | Manual validation        | Built-in validation     |
| **Type Safety**      | None                     | Full TypeScript         |
| **Component Reuse**  | Copy-paste               | Import components       |
| **Testing**          | Manual                   | Built-in testing tools  |

## 🧪 Testing

Angular comes with built-in testing support:

```bash
# Run unit tests with Karma
npm test

# Run tests in headless mode
npm test -- --no-watch --browsers=ChromeHeadless
```

## 📦 Building for Production

```bash
# Build optimized bundle
npm run build

# Output will be in dist/ directory
# Deploy dist/adblock-compiler-poc/ to your server
```

## 🔍 API Integration

The compiler service calls `/api/compile` with:

```typescript
interface CompileRequest {
    configuration: {
        name: string;
        sources: Array<{ source: string }>;
        transformations: string[];
    };
    benchmark?: boolean;
}
```

If the API is not available, it falls back to mock data for demo purposes.

## 💡 Next Steps for Production

1. **State Management**: Add NgRx or Akita for complex state
2. **Error Handling**: Global error interceptor
3. **Loading States**: HTTP interceptor for loading spinner
4. **Authentication**: Guards for protected routes
5. **Lazy Loading**: Split bundles by route
6. **PWA**: Add service worker for offline support
7. **Internationalization**: Angular i18n for multi-language
8. **Accessibility**: ARIA attributes and keyboard navigation

## 📚 Resources

- [Angular Official Docs](https://angular.io/docs)
- [Standalone Components Guide](https://angular.io/guide/standalone-components)
- [Reactive Forms](https://angular.io/guide/reactive-forms)
- [RxJS Documentation](https://rxjs.dev/)
- [Angular Router](https://angular.io/guide/router)

## 🤝 Angular vs React vs Vue

See the main [PoC README](../README.md) for a detailed comparison of all three frameworks.
