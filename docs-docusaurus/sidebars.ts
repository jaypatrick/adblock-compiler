import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

/**
 * Docusaurus sidebar configuration generated from docs/SUMMARY.md.
 *
 * All 174 entries from the mdBook SUMMARY.md are represented here.
 * Sidebar `id` values are relative to the Docusaurus docs content root
 * (configured as `path: '../docs'`) — they do NOT include a `../docs/` prefix.
 * For example, `api/README` resolves to `docs/api/README.md` on disk.
 *
 * Note: `.md` extensions are intentionally omitted per Docusaurus convention.
 */
const sidebars: SidebarsConfig = {
    docsSidebar: [
        { type: 'doc', id: 'README', label: 'Introduction' },
        { type: 'doc', id: 'api-reference', label: 'API Reference' },

        // ── REST / HTTP API ────────────────────────────────────────────────
        {
            type: 'category',
            label: 'REST / HTTP API',
            link: { type: 'doc', id: 'api/README' },
            items: [
                { type: 'doc', id: 'api/AGTREE_INTEGRATION', label: 'AGTree Integration' },
                { type: 'doc', id: 'api/AST_WALK', label: 'AST Walk' },
                { type: 'doc', id: 'api/BATCH_API_GUIDE', label: 'Batch API Guide' },
                { type: 'doc', id: 'api/CONFIGURATION_API', label: 'Configuration API' },
                { type: 'doc', id: 'api/LIBRARY', label: 'Library API' },
                { type: 'doc', id: 'api/NOTIFICATIONS', label: 'Notifications' },
                { type: 'doc', id: 'api/OPENAPI_SUPPORT', label: 'OpenAPI Support' },
                { type: 'doc', id: 'api/OPENAPI_TOOLING', label: 'OpenAPI Tooling' },
                { type: 'doc', id: 'api/PLATFORM_SUPPORT', label: 'Platform Support' },
                { type: 'doc', id: 'api/QUICK_REFERENCE', label: 'Quick Reference' },
                { type: 'doc', id: 'api/REGISTRY_UI_INTEGRATION', label: 'Registry UI Integration' },
                { type: 'doc', id: 'api/RULE_SETS', label: 'Rule Sets' },
                { type: 'doc', id: 'api/STREAMING_API', label: 'Streaming API' },
                { type: 'doc', id: 'api/VALIDATE_RULE', label: 'Validate Rule' },
                { type: 'doc', id: 'api/ZOD_VALIDATION', label: 'Zod Validation' },
            ],
        },

        // ── Observability ──────────────────────────────────────────────────
        {
            type: 'category',
            label: 'Observability',
            link: { type: 'doc', id: 'observability/README' },
            items: [
                { type: 'doc', id: 'observability/SENTRY', label: 'Sentry Integration' },
                { type: 'doc', id: 'observability/SENTRY_BEST_PRACTICES', label: 'Sentry Best Practices' },
                { type: 'doc', id: 'observability/SENTRY_DURABLE_OBJECTS', label: 'Sentry Durable Objects & Workflows' },
                { type: 'doc', id: 'observability/CLOUDFLARE_OBSERVABILITY', label: 'Cloudflare Native Observability' },
                { type: 'doc', id: 'observability/PROMETHEUS', label: 'Prometheus Metrics' },
                { type: 'doc', id: 'observability/LOGPUSH', label: 'Logpush → R2' },
                { type: 'doc', id: 'observability/PROVIDERS', label: 'Custom Providers' },
            ],
        },

        // ── Cloudflare Integration ─────────────────────────────────────────
        {
            type: 'category',
            label: 'Cloudflare Integration',
            link: { type: 'doc', id: 'cloudflare/README' },
            items: [
                { type: 'doc', id: 'cloudflare/CLOUDFLARE_SERVICES', label: 'Services Overview' },
                { type: 'doc', id: 'cloudflare/ADMIN_DASHBOARD', label: 'Admin Dashboard' },
                { type: 'doc', id: 'cloudflare/AGENTS', label: 'Agents SDK' },
                { type: 'doc', id: 'cloudflare/CLOUDFLARE_ANALYTICS', label: 'Analytics' },
                { type: 'doc', id: 'cloudflare/BROWSER_RENDERING', label: 'Browser Rendering' },
                { type: 'doc', id: 'cloudflare/CLOUDFLARE_D1', label: 'D1 Database' },
                { type: 'doc', id: 'cloudflare/CLOUDFLARE_WORKFLOWS', label: 'Workflows' },
                { type: 'doc', id: 'cloudflare/QUEUE_DIAGNOSTICS', label: 'Queue Diagnostics' },
                { type: 'doc', id: 'cloudflare/QUEUE_SUPPORT', label: 'Queue Support' },
                { type: 'doc', id: 'cloudflare/WORKER_E2E_TESTS', label: 'Worker E2E Tests' },
                { type: 'doc', id: 'cloudflare/EMAIL_SERVICE', label: 'Email Service' },
                { type: 'doc', id: 'cloudflare/EMAIL_DELIVERY_WORKFLOW', label: 'Email Delivery Workflow' },
            ],
        },

        // ── Database Setup ─────────────────────────────────────────────────
        {
            type: 'category',
            label: 'Database Setup',
            link: { type: 'doc', id: 'database-setup/README' },
            items: [
                { type: 'doc', id: 'database-setup/multi-tenancy-schema', label: 'Multi-Tenancy Schema' },
                { type: 'doc', id: 'database-setup/DATABASE_ARCHITECTURE', label: 'Architecture' },
                { type: 'doc', id: 'database-setup/neon-migration-summary', label: 'Neon Migration Summary' },
                { type: 'doc', id: 'database-setup/neon-setup', label: 'Neon Setup' },
                { type: 'doc', id: 'database-setup/neon-branching', label: 'Neon Branching' },
                { type: 'doc', id: 'database-setup/edge-cache-architecture', label: 'Edge Cache Architecture' },
                { type: 'doc', id: 'database-setup/migration-checklist', label: 'Migration Checklist' },
                { type: 'doc', id: 'database-setup/local-dev', label: 'Local Development' },
                { type: 'doc', id: 'database-setup/postgres-modern', label: 'Modern Postgres' },
                { type: 'doc', id: 'database-setup/prisma-schema-reference', label: 'Prisma Schema Reference' },
                { type: 'doc', id: 'database-setup/prisma-deno-compatibility', label: 'Prisma Deno Compatibility' },
                { type: 'doc', id: 'database-setup/DATABASE_EVALUATION', label: 'Evaluation' },
                { type: 'doc', id: 'database-setup/PRISMA_EVALUATION', label: 'Prisma Evaluation' },
            ],
        },

        // ── Deployment ────────────────────────────────────────────────────
        {
            type: 'category',
            label: 'Deployment',
            link: { type: 'doc', id: 'deployment/README' },
            items: [
                { type: 'doc', id: 'deployment/cloudflare-containers', label: 'Cloudflare Containers' },
                { type: 'doc', id: 'deployment/cloudflare-pages', label: 'Cloudflare Pages' },
                { type: 'doc', id: 'deployment/CLOUDFLARE_WORKERS_ARCHITECTURE', label: 'Cloudflare Workers Architecture' },
                { type: 'doc', id: 'deployment/ENVIRONMENTS', label: 'Deployment Environments' },
                { type: 'doc', id: 'deployment/DEPLOYMENT_VERSIONING', label: 'Deployment Versioning' },
                { type: 'doc', id: 'deployment/GRADUAL_DEPLOYMENTS', label: 'Gradual Deployments' },
                { type: 'doc', id: 'deployment/DISASTER_RECOVERY', label: 'Disaster Recovery' },
                { type: 'doc', id: 'deployment/DOCKER', label: 'Docker' },
                { type: 'doc', id: 'deployment/PRODUCTION_READINESS', label: 'Production Readiness' },
                { type: 'doc', id: 'deployment/PRODUCTION_SECRETS', label: 'Production Secrets' },
            ],
        },

        // ── Development ───────────────────────────────────────────────────
        {
            type: 'category',
            label: 'Development',
            link: { type: 'doc', id: 'development/README' },
            items: [
                { type: 'doc', id: 'development/ARCHITECTURE', label: 'Architecture' },
                { type: 'doc', id: 'development/benchmarks', label: 'Benchmarks' },
                { type: 'doc', id: 'development/CIRCUIT_BREAKER', label: 'Circuit Breaker' },
                { type: 'doc', id: 'development/CODE_REVIEW', label: 'Code Review' },
                { type: 'doc', id: 'development/DEVELOPER_ONBOARDING', label: 'Developer Onboarding' },
                { type: 'doc', id: 'development/DIAGNOSTICS', label: 'Diagnostics' },
                { type: 'doc', id: 'development/DIAG_FULL', label: 'Full Diagnostics Tool' },
                { type: 'doc', id: 'development/ERROR_REPORTING', label: 'Error Reporting' },
                { type: 'doc', id: 'development/EXTENSIBILITY', label: 'Extensibility' },
                { type: 'doc', id: 'development/HOOKS', label: 'Hooks' },
                { type: 'doc', id: 'development/COUNT_LOC', label: 'Lines of Code Counter' },
                { type: 'doc', id: 'development/LOGGING', label: 'Logging' },
            ],
        },

        // ── Architecture ──────────────────────────────────────────────────
        {
            type: 'category',
            label: 'Architecture',
            link: { type: 'doc', id: 'architecture/SYSTEM_ARCHITECTURE' },
            items: [
                { type: 'doc', id: 'architecture/MULTI_TENANCY', label: 'Multi-Tenancy Architecture' },
                { type: 'doc', id: 'architecture/hono-routing', label: 'Hono Routing' },
                { type: 'doc', id: 'architecture/hono-rpc-client', label: 'Hono RPC Client' },
                { type: 'doc', id: 'architecture/trpc', label: 'tRPC API Layer' },
                { type: 'doc', id: 'architecture/durable-objects', label: 'Durable Objects' },
            ],
        },

        // ── Frontend ──────────────────────────────────────────────────────
        {
            type: 'category',
            label: 'Frontend',
            link: { type: 'doc', id: 'frontend/README' },
            items: [
                { type: 'doc', id: 'frontend/ANGULAR_FRONTEND', label: 'Angular Frontend' },
                { type: 'doc', id: 'frontend/ANGULAR_PARITY_CHECKLIST', label: 'Angular Parity Checklist' },
                { type: 'doc', id: 'frontend/SPA_BENEFITS', label: 'SPA Benefits' },
                { type: 'doc', id: 'frontend/TAILWIND_CSS', label: 'Tailwind CSS' },
                { type: 'doc', id: 'frontend/VALIDATION_UI', label: 'Validation UI' },
                { type: 'doc', id: 'frontend/VITE', label: 'Vite' },
            ],
        },

        // ── Guides ────────────────────────────────────────────────────────
        {
            type: 'category',
            label: 'Guides',
            link: { type: 'doc', id: 'guides/README' },
            items: [
                { type: 'doc', id: 'guides/quick-start', label: 'Quick Start' },
                { type: 'doc', id: 'guides/clients', label: 'Clients' },
                { type: 'doc', id: 'guides/USER_MIGRATION_GUIDE', label: 'User Migration Guide' },
                { type: 'doc', id: 'guides/TROUBLESHOOTING', label: 'Troubleshooting' },
                { type: 'doc', id: 'guides/VALIDATION_ERRORS', label: 'Validation Errors' },
            ],
        },

        // ── Usage ─────────────────────────────────────────────────────────
        {
            type: 'category',
            label: 'Usage',
            link: { type: 'doc', id: 'usage/CONFIGURATION' },
            items: [
                { type: 'doc', id: 'usage/CLI', label: 'CLI Reference' },
                { type: 'doc', id: 'usage/TRANSFORMATIONS', label: 'Transformations' },
            ],
        },

        // ── Configuration Manager ─────────────────────────────────────────
        {
            type: 'category',
            label: 'Configuration Manager',
            link: { type: 'doc', id: 'configuration/README' },
            items: [
                { type: 'doc', id: 'configuration/schema-reference', label: 'Schema Reference' },
                { type: 'doc', id: 'configuration/env-overrides', label: 'Environment Overrides' },
                { type: 'doc', id: 'configuration/flow-diagram', label: 'Load Flow Diagram' },
                { type: 'doc', id: 'configuration/terraform-extensibility', label: 'Terraform / IaC Extensibility' },
            ],
        },

        // ── Postman ───────────────────────────────────────────────────────
        { type: 'doc', id: 'postman/README', label: 'Postman' },

        // ── Reference ─────────────────────────────────────────────────────
        {
            type: 'category',
            label: 'Reference',
            link: { type: 'doc', id: 'reference/README' },
            items: [
                { type: 'doc', id: 'reference/AUTO_VERSION_BUMP', label: 'Auto Version Bump' },
                { type: 'doc', id: 'reference/BUGS_AND_FEATURES', label: 'Bugs & Features' },
                { type: 'doc', id: 'reference/ENV_CONFIGURATION', label: 'Environment Configuration' },
                { type: 'doc', id: 'reference/GITHUB_ISSUE_TEMPLATES', label: 'GitHub Issue Templates' },
                { type: 'doc', id: 'reference/LIGHTHOUSE_CI', label: 'Lighthouse CI' },
                { type: 'doc', id: 'reference/claude', label: 'AI Assistant Guide' },
                { type: 'doc', id: 'reference/VERSION_MANAGEMENT', label: 'Version Management' },
            ],
        },

        // ── Releases ──────────────────────────────────────────────────────
        {
            type: 'category',
            label: 'Releases',
            link: { type: 'doc', id: 'releases/README' },
            items: [
                { type: 'doc', id: 'releases/RELEASE_0.8.0', label: 'v0.8.0 Release Notes' },
                { type: 'doc', id: 'releases/BLOG_POST_ADBLOCK_COMPILER', label: 'Blog Post' },
            ],
        },

        // ── Authentication & Authorization ────────────────────────────────
        {
            type: 'category',
            label: 'Authentication & Authorization',
            link: { type: 'doc', id: 'auth/README' },
            items: [
                { type: 'doc', id: 'auth/multi-tenancy', label: 'Multi-Tenancy & Organizations' },
                { type: 'doc', id: 'auth/auth-provider-selection', label: 'Auth Provider Selection' },
                { type: 'doc', id: 'auth/auth-chain-reference', label: 'Auth Chain Reference' },
                { type: 'doc', id: 'auth/better-auth-prisma', label: 'Better Auth + Prisma' },
                { type: 'doc', id: 'auth/migration-clerk-to-better-auth', label: 'Migration: Clerk → Better Auth' },
                { type: 'doc', id: 'auth/configuration', label: 'Configuration Guide' },
                { type: 'doc', id: 'auth/developer-guide', label: 'Developer Guide' },
                { type: 'doc', id: 'auth/api-authentication', label: 'API Authentication' },
                { type: 'doc', id: 'auth/admin-access', label: 'Admin Access' },
                { type: 'doc', id: 'auth/removing-anonymous-access', label: 'Removing Anonymous Access' },
                { type: 'doc', id: 'auth/cli-authentication', label: 'CLI Authentication' },
                { type: 'doc', id: 'auth/clerk-setup', label: 'Clerk Dashboard Setup' },
                { type: 'doc', id: 'auth/clerk-cloudflare-integration', label: 'Clerk + Cloudflare Integration' },
                { type: 'doc', id: 'auth/cloudflare-access', label: 'Cloudflare Access' },
                { type: 'doc', id: 'auth/postman-testing', label: 'Postman Auth Testing' },
                { type: 'doc', id: 'auth/email-architecture', label: 'Email Architecture' },
                { type: 'doc', id: 'auth/resend-contact-sync', label: 'Resend Contact Sync' },
                { type: 'doc', id: 'auth/zta-review-fixes', label: 'ZTA Review Fixes' },
            ],
        },

        // ── Admin System ──────────────────────────────────────────────────
        {
            type: 'category',
            label: 'Admin System',
            link: { type: 'doc', id: 'admin/README' },
            items: [
                { type: 'doc', id: 'admin/subscription-plans', label: 'Subscription Plans' },
                { type: 'doc', id: 'admin/roles-permissions', label: 'Roles & Permissions' },
                { type: 'doc', id: 'admin/api-reference', label: 'API Reference' },
                { type: 'doc', id: 'admin/database-schema', label: 'Database Schema' },
                { type: 'doc', id: 'admin/feature-flags', label: 'Feature Flags' },
                { type: 'doc', id: 'admin/neon-api-service', label: 'Neon API Service' },
                { type: 'doc', id: 'admin/neon-endpoints', label: 'Neon Admin Endpoints' },
                { type: 'doc', id: 'admin/observability', label: 'Observability & Audit' },
                { type: 'doc', id: 'admin/operator-guide', label: 'Operator Guide' },
            ],
        },

        // ── Security ──────────────────────────────────────────────────────
        {
            type: 'category',
            label: 'Security',
            link: { type: 'doc', id: 'security/ZERO_TRUST_ARCHITECTURE' },
            items: [
                { type: 'doc', id: 'security/ZTA_DEVELOPER_GUIDE', label: 'ZTA Developer Guide' },
                { type: 'doc', id: 'security/API_SHIELD_VULNERABILITY_SCANNER', label: 'API Shield Vulnerability Scanner' },
                { type: 'doc', id: 'security/PAGE_SHIELD_INTEGRATION', label: 'Page Shield Integration' },
                { type: 'doc', id: 'security/API_SHIELD_WEB_ASSETS', label: 'Automated Web Asset Sync' },
            ],
        },

        // ── Testing ───────────────────────────────────────────────────────
        {
            type: 'category',
            label: 'Testing',
            link: { type: 'doc', id: 'testing/README' },
            items: [
                { type: 'doc', id: 'testing/testing', label: 'Testing Guide' },
                { type: 'doc', id: 'testing/database-testing', label: 'Database Testing' },
                { type: 'doc', id: 'testing/E2E_TESTING', label: 'E2E Testing' },
                { type: 'doc', id: 'testing/POSTMAN_TESTING', label: 'Postman Testing' },
            ],
        },

        // ── Troubleshooting ───────────────────────────────────────────────
        {
            type: 'category',
            label: 'Troubleshooting',
            link: { type: 'doc', id: 'troubleshooting/README' },
            items: [
                { type: 'doc', id: 'troubleshooting/KB-001-api-not-available', label: 'KB-001: API Not Available' },
                { type: 'doc', id: 'troubleshooting/KB-002-hyperdrive-database-down', label: 'KB-002: Hyperdrive Database Down' },
                { type: 'doc', id: 'troubleshooting/KB-003-neon-hyperdrive-live-session-2026-03-25', label: 'KB-003: Database Down After Deploy' },
                { type: 'doc', id: 'troubleshooting/KB-004-prisma-wasm-cloudflare', label: 'KB-004: Prisma WASM Error' },
                { type: 'doc', id: 'troubleshooting/neon-troubleshooting', label: 'Neon Troubleshooting' },
            ],
        },

        // ── Ops Tools ─────────────────────────────────────────────────────
        {
            type: 'category',
            label: 'Ops Tools',
            link: { type: 'doc', id: 'tools/README' },
            items: [
                { type: 'doc', id: 'tools/auth-healthcheck', label: 'auth-healthcheck' },
            ],
        },

        // ── Workflows ─────────────────────────────────────────────────────
        {
            type: 'category',
            label: 'Workflows',
            link: { type: 'doc', id: 'workflows/README' },
            items: [
                { type: 'doc', id: 'workflows/WORKFLOWS', label: 'Workflows Reference' },
                { type: 'doc', id: 'workflows/ACTIONLINT', label: 'Workflow Linting' },
                { type: 'doc', id: 'workflows/ENV_SETUP', label: 'Environment Setup' },
                { type: 'doc', id: 'workflows/WORKFLOW_DIAGRAMS', label: 'Workflow Diagrams' },
                { type: 'doc', id: 'workflows/WORKFLOW_IMPROVEMENTS', label: 'Workflow Improvements' },
                { type: 'doc', id: 'workflows/WORKFLOW_CLEANUP_SUMMARY', label: 'Workflow Cleanup Summary' },
            ],
        },

        // ── Threat Intelligence ───────────────────────────────────────────
        { type: 'doc', id: 'threat-intel/INGESTION_AND_MCP_DESIGN', label: 'Threat Intelligence' },
    ],
};

export default sidebars;
