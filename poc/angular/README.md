# Angular 21 PoC - Adblock Compiler

A proof-of-concept Angular 21 application demonstrating modern Angular features with Angular Material, **zoneless change detection**, and Server-Side Rendering (SSR).

## Features

### Angular 21 Modern Patterns
- **Standalone Components** - No NgModule required
- **Zoneless Change Detection** (`provideZonelessChangeDetection()`) - No Zone.js; scheduling driven entirely by signal notifications
- **Signals** (`signal()`, `computed()`, `effect()`) - Fine-grained reactivity, required for zoneless correctness
- **Functional DI** (`inject()`) - Clean, composable dependency injection
- **New Control Flow** (`@if`, `@for`, `@switch`) - Better performance and type inference
- **View Transitions API** - Smooth page transitions via `withViewTransitions()`
- **Component Input Binding** - Map route params to component inputs via `withComponentInputBinding()`
- **`takeUntilDestroyed()`** - Declarative subscription teardown via `DestroyRef`; replaces `Subject<void>` + `ngOnDestroy`

### Angular Material (Material Design 3)
- `MatToolbarModule` - App toolbar
- `MatSidenavModule` - Navigation sidenav
- `MatCardModule` - Content cards
- `MatButtonModule` - Material buttons
- `MatFormFieldModule` - Form fields with Material styling
- `MatTableModule` - Data table for benchmarks
- `MatProgressBarModule` - Progress indicators
- `MatChipsModule` - Chip labels

### Server-Side Rendering (SSR)
- `@angular/ssr` with `provideServerRendering()`
- Express server in `server.ts`
- `mergeApplicationConfig()` for browser/server config composition
- `ServerRoute[]` with `RenderMode.Server` for all routes
- SSR-safe DOM access using `inject(DOCUMENT)` instead of direct `document` access

### Angular Router
- Lazy-loaded routes with `loadComponent()`
- Route titles (browser tab updates)
- Route data (metadata)
- Programmatic navigation with `Router.navigate()`
- Declarative navigation with `routerLink`
- URL query params with `ActivatedRoute`
- Component input binding with `withComponentInputBinding()`

## Project Structure

```
src/
├── app/
│   ├── app.component.ts      # Root component with Material sidenav
│   ├── app.config.ts         # Browser application config (providers)
│   ├── app.config.server.ts  # Server-side config (merges with app.config)
│   ├── app.routes.ts         # Client-side routes
│   ├── app.routes.server.ts  # Server-side render modes
│   ├── benchmark/            # Benchmark component with Material table
│   ├── compiler/             # Compiler form with Material form fields
│   ├── home/                 # Dashboard with Material cards
│   ├── services/             # CompilerService (inject() DI pattern)
│   └── signals/              # Signals demo with Material components
├── main.ts                   # Browser bootstrap
├── main.server.ts            # Server bootstrap
├── index.html                # HTML entry with Material fonts
└── styles.css                # Global styles + Material theme
server.ts                     # Express SSR server
```

## Development

```bash
# Install dependencies
npm install

# Start development server (CSR)
npm start

# Build for production (includes SSR)
npm run build

# Start SSR server
npm run serve:ssr

# Run tests
npm test
```

## Angular 21 vs Previous Versions

| Feature | Before (v19) | Now (v21) |
|---------|-------------|-----------|
| DI | Constructor injection | `inject()` functional DI |
| Config | `bootstrapApplication()` with inline providers | `app.config.ts` with `ApplicationConfig` |
| SSR | Not configured | `@angular/ssr` + Express server |
| UI | Custom CSS | Angular Material 3 |
| Theme | CSS variables | Material Design 3 tokens |
| Change detection | `provideZoneChangeDetection()` with Zone.js | `provideZonelessChangeDetection()` — no Zone.js |
| Subscription teardown | `Subject<void>` + `ngOnDestroy` | `takeUntilDestroyed(destroyRef)` |
| Mutable state | Plain class fields | `signal()` for zoneless reactivity |
| HTTP | `withFetch()` | `withFetch()` for SSR compatibility |
