/**
 * Angular PoC - Signals Component
 *
 * ANGULAR SIGNALS PATTERN: Modern reactive state management
 * Demonstrates signal(), computed(), effect(), and new template syntax
 *
 * Signals are Angular's answer to fine-grained reactivity. They provide:
 * - Better performance than Zone.js change detection
 * - Explicit dependencies (no hidden subscriptions)
 * - Simpler mental model than RxJS for state
 * - Automatic change detection optimization
 */

import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/**
 * Interface for compilation history entry
 * TypeScript interface for type safety
 */
interface CompilationHistoryItem {
    id: number;
    timestamp: Date;
    urlCount: number;
    transformationCount: number;
    status: 'success' | 'error';
}

/**
 * SignalsComponent
 *
 * ANGULAR PATTERNS DEMONSTRATED:
 * 1. signal() - Writable reactive state
 * 2. computed() - Derived reactive values
 * 3. effect() - Side effects that run when signals change
 * 4. inject() - Functional dependency injection (no constructor needed)
 * 5. New @if/@for template syntax (replaces *ngIf/*ngFor)
 *
 * WHY SIGNALS MATTER:
 * - Zone.js change detection checks EVERY component on EVERY event
 * - Signals enable "fine-grained reactivity" - only affected components update
 * - Result: Better performance, especially in large apps
 * - Simpler to reason about: explicit dependencies, no hidden subscriptions
 */
@Component({
    selector: 'app-signals',
    standalone: true,
    imports: [CommonModule, FormsModule],
    template: `
    <div>
        <h1>⚡ Angular Signals</h1>
        <p class="mb-2" style="color: var(--text-muted)">
            Modern reactive state management with signals, computed values, and effects
        </p>

        <!-- SIGNAL DEMONSTRATION: Basic Reactive State -->
        <div class="form-section">
            <h3>📊 Compilation Counter (signal)</h3>
            <div class="signal-demo-card">
                <div class="counter-display">
                    <span class="counter-value">{{ compilationCount() }}</span>
                    <span class="counter-label">compilations</span>
                </div>
                <div class="button-group">
                    <button class="btn btn-primary" (click)="incrementCount()">
                        ➕ Add Compilation
                    </button>
                    <button class="btn btn-secondary" (click)="resetCount()">
                        🔄 Reset Counter
                    </button>
                </div>
                <div class="code-explanation">
                    <code>compilationCount = signal(0);</code>
                    <p>
                        A <strong>signal</strong> is a reactive container for a value.
                        Call <code>compilationCount()</code> to read, 
                        <code>compilationCount.set(5)</code> to write,
                        <code>compilationCount.update(n => n + 1)</code> to modify.
                    </p>
                </div>
            </div>
        </div>

        <!-- COMPUTED DEMONSTRATION: Derived State -->
        <div class="form-section">
            <h3>🧮 Statistics (computed)</h3>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-label">Total Compilations</div>
                    <div class="stat-value">{{ compilationCount() }}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Average URLs per Compilation</div>
                    <div class="stat-value">{{ averageUrlsPerCompilation() }}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Success Rate</div>
                    <div class="stat-value">{{ successRate() }}%</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Status</div>
                    <div class="stat-value" [style.color]="statusColor()">
                        {{ compilationStatus() }}
                    </div>
                </div>
            </div>
            <div class="code-explanation">
                <code>averageUrls = computed(() => totalUrls() / compilationCount());</code>
                <p>
                    A <strong>computed signal</strong> automatically recalculates when its
                    dependencies change. It's cached and only recomputes when needed.
                    Like computed properties in Vue or useMemo in React.
                </p>
            </div>
        </div>

        <!-- NEW TEMPLATE SYNTAX: @if (replaces *ngIf) -->
        <div class="form-section">
            <h3>📋 Compilation History (New @for syntax)</h3>
            
            <!-- NEW: @if syntax instead of *ngIf -->
            @if (compilationHistory().length === 0) {
                <div class="alert alert-info">
                    No compilations yet. Click "Simulate Compilation" to add one!
                </div>
            } @else {
                <!-- NEW: @for syntax instead of *ngFor -->
                <div class="history-list">
                    @for (item of compilationHistory(); track item.id) {
                        <div class="history-item" [class.success]="item.status === 'success'">
                            <div class="history-icon">
                                @if (item.status === 'success') {
                                    ✅
                                } @else {
                                    ❌
                                }
                            </div>
                            <div class="history-details">
                                <div class="history-title">
                                    Compilation #{{ item.id }}
                                </div>
                                <div class="history-meta">
                                    {{ item.timestamp | date:'short' }} • 
                                    {{ item.urlCount }} URLs • 
                                    {{ item.transformationCount }} transformations
                                </div>
                            </div>
                        </div>
                    }
                </div>
            }
            
            <button class="btn btn-primary mt-2" (click)="simulateCompilation()">
                🚀 Simulate Compilation
            </button>
            
            <div class="code-explanation">
                <pre>@if (condition) {{ '{' }}
  &lt;div&gt;Content when true&lt;/div&gt;
{{ '}' }} @else {{ '{' }}
  &lt;div&gt;Content when false&lt;/div&gt;
{{ '}' }}

@for (item of items(); track item.id) {{ '{' }}
  &lt;div&gt;{{ '{{' }} item.name {{ '}}' }}&lt;/div&gt;
{{ '}' }}</pre>
                <p>
                    Angular's <strong>new control flow syntax</strong> (@if/@for/@switch) is:
                    • More readable than *ngIf/*ngFor
                    • Better type inference
                    • Better performance (no structural directives overhead)
                    • Part of Angular's shift toward signals
                </p>
            </div>
        </div>

        <!-- EFFECT DEMONSTRATION -->
        <div class="form-section">
            <h3>⚡ Side Effects (effect)</h3>
            <div class="alert alert-success">
                <strong>✅ Effect is running!</strong>
                <p style="margin: 8px 0;">
                    An <code>effect()</code> is watching <code>compilationCount</code>.
                    Every time you increment the counter, a message is logged to the console.
                    Open DevTools Console to see it!
                </p>
                <p style="margin: 8px 0; font-size: 14px;">
                    Last effect triggered: <strong>{{ lastEffectTimestamp() }}</strong>
                </p>
            </div>
            <div class="code-explanation">
                <pre>effect(() => {{ '{' }}
  console.log('Count changed:', compilationCount());
  lastEffectTimestamp.set(new Date().toLocaleTimeString());
{{ '}' }});</pre>
                <p>
                    An <strong>effect</strong> runs whenever any signal it reads changes.
                    Use effects for side effects like logging, analytics, localStorage sync, etc.
                    Similar to React's useEffect, but automatic dependency tracking.
                </p>
            </div>
        </div>

        <!-- EDUCATIONAL CONTENT -->
        <div class="alert alert-info">
            <strong>📚 Key Takeaways:</strong>
            <ul style="margin: 8px 0 8px 20px;">
                <li><strong>signal()</strong> - Writable reactive state</li>
                <li><strong>computed()</strong> - Derived values that auto-update</li>
                <li><strong>effect()</strong> - Side effects that run on signal changes</li>
                <li><strong>@if/@for</strong> - New template syntax for better performance</li>
                <li><strong>inject()</strong> - Functional DI (no constructor needed)</li>
            </ul>
        </div>

        <div class="alert alert-info">
            <strong>🔗 Signals vs RxJS:</strong>
            <p style="margin: 8px 0;">
                Signals and RxJS Observables serve different purposes:
            </p>
            <ul style="margin: 8px 0 8px 20px;">
                <li><strong>Signals:</strong> Synchronous state management, simple values</li>
                <li><strong>RxJS:</strong> Asynchronous streams, complex data flows</li>
                <li>Use <code>toSignal()</code> to convert Observable → Signal</li>
                <li>Use <code>toObservable()</code> to convert Signal → Observable</li>
                <li>Both can coexist! Use the right tool for each job.</li>
            </ul>
        </div>
    </div>
    `,
    styles: [`
    /* Component-scoped styles */
    
    .form-section {
        margin-bottom: 30px;
    }
    
    .form-section h3 {
        margin-bottom: 15px;
        color: var(--text-color);
    }
    
    .signal-demo-card {
        background: var(--section-bg);
        padding: 24px;
        border-radius: 8px;
        border: 1px solid var(--border-color);
    }
    
    .counter-display {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 30px;
        background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
        border-radius: 12px;
        margin-bottom: 20px;
    }
    
    .counter-value {
        font-size: 72px;
        font-weight: 700;
        color: white;
        line-height: 1;
    }
    
    .counter-label {
        font-size: 18px;
        color: rgba(255, 255, 255, 0.9);
        margin-top: 8px;
    }
    
    .button-group {
        display: flex;
        gap: 12px;
        margin-bottom: 20px;
        flex-wrap: wrap;
    }
    
    .btn {
        padding: 12px 24px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
    }
    
    .btn-primary {
        background: var(--primary);
        color: white;
    }
    
    .btn-primary:hover {
        background: var(--primary-dark);
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }
    
    .btn-secondary {
        background: var(--section-bg);
        color: var(--text-color);
        border: 1px solid var(--border-color);
    }
    
    .btn-secondary:hover {
        background: var(--button-hover);
    }
    
    .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 16px;
        margin-bottom: 20px;
    }
    
    .stat-card {
        background: var(--section-bg);
        padding: 20px;
        border-radius: 8px;
        border: 1px solid var(--border-color);
        text-align: center;
    }
    
    .stat-label {
        color: var(--text-muted);
        font-size: 12px;
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    
    .stat-value {
        font-size: 28px;
        font-weight: 700;
        color: var(--primary);
    }
    
    .history-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 16px;
    }
    
    .history-item {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 16px;
        background: var(--section-bg);
        border-radius: 8px;
        border: 1px solid var(--border-color);
        transition: all 0.3s ease;
    }
    
    .history-item:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
    }
    
    .history-item.success {
        border-left: 4px solid var(--success);
    }
    
    .history-icon {
        font-size: 24px;
    }
    
    .history-details {
        flex: 1;
    }
    
    .history-title {
        font-weight: 600;
        color: var(--text-color);
        margin-bottom: 4px;
    }
    
    .history-meta {
        font-size: 13px;
        color: var(--text-muted);
    }
    
    .code-explanation {
        background: var(--card-bg);
        padding: 16px;
        border-radius: 6px;
        border: 1px solid var(--border-color);
        margin-top: 16px;
    }
    
    .code-explanation code {
        background: var(--section-bg);
        padding: 4px 8px;
        border-radius: 4px;
        font-family: 'Courier New', monospace;
        font-size: 13px;
        color: var(--primary);
        display: block;
        margin-bottom: 8px;
    }
    
    .code-explanation pre {
        background: var(--section-bg);
        padding: 12px;
        border-radius: 4px;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        color: var(--text-color);
        overflow-x: auto;
        margin-bottom: 8px;
        line-height: 1.5;
    }
    
    .code-explanation p {
        color: var(--text-muted);
        font-size: 14px;
        line-height: 1.6;
        margin: 0;
    }
    
    .mb-2 { margin-bottom: 20px; }
    .mt-2 { margin-top: 20px; }
    
    .alert {
        padding: 16px;
        border-radius: 6px;
        margin-bottom: 20px;
    }
    
    .alert-info {
        background: #dbeafe;
        color: #1e40af;
        border: 1px solid #bfdbfe;
    }
    
    .alert-success {
        background: #d1fae5;
        color: #065f46;
        border: 1px solid #a7f3d0;
    }
    
    .alert code {
        background: rgba(0, 0, 0, 0.1);
        padding: 2px 6px;
        border-radius: 4px;
        font-family: 'Courier New', monospace;
        font-size: 13px;
    }
    
    .alert ul {
        padding-left: 20px;
    }
    
    .alert li {
        margin: 4px 0;
    }
    `],
})
export class SignalsComponent {
    /**
     * SIGNAL: Writable reactive state
     * Pattern: signal() creates a reactive container for a value
     * Read: compilationCount()
     * Write: compilationCount.set(5)
     * Update: compilationCount.update(n => n + 1)
     */
    compilationCount = signal(0);

    /**
     * SIGNAL: Auto-incrementing ID counter (never resets)
     * Separate from compilationCount so IDs remain unique across resets.
     * compilationCount can be reset to 0, but historyIds always grow.
     */
    private nextHistoryId = signal(0);
    
    /**
     * SIGNAL: Compilation history (array of items)
     * Demonstrates that signals can hold any value type
     */
    compilationHistory = signal<CompilationHistoryItem[]>([]);
    
    /**
     * SIGNAL: Last effect timestamp
     * Used to demonstrate effects running
     */
    lastEffectTimestamp = signal('Not triggered yet');
    
    /**
     * COMPUTED: Average URLs per compilation
     * Pattern: computed() creates a derived signal that auto-updates
     * Recalculates only when dependencies change
     */
    averageUrlsPerCompilation = computed(() => {
        const history = this.compilationHistory();
        if (history.length === 0) return 0;
        const totalUrls = history.reduce((sum, item) => sum + item.urlCount, 0);
        return (totalUrls / history.length).toFixed(1);
    });
    
    /**
     * COMPUTED: Success rate percentage
     */
    successRate = computed(() => {
        const history = this.compilationHistory();
        if (history.length === 0) return 100;
        const successCount = history.filter(item => item.status === 'success').length;
        return Math.round((successCount / history.length) * 100);
    });
    
    /**
     * COMPUTED: Compilation status text
     */
    compilationStatus = computed(() => {
        const count = this.compilationCount();
        if (count === 0) return 'Not Started';
        if (count < 5) return 'Getting Started';
        if (count < 10) return 'Active';
        return 'Power User';
    });
    
    /**
     * COMPUTED: Status color
     */
    statusColor = computed(() => {
        const count = this.compilationCount();
        if (count === 0) return '#666';
        if (count < 5) return '#3b82f6';
        if (count < 10) return '#10b981';
        return '#8b5cf6';
    });
    
    /**
     * CONSTRUCTOR: Setup effects
     * Note: We use constructor here to set up effects that should run
     * throughout the component's lifetime. In modern Angular, we could
     * also use inject() for services if needed.
     */
    constructor() {
        /**
         * EFFECT: Runs whenever compilationCount changes
         * Pattern: effect() automatically tracks signal dependencies
         * Runs immediately and whenever any read signal changes
         */
        effect(() => {
            const count = this.compilationCount();
            console.log(`[Angular Signals Effect] Compilation count changed to: ${count}`);
            this.lastEffectTimestamp.set(new Date().toLocaleTimeString());
        });
    }
    
    /**
     * Increment the compilation counter
     * Pattern: signal.update() for functional updates
     */
    incrementCount(): void {
        this.compilationCount.update(count => count + 1);
    }
    
    /**
     * Reset the compilation counter
     * Pattern: signal.set() for direct assignment
     */
    resetCount(): void {
        this.compilationCount.set(0);
        this.compilationHistory.set([]);
    }
    
    /**
     * Simulate a compilation by adding to history
     * Demonstrates updating complex state (arrays) with signals
     */
    simulateCompilation(): void {
        this.nextHistoryId.update(id => id + 1);
        const newItem: CompilationHistoryItem = {
            id: this.nextHistoryId(),
            timestamp: new Date(),
            urlCount: Math.floor(Math.random() * 5) + 1,
            transformationCount: Math.floor(Math.random() * 8) + 3,
            status: Math.random() > 0.2 ? 'success' : 'error',
        };
        
        // SIGNAL UPDATE PATTERN: Immutable array update
        // .update() atomically applies the function to produce the new value
        // Creates a new array immutably by spreading the old array and adding the new item
        this.compilationHistory.update(history => [...history, newItem]);
        this.incrementCount();
    }
}
