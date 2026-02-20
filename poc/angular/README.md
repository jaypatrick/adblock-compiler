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
