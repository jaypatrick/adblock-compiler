#!/bin/sh
# Builds and deploys the Angular SSR frontend Worker (adblock-compiler-frontend).
# Run from the repo root.
set -e
echo "Building Angular SSR bundle..."
pnpm --filter adblock-compiler-frontend run build
echo "Injecting CF Web Analytics token..."
# build-worker.sh skips the Angular build (dist already present) and only
# rewrites the {{CF_WEB_ANALYTICS_TOKEN}} placeholder in index.html.
sh scripts/build-worker.sh
echo "Deploying adblock-compiler-frontend to Cloudflare Workers..."
pnpm --filter adblock-compiler-frontend run deploy
echo "Done."
