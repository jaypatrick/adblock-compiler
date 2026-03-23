#!/bin/sh
# Builds the Angular frontend for the Cloudflare Worker.
# Skipped when the dist directory already exists (e.g. in CI, where the
# frontend artifact is downloaded before wrangler runs this script).
DIST_DIR="frontend/dist/adblock-compiler/browser"

if [ -d "$DIST_DIR" ]; then
    echo "Frontend assets already present at $DIST_DIR — skipping build."
else
    pnpm run build:worker
fi

# Inject Cloudflare Web Analytics token into the built index.html.
# The placeholder {{CF_WEB_ANALYTICS_TOKEN}} is replaced with the token from
# the environment, or the analytics script is removed if the token is not set.
# sed uses a temp file + mv instead of sed -i to be portable across GNU and BSD sed
# (macOS requires sed -i '' whereas GNU sed accepts sed -i without a suffix).
INDEX_HTML="$DIST_DIR/index.html"
if [ -f "$INDEX_HTML" ]; then
    if [ -n "$CF_WEB_ANALYTICS_TOKEN" ]; then
        # Escape characters special in sed replacement with '|' delimiter: & \ |
        ESCAPED_TOKEN=$(printf '%s' "$CF_WEB_ANALYTICS_TOKEN" | sed 's/[&|\\]/\\&/g')
        sed "s|{{CF_WEB_ANALYTICS_TOKEN}}|$ESCAPED_TOKEN|g" "$INDEX_HTML" > "$INDEX_HTML.tmp" && mv "$INDEX_HTML.tmp" "$INDEX_HTML"
        echo "Cloudflare Web Analytics token injected into $INDEX_HTML."
    else
        # Remove the entire Cloudflare beacon <script> tag by matching the
        # cloudflareinsights.com URL as an anchor. Using substitution (not line
        # deletion) so minified HTML that places multiple tags on one line is handled
        # safely — only the analytics tag is removed, not the whole line.
        sed 's|<script[^>]*cloudflareinsights\.com[^>]*></script>||g' "$INDEX_HTML" > "$INDEX_HTML.tmp" && mv "$INDEX_HTML.tmp" "$INDEX_HTML"
        echo "CF_WEB_ANALYTICS_TOKEN not set — analytics script removed from $INDEX_HTML."
    fi
fi

# Patch polyfills.server.mjs for Cloudflare Workers compatibility.
# Angular's SSR build generates polyfills.server.mjs that calls
# createRequire(import.meta.url) at module scope. In Cloudflare Workers,
# import.meta.url is undefined at script-validation time, causing error 10021.
# Patch to use optional chaining with a safe fallback URL so the module
# initialises without error in the Workers runtime.
POLYFILLS_FILE="frontend/dist/adblock-compiler/server/polyfills.server.mjs"
if [ -f "$POLYFILLS_FILE" ]; then
    # Ensure the expected pattern exists before attempting to patch.
    if ! grep -q 'createRequire(import.meta.url)' "$POLYFILLS_FILE"; then
        echo "Error: expected pattern 'createRequire(import.meta.url)' not found in $POLYFILLS_FILE; Angular output may have changed." >&2
        exit 1
    fi

    # Apply the patch into a temporary file.
    if ! sed "s|createRequire(import\.meta\.url)|createRequire(import.meta?.url ?? 'file:///worker')|g" \
        "$POLYFILLS_FILE" > "$POLYFILLS_FILE.tmp"; then
        echo "Error: failed to patch $POLYFILLS_FILE (sed exited with an error)." >&2
        rm -f "$POLYFILLS_FILE.tmp"
        exit 1
    fi

    # Verify that the replacement was actually applied.
    if ! grep -q "createRequire(import.meta?.url ?? 'file:///worker')" "$POLYFILLS_FILE.tmp"; then
        echo "Error: patch verification failed for $POLYFILLS_FILE; replacement not found in patched output." >&2
        rm -f "$POLYFILLS_FILE.tmp"
        exit 1
    fi

    mv "$POLYFILLS_FILE.tmp" "$POLYFILLS_FILE"
    echo "Patched $POLYFILLS_FILE for Cloudflare Workers (createRequire fallback)."
fi
