# URL Management

All public-facing service URLs are managed as Wrangler environment variables.
Changing a domain requires editing two files for runtime (`wrangler.toml` and
`frontend/wrangler.toml`) and, if you want tests and CLI tools to reflect the
new URLs without env overrides, also updating the fallback constants in
`worker/utils/constants.ts`.

> **Note:** The fallback constants (`DOCS_SITE_URL_FALLBACK`, `FRONTEND_URL_FALLBACK`,
> `API_URL_FALLBACK`) are intentionally static — they exist solely for unit-test
> and CLI contexts where the Workers runtime is not present. The production worker
> always reads the env bindings set in `wrangler.toml`.

## URL variables

| Variable       | Description                              | Default (*.workers.dev)                                   |
|----------------|------------------------------------------|-----------------------------------------------------------|
| `URL_FRONTEND` | Angular frontend worker                  | `https://adblock-frontend.jk-com.workers.dev`      |
| `URL_API`      | Backend / API worker                     | `https://adblock-compiler.jk-com.workers.dev`      |
| `URL_DOCS`     | mdBook documentation (Cloudflare Pages)  | `https://docs.bloqr.dev`                     |

## Changing the domain

1. Update `URL_FRONTEND`, `URL_API`, and `URL_DOCS` in **`wrangler.toml`** `[vars]`.
2. Update the same three vars in **`frontend/wrangler.toml`** `[vars]`.
3. Update `CORS_ALLOWED_ORIGINS` in `wrangler.toml` to include the new frontend origin.
4. *(Optional)* Update the fallback constants in `worker/utils/constants.ts` if you want tests
   and CLI tools to use the new URLs without an explicit env override.
5. `scripts/build-worker.sh` injects `URL_FRONTEND` into `frontend/src/index.html` at build time.
   Resolution order: (1) `URL_FRONTEND` env var, (2) `URL_FRONTEND` from `wrangler.toml` `[vars]`
   (automatic fallback used by CI dry-run), (3) hard failure if neither is available and the
   placeholder is still present.
6. Run `wrangler deploy` (backend) and `pnpm --filter adblock-frontend run deploy` (frontend).

## Local dev overrides

Copy `.dev.vars.example` → `.dev.vars` and set:

```dotenv
URL_FRONTEND=http://localhost:4200
URL_API=http://localhost:8787
URL_DOCS=https://docs.bloqr.dev
```

These override the `wrangler.toml` values during `wrangler dev`.

## Where URLs are consumed at runtime

| Location | Variable used | How |
|---|---|---|
| `worker/utils/constants.ts` | `URL_DOCS`, `URL_API`, `URL_FRONTEND` | `getProjectUrls(env)` helper |
| `frontend/src/index.html` | `URL_FRONTEND` | Build-time placeholder substitution via `scripts/build-worker.sh` |
| `wrangler.toml` `CORS_ALLOWED_ORIGINS` | (manual sync) | Must include `URL_FRONTEND` value |
