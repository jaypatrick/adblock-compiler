# URL Management

All public-facing service URLs are managed as Wrangler environment variables.
This means changing a domain requires editing exactly two files:
`wrangler.toml` and `frontend/wrangler.toml`.

## URL variables

| Variable       | Description                              | Default (*.workers.dev)                                   |
|----------------|------------------------------------------|-----------------------------------------------------------|
| `URL_FRONTEND` | Angular frontend worker                  | `https://adblock-frontend.jayson-knight.workers.dev`      |
| `URL_API`      | Backend / API worker                     | `https://adblock-compiler.jayson-knight.workers.dev`      |
| `URL_DOCS`     | mdBook documentation (Cloudflare Pages)  | `https://adblock-compiler-docs.pages.dev`                 |

## Changing the domain

1. Update `URL_FRONTEND`, `URL_API`, and `URL_DOCS` in **`wrangler.toml`** `[vars]`.
2. Update the same three vars in **`frontend/wrangler.toml`** `[vars]`.
3. Update `CORS_ALLOWED_ORIGINS` in `wrangler.toml` to include the new frontend origin.
4. Run `wrangler deploy` (backend) and `pnpm --filter adblock-frontend run deploy` (frontend).
5. The `scripts/build-worker.sh` build step will substitute `URL_FRONTEND` into `frontend/src/index.html` automatically.

## Local dev overrides

Copy `.dev.vars.example` → `.dev.vars` and set:

```dotenv
URL_FRONTEND=http://localhost:4200
URL_API=http://localhost:8787
URL_DOCS=https://adblock-compiler-docs.pages.dev
```

These override the `wrangler.toml` values during `wrangler dev`.

## Where URLs are consumed at runtime

| Location | Variable used | How |
|---|---|---|
| `worker/utils/constants.ts` | `URL_DOCS`, `URL_API`, `URL_FRONTEND` | `getProjectUrls(env)` helper |
| `frontend/src/index.html` | `URL_FRONTEND` | Build-time placeholder substitution via `scripts/build-worker.sh` |
| `wrangler.toml` `CORS_ALLOWED_ORIGINS` | (manual sync) | Must include `URL_FRONTEND` value |
