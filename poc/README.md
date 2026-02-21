# Frontend Framework Migration - Proof of Concept

This directory contains proof-of-concept implementations of the Adblock Compiler frontend in three popular JavaScript frameworks: **React**, **Vue 3**, and **Angular 17+**.

## 📋 Overview

Each PoC demonstrates how the existing vanilla HTML/CSS/JS frontend would be implemented in a modern framework, showcasing:

- ✅ Component-based architecture
- ✅ Client-side routing (SPA)
- ✅ State management (forms, theme, API data)
- ✅ Theme toggle (dark/light mode)
- ✅ API integration pattern
- ✅ Loading and error states
- ✅ Form validation

## 🎯 PoC Implementations

### 1. React PoC ([react/index.html](./react/index.html))

**Technology Stack:**

- React 18 (via CDN)
- React Router v6 (via CDN)
- Babel Standalone (for JSX transformation)

**Key Patterns:**

- Functional components with Hooks
- `useState` for local state
- `useEffect` for side effects
- Context API for theme management
- Controlled components for forms
- Custom hooks for reusable logic

**How to Run:**

```bash
cd poc/react
# Open index.html in a web browser
# OR serve with a local server:
python3 -m http.server 8000
# Then visit: http://localhost:8000
```

**Advantages:**

- 🚀 Huge ecosystem and community
- 📚 Abundant learning resources
- 🔧 Flexible and unopinionated
- ⚡ Great performance with Virtual DOM
- 🧩 Rich component library ecosystem

**Considerations:**

- Requires build tooling for production (Vite, webpack)
- More decisions to make (state management, routing)
- JSX learning curve

---

### 2. Vue 3 PoC ([vue/index.html](./vue/index.html))

**Technology Stack:**

- Vue 3 (via CDN)
- Vue Router 4 (via CDN)
- Composition API

**Key Patterns:**

- Vue Router for declarative routing, named routes, and route metadata
- Route parameters with `useRoute()` for bookmarkable application states
- Programmatic navigation with `useRouter().push()`
- Navigation guards with `router.beforeEach()` for cross-cutting concerns
- Composition API with `setup()`
- `ref()` and `reactive()` for reactive state
- `computed()` for derived state
- `watch()` for side effects
- Template-based declarative rendering
- Two-way data binding with `v-model`
- Composables for reusable logic

**Why Vue Router Is Worth Using:**

Vue Router is not just a convenience layer — it enables architectural patterns that would be
painful to implement by hand:

| Benefit | What it Gives You |
| --- | --- |
| **Declarative links** | `<router-link>` auto-applies active classes; no DOM querying needed |
| **Programmatic navigation** | `router.push('/compiler/dns')` from any component or service |
| **Route parameters** | `/compiler/:preset` makes URLs shareable and bookmarkable |
| **Navigation guards** | `router.beforeEach()` centralises auth, analytics, and title updates |
| **Route metadata** | Attach arbitrary data (`meta.title`, `meta.requiresAuth`) to routes |
| **Lazy loading** | `component: () => import('./Page.vue')` splits routes into separate chunks |
| **Nested routes** | Multi-level `<router-view>` outlets for complex layouts |
| **Named routes** | Stable names decouple navigation code from URL structure |

The Vue PoC demonstrates the first five of these benefits in a single CDN-based HTML file.

**How to Run:**

```bash
cd poc/vue
# Open index.html in a web browser
# OR serve with a local server:
python3 -m http.server 8001
# Then visit: http://localhost:8001
```

**Advantages:**

- 🎨 Progressive framework (start simple, scale up)
- 📖 Excellent documentation
- 🔄 Two-way data binding
- 🎯 Intuitive template syntax
- ⚡ Great performance with reactivity system
- 🛠️ Official router and state management

**Considerations:**

- Smaller ecosystem than React
- Less corporate backing
- Composition API is newer (learning curve)

---

### 3. Angular PoC ([angular/](./angular/))

**Technology Stack:**

- Angular 17+ (Standalone Components)
- TypeScript
- RxJS
- Reactive Forms

**Key Patterns:**

- Standalone components (no NgModules)
- Dependency Injection
- Reactive Forms with FormBuilder
- RxJS Observables for async operations
- Services for business logic
- Structural directives (`*ngIf`, `*ngFor`)
- Component-scoped styles

**How to Run:**

```bash
cd poc/angular
npm install
npm start
# Visit: http://localhost:4200
```

**Advantages:**

- 🏢 Enterprise-ready framework
- 📘 Full TypeScript integration
- 🧰 Complete solution (router, forms, HTTP, testing)
- 🔒 Strong typing and interfaces
- 🎓 Opinionated architecture (consistency)
- 💼 Popular in enterprise environments

**Considerations:**

- Steeper learning curve
- More boilerplate code
- Larger bundle size
- Requires Node.js and build tools

---

## 🔍 Feature Comparison

| Feature               | React                     | Vue                  | Angular              |
| --------------------- | ------------------------- | -------------------- | -------------------- |
| **Learning Curve**    | Medium                    | Easy                 | Steep                |
| **Bundle Size**       | Small-Medium              | Small                | Large                |
| **Performance**       | Excellent                 | Excellent            | Very Good            |
| **TypeScript**        | Optional                  | Optional             | Required             |
| **State Management**  | External (Redux, Zustand) | Built-in (Pinia)     | Services + RxJS      |
| **Form Handling**     | Manual / Libraries        | v-model + validation | Reactive Forms       |
| **Routing**           | React Router              | Vue Router           | Angular Router       |
| **Build Setup**       | Vite / CRA                | Vite / Vue CLI       | Angular CLI          |
| **Testing**           | Jest + Testing Library    | Vitest / Jest        | Jasmine + Karma      |
| **Mobile**            | React Native              | Native options       | Ionic / NativeScript |
| **Community**         | Very Large                | Large                | Large                |
| **Corporate Backing** | Meta                      | Independent          | Google               |

## 🎨 Visual Comparison

All three PoCs implement the same design using the existing color scheme:

- **Primary Gradient**: `#667eea` → `#764ba2`
- **Dark Mode**: Supported in all implementations
- **Responsive Design**: Mobile-friendly layouts
- **Consistent UX**: Same user experience across frameworks

## 📊 Code Structure Comparison

### React

```
- Functional components
- JSX templates
- Hooks for state/effects
- Context for global state
- Props for data flow
```

### Vue

```
- Single-file components (or templates)
- Template syntax (HTML-like)
- Composition API for logic
- Reactive data binding
- Props & emits for communication
```

### Angular

```
- Class-based components
- Inline or external templates
- Decorators (@Component, @Injectable)
- Services for shared logic
- Input/Output for communication
```

## 🚀 Migration Path Recommendations

### Choose **React** if:

- ✅ You want maximum flexibility
- ✅ Large ecosystem is important
- ✅ Team has React experience
- ✅ You need React Native for mobile
- ✅ You prefer functional programming

### Choose **Vue** if:

- ✅ You want an easy learning curve
- ✅ Progressive enhancement is important
- ✅ You like template-based syntax
- ✅ You want official libraries (router, state)
- ✅ You value excellent documentation

### Choose **Angular** if:

- ✅ You need an enterprise framework
- ✅ TypeScript is a requirement
- ✅ You want a complete solution
- ✅ Team consistency is critical
- ✅ You're building a large-scale app

## 📈 Existing App Analysis

### Current Stack

- **Multi-page application** (compiler.html, index.html, admin-storage.html, test.html)
- **Vanilla JavaScript** with manual DOM manipulation
- **CSS Custom Properties** for theming
- **Chart.js** for visualization
- **No build step** - direct HTML/CSS/JS

### Migration Benefits

**All Frameworks Provide:**

1. **Single Page Application** - No page reloads, faster navigation
2. **Component Reusability** - DRY principle, maintainable code
3. **State Management** - Predictable data flow
4. **Developer Experience** - Hot reload, debugging tools
5. **Testing** - Unit tests, integration tests
6. **Type Safety** (with TypeScript) - Fewer runtime errors
7. **Modern Tooling** - Linting, formatting, bundling
8. **Performance** - Code splitting, lazy loading

## 🔧 API Integration

All PoCs use the same API contract:

**Endpoint:** `POST /api/compile`

**Request:**

```json
{
    "configuration": {
        "name": "Filter List Name",
        "sources": [
            { "source": "https://example.com/filters.txt" }
        ],
        "transformations": [
            "RemoveComments",
            "Deduplicate",
            "TrimLines",
            "RemoveEmptyLines"
        ]
    },
    "benchmark": true
}
```

**Response:**

```json
{
  "success": true,
  "ruleCount": 1234,
  "sources": 1,
  "transformations": [...],
  "benchmark": {
    "duration": "123ms",
    "rulesPerSecond": 10000
  }
}
```

**Available Transformations:**

- RemoveComments
- Compress
- RemoveModifiers
- Validate
- ValidateAllowIp
- Deduplicate
- InvertAllow
- RemoveEmptyLines
- TrimLines
- InsertFinalNewLine
- ConvertToAscii

## 📝 Implementation Notes

### React & Vue (CDN Versions)

- Single HTML file, no build step required
- Suitable for PoC and small projects
- For production, use Vite or other build tools

### Angular

- Requires Node.js and npm
- Uses Angular CLI for development
- Production-ready setup out of the box

### Production Considerations

1. **Build Process**: All frameworks need bundling for production
2. **Code Splitting**: Lazy load routes and components
3. **SEO**: Consider SSR (Next.js, Nuxt, Angular Universal)
4. **PWA**: Add service workers for offline support
5. **Testing**: Set up unit and E2E tests
6. **CI/CD**: Automate builds and deployments

## 🧪 Testing the PoCs

### React & Vue (CDN)

1. Open the HTML file directly in a browser
2. Or serve with a local HTTP server:
   ```bash
   python3 -m http.server 8000
   npx http-server
   ```

### Angular

1. Install dependencies: `npm install`
2. Run dev server: `npm start`
3. Build for production: `npm run build`

## 🎓 Learning Resources

### React

- [Official React Docs](https://react.dev/)
- [React Router](https://reactrouter.com/)
- [React Hooks](https://react.dev/reference/react)

### Vue

- [Official Vue Docs](https://vuejs.org/)
- [Vue Router](https://router.vuejs.org/)
- [Composition API](https://vuejs.org/guide/extras/composition-api-faq.html)

### Angular

- [Official Angular Docs](https://angular.io/docs)
- [Standalone Components](https://angular.io/guide/standalone-components)
- [Reactive Forms](https://angular.io/guide/reactive-forms)

## 📞 Next Steps

1. **Review each PoC** - Test functionality and developer experience
2. **Gather team feedback** - Which framework feels most intuitive?
3. **Consider requirements** - Project size, timeline, team skills
4. **Prototype further** - Implement more complex features
5. **Make decision** - Choose framework and plan migration
6. **Set up tooling** - Configure build process, linting, testing
7. **Migrate incrementally** - Start with one page/feature

## 🤝 Contributing

These PoCs are starting points. Feel free to extend them with:

- Additional pages (admin-storage, test)
- Chart.js integration
- WebSocket support
- Authentication
- Error boundaries
- Loading skeletons
- Animations

---

**Questions or Feedback?** Open an issue or discussion in the repository!
