# Turnstile Middleware

The Bloqr Worker validates Cloudflare Turnstile tokens on all mutating endpoints (`POST`, `PUT`, `PATCH`, `DELETE`) that are reachable from a browser. This document describes how the middleware reads the token, calls the Turnstile siteverify API, handles failures, and grants bypasses for API-key-authenticated callers.

---

## Token Sources

The middleware reads the Turnstile token from the **JSON request body** as the `turnstileToken` field. The body is read via `Request.clone()` to leave the original stream intact for downstream route handlers and validators.

```typescript
// worker/middleware/hono-middleware.ts (simplified)
const body = await c.req.raw.clone().json() as { turnstileToken?: string };
const token = body.turnstileToken ?? '';
```

> **WebSocket exception:** `/ws/compile` and `/ws/compile/v2` do not carry a JSON body during the HTTP upgrade handshake. For these routes only, the Turnstile token arrives as the `?turnstileToken=` query parameter and is verified inline (not through this middleware).

---

## Middleware Implementation

```typescript
// worker/middleware/hono-middleware.ts (simplified)
export function turnstileMiddleware(): AppMiddleware {
    return async (c, next) => {
        // 1. No-op if TURNSTILE_SECRET_KEY is not configured
        if (!c.env.TURNSTILE_SECRET_KEY) {
            await next();
            return;
        }

        // 2. Bypass for API key callers (server-to-server)
        if (c.get('authContext')?.authMethod === 'api-key') {
            await next();
            return;
        }

        // 3. Extract token from JSON body (stream is cloned, original intact)
        let token = '';
        try {
            const body = await c.req.raw.clone().json() as { turnstileToken?: string };
            token = body.turnstileToken ?? '';
        } catch {
            return ProblemResponse.badRequest(
                c.req.path,
                'Invalid request body — could not extract Turnstile token',
            );
        }

        // 4. Verify with Cloudflare
        const result = await verifyTurnstileToken(c.env, token, c.get('ip'));
        if (!result.success) {
            return ProblemResponse.turnstileRejection(
                c.req.path,
                result.error ?? 'Turnstile verification failed',
            );
        }

        await next();
    };
}
```

---

## API Key Bypass

Callers authenticated via a Bloqr API key skip Turnstile verification. The bypass is enforced through the **auth context** set by the unified auth middleware, not by inspecting the `Authorization` header directly. This is important: the Turnstile middleware runs after auth, so `c.get('authContext')` is already populated.

```typescript
// API key requests are server-to-server — Turnstile (human verification) does not apply.
if (c.get('authContext')?.authMethod === 'api-key') {
    await next();
    return;
}
```

Callers that use this bypass:

- The Bloqr CLI (`blq` tool)
- CI pipelines using machine-to-machine API keys
- Newman (Postman) integration test collections
- Any server-side Worker-to-Worker call that passes an API key

> **Security note (ZTA):** The bypass fires only after the unified auth middleware has validated the API key and recorded `authMethod: 'api-key'` in the auth context. An unauthenticated request with a `blq_` prefix in the `Authorization` header will fail auth before it reaches the Turnstile check and will never receive the bypass.

---

## Newman / Postman Bypass

When running Newman integration tests against the deployed Worker, authenticate using a valid API key. The Turnstile middleware checks `authContext.authMethod === 'api-key'` (set by the auth middleware after validating the key), so no Turnstile token is needed.

```bash
newman run docs/postman/postman-collection.json \
    --environment docs/postman/postman-environment-prod.json \
    --env-var "bearerToken=${NEWMAN_USER_API_KEY}" \
    --color on
```

In the Postman collection, configure the pre-request script at the collection level:

```javascript
// Pre-request script (Collection level)
pm.request.headers.upsert({
    key:   'Authorization',
    value: `Bearer ${pm.environment.get('bearerToken')}`,
});
```

With a valid API key, all `POST`/`PUT`/`PATCH`/`DELETE` requests bypass the Turnstile check. Do **not** add `turnstileToken` to the request body in Newman tests — it is unnecessary and adds noise to test payloads.

---

## Angular Frontend Integration

The Angular `HttpClient` interceptor injects the Turnstile token into the request body for all mutating requests. Since the middleware reads `turnstileToken` from the JSON body, the interceptor adds it to the body before the request is sent rather than as a header.

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
                // req.body is assumed to be a plain object (JSON).
                // FormData and other non-object body types are not mutated.
                const body = { ...(req.body as Record<string, unknown>), turnstileToken: token };
                const withToken = req.clone({ body });
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
| Body cannot be parsed as JSON | `400` | `BAD_REQUEST` |
| Token missing (`turnstileToken` absent or empty string) | `403` | `TURNSTILE_REJECTION` |
| Token present but siteverify returns `success: false` | `403` | `TURNSTILE_REJECTION` |
| Siteverify fetch fails (network error) | `502` | `UPSTREAM_ERROR` |
| API key authenticated caller (`authMethod === 'api-key'`) | — | (no error, passes through) |

---

## Related Documentation

- [CORS Policy](./cors.md) — `X-Turnstile-Token` is listed in `Access-Control-Allow-Headers` for cross-origin preflight
- [Worker Request Lifecycle](../architecture/worker-request-lifecycle.md) — pipeline order: Auth + Rate Limit → CORS → Turnstile → Route handler
- [Better Auth Security Audit](../auth/better-auth-audit-2026-05.md) — API key authentication and the auth context
