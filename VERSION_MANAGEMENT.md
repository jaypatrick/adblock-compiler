# Version Management

This document describes how version strings are managed across the adblock-compiler project to ensure consistency and prevent version drift.

## Single Source of Truth

**`src/version.ts`** is the canonical source for the package version.

```typescript
export const VERSION = '0.12.0';
```

## Version Synchronization

All version strings flow from `src/version.ts`:

### 1. Package Metadata

These files must be manually updated together:

- **`src/version.ts`** - The VERSION constant (primary source)
- **`deno.json`** - Package version for JSR publishing
- **`package.json`** - Package version for npm compatibility
- **`wrangler.toml`** - COMPILER_VERSION environment variable

### 2. Worker Code (Automatic)

Worker code imports and uses VERSION as a fallback:

- **`worker/worker.ts`** - Imports VERSION, uses `env.COMPILER_VERSION || VERSION`
- **`worker/router.ts`** - Imports VERSION, uses `env.COMPILER_VERSION || VERSION`
- **`worker/websocket.ts`** - Imports VERSION, uses `env.COMPILER_VERSION || VERSION`

This ensures that even if `COMPILER_VERSION` is not set in the environment, the worker will use the correct version from `src/version.ts`.

### 3. Web UI (Dynamic Loading)

HTML files load version dynamically from the API at runtime:

- **`public/index.html`** - Calls `/api/version` endpoint via `loadVersion()`
- **`public/compiler.html`** - Calls `/api/version` and `/api` endpoints via `fetchCompilerVersion()`

Fallback HTML values are provided for offline/error scenarios but are always overridden by the API response.

### 4. Tests

Test files import VERSION for consistency:

- **`worker/queue.integration.test.ts`** - Uses `VERSION + '-test'`

## Version Update Process

### Automatic (Recommended)

The project uses **automatic version bumping** based on Conventional Commits:

- **Automatic**: Version is bumped automatically when you merge PRs with proper commit messages
- **No manual editing**: Version files are updated automatically
- **Changelog generation**: CHANGELOG.md is updated automatically
- **Release creation**: GitHub releases are created automatically

See [docs/AUTO_VERSION_BUMP.md](docs/AUTO_VERSION_BUMP.md) for complete details.

**Quick Guide:**

```bash
# Minor bump (new feature)
git commit -m "feat: add new transformation"

# Patch bump (bug fix)
git commit -m "fix: resolve parsing error"

# Major bump (breaking change)
git commit -m "feat!: change API interface"
```

### Manual (Fallback)

If you need to manually bump the version:

1. ✅ Update `src/version.ts` - Change the VERSION constant
2. ✅ Update `deno.json` - Change the "version" field
3. ✅ Update `package.json` - Change the "version" field
4. ✅ Update `wrangler.toml` - Change COMPILER_VERSION in [vars] section
5. ⚠️ Optional: Update HTML fallback versions in `public/index.html` and `public/compiler.html` (they will be overridden by API)
6. ✅ Update `CHANGELOG.md` - Document the changes
7. ✅ Commit with message: `chore: bump version to X.Y.Z [skip ci]`

Or use the GitHub Actions workflow: Actions → Version Bump → Run workflow

## Architecture Benefits

### Before (Version Drift Problem)

- Multiple hardcoded version strings scattered across the codebase
- Easy to forget updating some locations
- Version drift between components (e.g., 0.11.3, 0.11.4, 0.11.5, 0.12.0 all present)

### After (Single Source of Truth)

- One canonical source: `src/version.ts`
- Worker imports and uses it automatically
- Web UI loads it dynamically from API
- Only 4 files need manual sync (src/version.ts, deno.json, package.json, wrangler.toml)
- Clear documentation prevents future drift

## Version Flow Diagram

```
src/version.ts (VERSION = '0.12.0')
    ↓
    ├─→ worker/worker.ts (import VERSION)
    │   └─→ API endpoints (/api, /api/version)
    │       └─→ public/index.html (loadVersion())
    │       └─→ public/compiler.html (fetchCompilerVersion())
    │
    ├─→ worker/router.ts (import VERSION)
    ├─→ worker/websocket.ts (import VERSION)
    └─→ worker/queue.integration.test.ts (import VERSION)
```

## Implementation Details

### Worker Fallback Pattern

All worker files use this pattern:

```typescript
import { VERSION } from '../src/version.ts';

// Later in code:
version: env.COMPILER_VERSION || VERSION
```

This ensures:
1. Production uses `COMPILER_VERSION` from wrangler.toml
2. Local dev/tests use `VERSION` from src/version.ts if env var missing
3. No "unknown" versions

### Dynamic Loading in HTML

Both HTML files fetch version at page load:

```javascript
async function loadVersion() {
    const response = await fetch('/api/version');
    const result = await response.json();
    const version = result.data?.version || result.version;
    document.getElementById('version').textContent = version;
}
```

This ensures:
1. Version always matches deployed worker
2. No manual HTML updates needed
3. Fallback version only shown on API failure

## Troubleshooting

### Version shows as "unknown"

- Check that `COMPILER_VERSION` is set in wrangler.toml
- Verify worker files import VERSION from src/version.ts
- Ensure fallback pattern `env.COMPILER_VERSION || VERSION` is used

### Version shows old value in UI

- Check browser cache - hard refresh (Ctrl+F5)
- Verify API endpoint `/api/version` returns correct version
- Check that JavaScript `loadVersion()` function is being called

### Versions out of sync

- Follow the Version Update Checklist above
- Use grep to find any remaining hardcoded version strings:
  ```bash
  grep -r "0\.11\." --include="*.ts" --include="*.html" --include="*.toml"
  ```

## Related Files

- `src/version.ts` - Primary version definition
- `deno.json` - Package version
- `package.json` - Package version
- `wrangler.toml` - Worker environment variable
- `CHANGELOG.md` - Version history
- `.github/copilot-instructions.md` - Contains version sync instructions for AI assistance
