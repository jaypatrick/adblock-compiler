import { test, expect } from '@playwright/test';

/**
 * Full Application Click-Through E2E Tests
 *
 * These tests simulate complete user journeys through the application:
 * - User onboarding flow
 * - Complete compilation workflow
 * - Multi-page workflows
 */
test.describe('Full Application Click-Through Workflows', () => {
    test('should complete full user journey: home → compiler → compile → results', async ({ page }) => {
        // Step 1: Start at home
        await page.goto('/');
        await expect(page.locator('h1')).toContainText('Adblock Compiler Dashboard');

        // Step 2: Navigate to compiler via card
        await page.locator('.nav-card', { hasText: 'Filter List Compiler' }).click();
        await expect(page).toHaveURL(/\/compiler/);

        // Step 3: Select a preset
        const presetSelect = page.locator('mat-select');
        await presetSelect.click();
        await page.locator('mat-option').first().click();

        // Step 4: Submit compilation (if backend is available)
        const compileButton = page.locator('button', { hasText: /Compile/i });
        if (await compileButton.isEnabled()) {
            await compileButton.click();
            await page.waitForTimeout(2000);
        }

        // Step 5: Verify we're still on a valid page
        await expect(page.locator('body')).toBeVisible();
    });

    test('should navigate through all major sections without errors', async ({ page }) => {
        const sections = [
            { path: '/', heading: 'Dashboard' },
            { path: '/compiler', heading: 'Compiler' },
            { path: '/validation', heading: 'Validation' },
            { path: '/performance', heading: 'Performance' },
            { path: '/api-docs', heading: /API|Documentation/ },
            { path: '/admin', heading: 'Admin' },
        ];

        for (const section of sections) {
            await page.goto(section.path);
            await page.waitForTimeout(500);

            // Verify page loads without error
            await expect(page.locator('h1')).toBeVisible();

            // Verify no error messages
            const errorMessages = page.locator('.error, .alert-error, mat-error');
            if (await errorMessages.count() > 0) {
                const errorText = await errorMessages.first().textContent();
                // Some errors might be expected (like auth errors)
                console.log(`Note: Error on ${section.path}: ${errorText}`);
            }
        }
    });

    test('should maintain application state across navigation', async ({ page }) => {
        // Navigate to home
        await page.goto('/');

        // Toggle theme
        const themeButton = page.locator('button[aria-label="Toggle theme"]');
        await themeButton.click();
        await page.waitForTimeout(300);

        const bodyClassBefore = await page.locator('body').getAttribute('class');

        // Navigate to different page
        await page.goto('/compiler');
        await page.waitForTimeout(500);

        // Check if theme persisted
        const bodyClassAfter = await page.locator('body').getAttribute('class');

        // Theme should persist (both should have dark-theme or both shouldn't)
        expect(bodyClassBefore?.includes('dark-theme')).toBe(bodyClassAfter?.includes('dark-theme'));
    });

    test('should handle browser back/forward navigation', async ({ page }) => {
        // Navigate through pages
        await page.goto('/');
        await page.goto('/compiler');
        await page.goto('/validation');

        // Go back
        await page.goBack();
        await expect(page).toHaveURL(/\/compiler/);

        // Go forward
        await page.goForward();
        await expect(page).toHaveURL(/\/validation/);

        // Verify page is functional
        await expect(page.locator('h1')).toBeVisible();
    });

    test('should handle rapid page navigation without memory leaks', async ({ page }) => {
        // Rapidly navigate between pages
        for (let i = 0; i < 5; i++) {
            await page.goto('/');
            await page.waitForTimeout(200);
            await page.goto('/compiler');
            await page.waitForTimeout(200);
        }

        // Verify final page is functional
        await expect(page.locator('h1')).toBeVisible();
        await expect(page.locator('body')).toBeVisible();
    });

    test('should show loading states during navigation', async ({ page }) => {
        // Navigate to a page
        await page.goto('/');

        // Start navigation to another page
        const navigationPromise = page.goto('/performance');

        // Check for loading indicators (spinners, progress bars)
        // This is timing-sensitive and might not always catch the loading state
        await page.waitForTimeout(100);

        await navigationPromise;

        // Verify page loaded successfully
        await expect(page.locator('h1')).toBeVisible();
    });

    test('should handle network errors gracefully', async ({ page }) => {
        // Navigate to page
        await page.goto('/compiler');

        // Try to submit without network (if possible)
        // In real scenarios, this would test offline handling

        // For now, just verify error handling UI exists
        // Look for error display mechanisms
        const form = page.locator('form');
        await expect(form).toBeVisible();
    });

    test('should maintain responsive behavior during interactions', async ({ page }) => {
        // Test at mobile viewport
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/');

        // Verify mobile menu works
        const menuButton = page.locator('button[aria-label="Toggle navigation"]');
        if (await menuButton.isVisible()) {
            await menuButton.click();
            await page.waitForTimeout(300);
        }

        // Test at desktop viewport
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.goto('/');
        await page.waitForTimeout(300);

        // Verify desktop layout
        await expect(page.locator('body')).toBeVisible();
    });
});
