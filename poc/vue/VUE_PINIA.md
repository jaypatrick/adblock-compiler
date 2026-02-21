# Pinia - Modern State Management for Vue 3

## 🍍 What is Pinia?

**Pinia** is the official state management library for Vue 3. It's the spiritual successor to Vuex, offering a simpler, more intuitive API that leverages Vue 3's Composition API.

### Why Pinia is the Modern Choice

Pinia was designed from the ground up for Vue 3 and is now the **officially recommended** state management solution by the Vue core team. It provides:

- ✅ **Intuitive API** - No mutations, just actions. Simpler than Vuex.
- ✅ **TypeScript Support** - Full type inference out of the box
- ✅ **DevTools Integration** - Time-travel debugging, action tracking
- ✅ **Modular by Design** - Multiple stores, no single global store
- ✅ **Lightweight** - ~1KB after gzip
- ✅ **Server-Side Rendering** - First-class SSR support

## 📚 Key Concepts

### 1. Store Definition with `defineStore()`

A Pinia store is created using `defineStore()` and consists of three main parts:

```javascript
const useCompilerStore = defineStore('compiler', {
    // STATE: The single source of truth
    state: () => ({
        urls: [''],
        selectedTransformations: [],
        isLoading: false,
        result: null,
        error: null,
    }),
    
    // GETTERS: Computed properties derived from state
    getters: {
        compiledCount(state) {
            return state.result ? state.result.ruleCount : 0;
        },
        canCompile(state) {
            return state.urls.some(url => url.trim() !== '') && !state.isLoading;
        },
    },
    
    // ACTIONS: Methods that mutate state
    actions: {
        addUrl() {
            this.urls.push('');
        },
        removeUrl(index) {
            if (this.urls.length > 1) {
                this.urls.splice(index, 1);
            }
        },
        toggleTransformation(name) {
            const index = this.selectedTransformations.indexOf(name);
            if (index > -1) {
                this.selectedTransformations.splice(index, 1);
            } else {
                this.selectedTransformations.push(name);
            }
        },
    },
});
```

### 2. State

**State** is the reactive data that your application needs to track. It's defined as a function returning an object:

```javascript
state: () => ({
    urls: [''],
    isLoading: false,
    result: null,
})
```

**Why a function?** This ensures each store instance gets its own state object, which is essential for SSR and testing.

### 3. Getters

**Getters** are like computed properties for your store. They derive values from state and are automatically cached:

```javascript
getters: {
    // Getter receives state as first argument
    compiledCount(state) {
        return state.result ? state.result.ruleCount : 0;
    },
    
    // Getters can access other getters via 'this'
    summaryText() {
        return `Compiled ${this.compiledCount} rules`;
    },
}
```

**Benefits:**
- Automatically cached (only recomputed when dependencies change)
- Can be used in templates like regular reactive properties
- Can access other getters via `this`

### 4. Actions

**Actions** are methods that modify state. Unlike Vuex, there are no mutations — actions can directly mutate state:

```javascript
actions: {
    // Synchronous action
    addUrl() {
        this.urls.push('');
    },
    
    // Async action
    async compile() {
        this.isLoading = true;
        this.error = null;
        
        try {
            const response = await fetch('/api/compile', {
                method: 'POST',
                body: JSON.stringify({ urls: this.urls }),
            });
            this.result = await response.json();
        } catch (err) {
            this.error = err.message;
        } finally {
            this.isLoading = false;
        }
    },
}
```

**Key differences from Vuex:**
- No mutations — actions can directly modify state
- Actions can be synchronous or asynchronous
- Actions can call other actions

### 5. Using Stores in Components

Import and use the store in any component:

```javascript
import { useCompilerStore } from './stores/compiler';

export default {
    setup() {
        const store = useCompilerStore();
        
        // Access state
        console.log(store.urls);
        
        // Access getters
        console.log(store.compiledCount);
        
        // Call actions
        store.addUrl();
        store.compile();
        
        return { store };
    },
}
```

In templates, you can access store properties directly:

```vue
<template>
    <div>
        <p>URLs: {{ store.urls.length }}</p>
        <p>Compiled: {{ store.compiledCount }}</p>
        <button @click="store.addUrl()">Add URL</button>
    </div>
</template>
```

## 🤔 Why Use Pinia Over Vue Composables?

You might wonder: "Can't I just use `ref()` and `reactive()` from Vue's Composition API?" Here's when Pinia adds value:

### Vue Composables (Local State)

```javascript
// useCompiler.js - Composable
export function useCompiler() {
    const urls = ref(['']);
    const isLoading = ref(false);
    
    const addUrl = () => urls.value.push('');
    
    return { urls, isLoading, addUrl };
}

// ComponentA.vue
const { urls } = useCompiler(); // Fresh instance

// ComponentB.vue
const { urls } = useCompiler(); // Different instance! State NOT shared
```

**Problem:** Each component gets its own instance. State is not shared.

### Pinia (Global State)

```javascript
// stores/compiler.js
export const useCompilerStore = defineStore('compiler', {
    state: () => ({ urls: [''] }),
    actions: { addUrl() { this.urls.push(''); } },
});

// ComponentA.vue
const store = useCompilerStore(); // Same instance

// ComponentB.vue
const store = useCompilerStore(); // Same instance! State IS shared
```

**Solution:** All components share the same store instance.

### When to Use Each

| Use Vue Composables When: | Use Pinia When: |
|---------------------------|-----------------|
| State is component-local | State is shared across multiple components |
| Reusing logic, not data | Centralized application state needed |
| Simple utilities/helpers | Complex state with multiple actions |
| No need for DevTools | Want to debug state changes |

### Pinia Advantages

1. **Centralized State**
   - Single source of truth for application state
   - Easy to reason about where data lives
   - No prop drilling through component trees

2. **DevTools Integration**
   - Time-travel debugging
   - Action history
   - State snapshots
   - Inspect store state in real-time

3. **Type Safety**
   - Full TypeScript inference
   - Autocomplete for state, getters, actions
   - Type-safe across entire application

4. **Server-Side Rendering**
   - Built-in SSR support
   - Hydration handled automatically
   - Multiple instances for concurrent requests

5. **Plugin System**
   - Extend Pinia with plugins
   - Persist state to localStorage
   - Sync state across tabs
   - Add custom functionality

## 📝 Code Examples from Our Implementation

### Store Definition

```javascript
const useCompilerStore = defineStore('compiler', {
    state: () => ({
        urls: [''],
        selectedTransformations: [],
        isLoading: false,
        result: null,
        error: null,
    }),
    
    getters: {
        compiledCount(state) {
            return state.result ? state.result.ruleCount : 0;
        },
        canCompile(state) {
            return state.urls.some(url => url.trim() !== '') && !state.isLoading;
        },
    },
    
    actions: {
        addUrl() {
            this.urls.push('');
        },
        removeUrl(index) {
            if (this.urls.length > 1) {
                this.urls.splice(index, 1);
            }
        },
        toggleTransformation(transformationName) {
            const index = this.selectedTransformations.indexOf(transformationName);
            if (index > -1) {
                this.selectedTransformations.splice(index, 1);
            } else {
                this.selectedTransformations.push(transformationName);
            }
        },
        resetCompilation() {
            this.result = null;
            this.error = null;
        },
        setLoading(loading) {
            this.isLoading = loading;
        },
        setError(error) {
            this.error = error;
        },
        setResult(result) {
            this.result = result;
        },
    },
});
```

### Using in CompilerPage Component

```javascript
const CompilerPage = {
    setup() {
        const store = useCompilerStore();
        
        const handleCompile = async () => {
            const validUrls = store.urls.filter(url => url.trim() !== '');
            
            if (validUrls.length === 0) {
                store.setError('Please enter at least one URL');
                return;
            }
            
            store.setLoading(true);
            store.resetCompilation();
            
            try {
                const response = await fetch('/api/compile', {
                    method: 'POST',
                    body: JSON.stringify({
                        sources: validUrls,
                        transformations: store.selectedTransformations,
                    }),
                });
                
                const result = await response.json();
                store.setResult(result);
            } catch (err) {
                store.setError(err.message);
            } finally {
                store.setLoading(false);
            }
        };
        
        return { store, handleCompile };
    },
};
```

### Template Usage

```vue
<template>
    <!-- Access state directly -->
    <input v-model="store.urls[0]" />
    
    <!-- Use getters -->
    <p>Compiled {{ store.compiledCount }} rules</p>
    
    <!-- Call actions -->
    <button @click="store.addUrl()">Add URL</button>
    
    <!-- Conditional rendering with state -->
    <div v-if="store.isLoading">Loading...</div>
    <div v-if="store.error">Error: {{ store.error }}</div>
</template>
```

## 🔗 Official Resources

- **Official Documentation**: https://pinia.vuejs.org/
- **Getting Started Guide**: https://pinia.vuejs.org/getting-started.html
- **Core Concepts**: https://pinia.vuejs.org/core-concepts/
- **TypeScript Support**: https://pinia.vuejs.org/cookbook/typescript.html
- **Plugins**: https://pinia.vuejs.org/core-concepts/plugins.html

## 🚀 Next Steps

1. **Explore the Store Inspector** - Visit `/store` route to see live state
2. **Experiment with Actions** - Try modifying state via action buttons
3. **Watch State Persistence** - Navigate between pages and see state persist
4. **Consider TypeScript** - For production, migrate to `.ts` for full type safety
5. **Add Plugins** - Explore Pinia plugins for persistence, logging, etc.

---

**Pinia is the modern, intuitive choice for Vue 3 state management.** It simplifies state management while providing powerful features for building scalable Vue applications.
