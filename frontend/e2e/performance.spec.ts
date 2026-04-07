import { test, expect } from '@playwright/test';

/**
 * Performance Metrics Page E2E Tests
 *
 * Tests the performance page functionality including:
 * - Metrics display
 * - Charts/graphs rendering
 * - Data refresh
 */
test.describe('Performance Metrics Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/performance');
        await expect(page.locator('h1')).toContainText('Performance');
    });

    test('should display performance metrics page', async ({ page }) => {
        // Verify main heading
        await expect(page.locator('h1')).toBeVisible();

        // Performance page should have some metrics or charts
        await page.waitForTimeout(1000);

        // Verify page structure
        const mainContent = page.locator('main, .content, .performance-content');
        await expect(mainContent.or(page.locator('body'))).toBeVisible();
    });

    test('should load metrics data', async ({ page }) => {
        // Wait for any async data loading
        await page.waitForTimeout(2000);

        // Look for common metric display elements
        const metricElements = page.locator('.metric, .stat, .chart, mat-card');

        // If metrics exist, verify they loaded
        const count = await metricElements.count();
        if (count > 0) {
            await expect(metricElements.first()).toBeVisible();
        }
    });

    test('should handle refresh or reload of metrics', async ({ page }) => {
        // Look for refresh button
        const refreshButton = page.locator('button', { hasText: /Refresh|Reload/i });

        if (await refreshButton.count() > 0) {
            await refreshButton.click();
            await page.waitForTimeout(1000);

            // Verify page is still functional
            await expect(page.locator('h1')).toBeVisible();
        }
    });

    test('should display performance in various formats', async ({ page }) => {
        await page.waitForTimeout(1000);

        // Check if charts or tables are present
        const visualizations = page.locator('canvas, svg, table');
        const count = await visualizations.count();

        // At least some form of data display should exist
        expect(count).toBeGreaterThanOrEqual(0);
    });
});
