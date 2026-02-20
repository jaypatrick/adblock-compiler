/**
 * Theme management module for Adblock Compiler UI.
 * Handles dark/light mode toggle with localStorage persistence.
 *
 * Import this module with:
 *   <script type="module" src="/js/theme.ts"></script>
 */

const STORAGE_KEY = 'adblock-compiler-theme';
const DARK_THEME = 'dark';
const LIGHT_THEME = 'light';

type Theme = typeof DARK_THEME | typeof LIGHT_THEME;

/** Return the stored theme or detect from system preference. */
function getStoredTheme(): Theme {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === DARK_THEME || stored === LIGHT_THEME) {
        return stored;
    }
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        return DARK_THEME;
    }
    return LIGHT_THEME;
}

/** Apply a theme to the document root. */
function applyTheme(theme: Theme): void {
    document.documentElement.setAttribute('data-theme', theme);
    updateToggleButton(theme);
}

/** Sync the toggle button icon/label with the active theme. */
function updateToggleButton(theme: Theme): void {
    const iconEl = document.getElementById('theme-icon');
    const labelEl = document.getElementById('theme-label');
    if (iconEl) iconEl.textContent = theme === DARK_THEME ? '☀️' : '🌙';
    if (labelEl) labelEl.textContent = theme === DARK_THEME ? 'Light Mode' : 'Dark Mode';
}

/** Toggle between light and dark themes. */
export function toggleTheme(): void {
    const current = (document.documentElement.getAttribute('data-theme') as Theme | null) ?? LIGHT_THEME;
    const next: Theme = current === DARK_THEME ? LIGHT_THEME : DARK_THEME;
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
}

/** Return the currently active theme. */
export function getTheme(): Theme {
    return getStoredTheme();
}

/** Programmatically set and persist a theme. */
export function setTheme(theme: Theme): void {
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme(theme);
}

/** Return HTML markup for a theme toggle button. */
export function createThemeToggleHTML(): string {
    return `
        <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme">
            <span class="theme-toggle-icon" id="theme-icon">🌙</span>
            <span class="theme-toggle-label" id="theme-label">Dark Mode</span>
        </button>
    `;
}

/** Initialise theme on page load and wire up the toggle button. */
function initTheme(): void {
    applyTheme(getStoredTheme());

    document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        // Only follow the system preference when the user hasn't set an explicit choice.
        if (!localStorage.getItem(STORAGE_KEY)) {
            applyTheme(e.matches ? DARK_THEME : LIGHT_THEME);
        }
    });
}

// Initialise as soon as the module is evaluated.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
} else {
    initTheme();
}

// Expose on window for pages that rely on the legacy AdblockTheme global.
declare global {
    interface Window {
        AdblockTheme: {
            toggle: typeof toggleTheme;
            get: typeof getTheme;
            set: typeof setTheme;
            createToggleHTML: typeof createThemeToggleHTML;
        };
    }
}

window.AdblockTheme = {
    toggle: toggleTheme,
    get: getTheme,
    set: setTheme,
    createToggleHTML: createThemeToggleHTML,
};
