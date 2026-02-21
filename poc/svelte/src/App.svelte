<script>
    // =============================================================
    // Svelte 5 Runes — Reactive State
    // $state()    → mutable reactive state (like useState in React)
    // $derived()  → computed values (like computed in Vue / useMemo in React)
    // $effect()   → side effects (like useEffect in React / watchEffect in Vue)
    // =============================================================

    // ---- Router ----
    let currentRoute = $state(window.location.hash || '#/');
    $effect(() => {
        const handler = () => { currentRoute = window.location.hash || '#/'; };
        window.addEventListener('hashchange', handler);
        return () => window.removeEventListener('hashchange', handler);
    });

    function navigate(route) {
        window.location.hash = route;
    }

    // ---- Theme ----
    let darkMode = $state(localStorage.getItem('svelte-poc-theme') === 'dark');
    $effect(() => {
        if (darkMode) {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('svelte-poc-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('svelte-poc-theme', 'light');
        }
    });

    // ---- Compiler Form State ----
    let sources = $state(['']);
    let selectedTransformations = $state(['RemoveComments', 'Deduplicate', 'TrimLines', 'RemoveEmptyLines']);
    let compiling = $state(false);
    let compileResult = $state(null);
    let compileError = $state('');

    const allTransformations = [
        'RemoveComments', 'Compress', 'RemoveModifiers', 'Validate',
        'ValidateAllowIp', 'Deduplicate', 'InvertAllow',
        'RemoveEmptyLines', 'TrimLines', 'InsertFinalNewLine', 'ConvertToAscii',
    ];

    function addSource() { sources = [...sources, '']; }
    function removeSource(i) { sources = sources.filter((_, idx) => idx !== i); }
    function updateSource(i, val) { sources = sources.map((s, idx) => idx === i ? val : s); }

    function toggleTransformation(t) {
        if (selectedTransformations.includes(t)) {
            selectedTransformations = selectedTransformations.filter(x => x !== t);
        } else {
            selectedTransformations = [...selectedTransformations, t];
        }
    }

    async function compile() {
        compiling = true;
        compileResult = null;
        compileError = '';
        try {
            const res = await fetch('/api/compile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    configuration: {
                        name: 'Svelte PoC Compilation',
                        sources: sources.filter(Boolean).map(s => ({ source: s })),
                        transformations: selectedTransformations,
                    },
                    benchmark: true,
                }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            compileResult = await res.json();
        } catch (e) {
            compileError = e.message;
            // Mock fallback for demo
            compileResult = {
                success: true,
                ruleCount: 4217,
                sources: sources.filter(Boolean).length,
                transformations: selectedTransformations,
                benchmark: { duration: '87ms', rulesPerSecond: 48471 },
                isMock: true,
            };
        } finally {
            compiling = false;
        }
    }

    // ---- Benchmark ----
    let benchRunCount = $state(5);
    let benchRunning = $state(false);
    let benchResults = $state([]);
    let benchProgress = $state(0);

    let benchMin = $derived(benchResults.length ? Math.min(...benchResults.map(r => r.ms)) : 0);
    let benchMax = $derived(benchResults.length ? Math.max(...benchResults.map(r => r.ms)) : 0);
    let benchAvg = $derived(benchResults.length ? benchResults.reduce((s, r) => s + r.ms, 0) / benchResults.length : 0);

    async function runBenchmark() {
        benchRunning = true;
        benchResults = [];
        benchProgress = 0;
        for (let i = 0; i < benchRunCount; i++) {
            const t0 = performance.now();
            try {
                await fetch('/api/compile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        configuration: {
                            name: 'Benchmark',
                            sources: [{ source: 'https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt' }],
                            transformations: ['RemoveComments', 'Deduplicate'],
                        },
                    }),
                });
            } catch (_) { /* ignore */ }
            const ms = performance.now() - t0;
            benchResults = [...benchResults, { run: i + 1, ms: Math.round(ms) }];
            benchProgress = Math.round(((i + 1) / benchRunCount) * 100);
        }
        benchRunning = false;
    }

    // ---- Runes Demo State ----
    let demoCounter = $state(0);
    let demoName = $state('World');
    let demoItems = $state(['Alpha', 'Beta', 'Gamma']);
    let newItemText = $state('');

    let demoDoubled = $derived(demoCounter * 2);
    let demoGreeting = $derived(`Hello, ${demoName}! Counter is ${demoCounter}.`);

    let effectLog = $state([]);
    $effect(() => {
        // This effect runs whenever demoCounter changes
        if (demoCounter > 0) {
            effectLog = [`$effect fired: counter=${demoCounter}`, ...effectLog].slice(0, 5);
        }
    });

    function addItem() {
        if (newItemText.trim()) {
            demoItems = [...demoItems, newItemText.trim()];
            newItemText = '';
        }
    }
    function removeItem(i) { demoItems = demoItems.filter((_, idx) => idx !== i); }
</script>

<svelte:head>
    <style>
        :root {
            --bg-gradient-start: #667eea;
            --bg-gradient-end: #764ba2;
            --primary: #667eea;
            --primary-dark: #5568d3;
            --secondary: #764ba2;
            --container-bg: #ffffff;
            --text-color: #333333;
            --text-muted: #666666;
            --border-color: #e0e0e0;
            --input-bg: #ffffff;
            --section-bg: #f8f9fa;
            --card-bg: #ffffff;
            --success: #10b981;
            --danger: #ef4444;
            --warning: #f59e0b;
            --info: #3b82f6;
        }
        [data-theme='dark'] {
            --bg-gradient-start: #1a1a2e;
            --bg-gradient-end: #16213e;
            --container-bg: #1e1e2e;
            --text-color: #e0e0e0;
            --text-muted: #a0a0a0;
            --border-color: #3a3a4a;
            --input-bg: #2a2a3a;
            --section-bg: #252535;
            --card-bg: #2a2a3a;
        }
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, var(--bg-gradient-start) 0%, var(--bg-gradient-end) 100%);
            min-height: 100vh;
            color: var(--text-color);
        }
    </style>
</svelte:head>

<style>
    /* App Shell */
    .app-header {
        background: rgba(255,255,255,0.1);
        backdrop-filter: blur(10px);
        padding: 1rem 2rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: white;
        border-bottom: 1px solid rgba(255,255,255,0.2);
        position: sticky;
        top: 0;
        z-index: 100;
    }
    .app-header h1 { font-size: 1.2rem; font-weight: 700; }
    .header-badge {
        background: rgba(255,255,255,0.25);
        border: 1px solid rgba(255,255,255,0.4);
        color: white;
        padding: 0.2rem 0.6rem;
        border-radius: 12px;
        font-size: 0.72rem;
        font-weight: 600;
        margin-left: 0.5rem;
        vertical-align: middle;
    }
    .header-actions { display: flex; align-items: center; gap: 0.75rem; }
    .theme-btn {
        background: rgba(255,255,255,0.2);
        border: 1px solid rgba(255,255,255,0.3);
        color: white;
        padding: 0.4rem 0.9rem;
        border-radius: 20px;
        cursor: pointer;
        font-size: 0.82rem;
    }
    .theme-btn:hover { background: rgba(255,255,255,0.3); }

    /* Navigation */
    nav {
        background: rgba(255,255,255,0.08);
        backdrop-filter: blur(6px);
        padding: 0 2rem;
        display: flex;
        gap: 0.25rem;
        border-bottom: 1px solid rgba(255,255,255,0.15);
    }
    .nav-link {
        color: rgba(255,255,255,0.75);
        text-decoration: none;
        padding: 0.75rem 1rem;
        font-size: 0.9rem;
        border-bottom: 2px solid transparent;
        transition: all 0.2s;
        cursor: pointer;
        background: none;
        border-top: none;
        border-left: none;
        border-right: none;
        font-family: inherit;
    }
    .nav-link:hover { color: white; }
    .nav-link.active { color: white; border-bottom-color: white; }

    /* Main layout */
    .main { max-width: 860px; margin: 2.5rem auto; padding: 0 1.5rem; }

    /* Page heading */
    .page-heading { color: white; margin-bottom: 1.75rem; }
    .page-heading h2 { font-size: 1.6rem; font-weight: 700; }
    .page-heading p { opacity: 0.8; margin-top: 0.35rem; font-size: 0.95rem; }

    /* Cards */
    .card {
        background: var(--card-bg);
        border-radius: 12px;
        padding: 1.5rem;
        border: 1px solid var(--border-color);
        box-shadow: 0 4px 16px rgba(0,0,0,0.1);
    }
    .cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 1rem;
        margin-bottom: 1.5rem;
    }
    .stat-card {
        background: var(--card-bg);
        border-radius: 10px;
        padding: 1.25rem;
        border: 1px solid var(--border-color);
        text-align: center;
    }
    .stat-icon { font-size: 1.75rem; margin-bottom: 0.5rem; }
    .stat-value { font-size: 1.5rem; font-weight: 700; color: var(--primary); }
    .stat-label { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem; }

    /* Form */
    .form-group { margin-bottom: 1.25rem; }
    .form-label { display: block; font-weight: 600; font-size: 0.9rem; margin-bottom: 0.5rem; color: var(--text-color); }
    .form-input {
        width: 100%;
        padding: 0.6rem 0.9rem;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        background: var(--input-bg);
        color: var(--text-color);
        font-size: 0.9rem;
    }
    .source-row { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; }
    .source-row input { flex: 1; }
    .btn {
        padding: 0.6rem 1.25rem;
        border-radius: 8px;
        border: none;
        cursor: pointer;
        font-size: 0.9rem;
        font-weight: 600;
        transition: opacity 0.2s;
    }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn-primary { background: linear-gradient(135deg, var(--primary), var(--secondary)); color: white; }
    .btn-primary:hover:not(:disabled) { opacity: 0.88; }
    .btn-secondary { background: var(--section-bg); color: var(--text-color); border: 1px solid var(--border-color); }
    .btn-danger { background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; }
    .btn-sm { padding: 0.35rem 0.75rem; font-size: 0.82rem; }
    .transformations-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 0.4rem; }
    .transformation-cb { display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; cursor: pointer; }
    .transformation-cb input { cursor: pointer; }
    .compile-btn { width: 100%; padding: 0.8rem; margin-top: 0.5rem; }

    /* Result / Error */
    .result-box {
        background: var(--section-bg);
        border-radius: 8px;
        padding: 1rem;
        margin-top: 1rem;
        border: 1px solid var(--border-color);
    }
    .result-box h4 { font-size: 0.9rem; font-weight: 700; margin-bottom: 0.5rem; }
    .result-row { display: flex; justify-content: space-between; font-size: 0.85rem; padding: 0.3rem 0; border-bottom: 1px solid var(--border-color); }
    .result-row:last-child { border-bottom: none; }
    .result-val { font-weight: 600; color: var(--primary); }
    .mock-badge { background: #fef3c7; color: #92400e; border-radius: 4px; padding: 0.15rem 0.4rem; font-size: 0.72rem; margin-left: 0.4rem; }
    .error-box { background: #fee2e2; color: #dc2626; border-radius: 8px; padding: 0.75rem 1rem; margin-top: 1rem; font-size: 0.88rem; }

    /* Benchmark */
    .progress-bar-wrap { background: var(--border-color); border-radius: 999px; height: 8px; margin: 0.75rem 0; }
    .progress-bar { background: linear-gradient(90deg, var(--primary), var(--secondary)); height: 8px; border-radius: 999px; transition: width 0.3s; }
    .bench-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 0.75rem; }
    .bench-table th { text-align: left; padding: 0.4rem 0.6rem; background: var(--section-bg); color: var(--text-muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .bench-table td { padding: 0.4rem 0.6rem; border-bottom: 1px solid var(--border-color); }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-top: 1rem; }
    .summary-card { background: var(--section-bg); border-radius: 8px; padding: 0.75rem; text-align: center; border: 1px solid var(--border-color); }
    .summary-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .summary-value { font-size: 1.3rem; font-weight: 700; color: var(--primary); margin-top: 0.25rem; }

    /* Runes demo */
    .rune-section { margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--border-color); }
    .rune-section:last-child { border-bottom: none; }
    .rune-tag {
        display: inline-block;
        background: linear-gradient(135deg, var(--primary), var(--secondary));
        color: white;
        border-radius: 6px;
        padding: 0.2rem 0.55rem;
        font-size: 0.75rem;
        font-weight: 700;
        margin-bottom: 0.5rem;
        font-family: monospace;
    }
    .counter-controls { display: flex; align-items: center; gap: 1rem; margin: 0.75rem 0; }
    .counter-display { font-size: 2rem; font-weight: 700; color: var(--primary); min-width: 3rem; text-align: center; }
    .derived-value { font-size: 0.9rem; color: var(--text-muted); margin-top: 0.35rem; }
    .effect-log { background: var(--section-bg); border-radius: 6px; padding: 0.6rem 0.75rem; font-family: monospace; font-size: 0.8rem; color: var(--text-muted); }
    .item-list { list-style: none; }
    .item-list li { display: flex; justify-content: space-between; align-items: center; padding: 0.35rem 0; border-bottom: 1px solid var(--border-color); font-size: 0.9rem; }
    .item-list li:last-child { border-bottom: none; }
    .add-item-row { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
    .add-item-row input { flex: 1; }

    /* Back link */
    .back-link { display: inline-block; margin-top: 2rem; color: rgba(255,255,255,0.8); text-decoration: none; font-size: 0.85rem; }
    .back-link:hover { color: white; }

    @media (max-width: 600px) {
        .app-header { flex-direction: column; gap: 0.5rem; text-align: center; }
        nav { overflow-x: auto; }
    }
</style>

<!-- ===== APP SHELL ===== -->
<header class="app-header">
    <div>
        <h1>🔥 Svelte PoC <span class="header-badge">Svelte 5 Runes</span></h1>
    </div>
    <div class="header-actions">
        <button class="theme-btn" onclick={() => (darkMode = !darkMode)}>
            {darkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
        </button>
    </div>
</header>

<nav>
    {#each [['#/', 'Home'], ['#/compiler', 'Compiler'], ['#/benchmark', 'Benchmark'], ['#/runes', 'Runes Demo']] as [route, label]}
        <button
            class="nav-link {currentRoute === route ? 'active' : ''}"
            onclick={() => navigate(route)}
        >{label}</button>
    {/each}
</nav>

<main class="main">

    <!-- ===== HOME ===== -->
    {#if currentRoute === '#/' || currentRoute === ''}
        <div class="page-heading">
            <h2>🏠 Svelte 5 Dashboard</h2>
            <p>Demonstrating Svelte 5 runes: $state, $derived, $effect — the compiler-first framework.</p>
        </div>
        <div class="cards-grid">
            <div class="stat-card">
                <div class="stat-icon">🔥</div>
                <div class="stat-value">Svelte 5</div>
                <div class="stat-label">Framework</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">⚡</div>
                <div class="stat-value">Runes</div>
                <div class="stat-label">Reactivity Model</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">🚫</div>
                <div class="stat-value">No VDOM</div>
                <div class="stat-label">Compile-time Opt.</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">📦</div>
                <div class="stat-value">~5 KB</div>
                <div class="stat-label">Runtime Size</div>
            </div>
        </div>
        <div class="card">
            <h3 style="margin-bottom: 0.75rem; font-size: 1.1rem;">About This PoC</h3>
            <p style="color: var(--text-muted); line-height: 1.6; font-size: 0.9rem;">
                This Svelte 5 PoC demonstrates the compiler-first approach to frontend development.
                Unlike React, Vue, or Angular, Svelte compiles your components to vanilla JavaScript at build time —
                there is no virtual DOM and no runtime framework overhead. Svelte 5 introduces
                <strong>runes</strong>: explicit reactive primitives (<code>$state</code>, <code>$derived</code>, <code>$effect</code>)
                that make reactivity transparent and predictable.
            </p>
        </div>

    <!-- ===== COMPILER ===== -->
    {:else if currentRoute === '#/compiler'}
        <div class="page-heading">
            <h2>🔧 Compiler</h2>
            <p>Compile adblock filter lists using the API. State managed with Svelte 5 $state runes.</p>
        </div>
        <div class="card">
            <div class="form-group">
                <div class="form-label">Filter List Sources</div>
                {#each sources as src, i}
                    <div class="source-row">
                        <input
                            class="form-input"
                            type="url"
                            placeholder="https://example.com/filters.txt"
                            value={src}
                            oninput={(e) => updateSource(i, e.target.value)}
                        />
                        {#if sources.length > 1}
                            <button class="btn btn-danger btn-sm" onclick={() => removeSource(i)}>✕</button>
                        {/if}
                    </div>
                {/each}
                <button class="btn btn-secondary btn-sm" onclick={addSource}>+ Add Source</button>
            </div>

            <div class="form-group">
                <div class="form-label">Transformations</div>
                <div class="transformations-grid">
                    {#each allTransformations as t}
                        <label class="transformation-cb">
                            <input
                                type="checkbox"
                                checked={selectedTransformations.includes(t)}
                                onchange={() => toggleTransformation(t)}
                            />
                            {t}
                        </label>
                    {/each}
                </div>
            </div>

            <button class="btn btn-primary compile-btn" onclick={compile} disabled={compiling || sources.every(s => !s.trim())}>
                {compiling ? '⏳ Compiling…' : '🚀 Compile Filter List'}
            </button>

            {#if compileError && !compileResult}
                <div class="error-box">⚠️ {compileError}</div>
            {/if}

            {#if compileResult}
                <div class="result-box">
                    <h4>
                        ✅ Compilation Complete
                        {#if compileResult.isMock}<span class="mock-badge">MOCK DATA</span>{/if}
                    </h4>
                    <div class="result-row"><span>Rules</span><span class="result-val">{compileResult.ruleCount?.toLocaleString()}</span></div>
                    <div class="result-row"><span>Sources</span><span class="result-val">{compileResult.sources}</span></div>
                    {#if compileResult.benchmark}
                        <div class="result-row"><span>Duration</span><span class="result-val">{compileResult.benchmark.duration}</span></div>
                        <div class="result-row"><span>Rules/sec</span><span class="result-val">{compileResult.benchmark.rulesPerSecond?.toLocaleString()}</span></div>
                    {/if}
                </div>
            {/if}
        </div>

    <!-- ===== BENCHMARK ===== -->
    {:else if currentRoute === '#/benchmark'}
        <div class="page-heading">
            <h2>📊 Benchmark</h2>
            <p>Measure compilation API performance. Uses $state and $derived runes for reactive results.</p>
        </div>
        <div class="card">
            <div class="form-group">
                <label class="form-label" for="bench-run-count">Number of Runs</label>
                <input id="bench-run-count" class="form-input" type="number" min="1" max="20" bind:value={benchRunCount} style="width: 120px;" />
            </div>
            <button class="btn btn-primary" onclick={runBenchmark} disabled={benchRunning}>
                {benchRunning ? `⏳ Running… (${benchProgress}%)` : '▶ Run Benchmark'}
            </button>

            {#if benchRunning || benchResults.length}
                <div class="progress-bar-wrap">
                    <div class="progress-bar" style="width: {benchProgress}%"></div>
                </div>
            {/if}

            {#if benchResults.length}
                <table class="bench-table">
                    <thead><tr><th>Run</th><th>Time (ms)</th></tr></thead>
                    <tbody>
                        {#each benchResults as r}
                            <tr><td>#{r.run}</td><td>{r.ms} ms</td></tr>
                        {/each}
                    </tbody>
                </table>

                {#if !benchRunning}
                    <div class="summary-grid">
                        <div class="summary-card">
                            <div class="summary-label">Min</div>
                            <div class="summary-value">{benchMin} ms</div>
                        </div>
                        <div class="summary-card">
                            <div class="summary-label">Avg</div>
                            <div class="summary-value">{Math.round(benchAvg)} ms</div>
                        </div>
                        <div class="summary-card">
                            <div class="summary-label">Max</div>
                            <div class="summary-value">{benchMax} ms</div>
                        </div>
                    </div>
                {/if}
            {/if}
        </div>

    <!-- ===== RUNES DEMO ===== -->
    {:else if currentRoute === '#/runes'}
        <div class="page-heading">
            <h2>⚡ Runes Demo</h2>
            <p>Interactive demonstration of Svelte 5's reactive primitives.</p>
        </div>
        <div class="card">
            <!-- $state -->
            <div class="rune-section">
                <div class="rune-tag">$state()</div>
                <p style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 0.75rem;">
                    Mutable reactive state. Any assignment triggers a DOM update automatically.
                </p>
                <div class="counter-controls">
                    <button class="btn btn-secondary btn-sm" onclick={() => demoCounter--}>−</button>
                    <span class="counter-display">{demoCounter}</span>
                    <button class="btn btn-primary btn-sm" onclick={() => demoCounter++}>+</button>
                    <button class="btn btn-secondary btn-sm" onclick={() => demoCounter = 0}>Reset</button>
                </div>
                <div style="margin-top: 0.5rem; font-size: 0.88rem;">
                    <label style="display: flex; align-items: center; gap: 0.5rem;">
                        <span style="color: var(--text-muted); min-width: 90px;">Your name:</span>
                        <input class="form-input" style="max-width: 220px;" bind:value={demoName} />
                    </label>
                </div>
            </div>

            <!-- $derived -->
            <div class="rune-section">
                <div class="rune-tag">$derived()</div>
                <p style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 0.75rem;">
                    Computed values that automatically update when their dependencies change.
                </p>
                <div class="derived-value">Doubled: <strong>{demoDoubled}</strong></div>
                <div class="derived-value" style="margin-top: 0.4rem;">Greeting: <strong>{demoGreeting}</strong></div>
            </div>

            <!-- $effect -->
            <div class="rune-section">
                <div class="rune-tag">$effect()</div>
                <p style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 0.75rem;">
                    Side effects that run whenever reactive state they read changes. The effect above logs every counter change.
                </p>
                <div class="effect-log">
                    {#if effectLog.length}
                        {#each effectLog as line}<div>{line}</div>{/each}
                    {:else}
                        <span style="opacity:0.5">Increment the counter above to see $effect fire…</span>
                    {/if}
                </div>
            </div>

            <!-- $state with arrays -->
            <div class="rune-section">
                <div class="rune-tag">$state() — arrays</div>
                <p style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 0.75rem;">
                    Svelte 5 tracks array mutations deeply. Reassigning the array triggers updates.
                </p>
                <ul class="item-list">
                    {#each demoItems as item, i}
                        <li>
                            <span>{item}</span>
                            <button class="btn btn-danger btn-sm" onclick={() => removeItem(i)}>✕</button>
                        </li>
                    {/each}
                </ul>
                <div class="add-item-row">
                    <input class="form-input" placeholder="New item…" bind:value={newItemText} onkeydown={(e) => e.key === 'Enter' && addItem()} />
                    <button class="btn btn-primary btn-sm" onclick={addItem}>Add</button>
                </div>
            </div>
        </div>
    {/if}

    <a href="../../poc/index.html" class="back-link">← Back to PoC comparison</a>
</main>
