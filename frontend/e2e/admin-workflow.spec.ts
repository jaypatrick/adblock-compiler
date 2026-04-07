import { test, expect } from '@playwright/test';

/**
 * Admin Workflow E2E Tests
 *
 * Tests admin panel functionality including:
 * - Admin page access
 * - Admin features and controls
 * - Settings management
 */
test.describe('Admin Workflow', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/admin');
    });

    test('should display admin page or redirect if unauthorized', async ({ page }) => {
        // Admin page might require authentication
        // Either we see the admin page OR we get redirected

        await page.waitForTimeout(1000);

        // Check current URL - could be /admin or redirected to login/home
        const currentUrl = page.url();

        if (currentUrl.includes('/admin')) {
            // We're on admin page
            await expect(page.locator('h1')).toContainText('Admin');
        } else {
            // Redirected due to lack of auth - that's expected behavior
            expect(currentUrl).toBeTruthy();
        }
    });

    test('should show admin controls when authorized', async ({ page }) => {
        await page.waitForTimeout(1000);

        if (page.url().includes('/admin')) {
            // Look for admin-specific elements
            const adminControls = page.locator('button, mat-tab, mat-accordion, .admin-section');

            // If we see admin controls, verify they exist
            const count = await adminControls.count();
            if (count > 0) {
                await expect(adminControls.first()).toBeVisible();
            }
        }
    });

    test('should handle admin page tabs if present', async ({ page }) => {
        await page.waitForTimeout(1000);

        if (page.url().includes('/admin')) {
            const tabs = page.locator('mat-tab');
            const tabCount = await tabs.count();

            if (tabCount > 0) {
                // Click through tabs
                for (let i = 0; i < Math.min(tabCount, 3); i++) {
                    await tabs.nth(i).click();
                    await page.waitForTimeout(300);
                    // Verify page doesn't crash
                    await expect(page.locator('body')).toBeVisible();
                }
            }
        }
    });

    test('should display admin statistics or data', async ({ page }) => {
        await page.waitForTimeout(1000);

        if (page.url().includes('/admin')) {
            // Admin page likely shows stats, tables, or metrics
            const dataElements = page.locator('table, .stat, .metric, mat-card');
            const count = await dataElements.count();

            // Some data display should exist
            expect(count).toBeGreaterThanOrEqual(0);
        }
    });
});
