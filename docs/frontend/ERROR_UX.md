# Frontend Error UX

This document covers the error-surface layer of the Bloqr Angular frontend: where errors appear, what drives their appearance, how design tokens map to severity levels, and how to add a new error code.

---

## Error Surfaces

Bloqr exposes errors on three surfaces. Each has a distinct use case and is implemented as a standalone component.

| Surface | Component | Use case |
|---------|-----------|----------|
| **Persistent banner** | `UrlErrorBannerComponent` | Cross-route errors: auth failures, session expiry, CORS rejection, service unavailability. Always visible at the top of the viewport. |
| **Inline overlay** | `ErrorBoundaryComponent` | Route-scoped rendering errors. Contains a crash to the affected route without navigating away. |
| **Full-page takeover** | `FatalErrorComponent` | Unrecoverable application errors (`AppError.isFatal = true`). Replaces the entire viewport. |

The `NotFoundComponent` is also part of the error-surface family (registered on the `**` wildcard route) but is not strictly an *error* surface — it is a navigation failure screen.

---

## Bloqr Design Tokens

The banner and overlay components consume Bloqr design tokens for background colour, text colour, and border. Do not use raw Tailwind severity utilities (`bg-red-700`, etc.) inside error components — use these tokens so that the error UX theme is updatable in one place.

| Severity | Token prefix | Background | Text | Border |
|----------|-------------|------------|------|--------|
| `low` | `--bloqr-error-low-*` | `--bloqr-error-low-bg` | `--bloqr-error-low-text` | `--bloqr-error-low-border` |
| `medium` | `--bloqr-error-medium-*` | `--bloqr-error-medium-bg` | `--bloqr-error-medium-text` | `--bloqr-error-medium-border` |
| `high` | `--bloqr-error-high-*` | `--bloqr-error-high-bg` | `--bloqr-error-high-text` | `--bloqr-error-high-border` |
| `critical` | `--bloqr-error-critical-*` | `--bloqr-error-critical-bg` | `--bloqr-error-critical-text` | `--bloqr-error-critical-border` |

**Default token values** (from `frontend/src/styles/tokens/_error.css`):

```css
:root {
    /* low */
    --bloqr-error-low-bg:           hsl(210 17% 95%);
    --bloqr-error-low-text:         hsl(215 19% 35%);
    --bloqr-error-low-border:       hsl(215 15% 78%);

    /* medium */
    --bloqr-error-medium-bg:        hsl(38 92% 95%);
    --bloqr-error-medium-text:      hsl(35 80% 28%);
    --bloqr-error-medium-border:    hsl(38 80% 72%);

    /* high */
    --bloqr-error-high-bg:          hsl(0 90% 96%);
    --bloqr-error-high-text:        hsl(0 72% 38%);
    --bloqr-error-high-border:      hsl(0 72% 80%);

    /* critical */
    --bloqr-error-critical-bg:      hsl(0 85% 22%);
    --bloqr-error-critical-text:    hsl(0 0% 98%);
    --bloqr-error-critical-border:  hsl(0 72% 42%);
}
```

---

## Triggering Error Displays — TypeScript Examples

### Pattern 1 — Guard redirecting with NavigationErrorService (same-session)

```typescript
// frontend/src/app/auth/guards/session.guard.ts
@Injectable({ providedIn: 'root' })
export class SessionGuard implements CanActivateFn {
    constructor(
        private readonly authFacade:   AuthFacadeService,
        private readonly navError:     NavigationErrorService,
        private readonly router:       Router,
    ) {}

    canActivate(): boolean | UrlTree {
        if (!this.authFacade.isAuthenticated()) {
            this.navError.setError(ErrorCode.TOKEN_EXPIRED);
            return this.router.parseUrl('/login');
        }
        return true;
    }
}
```

**Result:** `UrlErrorBannerComponent` reads the error from `NavigationErrorService` on the next `NavigationEnd` event. No network round-trip, no URL pollution.

### Pattern 2 — Worker-originated redirect with KV flash token

```typescript
// worker/routes/auth.routes.ts (server-side, runs in Worker)
if (!session) {
    const token = await setFlash(c.env.FLASH_STORE, {
        code:     'TOKEN_EXPIRED',
        message:  'Your session has expired.',
        severity: 'medium',
    });
    return c.redirect(`/login?flash=${token}`, 302);
}
```

**Result:** Angular bootstraps, `readFromUrl()` is called in the app initializer, the token is exchanged for the `ErrorCodeDefinition`, and the flash token is removed from the URL via `history.replaceState`.

### Pattern 3 — Programmatic set within a service (in-process, no navigation)

```typescript
// frontend/src/app/features/dashboard/dashboard.service.ts
async loadDashboardData(): Promise<DashboardData> {
    try {
        return await this.api.get<DashboardData>('/api/dashboard');
    } catch (err) {
        if (isHttpError(err, 429)) {
            this.flashService.set(ErrorCode.RATE_LIMITED);
        } else {
            this.flashService.set(ErrorCode.SERVICE_UNAVAILABLE);
        }
        throw err;
    }
}
```

**Result:** `UrlErrorBannerComponent` picks up the `currentFlash` signal on its next change-detection cycle. No navigation occurs.

### Pattern 4 — Throwing an `AppError` from any injectable

```typescript
// frontend/src/app/services/compilation.service.ts
if (response.status === 403) {
    throw new AppError(ErrorCode.FORBIDDEN, {
        isFatal:      false,
        adminMessage: `User ${userId} attempted to access ${compilationId} without scope.`,
    });
}
```

**Result:** `GlobalErrorHandler` catches the `AppError`. Because `isFatal = false`, it calls `navigationErrorService.setError(error.code)` and emits to the current route's error handler.

---

## Admin vs Regular User View

`UrlErrorBannerComponent` and `FatalErrorComponent` show different content based on `AuthFacadeService.isAdmin()`.

| Element | Regular user | Admin user |
|---------|-------------|------------|
| Human-readable message | ✓ Shown | ✓ Shown |
| CTA button | ✓ Shown (if `ctaLabel` set) | ✓ Shown |
| Error code chip | ✗ Hidden | ✓ Shown (e.g., `RATE_LIMITED`) |
| `adminMessage` | ✗ Hidden | ✓ Shown |
| Stack trace | ✗ Hidden | ✓ Shown (`FatalErrorComponent` only) |
| `context` JSON | ✗ Hidden | ✓ Shown (collapsible `<details>`) |

**Security note:** Admin-gated fields are conditionally rendered using `@if (authFacade.isAdmin())` — they are **not rendered** in the DOM for non-admin users. Do not use CSS-based visibility (`display: none`) for gating sensitive fields.

---

## `ErrorCode` Enum Usage

Import directly from the error-codes barrel:

```typescript
import { ErrorCode, resolveErrorCode } from '@app/error/error-codes';

// Resolve a code to its full definition:
const definition = resolveErrorCode(ErrorCode.TOKEN_EXPIRED);
// → { message: 'Your session has expired...', severity: 'medium', ctaLabel: 'Sign In', ... }

// Safe to call with unknown/untrusted strings:
const safe = resolveErrorCode(unknownString);
// → Returns UNKNOWN definition if the code is not in the registry
```

**Pattern: resolving from HTTP error response**

```typescript
const code = (err as { error?: { code?: string } }).error?.code;
const definition = resolveErrorCode(code);          // always safe, never throws
this.flashService.set(definition);
```

---

## How to Add a New Error Code

Follow these five steps in order. Each step is required.

### Step 1 — Add to the `ErrorCode` enum

```typescript
// frontend/src/app/error/error-codes.ts
export enum ErrorCode {
    // ... existing codes
    COMPILATION_QUOTA_EXCEEDED = 'COMPILATION_QUOTA_EXCEEDED', // ← add here
}
```

Use `SCREAMING_SNAKE_CASE`. The string value must be identical to the key. The string value is what is sent over the wire (in flash payloads and API error bodies) — keep it stable.

### Step 2 — Add the registry entry

```typescript
// frontend/src/app/error/error-codes.ts → ERROR_CODES constant
[ErrorCode.COMPILATION_QUOTA_EXCEEDED]: {
    message:      'You have reached your monthly compilation limit.',
    severity:     'high',
    adminMessage: 'User compilation count exceeded plan.maxCompilations. Upgrade or reset billing cycle.',
    ctaLabel:     'View Plans',
    ctaRoute:     '/settings/billing',
},
```

Guidelines:
- `message` must be user-friendly, non-technical, and end with a period.
- `adminMessage` should identify the root cause and the responsible code path.
- Set `ctaLabel` and `ctaRoute` when there is an obvious recovery action.
- Choose severity conservatively. `critical` is reserved for errors that make the application unusable (blank page, auth loop, data loss).

### Step 3 — Add to the Worker `ErrorCode` list (if applicable)

If the Worker or auth layer can return this error code, add it to the Worker's `errorCodes.ts` (or the shared constants file). This ensures the Zod schema in `POST /api/log/frontend-error` can validate the code.

### Step 4 — Wire the trigger

In the guard, service, or handler that can produce this error, add a call to one of the four trigger patterns documented above. Prefer `NavigationErrorService` for same-session redirects and `FlashService.set()` for in-page non-navigating errors.

### Step 5 — Test the banner

Add a unit test in `url-error-banner.component.spec.ts` (or a Playwright e2e test for the navigation flow):

```typescript
it('shows COMPILATION_QUOTA_EXCEEDED banner with high severity', () => {
    flashService.set(ErrorCode.COMPILATION_QUOTA_EXCEEDED);
    fixture.detectChanges();
    const banner = fixture.debugElement.query(By.css('[data-testid="error-banner"]'));
    expect(banner.nativeElement.textContent).toContain('monthly compilation limit');
    expect(banner.nativeElement.classList).toContain('severity-high');
});
```

---

## Related Documentation

- [Secure Error-Passing Architecture](../architecture/error-passing.md) — KV flash store, endpoint specs, D1 schema
- [Worker Request Lifecycle](../architecture/worker-request-lifecycle.md) — `waitUntil` pattern used by error logging
- [Better Auth Security Audit](../auth/better-auth-audit-2026-05.md) — auth error codes and session handling
