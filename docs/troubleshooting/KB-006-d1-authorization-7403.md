# KB-006: D1 Authorization Error (7403) - API Token Missing D1:Edit Permission

## Symptom

CI/CD deployment to Cloudflare fails during D1 migration step with:

```
✘ [ERROR] A request to the Cloudflare API (/accounts/***/d1/database/***) failed.
  The given account is not valid or is not authorized to access this service [code: 7403]
```

The error occurs even after creating a new API token with "Workers:Edit" and "Pages:Edit" permissions.

## Root Cause

Cloudflare separates resource permissions granularly. **D1:Edit** is a distinct permission from **Workers:Edit** and **Pages:Edit**.

Common mistake: Creating an API token with only Workers and Pages permissions, assuming Workers:Edit covers all Worker-related resources including D1 databases.

## Error Codes

- **7403**: Authorization error - the API token is valid but lacks permission for the requested resource
- **10000**: Authentication error - the API token is invalid or expired

The previous deployment workflow only detected error 10000, so on 7403 errors it would retry 3 times and then fail without helpful guidance.

## Solution

### Step 1: Update Your Cloudflare API Token

1. Go to [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Find your existing API token OR click "Create Token"
3. Ensure it has **all three** of these permissions:
   - ✅ **Account > D1:Edit** (REQUIRED for database migrations)
   - ✅ **Account > Workers:Edit** (for worker deployment)
   - ✅ **Account > Pages:Edit** (for Pages deployment)
4. Save the token

### Step 2: Update GitHub Secret

1. Go to your repository Settings → Secrets and variables → Actions
2. Update the `CLOUDFLARE_API_TOKEN` secret with your new token
3. Re-run the failed workflow

## Prevention

When creating Cloudflare API tokens for CI/CD, always include:

```
Account Permissions:
  • D1:Edit              ← Don't forget this!
  • Workers:Edit
  • Pages:Edit
  • Workers KV Storage:Edit (if using KV)
  • Workers R2 Storage:Edit (if using R2)
  • Account Analytics:Read (optional, for observability)
```

## Related Issues

- This issue affects all workflows that run D1 migrations:
  - `.github/workflows/ci.yml` (Deploy to Cloudflare job)
  - `.github/workflows/db-migrate.yml`
  - Any workflow using `.github/actions/deploy-worker/action.yml`

## Fix Applied

The deployment action now detects both error classes and handles them in separate branches, so it can provide the correct guidance for authorization failures (7403 / not authorized) versus authentication failures (10000):

```yaml
if echo "$output" | grep -qiE 'not authorized|7403'; then
    # Provides D1:Edit permission guidance
elif echo "$output" | grep -qiE 'Authentication error|10000'; then
    # Provides API token invalid/expired guidance
fi
```

## Verification

After updating the API token, the next deployment should succeed. If it still fails:

1. Verify `CLOUDFLARE_ACCOUNT_ID` is correct (check wrangler.toml or Cloudflare dashboard)
2. Confirm the D1 database exists: `deno task wrangler d1 list`
3. Check the database ID matches `wrangler.toml`: `database_id = "..."`

## References

- [Cloudflare API Token Permissions](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
- [D1 Documentation](https://developers.cloudflare.com/d1/)
- PR fixing this issue: [#1507](https://github.com/jaypatrick/adblock-compiler/pull/1507)
