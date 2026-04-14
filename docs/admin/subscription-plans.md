# Subscription Plans — Admin Operations Guide

This guide covers how to manage subscription plans, assign plans to users and organisations, set member tier overrides, and handle the seed data.

---

## Viewing Plans

### Via Direct Database Query

```sql
SELECT id, name, display_name, is_org_only,
       rate_limit_per_minute, rate_limit_per_day,
       max_filter_sources, max_compiled_outputs,
       ast_storage_enabled, translation_enabled,
       global_sharing_enabled, batch_api_enabled,
       retention_days
FROM subscription_plans
ORDER BY retention_days;
```

### Via Admin API

```http
GET /admin/subscription-plans
Authorization: Bearer <admin-token>
```

---

## Assigning a Plan to a User

To upgrade a user from `free` to `pro`, update both `plan_id` (authoritative) and `tier` (denormalized cache):

```sql
-- Look up the plan ID first
SELECT id FROM subscription_plans WHERE name = 'pro';

-- Then assign
UPDATE users
SET
    plan_id = '<pro-plan-uuid>',
    tier    = 'pro',
    updated_at = now()
WHERE id = '<user-uuid>';
```

> **Important:** Always update `tier` alongside `plan_id`. The `tier` field is a denormalized cache used by the Worker hot path to avoid a JOIN on every request.

### Via Admin API

```http
PATCH /admin/users/:userId
Content-Type: application/json
Authorization: Bearer <admin-token>

{
  "planId": "<pro-plan-uuid>",
  "tier": "pro"
}
```

---

## Assigning a Plan to an Organisation

```sql
-- Look up the plan ID
SELECT id, retention_days FROM subscription_plans WHERE name = 'vendor';

-- Assign plan, update denormalized fields
UPDATE organization
SET
    plan_id       = '<vendor-plan-uuid>',
    tier          = 'vendor',
    retention_days = 365,
    updated_at    = now()
WHERE id = '<org-uuid>';
```

> Copy `subscription_plans.retention_days` to `organization.retention_days` to keep the retention enforcement cache in sync.

### Via Admin API

```http
PATCH /admin/organizations/:orgId
Content-Type: application/json
Authorization: Bearer <admin-token>

{
  "planId": "<vendor-plan-uuid>",
  "tier": "vendor",
  "retentionDays": 365
}
```

---

## Setting a Member Tier Override

To restrict a specific org member to a lower tier than the org plan (e.g. a contractor on a vendor org limited to pro features):

```sql
UPDATE member
SET
    tier_override = 'pro',
    updated_at    = now()
WHERE organization_id = '<org-uuid>'
  AND user_id         = '<member-user-uuid>';
```

To remove an override (revert to inheriting the org plan):

```sql
UPDATE member
SET
    tier_override = NULL,
    updated_at    = now()
WHERE organization_id = '<org-uuid>'
  AND user_id         = '<member-user-uuid>';
```

---

## Seed Data

The four base plans are seeded automatically in the migration `20260414000000_multi_tenant_shared_schema`. To re-seed if the table is empty:

```sql
INSERT INTO subscription_plans (
    id, name, display_name, is_org_only,
    max_api_keys_per_user, rate_limit_per_minute, rate_limit_per_day,
    max_filter_sources, max_compiled_outputs, max_org_members,
    ast_storage_enabled, translation_enabled, global_sharing_enabled,
    batch_api_enabled, retention_days,
    created_at, updated_at
) VALUES
-- free
(gen_random_uuid(), 'free', 'Free', false,
 3, 60, 1000, 10, 50, NULL,
 false, false, false, false, 90,
 now(), now()),
-- pro
(gen_random_uuid(), 'pro', 'Pro', false,
 10, 300, 10000, 100, 500, NULL,
 true, true, true, false, 180,
 now(), now()),
-- vendor
(gen_random_uuid(), 'vendor', 'Vendor', true,
 25, 1000, 100000, -1, -1, NULL,
 true, true, true, true, 365,
 now(), now()),
-- enterprise
(gen_random_uuid(), 'enterprise', 'Enterprise', true,
 25, 1000, 100000, -1, -1, NULL,
 true, true, true, true, 730,
 now(), now())
ON CONFLICT (name) DO NOTHING;
```

> `max_filter_sources = -1` and `max_compiled_outputs = -1` are sentinel values for "unlimited" — enforce this in application code by checking `value === -1`.

---

## Creating a Custom Enterprise Plan

For an enterprise customer with bespoke limits:

```sql
INSERT INTO subscription_plans (
    id, name, display_name, is_org_only,
    max_api_keys_per_user, rate_limit_per_minute, rate_limit_per_day,
    max_filter_sources, max_compiled_outputs, max_org_members,
    ast_storage_enabled, translation_enabled, global_sharing_enabled,
    batch_api_enabled, retention_days,
    created_at, updated_at
) VALUES (
    gen_random_uuid(),
    'enterprise_acme',          -- unique slug for this customer
    'Enterprise (Acme Corp)',
    true,
    50,                         -- custom key limit
    2000, 500000,               -- custom rate limits
    -1, -1,                     -- unlimited sources and outputs
    100,                        -- max 100 org members
    true, true, true, true,
    1095,                       -- 3-year retention for compliance
    now(), now()
);
```

Then assign to the org as described in [Assigning a Plan to an Organisation](#assigning-a-plan-to-an-organisation).

---

## Rate Limit Precedence

When a request arrives, rate limits are enforced in the following order:

1. **Per-key** (`ApiKey.rateLimitPerMinute`): The limit on the specific API key used
2. **Per-plan** (`SubscriptionPlan.rateLimitPerMinute`): The ceiling for the user/org's plan tier
3. **Per-plan daily** (`SubscriptionPlan.rateLimitPerDay`): Daily aggregate cap

The per-key limit is always applied first. A key configured with a lower limit than the plan acts as an intentional throttle (useful for CI/CD keys that should not consume the full plan quota).

### Org vs. Solo Rate Limits

Org-tier plans (`vendor`, `enterprise`) have limits not available to solo users:

| Plan | req/min | req/day | Notes |
|---|---|---|---|
| `free` | 60 | 1,000 | Solo only |
| `pro` | 300 | 10,000 | Solo only |
| `vendor` | 1,000 | 100,000 | Org only (`isOrgOnly = true`) |
| `enterprise` | 1,000 | 100,000 | Org only (`isOrgOnly = true`) |

### Enforcing `isOrgOnly`

Before assigning a `vendor` or `enterprise` plan to a user, validate:

```typescript
if (plan.isOrgOnly && !organizationId) {
    throw new Error('Vendor and enterprise plans are only available to organisations.');
}
```

This check should be in both the admin API handler and any self-serve upgrade flow.
