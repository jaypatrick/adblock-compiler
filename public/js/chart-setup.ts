/**
 * Chart.js setup module for Adblock Compiler UI.
 * Imports Chart.js from npm and registers all built-in components so every
 * page that imports this module gets a fully configured Chart constructor.
 *
 * Import this module instead of the CDN script:
 *   <script type="module" src="/js/chart-setup.ts"></script>
 *
 * Chart is exposed on `window.Chart` for inline scripts that reference it
 * by name, preserving backward compatibility with existing page code.
 */

import {
    Chart,
    ArcElement,
    BarElement,
    CategoryScale,
    DoughnutController,
    Filler,
    Legend,
    LinearScale,
    LineController,
    LineElement,
    PieController,
    PointElement,
    TimeScale,
    Title,
    Tooltip,
} from 'chart.js';

// Register all components used across the UI.
Chart.register(
    ArcElement,
    BarElement,
    CategoryScale,
    DoughnutController,
    Filler,
    Legend,
    LinearScale,
    LineController,
    LineElement,
    PieController,
    PointElement,
    TimeScale,
    Title,
    Tooltip,
);

// Expose on window so inline <script> blocks can reference `Chart` directly.
declare global {
    interface Window {
        Chart: typeof Chart;
    }
}

window.Chart = Chart;

export { Chart };
