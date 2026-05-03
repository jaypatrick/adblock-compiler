# Turnstile Middleware

The Bloqr Worker validates Cloudflare Turnstile tokens on all mutating endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) that are reachable from a browser. This document describes how the middleware reads the token, calls the Turnstile siteverify API, handles failures, and grants bypasses for API-key-authenticated callers.

---

## Token Sources

The middleware reads the Turnstile token from two locations, in priority order:

1. **`CF-Turnstile-Token` request header** (preferred for Angular `HttpClient` calls and Playwright tests).
2. **`turnstileToken` query parameter** (fallback for form-action POSTs and legacy callers).

The middleware does **not** read the token from the JSON request body. Reading from the body would require consuming the body stream before the route handler sees it, creating the "body already used" crash documented in [Worker Request Lifecycle](../architecture/worker-request-lifecycle.md).

```typescript
// worker/middleware/turnstile.ts
function extractToken(c: Context): string | null {
    return (
        c.req.header('CF-Turnstile-Token') ??
        c.req.query('turnstileToken') ??
        null
    );
}
```

---

## Middleware Implementation

```typescript
// worker/middleware/turnstile.ts
import type { Context, Next } from 'hono';
import type { Env }            from '../types/env.ts';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function turnstileMiddleware() {
    return async (c: Context<{ Bindings: Env }>, next: Next): Promise<Response> => {
        // 1. Skip safe methods
        if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
            return next();
        }

        // 2. Bypass for API key callers
        const authHeader = c.req.header('Authorization') ?? '';
        if (authHeader.startsWith('Bearer blq_')) {
            return next();
        }

        // 3. Extract token
        const token = extractToken(c);
        if (!token) {
            return c.json(
                { error: { code: 'TURNSTILE_MISSING', message: 'Turnstile token is required.' } },
                400,
            );
        }

        // 4. Verify with Cloudflare
        const outcome = await verifyToken(token, c.env.TURNSTILE_SECRET_KEY);
        if (!outcome.success) {
            return c.json(
                {
                    error: {
                        code:    'TURNSTILE_INVALID',
                        message: 'Turnstile verification failed.',
                        detail:  outcome['error-codes'],
                    },
                },
                403,
            );
        }

        return next();
    };
}

async function verifyToken(
    token:     string,
    secretKey: string,
): Promise<{ success: boolean; 'error-codes'?: string[] }> {
    const body = new URLSearchParams({ secret: secretKey, response: token });
    const res  = await fetch(SITEVERIFY_URL, { method: 'POST', body });
    return res.json<{ success: boolean; 'error-codes'?: string[] }>();
}

function extractToken(c: Context): string | null {
    return (
        c.req.header('CF-Turnstile-Token') ??
        c.req.query('turnstileToken') ??
        null
    );
}
```

---

## API Key Bypass

Callers that present a Bloqr API key (`Authorization: Bearer blq_<key>`) skip Turnstile verification. This applies to:

- The Bloqr CLI (`blq` tool)
- CI pipelines using machine-to-machine API keys
- Newman (Postman) integration test collections
- Any server-side Worker-to-Worker call that passes an API key

**Bypass condition:**

```typescript
const authHeader = c.req.header('Authorization') ?? '';
if (authHeader.startsWith('Bearer blq_')) {
    return next();
}
```

The check uses the `blq_` prefix that distinguishes Bloqr API keys from user session JWTs (`Bearer eyJ...`). No further inspection of the key value is done at this middleware stage — full API key validation occurs in the authentication middleware that runs later in the pipeline.

> **Security note:** Never bypass Turnstile based on the presence of any `Authorization` header. The bypass is conditional on the `blq_` prefix specifically — a browser-issued session JWT must still pass Turnstile verification.

---

## Newman / Postman Bypass

When running Newman integration tests against the deployed Worker, set the `Authorization` header to a valid API key:

```bash
newman run postman/bloqr-api.json \
    --env-var "api_key=blq_ci_test_key_abc123" \
    --global-var "base_url=https://api.bloqr.app"
```

In the Postman collection, configure the pre-request script:

```javascript
// Pre-request script (Collection level)
pm.request.headers.upsert({
    key:   'Authorization',
    value: `Bearer ${pm.environment.get('api_key')}`,
});
```

With the `blq_` API key set, all `POST`/`PUT`/`PATCH`/`DELETE` requests bypass the Turnstile check. The `CF-Turnstile-Token` header should be omitted (or set to an empty string) in the Postman collection — do not set it to a dummy value, as the middleware reads it before the bypass check on newer builds.

---

## Angular Frontend Integration

The Angular `HttpClient` interceptor injects the Turnstile token as a header for all mutating requests:

```typescript
// frontend/src/app/interceptors/turnstile.interceptor.ts
@Injectable()
export class TurnstileInterceptor implements HttpInterceptor {
    constructor(private readonly turnstile: TurnstileService) {}

    intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
        const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
        if (safeMethods.includes(req.method)) {
            return next.handle(req);
        }

        return from(this.turnstile.getToken()).pipe(
            switchMap(token => {
                const withToken = req.clone({
                    setHeaders: { 'CF-Turnstile-Token': token },
                });
                return next.handle(withToken);
            }),
        );
    }
}
```

`TurnstileService.getToken()` calls `window.turnstile.execute(...)` and returns a `Promise<string>`.

---

## Error Response Reference

| Condition | HTTP Status | Error code |
|-----------|-------------|------------|
| Token missing (no header, no query param) | `400` | `TURNSTILE_MISSING` |
| Token present but siteverify returns `success: false` | `403` | `TURNSTILE_INVALID` |
| Siteverify fetch fails (network error) | `502` | `TURNSTILE_UPSTREAM_ERROR` |
| API key bypass (`Bearer blq_*`) | — | (no error, passes through) |

---

## Related Documentation

- [CORS Policy](./cors.md) — `CF-Turnstile-Token` is listed in `Access-Control-Allow-Headers`
- [Worker Request Lifecycle](../architecture/worker-request-lifecycle.md) — pipeline order: CORS → Turnstile → Auth → Route handler
- [Better Auth Security Audit](../auth/better-auth-audit-2026-05.md) — API key authentication and the `blq_` prefix convention
