/* global mermaid */
(function () {
    'use strict';

    /** Map an mdBook theme name to Mermaid theme + high-contrast variables. */
    function buildMermaidConfig(mdBookTheme) {
        var theme = mdBookTheme || 'coal';
        var isLight = theme === 'light' || theme === 'rust';

        if (isLight) {
            return {
                theme: 'default',
                themeVariables: {
                    background:          '#FFFFFF',
                    primaryColor:        '#CC4400',
                    primaryTextColor:    '#0F172A',
                    primaryBorderColor:  '#FF5500',
                    lineColor:           '#475569',
                    edgeLabelBackground: '#F8FAFC',
                    nodeTextColor:       '#0F172A',
                    textColor:           '#0F172A',
                    titleColor:          '#0F172A',
                    mainBkg:             '#FFFFFF',
                    nodeBorder:          '#CC4400',
                    clusterBkg:          '#F8FAFC',
                    clusterBorder:       '#E2E8F0',
                    labelBackground:     '#FFFFFF',
                    /* sequence */
                    actorBkg:            '#F8FAFC',
                    actorBorder:         '#CC4400',
                    actorTextColor:      '#0F172A',
                    actorLineColor:      '#475569',
                    signalColor:         '#CC4400',
                    signalTextColor:     '#0F172A',
                    noteBkgColor:        '#FFF3CD',
                    noteTextColor:       '#0F172A',
                    noteBorderColor:     '#CC4400',
                    /* ER / class fill types */
                    fillType0: '#FFFFFF',
                    fillType1: '#F8FAFC',
                    fillType2: '#FFFFFF',
                    fillType3: '#F8FAFC',
                    fillType4: '#FFFFFF',
                    fillType5: '#F8FAFC',
                    fillType6: '#FFFFFF',
                    fillType7: '#F8FAFC',
                },
            };
        }

        /* Resolve per-theme surface/elevated palette values. */
        var surface, elevated, border;
        if (theme === 'navy') {
            surface  = '#0A1122';
            elevated = '#0F1A30';
            border   = '#162240';
        } else if (theme === 'ayu') {
            surface  = '#0F1217';
            elevated = '#15191F';
            border   = '#1E2535';
        } else {
            /* coal + html fallback */
            surface  = '#0D0D0D';
            elevated = '#141414';
            border   = '#1A1A1A';
        }

        return {
            theme: 'dark',
            themeVariables: {
                background:          surface,
                primaryColor:        '#FF5500',
                primaryTextColor:    '#F1F5F9',
                primaryBorderColor:  '#FF7033',
                lineColor:           '#94A3B8',
                edgeLabelBackground: elevated,
                nodeTextColor:       '#F1F5F9',
                textColor:           '#F1F5F9',
                titleColor:          '#FF5500',
                mainBkg:             surface,
                nodeBorder:          border,
                clusterBkg:          elevated,
                clusterBorder:       border,
                labelBackground:     surface,
                /* sequence */
                actorBkg:            surface,
                actorBorder:         '#FF5500',
                actorTextColor:      '#F1F5F9',
                actorLineColor:      '#94A3B8',
                signalColor:         '#00D4FF',
                signalTextColor:     '#F1F5F9',
                noteBkgColor:        elevated,
                noteTextColor:       '#F1F5F9',
                noteBorderColor:     border,
                /* ER / class fill types — alternate surface / elevated */
                fillType0: surface,
                fillType1: elevated,
                fillType2: surface,
                fillType3: elevated,
                fillType4: surface,
                fillType5: elevated,
                fillType6: surface,
                fillType7: elevated,
            },
        };
    }

    /** Read current mdBook theme from localStorage. */
    function getCurrentTheme() {
        try {
            return localStorage.getItem('mdbook-theme') || 'coal';
        } catch (_e) {
            console.warn('Failed to read mdbook-theme from localStorage:', _e);
            return 'coal';
        }
    }

    /** Snapshot raw diagram source from every .mermaid element (once). */
    function snapshotSources() {
        var diagrams = document.querySelectorAll('.mermaid');
        for (var i = 0; i < diagrams.length; i++) {
            var el = diagrams[i];
            if (!el.hasAttribute('data-original')) {
                el.setAttribute('data-original', el.textContent || '');
            }
        }
    }

    /** Restore raw source and clear processed flag so Mermaid re-renders. */
    function resetDiagrams() {
        var diagrams = document.querySelectorAll('.mermaid');
        for (var i = 0; i < diagrams.length; i++) {
            var el = diagrams[i];
            var original = el.getAttribute('data-original');
            if (original !== null) {
                el.textContent = original;
            }
            el.removeAttribute('data-processed');
        }
    }

    /** Re-initialise Mermaid with the current theme and re-render all diagrams. */
    function reinit() {
        var config = buildMermaidConfig(getCurrentTheme());
        config.startOnLoad = false;
        mermaid.initialize(config);
        resetDiagrams();
        try {
            mermaid.init(undefined, '.mermaid');
        } catch (_e) {
            console.warn('Mermaid render failed:', _e);
        }
    }

    /** First-time render after the DOM is ready. */
    function firstRender() {
        snapshotSources();
        reinit();
    }

    /* ── Bootstrap ─────────────────────────────────────────────── */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', firstRender);
    } else {
        firstRender();
    }

    /* ── Theme change listeners ────────────────────────────────── */

    /* Cross-tab: localStorage 'mdbook-theme' key changed. */
    window.addEventListener('storage', function (e) {
        if (e.key === 'mdbook-theme') {
            reinit();
        }
    });

    /* Same-tab: mdBook adds the theme name as a class on <html>. */
    var observer = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].attributeName === 'class') {
                reinit();
                break;
            }
        }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}());
