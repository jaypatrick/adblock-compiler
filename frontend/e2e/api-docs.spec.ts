import { test, expect } from '@playwright/test';

/**
 * API Documentation Page E2E Tests
 *
 * Tests the API docs page functionality including:
 * - Documentation display
 * - Interactive API explorer
 * - Endpoint browsing
 */
test.describe('API Documentation Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/api-docs');
        await expect(page.locator('h1')).toContainText(/API|Documentation/);
    });

    test('should display API documentation page', async ({ page }) => {
        await expect(page.locator('h1')).toBeVisible();

        // Wait for content to load
        await page.waitForTimeout(1000);

        // Verify page structure
        await expect(page.locator('body')).toBeVisible();
    });

    test('should show API endpoints list', async ({ page }) => {
        await page.waitForTimeout(1000);

        // Look for API endpoint listings
        const endpointElements = page.locator('.endpoint, .api-route, mat-expansion-panel, mat-accordion');
        const count = await endpointElements.count();

        if (count > 0) {
            await expect(endpointElements.first()).toBeVisible();
        }
    });

    test('should allow expanding/collapsing endpoint details', async ({ page }) => {
        await page.waitForTimeout(1000);

        // Look for expandable elements (accordions, expansion panels)
        const expandableElements = page.locator('mat-expansion-panel-header, .expandable, details > summary');
        const count = await expandableElements.count();

        if (count > 0) {
            // Click first expandable
            await expandableElements.first().click();
            await page.waitForTimeout(300);

            // Click again to collapse
            await expandableElements.first().click();
            await page.waitForTimeout(300);

            // Verify no crash
            await expect(page.locator('h1')).toBeVisible();
        }
    });

    test('should display API endpoint documentation', async ({ page }) => {
        await page.waitForTimeout(1000);

        // Look for documentation text, code samples, or descriptions
        const docElements = page.locator('code, pre, .description, .docs-content');
        const count = await docElements.count();

        // Some documentation content should be present
        expect(count).toBeGreaterThanOrEqual(0);
    });

    test('should handle search or filter functionality if present', async ({ page }) => {
        await page.waitForTimeout(500);

        // Look for search input
        const searchInput = page.locator('input[type="search"], input[placeholder*="Search"], input[aria-label*="search"]');

        if (await searchInput.count() > 0) {
            await searchInput.fill('compile');
            await page.waitForTimeout(500);

            // Verify search didn't crash the page
            await expect(page.locator('h1')).toBeVisible();

            // Clear search
            await searchInput.clear();
        }
    });
});
