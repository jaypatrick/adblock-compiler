#!/bin/sh
# Builds and deploys the Angular SSR frontend Worker (adblock-compiler-frontend).
# Run from the repo root.
set -e
echo "Building Angular SSR bundle..."
cd frontend
npm run build
echo "Deploying adblock-compiler-frontend to Cloudflare Workers..."
npm run deploy
echo "Done."
