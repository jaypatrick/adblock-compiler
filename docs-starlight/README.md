# Bloqr Docs — Starlight (Astro) Scaffold

This directory contains a **Starlight (Astro)** documentation site for Bloqr — a
modern alternative to the current [mdBook](../book.toml) setup.

Both sites coexist independently. The existing mdBook pipeline (`book.toml`,
`wrangler.docs.toml`, `docs.bloqr.dev`) is **not modified** by this scaffold.

---

## Overview

| Property           | Value                                                 |
| ------------------ | ----------------------------------------------------- |
| **Framework**      | [Starlight](https://starlight.astro.build) (Astro v5) |
| **Deploy target**  | Cloudflare Worker → `docs-v3.bloqr.dev`               |
| **Content source** | `../docs/` (shared with mdBook via `srcDir`)          |
| **Search**         | Pagefind (built-in, offline-capable)                  |
| **Mermaid**        | `@beoe/rehype-mermaid` (remark plugin)                |
| **OpenAPI**        | `starlight-openapi` plugin                            |

---

## Local Development

```bash
# From this directory (docs-starlight/)
pnpm install
pnpm start          # Dev server at http://localhost:4321 (Astro default; port may differ if already in use)
```

Or from the repo root:

```bash
pnpm --filter @bloqr/docs-starlight run start
```

---

## Build

```bash
pnpm build          # Outputs to docs-starlight/dist/
```

Or from root:

```bash
pnpm docs:starlight:build
```

---

## Deploy

```bash
pnpm deploy         # Runs: wrangler deploy --config wrangler.docs-starlight.toml
```

Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to be set.

CI auto-deploys on push to `main` when files under `docs/**` or
`docs-starlight/**` change (see
[`.github/workflows/docs-starlight.yml`](../.github/workflows/docs-starlight.yml)).

---

## Key Advantages Over mdBook

| Feature                | mdBook                    | Starlight                              |
| ---------------------- | ------------------------- | -------------------------------------- |
| **Search**             | Basic (in-memory)         | Pagefind — offline, edge-ready         |
| **Cloudflare adapter** | Worker-based static serve | Static Worker Assets (`wrangler deploy`) |
| **Mermaid**            | `mdbook-mermaid` binary   | `@beoe/rehype-mermaid` remark plugin   |
| **OpenAPI**            | Manual static HTML        | `starlight-openapi` live playground    |
| **MDX**                | ❌                        | ✅ (embed Angular/React components)    |
| **i18n**               | ❌                        | ✅ built-in                            |
| **Framework**          | Rust binary               | TypeScript/Node (matches repo stack)   |
| **Customisation**      | CSS + `book.toml`         | Full Astro — islands, components, etc. |

---

## Key Differences from the Docusaurus Scaffold

See `docs-docusaurus/` for the parallel Docusaurus v3 scaffold.

|                 | Starlight (this)                  | Docusaurus                       |
| --------------- | --------------------------------- | -------------------------------- |
| **Search**      | Pagefind (zero config)            | Algolia (API key needed)         |
| **Versioning**  | Manual (community plugins)        | Built-in                         |
| **React**       | Not required                      | Required for theming             |
| **Bundle size** | Minimal (Astro partial hydration) | Larger (full React SPA)          |
| **OpenAPI**     | `starlight-openapi`               | `docusaurus-plugin-openapi-docs` |
| **Maturity**    | Newer, faster-growing             | Larger ecosystem, more stable    |

---

## Directory Structure

```
docs-starlight/
├── astro.config.ts              # Full Starlight config + 174-entry sidebar
├── package.json                 # @bloqr/docs-starlight
├── tsconfig.json                # Astro strict tsconfig
├── wrangler.docs-starlight.toml # Cloudflare Worker deploy config
├── .gitignore
├── README.md                    # This file
└── src/
    ├── assets/
    │   └── logo.svg             # Placeholder shield logo
    ├── content/
    │   └── config.ts            # Starlight docs collection schema
    ├── pages/                   # (empty — Starlight handles routing via srcDir)
    └── styles/
        └── custom.css           # Bloqr brand overrides (purple accent, dark theme)
```

Content is read directly from `../docs/` via the `srcDir: '../docs'` setting in
`astro.config.ts`. **No Markdown files are copied or duplicated.**

---

## Migration Notes — What Still Needs Manual Attention

### 1. Mermaid final wiring

`@beoe/rehype-mermaid` is listed as a dev dependency. To activate it, add it to
the `rehypePlugins` array in `astro.config.ts`:

```ts
import rehypeMermaid from '@beoe/rehype-mermaid';

// inside defineConfig:
markdown: {
    rehypePlugins: [rehypeMermaid],
},
```

Some Mermaid fences in the existing docs use `mermaid` as the language
identifier — verify they render correctly after wiring.

### 2. OpenAPI plugin config

`starlight-openapi` is installed but not yet configured. To add an OpenAPI
reference panel:

```ts
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi';

// inside starlight({ plugins: [...] })
plugins: [
    starlightOpenAPI([
        {
            base: 'api/openapi',
            label: 'API Reference',
            schema: '../docs/api/openapi.yaml',
        },
    ]),
],
```

Then replace the manual `api/` sidebar group with `openAPISidebarGroups`.

### 3. Logo asset

`src/assets/logo.svg` is a minimal placeholder shield icon. Replace with the
official Bloqr SVG logo.

### 4. Fonts

`custom.css` loads Inter and JetBrains Mono from Google Fonts CDN. For fully
offline/privacy-respecting builds, replace with `@fontsource/inter` and
`@fontsource/jetbrains-mono` npm packages and import them in `custom.css`.

### 5. `srcDir` and frontmatter

Starlight expects frontmatter in Markdown files. Existing `docs/**/*.md` files
without frontmatter will still render, but pages with `title:` in frontmatter
will override the sidebar label. Add frontmatter gradually as needed.
