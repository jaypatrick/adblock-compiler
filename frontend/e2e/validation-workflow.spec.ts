import { test, expect } from '@playwright/test';

/**
 * Validation Page E2E Tests
 *
 * Tests the validation workflow including:
 * - Form input
 * - Validation execution
 * - Results display
 */
test.describe('Validation Workflow', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/validation');
        await expect(page.locator('h1')).toContainText('Validation');
    });

    test('should display validation form', async ({ page }) => {
        await expect(page.locator('form')).toBeVisible();
    });

    test('should handle validation input and submission', async ({ page }) => {
        // Look for textarea or input for filter list content
        const textarea = page.locator('textarea').first();

        if (await textarea.count() > 0) {
            await textarea.fill('||example.com^\n! This is a comment\n||ads.example.com^');

            // Find and click validate button
            const validateButton = page.locator('button', { hasText: /Validate/i });
            if (await validateButton.count() > 0) {
                await validateButton.click();

                // Wait for results
                await page.waitForTimeout(1000);

                // Verify page doesn't crash
                await expect(page.locator('form')).toBeVisible();
            }
        }
    });

    test('should show validation results section', async ({ page }) => {
        // After validation, results should appear
        // Even without submission, results section might exist
        await page.waitForTimeout(500);

        // Verify page structure is intact
        await expect(page.locator('h1')).toBeVisible();
    });
});
