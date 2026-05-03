import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration
 *
 * Comprehensive configuration for click-through testing of the Adblock Compiler frontend.
 * Tests run against local dev server (http://localhost:4200) by default.
 *
 * Usage:
 *   pnpm --filter bloqr-frontend run test:e2e           # Run all tests
 *   pnpm --filter bloqr-frontend run test:e2e:headed    # Run with visible browser
 *   pnpm --filter bloqr-frontend run test:e2e:ui        # Run with interactive UI
 *   pnpm --filter bloqr-frontend run test:e2e:debug     # Run with debugger
 */
export default defineConfig({
    testDir: '.',
    timeout: 30000,
    expect: { timeout: 5000 },
    fullyParallel: true,
    forbidOnly: !!process.env['CI'],
    retries: process.env['CI'] ? 2 : 0,
    workers: process.env['CI'] ? 1 : undefined,
    reporter: process.env['CI'] ? 'github' : 'html',
    use: {
        baseURL: process.env['BASE_URL'] || 'http://localhost:4200',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        // Uncomment to test on additional browsers
        // {
        //     name: 'firefox',
        //     use: { ...devices['Desktop Firefox'] },
        // },
        // {
        //     name: 'webkit',
        //     use: { ...devices['Desktop Safari'] },
        // },
        // {
        //     name: 'mobile-chrome',
        //     use: { ...devices['Pixel 5'] },
        // },
        // {
        //     name: 'mobile-safari',
        //     use: { ...devices['iPhone 13'] },
        // },
    ],
    webServer: {
        command: 'npm start',
        url: 'http://localhost:4200',
        reuseExistingServer: !process.env['CI'],
        cwd: '..',
        timeout: 120000,
    },
});
