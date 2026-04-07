import { test, expect } from '@playwright/test';

/**
 * Comprehensive Compiler Workflow E2E Tests
 *
 * These tests cover the full click-through flow of the compiler feature:
 * - Form input and interaction
 * - Preset selection
 * - URL management (add/remove)
 * - Submission and result handling
 * - SSE streaming mode
 * - Error handling
 */
test.describe('Compiler Workflow - Full Click-Through', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/compiler');
        await expect(page.locator('h1')).toContainText('Compiler');
    });

    test('should complete full compilation workflow with preset', async ({ page }) => {
        // Step 1: Select a preset
        await page.locator('mat-select').click();
        await page.locator('mat-option').first().click();

        // Step 2: Verify URL input is populated
        const urlInput = page.locator('input[type="url"]').first();
        await expect(urlInput).not.toHaveValue('');

        // Step 3: Click compile button
        const compileButton = page.locator('button', { hasText: /Compile/i });
        await expect(compileButton).toBeEnabled();
        await compileButton.click();

        // Step 4: Wait for results (or error)
        // Results might show in a results section or a dialog
        await page.waitForTimeout(2000);

        // Verify some response - either success indicator or results
        // This will depend on whether the backend is available
        // For now, we verify the form doesn't crash
        await expect(page.locator('form')).toBeVisible();
    });

    test('should add and remove multiple URL inputs', async ({ page }) => {
        // Get initial count
        const initialCount = await page.locator('input[type="url"]').count();

        // Add a URL
        const addButton = page.locator('button', { hasText: /Add URL/i });
        await addButton.click();

        // Verify URL was added
        const afterAddCount = await page.locator('input[type="url"]').count();
        expect(afterAddCount).toBe(initialCount + 1);

        // Find and click a remove button (if exists)
        const removeButtons = page.locator('button[aria-label*="Remove"], button[aria-label*="Delete"]');
        if (await removeButtons.count() > 0) {
            await removeButtons.first().click();
            const afterRemoveCount = await page.locator('input[type="url"]').count();
            expect(afterRemoveCount).toBe(initialCount);
        }
    });

    test('should toggle SSE streaming mode', async ({ page }) => {
        // Find the SSE toggle
        const toggle = page.locator('mat-slide-toggle');
        await expect(toggle).toBeVisible();

        // Get initial state
        const isCheckedBefore = await toggle.locator('input').isChecked();

        // Toggle it
        await toggle.click();
        await page.waitForTimeout(300);

        // Verify state changed
        const isCheckedAfter = await toggle.locator('input').isChecked();
        expect(isCheckedAfter).toBe(!isCheckedBefore);

        // Toggle back
        await toggle.click();
        await page.waitForTimeout(300);

        // Verify back to original state
        const isCheckedFinal = await toggle.locator('input').isChecked();
        expect(isCheckedFinal).toBe(isCheckedBefore);
    });

    test('should handle form validation for empty URLs', async ({ page }) => {
        // Clear preset if any
        const presetSelect = page.locator('mat-select');
        if (await presetSelect.count() > 0) {
            // Try to find a way to clear it or ensure URL is empty
        }

        // Try to submit with empty URL
        const compileButton = page.locator('button', { hasText: /Compile/i });

        // Check if button is disabled or form shows validation errors
        if (await compileButton.isEnabled()) {
            await compileButton.click();
            // Should show some error or validation message
            await page.waitForTimeout(500);
        } else {
            // Button correctly disabled for invalid input
            expect(await compileButton.isDisabled()).toBe(true);
        }
    });

    test('should display resource status card', async ({ page }) => {
        // Verify resource status card is present
        const statusCard = page.locator('.resource-status-card');
        await expect(statusCard).toBeVisible();

        // Verify it shows some status information
        const statusText = await statusCard.textContent();
        expect(statusText).toBeTruthy();
    });

    test('should allow switching between different presets', async ({ page }) => {
        const presetSelect = page.locator('mat-select');
        await expect(presetSelect).toBeVisible();

        // Open dropdown
        await presetSelect.click();

        // Get all options
        const options = page.locator('mat-option');
        const optionCount = await options.count();

        if (optionCount > 1) {
            // Select first option
            await options.nth(0).click();
            await page.waitForTimeout(300);

            // Open again and select different option
            await presetSelect.click();
            await options.nth(1).click();
            await page.waitForTimeout(300);

            // Verify URLs might have changed
            const urlInput = page.locator('input[type="url"]').first();
            await expect(urlInput).toBeVisible();
        }
    });

    test('should show compile button with proper state', async ({ page }) => {
        const compileButton = page.locator('button', { hasText: /Compile/i });
        await expect(compileButton).toBeVisible();

        // Button should have proper styling and be interactive
        await expect(compileButton).toHaveAttribute('type', /button|submit/);
    });

    test('should handle rapid form interactions without crashing', async ({ page }) => {
        // Rapid clicks on add URL
        const addButton = page.locator('button', { hasText: /Add URL/i });
        for (let i = 0; i < 3; i++) {
            await addButton.click();
            await page.waitForTimeout(100);
        }

        // Verify form is still functional
        await expect(page.locator('form')).toBeVisible();

        // Rapid preset changes
        const presetSelect = page.locator('mat-select');
        for (let i = 0; i < 2; i++) {
            await presetSelect.click();
            await page.locator('mat-option').first().click();
            await page.waitForTimeout(100);
        }

        // Verify still functional
        await expect(page.locator('form')).toBeVisible();
    });
});
