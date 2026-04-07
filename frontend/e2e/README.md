# Playwright E2E Click-Through Testing Suite

Comprehensive end-to-end testing suite for the Adblock Compiler frontend using Playwright. These tests validate core user flows, interactions, and regression detection.

## 🎯 Overview

This test suite provides:

- **Full click-through workflows** - Complete user journeys from home → compiler → results
- **Comprehensive page coverage** - All major sections tested (Home, Compiler, Validation, Performance, Admin, API Docs)
- **Form interaction tests** - Input validation, submission, and error handling
- **Navigation flows** - Multi-page workflows and browser history handling
- **Responsive behavior** - Mobile and desktop viewport testing
- **State persistence** - Theme settings and app state across navigation
- **Error handling** - Graceful degradation and error message validation

## 🚀 Quick Start

### Prerequisites

Ensure you have the following installed:

```bash
# Node.js and pnpm (handled by root package.json)
# Playwright browsers
pnpm --filter adblock-frontend exec playwright install
```

### Running Tests Locally

```bash
# Run all E2E tests
pnpm --filter adblock-frontend run test:e2e

# Run with UI mode (interactive debugging)
pnpm --filter adblock-frontend exec playwright test --config=e2e/playwright.config.ts --ui

# Run specific test file
pnpm --filter adblock-frontend exec playwright test e2e/compiler-workflow.spec.ts

# Run tests in headed mode (see browser)
pnpm --filter adblock-frontend exec playwright test --config=e2e/playwright.config.ts --headed

# Run tests with debugging
pnpm --filter adblock-frontend exec playwright test --config=e2e/playwright.config.ts --debug
```

### Start Development Server

Tests require the frontend dev server to be running:

```bash
# Terminal 1: Start frontend dev server
pnpm --filter adblock-frontend run start
# Server runs on http://localhost:4200

# Terminal 2: Run E2E tests
pnpm --filter adblock-frontend run test:e2e
```

For full-stack testing (with backend API):

```bash
# Terminal 1: Start Worker API
deno task wrangler:dev
# API runs on http://localhost:8787

# Terminal 2: Start frontend (proxies API)
pnpm --filter adblock-frontend run start
# Frontend runs on http://localhost:4200, proxies /api to :8787

# Terminal 3: Run E2E tests
pnpm --filter adblock-frontend run test:e2e
```

## 📋 Test Files

### Core Workflow Tests

#### `home.spec.ts`
- Dashboard display and navigation cards
- System status sections
- Stat cards with skeleton states
- Navigation to other pages

#### `compiler-workflow.spec.ts`
**Comprehensive compilation workflow tests:**
- Full compilation flow: preset selection → form input → submit → results
- URL input management (add/remove)
- SSE streaming mode toggle
- Form validation for empty URLs
- Resource status card display
- Preset switching functionality
- Compile button state management
- Rapid interaction handling

#### `validation-workflow.spec.ts`
- Validation form display
- Filter list input and submission
- Validation results rendering

#### `performance.spec.ts`
- Performance metrics display
- Charts and visualizations
- Metrics refresh functionality
- Data loading states

#### `admin-workflow.spec.ts`
- Admin page access control
- Admin controls and tabs
- Statistics and data display
- Authorization redirects

#### `api-docs.spec.ts`
- API documentation display
- Endpoint listings
- Expandable/collapsible details
- Documentation search/filter

#### `navigation.spec.ts`
- Sidenav navigation through all routes
- Page title validation (WCAG 2.4.2 compliance)
- Theme toggle functionality
- Sidenav toggle behavior
- Wildcard route handling

#### `full-workflows.spec.ts`
**Complete application workflows:**
- Full user journey: home → compiler → compile → results
- Multi-section navigation without errors
- Application state persistence across navigation
- Browser back/forward navigation
- Rapid page navigation handling
- Loading states during navigation
- Network error handling
- Responsive behavior (mobile/desktop)

## 🧪 Test Patterns

### Test Structure

Each test follows this pattern:

```typescript
test.describe('Feature Name', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to page
        await page.goto('/path');
        // Verify page loaded
        await expect(page.locator('h1')).toContainText('Expected Title');
    });

    test('should perform specific action', async ({ page }) => {
        // Test implementation
    });
});
```

### Key Testing Strategies

1. **Graceful Degradation**: Tests account for missing backend/API
2. **Conditional Checks**: Use `.count()` to check element existence before interaction
3. **Wait Strategies**: `waitForTimeout()` for animations, `waitForSelector()` for dynamic content
4. **State Verification**: Always verify page stability after interactions
5. **Error Tolerance**: Expect some features may not be available without auth/backend

### Example: Conditional Element Interaction

```typescript
// Check if element exists before interacting
const refreshButton = page.locator('button', { hasText: /Refresh/i });
if (await refreshButton.count() > 0) {
    await refreshButton.click();
    await page.waitForTimeout(1000);
}
```

## 🔧 Configuration

### Playwright Config (`frontend/e2e/playwright.config.ts`)

```typescript
export default defineConfig({
    testDir: '.',
    timeout: 30000,
    expect: { timeout: 5000 },
    fullyParallel: true,
    forbidOnly: !!process.env['CI'],
    retries: process.env['CI'] ? 2 : 0,
    workers: process.env['CI'] ? 1 : undefined,
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:4200',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: 'npm start',
        url: 'http://localhost:4200',
        reuseExistingServer: !process.env['CI'],
        cwd: '..',
    },
});
```

### Key Configuration Options

- **timeout**: 30 seconds per test (can handle slow APIs)
- **fullyParallel**: Tests run in parallel for speed
- **trace**: Captures trace on first retry for debugging
- **baseURL**: All `page.goto()` calls relative to this
- **webServer**: Automatically starts dev server if not running

## 🎨 Test Scenarios

### Compiler Workflow

```
User Flow:
1. Navigate to /compiler
2. Select preset from dropdown
3. Verify URL auto-populated
4. Click "Compile" button
5. Wait for results or error
6. Verify page remains functional
```

### Full Application Journey

```
Complete User Journey:
1. Start at home (/)
2. Click "Filter List Compiler" card
3. Navigate to /compiler
4. Select a preset
5. Submit compilation
6. View results
7. Verify no errors
```

### Navigation State Persistence

```
State Persistence:
1. Toggle dark theme on home page
2. Navigate to /compiler
3. Verify theme persists
4. Navigate to /validation
5. Verify theme still persists
```

## 📊 Running in Different Modes

### Interactive UI Mode (Recommended for Development)

```bash
pnpm --filter adblock-frontend exec playwright test --ui
```

Benefits:
- Visual test runner
- Time travel debugging
- Watch mode for file changes
- Pick and choose tests to run

### Headed Mode (Watch Tests Execute)

```bash
pnpm --filter adblock-frontend exec playwright test --headed
```

See the actual browser window and watch tests execute.

### Debug Mode

```bash
pnpm --filter adblock-frontend exec playwright test --debug
```

Opens Playwright Inspector for step-by-step debugging.

### Generate Test Code

```bash
pnpm --filter adblock-frontend exec playwright codegen http://localhost:4200
```

Opens browser and records your actions as test code.

## 🐛 Debugging Failed Tests

### View Test Report

After running tests, view the HTML report:

```bash
pnpm --filter adblock-frontend exec playwright show-report
```

### Trace Viewer

If a test fails on retry, trace is automatically captured:

```bash
pnpm --filter adblock-frontend exec playwright show-trace trace.zip
```

### Common Issues

#### Issue: "Target page, context or browser has been closed"

**Cause**: Test timeout or navigation issue

**Solution**:
```typescript
// Increase timeout for specific test
test('long-running test', async ({ page }) => {
    test.setTimeout(60000); // 60 seconds
    // test code
});
```

#### Issue: "Element not found"

**Cause**: Element not rendered yet or selector incorrect

**Solution**:
```typescript
// Wait for element
await page.waitForSelector('selector', { timeout: 10000 });

// Or use more lenient waiting
await expect(page.locator('selector')).toBeVisible({ timeout: 10000 });
```

#### Issue: "Tests fail locally but work in CI"

**Cause**: Timing differences or state pollution

**Solution**:
- Ensure clean state in `beforeEach`
- Use explicit waits instead of fixed timeouts
- Check for test interdependencies

## 📈 Test Coverage

Current test coverage:

- ✅ Home page navigation and cards
- ✅ Compiler form interactions
- ✅ Compiler workflow (preset → form → submit)
- ✅ Validation page
- ✅ Performance metrics page
- ✅ Admin panel
- ✅ API documentation page
- ✅ Theme toggling
- ✅ Sidenav navigation
- ✅ Browser back/forward
- ✅ State persistence
- ✅ Responsive behavior
- ✅ Error handling

## 🚫 NOT in CI (Yet)

These tests are **standalone** and **not part of CI** by design:

- Intended for manual regression testing
- Can catch UI regressions before promotion to CI
- Useful for local development validation
- May be added to CI in future once stabilized

## 🔄 Future Enhancements

Potential additions:

- [ ] Authentication flow testing (when auth is enabled)
- [ ] API integration tests with mock server
- [ ] Visual regression testing (screenshots)
- [ ] Accessibility (a11y) testing
- [ ] Performance benchmarking
- [ ] Network condition testing (slow 3G, offline)
- [ ] Cross-browser testing (Firefox, Safari)
- [ ] Mobile device testing (iOS, Android)

## 📚 Resources

- [Playwright Documentation](https://playwright.dev)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Angular Testing Guide](https://angular.dev/guide/testing)
- [Material Design Testing](https://material.angular.io/guide/using-component-harnesses)

## 💡 Tips

1. **Run tests frequently** during development to catch regressions early
2. **Use UI mode** for interactive debugging and test exploration
3. **Write tests for bugs** before fixing them to prevent regression
4. **Keep tests independent** - no test should depend on another
5. **Use page objects** for repeated selectors (future enhancement)
6. **Capture screenshots** on failure for easier debugging
7. **Test both happy paths and error cases**
8. **Consider accessibility** in your tests (ARIA labels, keyboard navigation)

## 🎯 Running Specific Test Suites

```bash
# Run only compiler tests
pnpm --filter adblock-frontend exec playwright test e2e/compiler-workflow.spec.ts

# Run all workflow tests
pnpm --filter adblock-frontend exec playwright test e2e/*-workflow.spec.ts

# Run tests matching pattern
pnpm --filter adblock-frontend exec playwright test -g "navigation"

# Run only tests with specific tag
pnpm --filter adblock-frontend exec playwright test --grep "@smoke"
```

## 📝 Adding New Tests

To add new tests:

1. Create new `.spec.ts` file in `frontend/e2e/`
2. Follow existing test structure
3. Use descriptive test names
4. Add comments for complex interactions
5. Update this README with new coverage

Example:

```typescript
import { test, expect } from '@playwright/test';

test.describe('New Feature', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/new-feature');
    });

    test('should do something', async ({ page }) => {
        // Your test here
    });
});
```

## 🤝 Contributing

When adding E2E tests:

- Follow existing patterns and naming conventions
- Test both success and error paths
- Add documentation for new test scenarios
- Verify tests pass locally before committing
- Consider edge cases and error conditions

---

**Happy Testing! 🎭**
