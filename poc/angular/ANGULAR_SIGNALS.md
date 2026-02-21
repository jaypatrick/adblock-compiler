# Angular Signals - Modern Reactive State Management

## ⚡ What are Angular Signals?

**Angular Signals** are a new reactive primitive introduced in Angular 16+ that revolutionize how Angular applications handle state and change detection. They represent a fundamental shift in Angular's reactivity model, moving from Zone.js-based change detection to fine-grained reactivity.

### Why Signals Matter

Traditional Angular change detection (Zone.js) checks **every component** on **every async event** (clicks, HTTP requests, timers, etc.). This works but can be inefficient in large applications.

**Signals enable fine-grained reactivity** - only components that depend on changed signals are updated. This results in:

- ✅ **Better Performance** - Skip unnecessary change detection cycles
- ✅ **Explicit Dependencies** - Clear what triggers updates
- ✅ **Simpler Mental Model** - No hidden subscriptions or memory leaks
- ✅ **Better TypeScript Support** - Full type inference
- ✅ **Interop with RxJS** - Use both paradigms together

## 📚 Core Concepts

### 1. `signal()` - Writable Reactive State

A **signal** is a reactive container for a value. It notifies consumers when the value changes.

```typescript
import { signal } from '@angular/core';

// Create a signal with initial value
count = signal(0);

// Read the signal (call it like a function)
console.log(this.count()); // 0

// Write to the signal
this.count.set(5); // Direct assignment
this.count.update(n => n + 1); // Functional update
```

**Key Methods:**
- **`.set(value)`** - Replace the signal's value
- **`.update(fn)`** - Update based on current value
- **`signal()`** - Read the current value

**Usage in Templates:**
```html
<p>Count: {{ count() }}</p>
<button (click)="count.set(count() + 1)">Increment</button>
```

### 2. `computed()` - Derived Reactive Values

A **computed signal** automatically recalculates when its dependencies change. It's lazy (only computed when read) and cached.

```typescript
import { computed, signal } from '@angular/core';

count = signal(0);

// Computed signal automatically tracks dependencies
doubleCount = computed(() => this.count() * 2);

// Always up-to-date, no manual updates needed
console.log(this.doubleCount()); // 0
this.count.set(5);
console.log(this.doubleCount()); // 10
```

**Benefits:**
- Automatic dependency tracking
- Cached - only recomputed when dependencies change
- Type-safe - infers return type
- Lazy - not computed until read

**Complex Example:**
```typescript
firstName = signal('John');
lastName = signal('Doe');
age = signal(30);

// Computed can depend on multiple signals
fullName = computed(() => `${this.firstName()} ${this.lastName()}`);
isAdult = computed(() => this.age() >= 18);
greeting = computed(() => 
    `Hello, ${this.fullName()}! You are ${this.isAdult() ? 'an adult' : 'a minor'}.`
);
```

### 3. `effect()` - Side Effects

An **effect** runs whenever any signal it reads changes. Use effects for side effects like logging, analytics, or localStorage sync.

```typescript
import { effect, signal } from '@angular/core';

count = signal(0);

constructor() {
    effect(() => {
        // This runs immediately and whenever count changes
        console.log('Count changed to:', this.count());
        
        // Save to localStorage
        localStorage.setItem('count', String(this.count()));
    });
}
```

**Key Points:**
- Runs immediately on creation
- Automatically tracks dependencies (any signal read inside)
- Re-runs when dependencies change
- Cannot modify signals directly (would cause infinite loops)

**Use Cases:**
- Logging and debugging
- Analytics tracking
- localStorage persistence
- Syncing with external APIs
- DOM manipulation (rare cases)

### 4. New `@if` / `@for` / `@switch` Template Syntax

Angular 17+ introduces new built-in control flow that replaces structural directives (`*ngIf`, `*ngFor`, `*ngSwitch`).

#### `@if` replaces `*ngIf`

**Old Syntax:**
```html
<div *ngIf="isLoggedIn">Welcome!</div>
<div *ngIf="!isLoggedIn">Please log in</div>
```

**New Syntax:**
```html
@if (isLoggedIn) {
    <div>Welcome!</div>
} @else {
    <div>Please log in</div>
}
```

**Benefits:**
- More readable
- Better type inference
- No need for structural directives
- Works seamlessly with signals

#### `@for` replaces `*ngFor`

**Old Syntax:**
```html
<div *ngFor="let item of items; let i = index; trackBy: trackByFn">
    {{ i }}: {{ item.name }}
</div>
```

**New Syntax:**
```html
@for (item of items; track item.id) {
    <div>{{ item.name }}</div>
}
```

**Key Differences:**
- `track` expression is required (replaces `trackBy`)
- Access index with `$index`
- Access first/last with `$first` / `$last`
- More concise and readable

**With Index:**
```html
@for (item of items; track item.id; let i = $index) {
    <div>{{ i }}: {{ item.name }}</div>
}
```

**Empty State:**
```html
@for (item of items; track item.id) {
    <div>{{ item.name }}</div>
} @empty {
    <div>No items found</div>
}
```

#### `@switch` replaces `*ngSwitch`

**Old Syntax:**
```html
<div [ngSwitch]="status">
    <div *ngSwitchCase="'loading'">Loading...</div>
    <div *ngSwitchCase="'success'">Success!</div>
    <div *ngSwitchDefault>Error</div>
</div>
```

**New Syntax:**
```html
@switch (status) {
    @case ('loading') {
        <div>Loading...</div>
    }
    @case ('success') {
        <div>Success!</div>
    }
    @default {
        <div>Error</div>
    }
}
```

### 5. `inject()` - Functional Dependency Injection

**inject()** allows dependency injection without constructors, enabling functional composition patterns.

**Old Pattern:**
```typescript
export class MyComponent {
    constructor(private http: HttpClient, private router: Router) {}
}
```

**New Pattern:**
```typescript
import { inject } from '@angular/core';

export class MyComponent {
    http = inject(HttpClient);
    router = inject(Router);
    
    // Or use inline
    navigateHome() {
        inject(Router).navigate(['/']);
    }
}
```

**Benefits:**
- More concise
- Enables functional composition
- Works in functions, not just constructors
- Better testability

## 🔄 Signals vs RxJS Observables

Angular applications can use **both** Signals and RxJS Observables. They serve different purposes:

| Aspect | Signals | RxJS Observables |
|--------|---------|------------------|
| **Purpose** | Synchronous state management | Asynchronous data streams |
| **When to Use** | Component state, derived values | HTTP requests, WebSockets, timers |
| **Performance** | Better (fine-grained reactivity) | Good (but broader change detection) |
| **Learning Curve** | Easier | Steeper |
| **Operators** | Limited (computed, effect) | Rich (map, filter, switchMap, etc.) |
| **Memory** | Less chance of memory leaks | Must unsubscribe |

### Converting Between Signals and Observables

Angular provides interop functions:

#### `toSignal()` - Observable → Signal

```typescript
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';

http = inject(HttpClient);

// Convert Observable to Signal
data$ = this.http.get<Data[]>('/api/data');
data = toSignal(this.data$, { initialValue: [] });

// Use in template
// <div>{{ data().length }} items</div>
```

#### `toObservable()` - Signal → Observable

```typescript
import { toObservable } from '@angular/core/rxjs-interop';

count = signal(0);
count$ = toObservable(this.count);

// Use with RxJS operators
this.count$.pipe(
    debounceTime(300),
    switchMap(count => this.http.post('/api/count', { count }))
).subscribe();
```

### When to Use Which?

**Use Signals for:**
- Component state (form values, UI state)
- Derived values (computed properties)
- Synchronous operations
- Simple state management

**Use RxJS for:**
- HTTP requests
- WebSocket connections
- Complex async flows
- Advanced operators (debounce, retry, etc.)
- Event streams

**Best Practice:** Start with Signals for state, use RxJS for async operations, convert between them as needed.

## 📝 Code Examples from Our Implementation

### Basic Signal Usage

```typescript
import { Component, signal } from '@angular/core';

@Component({
    selector: 'app-signals',
    template: `
        <div class="counter">
            <p>Count: {{ compilationCount() }}</p>
            <button (click)="incrementCount()">+1</button>
            <button (click)="resetCount()">Reset</button>
        </div>
    `
})
export class SignalsComponent {
    // Create a writable signal
    compilationCount = signal(0);
    
    // Methods to update the signal
    incrementCount() {
        this.compilationCount.update(n => n + 1);
    }
    
    resetCount() {
        this.compilationCount.set(0);
    }
}
```

### Computed Signals

```typescript
compilationCount = signal(0);
compilationHistory = signal<CompilationHistoryItem[]>([]);

// Computed signal - automatically updates
averageUrlsPerCompilation = computed(() => {
    const history = this.compilationHistory();
    if (history.length === 0) return 0;
    
    const totalUrls = history.reduce((sum, item) => sum + item.urlCount, 0);
    return (totalUrls / history.length).toFixed(1);
});

successRate = computed(() => {
    const history = this.compilationHistory();
    if (history.length === 0) return 100;
    
    const successCount = history.filter(item => item.status === 'success').length;
    return Math.round((successCount / history.length) * 100);
});
```

### Effects

```typescript
lastEffectTimestamp = signal('Not triggered yet');

constructor() {
    // Effect runs whenever compilationCount changes
    effect(() => {
        const count = this.compilationCount();
        console.log(`Compilation count changed to: ${count}`);
        
        // Update timestamp signal
        this.lastEffectTimestamp.set(new Date().toLocaleTimeString());
    });
}
```

### New Template Syntax

```typescript
@Component({
    template: `
        <!-- @if syntax -->
        @if (compilationHistory().length === 0) {
            <div class="empty-state">No compilations yet</div>
        } @else {
            <!-- @for syntax -->
            @for (item of compilationHistory(); track item.id) {
                <div class="history-item">
                    <!-- Nested @if -->
                    @if (item.status === 'success') {
                        <span>✅</span>
                    } @else {
                        <span>❌</span>
                    }
                    <span>Compilation #{{ item.id }}</span>
                </div>
            }
        }
    `
})
```

### Array Updates with Signals

```typescript
compilationHistory = signal<CompilationHistoryItem[]>([]);

simulateCompilation() {
    const newItem = {
        id: this.compilationCount() + 1,
        timestamp: new Date(),
        urlCount: Math.floor(Math.random() * 5) + 1,
        status: 'success' as const,
    };
    
    // Update array: create new array with spread operator
    this.compilationHistory.update(history => [...history, newItem]);
}
```

## 🚀 Migration from Observables to Signals

### Before (RxJS)

```typescript
export class CompilerComponent implements OnDestroy {
    count$ = new BehaviorSubject(0);
    doubleCount$ = this.count$.pipe(map(n => n * 2));
    
    private destroy$ = new Subject<void>();
    
    ngOnInit() {
        this.count$.pipe(
            takeUntil(this.destroy$)
        ).subscribe(count => {
            console.log('Count:', count);
        });
    }
    
    increment() {
        this.count$.next(this.count$.value + 1);
    }
    
    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }
}
```

### After (Signals)

```typescript
export class CompilerComponent {
    count = signal(0);
    doubleCount = computed(() => this.count() * 2);
    
    constructor() {
        effect(() => {
            console.log('Count:', this.count());
        });
    }
    
    increment() {
        this.count.update(n => n + 1);
    }
    
    // No ngOnDestroy needed - effects clean up automatically
}
```

**Benefits:**
- ✅ No manual subscription management
- ✅ No memory leaks
- ✅ Less boilerplate
- ✅ Simpler to understand

## 🔗 Official Resources

- **Angular Signals Guide**: https://angular.dev/guide/signals
- **Angular Change Detection**: https://angular.dev/best-practices/runtime-performance
- **New Control Flow Syntax**: https://angular.dev/guide/templates/control-flow
- **RxJS Interop**: https://angular.dev/guide/signals/rxjs-interop
- **Functional Dependency Injection**: https://angular.dev/guide/di/dependency-injection-context

## 🎯 Best Practices

1. **Start with Signals for State**
   - Use signals for component state
   - Replace most BehaviorSubjects with signals
   - Use computed() for derived values

2. **Use Effects Sparingly**
   - Effects are for side effects only
   - Don't modify signals inside effects
   - Consider if computed() is better

3. **Leverage New Template Syntax**
   - Prefer `@if/@for/@switch` over `*ngIf/*ngFor/*ngSwitch`
   - Better performance and type inference
   - More readable code

4. **Mix Signals and RxJS Wisely**
   - Signals for sync state
   - RxJS for async operations
   - Use `toSignal()` and `toObservable()` for interop

5. **Update Arrays Immutably**
   ```typescript
   // ✅ Good: Create new array
   items.update(arr => [...arr, newItem]);
   
   // ❌ Bad: Mutate existing array (won't trigger updates)
   items().push(newItem);
   ```

## 🚀 Next Steps

1. **Explore the Signals Component** - Visit `/signals` route in the Angular PoC
2. **Experiment with Actions** - Try the interactive demos
3. **Read Official Docs** - Deep dive into Angular Signals
4. **Migrate Gradually** - Start using signals in new components
5. **Combine with RxJS** - Learn the interop patterns

---

**Angular Signals represent the future of Angular reactivity.** They provide a simpler, more performant way to manage state while maintaining full backward compatibility with existing RxJS code.
