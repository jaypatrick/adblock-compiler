# Social OAuth Providers

This document describes how to configure social login providers (GitHub, Google) for the adblock-compiler.

## Currently Active: GitHub

GitHub OAuth is active when both `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set.

### GitHub Setup

1. Go to **GitHub → Settings → Developer Settings → OAuth Apps → New OAuth App**
   (or [register a new application](https://github.com/settings/applications/new))

2. Fill in:
   - **Application name**: `Adblock Compiler`
   - **Homepage URL**: `https://your-worker.workers.dev`
   - **Authorization callback URL**:
     ```
     https://your-worker.workers.dev/api/auth/callback/github
     ```

3. After creating the app, copy the **Client ID** and generate a **Client Secret**.

4. Set the secrets:
   ```bash
   # Local dev (.dev.vars)
   GITHUB_CLIENT_ID=<client-id>
   GITHUB_CLIENT_SECRET=<client-secret>

   # Production (Cloudflare Worker secrets)
   wrangler secret put GITHUB_CLIENT_ID
   wrangler secret put GITHUB_CLIENT_SECRET
   ```

Once set, the GitHub sign-in button appears automatically on the sign-in and sign-up pages.
The `GET /api/auth/providers` endpoint will return `github: true`, signalling the Angular
frontend to render the button.

---

## Future: Google

Google OAuth is wired in `worker/lib/auth.ts` but commented out.
To activate in a future release:

1. Create a Google Cloud project and OAuth 2.0 credentials.
2. Set the callback URL: `https://your-worker.workers.dev/api/auth/callback/google`
3. Set secrets:
   ```bash
   wrangler secret put GOOGLE_CLIENT_ID
   wrangler secret put GOOGLE_CLIENT_SECRET
   ```
4. Uncomment the Google block in `worker/lib/auth.ts` (`buildSocialProviders` function).

---

## Admin Panel

The **Admin → Auth Settings** panel (`/admin/auth-settings`) shows the current social
provider status (configured or not) without exposing credential values.

OAuth credentials are managed exclusively via `wrangler secret put` or the Cloudflare
dashboard — the admin UI is read-only for secret presence.
