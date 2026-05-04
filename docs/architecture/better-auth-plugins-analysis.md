# Better Auth Plugins Analysis & Recommendations

## Executive Summary

This document provides a comprehensive analysis of Better Auth plugins for the adblock-compiler project, evaluating their implementation status, benefits, and recommendations for adoption.

**Status at a Glance:**
- ✅ **4 plugins already active:** `bearer`, `twoFactor`, `multiSession`, `admin`
- 🔄 **1 plugin recommended for implementation:** `organization`
- 📋 **6 plugins under consideration:** `apiKey`, `magicLink`, `username`, `jwt`, `hibp`, `captcha`, `openAPI`

---

## Currently Implemented Plugins

### ✅ bearer() Plugin
**Status:** Active (auth.ts:175)

**Purpose:** Enables API authentication via `Authorization: Bearer <token>` header instead of browser cookies.

**Endpoints Auto-Exposed:**
- Session token endpoint returns `session.token` in responses

**Usage:**
- Frontend: `getToken()` method retrieves session token for API calls
- Critical for API-first architecture
- Enables Postman/curl access with tokens

**Benefits:**
- ✅ Essential for our API-centric architecture
- ✅ Already integrated with middleware/auth.ts
- ✅ Frontend service has `getToken()` method

**Database Schema:** Uses existing `Session.token` field

**ZTA Compliance:** ✅ Fully compliant - tokens verified via Better Auth

---

### ✅ twoFactor() Plugin
**Status:** Active (auth.ts:180)

**Purpose:** TOTP-based two-factor authentication for enhanced account security.

**Configuration:**
```typescript
twoFactor({
    issuer: 'adblock-compiler'
})
```

**Endpoints Auto-Exposed:**
- `POST /api/auth/two-factor/enable` - Generate TOTP secret + QR URI
- `POST /api/auth/two-factor/verify` - Verify TOTP code (enables 2FA)
- `POST /api/auth/two-factor/disable` - Remove 2FA

**Database Schema:**
```prisma
model TwoFactor {
  id          String @id @default(uuid())
  userId      String @unique
  secret      String  // Encrypted TOTP secret
  backupCodes String  // JSON array
}

// User model field:
twoFactorEnabled Boolean @default(false)
```

**Frontend Integration:**
```typescript
enableTwoFactor(password)     // Get TOTP URI for QR
verifyTwoFactor(code)         // Verify code
disableTwoFactor(password)    // Disable 2FA
```

**Benefits:**
- ✅ Critical security feature for list/rule managers
- ✅ Easy user adoption (QR code scanning)
- ✅ Backup codes for recovery
- ✅ No additional dependencies

**Recommendation:** ✅ Keep active - essential security feature

---

### ✅ multiSession() Plugin
**Status:** Active (auth.ts:187)

**Purpose:** Multiple active sessions per user across devices.

**Endpoints Auto-Exposed:**
- `GET /api/auth/list-sessions` - List all active sessions
- `POST /api/auth/revoke-session` - Revoke specific session
- `POST /api/auth/revoke-other-sessions` - Revoke all except current

**Database Schema:** Uses existing `Session` model with tracking

**Frontend Integration:**
```typescript
listSessions()              // Get all active sessions
revokeSession(token)        // Logout specific session
revokeOtherSessions()       // Logout all other devices
```

**Benefits:**
- ✅ Users can manage active devices
- ✅ Security: logout stolen/lost devices
- ✅ UX: see where you're logged in

**Recommendation:** ✅ Keep active - valuable security & UX feature

---

### ✅ admin() Plugin
**Status:** Active (auth.ts:195)

**Purpose:** Built-in admin user and role management.

**Endpoints Auto-Exposed:**
- `GET /api/auth/admin/list-users` - List all users
- `POST /api/auth/admin/set-role` - Change user role
- `POST /api/auth/admin/ban-user` - Ban a user
- `POST /api/auth/admin/unban-user` - Unban a user
- `POST /api/auth/admin/impersonate-user` - Impersonate user
- `POST /api/auth/admin/revoke-user-sessions` - Revoke all sessions

**Database Schema:**
```prisma
model User {
  role       String    @default("user")
  banned     Boolean   @default(false)
  banReason  String?
  banExpires DateTime?
}
```

**Integration:** Already integrated with custom admin routes at `/admin/users/*`

**Benefits:**
- ✅ Robust admin UI and roles
- ✅ Simplifies user management
- ✅ Ban management built-in

**Recommendation:** ✅ Keep active - critical for administration

---

## Recommended for Implementation

### 🔄 organization() Plugin
**Status:** Not implemented (commented at auth.ts:198)

**Purpose:** Multi-tenancy support - enables teams/organizations with member roles and permissions.

**Use Cases for Our Project:**
- Team-based compilation workflows
- Shared filter list ownership
- Organization-level API keys
- Multi-team list moderation

**Endpoints Auto-Exposed:**
- `POST /api/auth/organization/create` - Create organization
- `POST /api/auth/organization/invite-member` - Invite user to org
- `POST /api/auth/organization/remove-member` - Remove member
- `POST /api/auth/organization/update-member-role` - Change member role
- `GET /api/auth/organization/list-organizations` - List user's orgs
- `GET /api/auth/organization/get-full-organization` - Get org details

**Database Schema Required:**
```prisma
model Organization {
  id          String   @id @default(uuid())
  name        String
  slug        String   @unique
  logo        String?
  createdAt   DateTime @default(now())
  metadata    Json?

  members     Member[]
}

model Member {
  id             String       @id @default(uuid())
  organizationId String
  userId         String
  role           String       // owner | admin | member
  createdAt      DateTime     @default(now())

  organization   Organization @relation(fields: [organizationId], references: [id])
  user           User         @relation(fields: [userId], references: [id])

  @@unique([organizationId, userId])
}
```

**Configuration:**
```typescript
organization({
  allowUserToCreateOrganization: true,  // All users can create orgs
  organizationLimit: 3,                  // Max 3 orgs per user
})
```

**Benefits:**
- ✅ Native multi-tenancy support
- ✅ Built-in role system (owner/admin/member)
- ✅ Invitation workflow included
- ✅ Scales with business needs

**Implementation Complexity:** Medium
- Database migration required
- Frontend service updates needed
- Optional: Update FilterSource.ownerUserId to support org ownership

**Recommendation:** ✅ **IMPLEMENT** - High value for collaborative use cases

---

## Plugins Under Consideration

### 📋 apiKey() Plugin (Custom vs. Built-in)
**Status:** Custom implementation active at `worker/handlers/api-keys.ts`

**Better Auth Plugin:** Provides standardized API key management at `/api/auth/admin/api-keys/*`

**Current Custom Implementation:**
```typescript
// worker/routes/api-keys.routes.ts
POST   /api/keys         // Create key
GET    /api/keys         // List keys
DELETE /api/keys/:id     // Revoke key
PATCH  /api/keys/:id     // Update key
```

**Database Schema:**
```prisma
model ApiKey {
  id                 String    @id @default(uuid())
  userId             String
  keyHash            String    @unique
  keyPrefix          String    // Display prefix
  name               String
  scopes             String[]  @default(["compile"])
  rateLimitPerMinute Int       @default(60)
  lastUsedAt         DateTime?
  expiresAt          DateTime?
  revokedAt          DateTime?
}
```

**Custom Features:**
- ✅ Per-key scopes (`compile`, `admin`, etc.)
- ✅ Per-key rate limits
- ✅ Expiration management
- ✅ Last used tracking

**Better Auth apiKey() Plugin Features:**
- Standard API key CRUD
- Simpler implementation
- Less customization

**Analysis:**
- Our custom implementation has richer features (scopes, per-key limits)
- Better Auth plugin would simplify maintenance
- Migration would require schema changes

**Recommendation:** ⚠️ **KEEP CUSTOM** - Our implementation is more feature-rich
- Optional: Add Better Auth plugin for secondary API key type (read-only tokens)

---

### 📋 magicLink() Plugin
**Status:** Not implemented

**Purpose:** Passwordless login via email links.

**Use Case:**
- Simplify login UX
- Reduce password fatigue
- Good for occasional users

**Implementation:**
```typescript
magicLink({
  sendMagicLink: async ({ email, url }) => {
    // Send email with magic link
    // Requires email service integration
  }
})
```

**Pros:**
- ✅ Better UX for casual users
- ✅ No passwords to forget
- ✅ Built-in token management

**Cons:**
- ❌ Requires email service (Resend, Postmark, etc.)
- ❌ Additional cost for email sending
- ❌ May confuse users with multiple login methods

**Recommendation:** 🔄 **DEFER** - Implement when email service is ready
- Priority: Medium
- Complexity: Low (once email service is available)

---

### 📋 username() Plugin
**Status:** Not implemented

**Purpose:** Username-based authentication instead of email-only.

**Use Case:**
- Allow users to choose display names
- Social/gaming-style login

**Current:** Users have `displayName` field but login is email-only

**Pros:**
- ✅ More casual/friendly UX
- ✅ Username-based profiles

**Cons:**
- ❌ Requires unique username constraints
- ❌ Added complexity (username + email + password)
- ❌ Username availability checks needed

**Recommendation:** ⏸️ **LOW PRIORITY** - Email auth sufficient for now
- Revisit if community/social features are added

---

### 📋 jwt() Plugin
**Status:** Not needed (bearer plugin sufficient)

**Purpose:** Stateless JWT tokens for API authentication.

**Current Solution:** `bearer()` plugin already provides token-based auth

**Analysis:**
- bearer() uses session tokens (validated via database)
- jwt() uses stateless tokens (signed, no DB lookup)
- Trade-offs:
  - bearer: Can revoke immediately (session deletion)
  - jwt: Faster (no DB lookup), but can't revoke until expiry

**Recommendation:** ❌ **NOT NEEDED** - bearer() plugin is sufficient
- Our ZTA architecture requires database-validated tokens
- Immediate revocation is critical for security

---

### 📋 hibp() Plugin (Have I Been Pwned)
**Status:** Not implemented

**Purpose:** Check passwords against breach databases during sign-up/password change.

**Implementation:**
```typescript
import { passkey } from "better-auth/plugins"

hibp({
  // Checks password against HIBP API on sign-up/change
})
```

**Pros:**
- ✅ Prevents known-breached passwords
- ✅ Improves account security
- ✅ Free API (k-anonymity)

**Cons:**
- ❌ External API dependency (haveibeenpwned.com)
- ❌ Slight sign-up delay (~200ms)
- ❌ May confuse users if password rejected

**Recommendation:** 🔄 **CONSIDER** - Valuable security feature
- Priority: Low-Medium
- Complexity: Very Low (drop-in plugin)
- Implement after core features stabilized

---

### 📋 captcha() Plugin
**Status:** Custom Turnstile implementation active

**Purpose:** Bot protection for sign-up/login.

**Current Implementation:**
- Cloudflare Turnstile integrated at sign-up/login
- Middleware: `worker/middleware/turnstile.ts`
- Frontend: Turnstile component in sign-up/sign-in forms

**Better Auth captcha() Plugin:**
- Generic captcha integration
- Supports reCAPTCHA, hCaptcha, Turnstile

**Recommendation:** ❌ **NOT NEEDED** - Custom Turnstile integration sufficient
- Our implementation is well-integrated
- Better Auth plugin adds unnecessary abstraction

---

### 📋 openAPI() Plugin
**Status:** Partial - Hono OpenAPI active

**Purpose:** Auto-generate OpenAPI docs for auth endpoints.

**Current State:**
- Hono OpenAPI integration at `/api/openapi.json` (hono-app.ts:41)
- Documents custom routes
- Better Auth endpoints not documented

**Better Auth openAPI() Plugin:**
```typescript
import { openAPI } from "better-auth/plugins"

openAPI()  // Exposes GET /api/auth/.well-known/openapi.json
```

**Pros:**
- ✅ Documents all auth endpoints
- ✅ Enables Postman import
- ✅ API exploration

**Cons:**
- ❌ Separate OpenAPI spec (/api/auth/.well-known/openapi.json)
- ❌ Need to merge with Hono OpenAPI spec

**Recommendation:** 🔄 **CONSIDER** - Good for developer experience
- Priority: Low
- Complexity: Low
- Implement when consolidating API documentation

---

## Implementation Priority

### Phase 1 (Immediate - This PR)
1. ✅ Document all plugins (this document)
2. 🔄 Implement `organization()` plugin
   - Add database schema
   - Run migration
   - Update frontend service
   - Add organization management UI (optional)

### Phase 2 (Near-term)
3. 🔄 Evaluate `magicLink()` plugin
   - Requires email service decision
   - Implement once email provider chosen

4. 🔄 Consider `hibp()` plugin
   - Low complexity, high security value
   - Implement after organization plugin stabilized

### Phase 3 (Future)
5. 🔄 Evaluate `openAPI()` plugin
   - Improve developer experience
   - Consolidate API documentation

6. ⏸️ Defer `username()` plugin
   - Revisit if community features added

7. ❌ Skip `jwt()` and `captcha()` plugins
   - Already covered by bearer() and custom Turnstile

---

## ZTA Compliance Notes

All Better Auth endpoints must comply with Zero Trust Architecture:

### Endpoint Security Requirements
- **Edge Layer:** WAF/API Shield in sync with OpenAPI spec, CORS allowlist
- **Worker Layer:** Auth chain before business logic, rate limiting on all endpoints
- **Validation:** Zod schemas at trust boundaries
- **Telemetry:** Security events for auth failures

### Plugin-Specific ZTA
- `organization()`: Membership checks before org operations
- `magicLink()`: Token expiry validation (default: 5 minutes)
- `hibp()`: No PII sent to external API (k-anonymity)

---

## Database Migration Strategy

### For organization() Plugin

**Step 1: Generate schema changes**
```bash
# Add Organization and Member models to schema.prisma
deno task db:migrate
```

**Step 2: Apply migration**
```bash
deno task db:migrate:deploy
```

**Step 3: Verify migration**
```sql
-- Check tables created
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('organizations', 'members');
```

**Rollback Plan:** Keep migration reversible
```sql
-- Rollback SQL (if needed)
DROP TABLE IF EXISTS members;
DROP TABLE IF EXISTS organizations;
```

---

## Frontend Integration Guide

### Adding Organization Support

**Step 1: Extend BetterAuthService**
```typescript
// frontend/src/app/services/better-auth.service.ts

async createOrganization(name: string, slug: string): Promise<void> {
  const res = await fetch(`${this.apiBaseUrl}/auth/organization/create`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, slug })
  });
  if (!res.ok) throw new Error('Failed to create organization');
}

async listOrganizations(): Promise<Organization[]> {
  const res = await fetch(`${this.apiBaseUrl}/auth/organization/list-organizations`, {
    credentials: 'include'
  });
  if (!res.ok) throw new Error('Failed to list organizations');
  return await res.json();
}
```

**Step 2: Create OrganizationService (optional)**
```typescript
// frontend/src/app/services/organization.service.ts

@Injectable({ providedIn: 'root' })
export class OrganizationService {
  private readonly authService = inject(BetterAuthService);

  async inviteMember(orgId: string, email: string, role: string) { ... }
  async removeMember(orgId: string, userId: string) { ... }
  async updateMemberRole(orgId: string, userId: string, role: string) { ... }
}
```

---

## Testing Strategy

### Unit Tests
- [ ] Test organization CRUD operations
- [ ] Test member invitation workflow
- [ ] Test role permission checks

### Integration Tests
- [ ] Test multi-user organization scenarios
- [ ] Test organization-scoped API keys (if implemented)
- [ ] Test organization ownership transfer

### E2E Tests
- [ ] Test organization creation flow
- [ ] Test member invitation acceptance
- [ ] Test organization switching in UI

---

## Security Considerations

### organization() Plugin
- ✅ Role-based access control (owner/admin/member)
- ✅ Unique org slugs prevent enumeration
- ⚠️ Verify membership before org operations
- ⚠️ Rate-limit org creation (prevent spam)

### API Key Management
- ✅ Keep custom implementation with scopes
- ✅ Maintain per-key rate limits
- ✅ Log API key usage for audit

---

## Cost Analysis

### Infrastructure Costs
- **organization() plugin:**
  - Database: +2 tables, minimal storage impact
  - Worker CPU: Negligible (membership lookups cached)

- **magicLink() plugin:**
  - Email service: ~$0.001 per email (Resend/Postmark)
  - Volume: Depends on user sign-ups

- **hibp() plugin:**
  - External API: Free (Cloudflare partnership)
  - Latency: +200ms on password operations

---

## Maintenance Implications

### Better Auth Updates
- Current version: ^1.5.6
- Update frequency: Monthly releases
- Breaking changes: Rare (semantic versioning)

### Plugin Maintenance
- Built-in plugins: Updated with Better Auth core
- Custom plugins: Maintained separately
- Migration effort: Low (plugins are modular)

---

## Conclusion

**Summary of Recommendations:**

✅ **Keep Active (4):**
- bearer, twoFactor, multiSession, admin

🔄 **Implement Now (1):**
- organization (multi-tenancy support)

📋 **Consider Future (3):**
- magicLink (when email service ready)
- hibp (low-hanging security fruit)
- openAPI (developer experience)

⏸️ **Defer (1):**
- username (not critical)

❌ **Skip (2):**
- jwt (bearer sufficient)
- captcha (Turnstile active)

**Next Steps:**
1. Implement organization() plugin
2. Generate and apply database migration
3. Update frontend service
4. Test multi-tenancy workflows
5. Document usage for team administrators

---

## References

- [Better Auth Documentation](https://better-auth.com)
- [Better Auth Plugins Reference](https://better-auth.com/docs/plugins/overview)
- [Organization Plugin Docs](https://better-auth.com/docs/plugins/organization)
- [API Key Plugin Docs](https://better-auth.com/docs/plugins/api-key)
- [Two-Factor Plugin Docs](https://better-auth.com/docs/plugins/two-factor)
- [Project Prisma Schema](../../prisma/schema.prisma)
- [Auth Configuration](../../worker/lib/auth.ts)
