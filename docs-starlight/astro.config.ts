import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: cloudflare(),
  site: "https://docs-v3.bloqr.dev",

  // Read Markdown content directly from the existing docs/ directory.
  // No file copying needed — Starlight serves them in place.
  srcDir: "../docs",

  integrations: [
    starlight({
      title: "Bloqr",
      description: "Adblock/AdGuard Hostlist & Rules Compiler",
      logo: {
        src: "./src/assets/logo.svg",
        alt: "Bloqr",
      },
      editLink: {
        baseUrl:
          "https://github.com/jaypatrick/adblock-compiler/edit/main/docs/",
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/jaypatrick/adblock-compiler",
        },
      ],
      customCss: ["./src/styles/custom.css"],
      // Pagefind is Starlight's built-in search — no extra config needed.
      sidebar: [
        { label: "Introduction", link: "/" },
        { label: "API Reference", link: "/api-reference" },
        {
          label: "REST / HTTP API",
          items: [
            { label: "Overview", link: "/api/" },
            { label: "AGTree Integration", link: "/api/AGTREE_INTEGRATION" },
            { label: "AST Walk", link: "/api/AST_WALK" },
            { label: "Batch API Guide", link: "/api/BATCH_API_GUIDE" },
            { label: "Configuration API", link: "/api/CONFIGURATION_API" },
            { label: "Library API", link: "/api/LIBRARY" },
            { label: "Notifications", link: "/api/NOTIFICATIONS" },
            { label: "OpenAPI Support", link: "/api/OPENAPI_SUPPORT" },
            { label: "OpenAPI Tooling", link: "/api/OPENAPI_TOOLING" },
            { label: "Platform Support", link: "/api/PLATFORM_SUPPORT" },
            { label: "Quick Reference", link: "/api/QUICK_REFERENCE" },
            {
              label: "Registry UI Integration",
              link: "/api/REGISTRY_UI_INTEGRATION",
            },
            { label: "Rule Sets", link: "/api/RULE_SETS" },
            { label: "Streaming API", link: "/api/STREAMING_API" },
            { label: "Validate Rule", link: "/api/VALIDATE_RULE" },
            { label: "Zod Validation", link: "/api/ZOD_VALIDATION" },
          ],
        },
        {
          label: "Observability",
          items: [
            { label: "Overview", link: "/observability/" },
            { label: "Sentry Integration", link: "/observability/SENTRY" },
            {
              label: "Sentry Best Practices",
              link: "/observability/SENTRY_BEST_PRACTICES",
            },
            {
              label: "Sentry Durable Objects & Workflows",
              link: "/observability/SENTRY_DURABLE_OBJECTS",
            },
            {
              label: "Cloudflare Native Observability",
              link: "/observability/CLOUDFLARE_OBSERVABILITY",
            },
            { label: "Prometheus Metrics", link: "/observability/PROMETHEUS" },
            { label: "Logpush → R2", link: "/observability/LOGPUSH" },
            { label: "Custom Providers", link: "/observability/PROVIDERS" },
          ],
        },
        {
          label: "Cloudflare Integration",
          items: [
            { label: "Overview", link: "/cloudflare/" },
            {
              label: "Services Overview",
              link: "/cloudflare/CLOUDFLARE_SERVICES",
            },
            { label: "Admin Dashboard", link: "/cloudflare/ADMIN_DASHBOARD" },
            { label: "Agents SDK", link: "/cloudflare/AGENTS" },
            { label: "Analytics", link: "/cloudflare/CLOUDFLARE_ANALYTICS" },
            {
              label: "Browser Rendering",
              link: "/cloudflare/BROWSER_RENDERING",
            },
            { label: "D1 Database", link: "/cloudflare/CLOUDFLARE_D1" },
            { label: "Workflows", link: "/cloudflare/CLOUDFLARE_WORKFLOWS" },
            {
              label: "Queue Diagnostics",
              link: "/cloudflare/QUEUE_DIAGNOSTICS",
            },
            { label: "Queue Support", link: "/cloudflare/QUEUE_SUPPORT" },
            { label: "Worker E2E Tests", link: "/cloudflare/WORKER_E2E_TESTS" },
            { label: "Email Service", link: "/cloudflare/EMAIL_SERVICE" },
            {
              label: "Email Delivery Workflow",
              link: "/cloudflare/EMAIL_DELIVERY_WORKFLOW",
            },
          ],
        },
        {
          label: "Database Setup",
          items: [
            { label: "Overview", link: "/database-setup/" },
            {
              label: "Multi-Tenancy Schema",
              link: "/database-setup/multi-tenancy-schema",
            },
            {
              label: "Architecture",
              link: "/database-setup/DATABASE_ARCHITECTURE",
            },
            {
              label: "Neon Migration Summary",
              link: "/database-setup/neon-migration-summary",
            },
            { label: "Neon Setup", link: "/database-setup/neon-setup" },
            { label: "Neon Branching", link: "/database-setup/neon-branching" },
            {
              label: "Edge Cache Architecture",
              link: "/database-setup/edge-cache-architecture",
            },
            {
              label: "Migration Checklist",
              link: "/database-setup/migration-checklist",
            },
            { label: "Local Development", link: "/database-setup/local-dev" },
            {
              label: "Modern Postgres",
              link: "/database-setup/postgres-modern",
            },
            {
              label: "Prisma Schema Reference",
              link: "/database-setup/prisma-schema-reference",
            },
            {
              label: "Prisma Deno Compatibility",
              link: "/database-setup/prisma-deno-compatibility",
            },
            {
              label: "Evaluation",
              link: "/database-setup/DATABASE_EVALUATION",
            },
            {
              label: "Prisma Evaluation",
              link: "/database-setup/PRISMA_EVALUATION",
            },
          ],
        },
        {
          label: "Deployment",
          items: [
            { label: "Overview", link: "/deployment/" },
            {
              label: "Cloudflare Containers",
              link: "/deployment/cloudflare-containers",
            },
            { label: "Cloudflare Pages", link: "/deployment/cloudflare-pages" },
            {
              label: "Cloudflare Workers Architecture",
              link: "/deployment/CLOUDFLARE_WORKERS_ARCHITECTURE",
            },
            {
              label: "Deployment Environments",
              link: "/deployment/ENVIRONMENTS",
            },
            {
              label: "Deployment Versioning",
              link: "/deployment/DEPLOYMENT_VERSIONING",
            },
            {
              label: "Gradual Deployments",
              link: "/deployment/GRADUAL_DEPLOYMENTS",
            },
            {
              label: "Disaster Recovery",
              link: "/deployment/DISASTER_RECOVERY",
            },
            { label: "Docker", link: "/deployment/DOCKER" },
            {
              label: "Production Readiness",
              link: "/deployment/PRODUCTION_READINESS",
            },
            {
              label: "Production Secrets",
              link: "/deployment/PRODUCTION_SECRETS",
            },
          ],
        },
        {
          label: "Development",
          items: [
            { label: "Overview", link: "/development/" },
            { label: "Architecture", link: "/development/ARCHITECTURE" },
            { label: "Benchmarks", link: "/development/benchmarks" },
            { label: "Circuit Breaker", link: "/development/CIRCUIT_BREAKER" },
            { label: "Code Review", link: "/development/CODE_REVIEW" },
            {
              label: "Developer Onboarding",
              link: "/development/DEVELOPER_ONBOARDING",
            },
            { label: "Diagnostics", link: "/development/DIAGNOSTICS" },
            {
              label: "Full Diagnostics Tool (diag-full)",
              link: "/development/DIAG_FULL",
            },
            { label: "Error Reporting", link: "/development/ERROR_REPORTING" },
            { label: "Extensibility", link: "/development/EXTENSIBILITY" },
            { label: "Hooks", link: "/development/HOOKS" },
            { label: "Lines of Code Counter", link: "/development/COUNT_LOC" },
            { label: "Logging", link: "/development/LOGGING" },
          ],
        },
        {
          label: "Architecture",
          items: [
            {
              label: "System Architecture",
              link: "/architecture/SYSTEM_ARCHITECTURE",
            },
            {
              label: "Multi-Tenancy Architecture",
              link: "/architecture/MULTI_TENANCY",
            },
            { label: "Hono Routing", link: "/architecture/hono-routing" },
            { label: "Hono RPC Client", link: "/architecture/hono-rpc-client" },
            { label: "tRPC API Layer", link: "/architecture/trpc" },
            { label: "Durable Objects", link: "/architecture/durable-objects" },
          ],
        },
        {
          label: "Frontend",
          items: [
            { label: "Overview", link: "/frontend/" },
            { label: "Angular Frontend", link: "/frontend/ANGULAR_FRONTEND" },
            {
              label: "Angular Parity Checklist",
              link: "/frontend/ANGULAR_PARITY_CHECKLIST",
            },
            { label: "SPA Benefits", link: "/frontend/SPA_BENEFITS" },
            { label: "Tailwind CSS", link: "/frontend/TAILWIND_CSS" },
            { label: "Validation UI", link: "/frontend/VALIDATION_UI" },
            { label: "Vite", link: "/frontend/VITE" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Overview", link: "/guides/" },
            { label: "Quick Start", link: "/guides/quick-start" },
            { label: "Clients", link: "/guides/clients" },
            {
              label: "User Migration Guide",
              link: "/guides/USER_MIGRATION_GUIDE",
            },
            { label: "Troubleshooting", link: "/guides/TROUBLESHOOTING" },
            { label: "Validation Errors", link: "/guides/VALIDATION_ERRORS" },
          ],
        },
        {
          label: "Usage",
          items: [
            { label: "Configuration", link: "/usage/CONFIGURATION" },
            { label: "CLI Reference", link: "/usage/CLI" },
            { label: "Transformations", link: "/usage/TRANSFORMATIONS" },
          ],
        },
        {
          label: "Configuration Manager",
          items: [
            { label: "Overview", link: "/configuration/" },
            {
              label: "Schema Reference",
              link: "/configuration/schema-reference",
            },
            {
              label: "Environment Overrides",
              link: "/configuration/env-overrides",
            },
            { label: "Load Flow Diagram", link: "/configuration/flow-diagram" },
            {
              label: "Terraform / IaC Extensibility",
              link: "/configuration/terraform-extensibility",
            },
          ],
        },
        { label: "Postman", link: "/postman/" },
        {
          label: "Reference",
          items: [
            { label: "Overview", link: "/reference/" },
            {
              label: "Auto Version Bump",
              link: "/reference/AUTO_VERSION_BUMP",
            },
            { label: "Bugs & Features", link: "/reference/BUGS_AND_FEATURES" },
            {
              label: "Environment Configuration",
              link: "/reference/ENV_CONFIGURATION",
            },
            {
              label: "GitHub Issue Templates",
              link: "/reference/GITHUB_ISSUE_TEMPLATES",
            },
            { label: "Lighthouse CI", link: "/reference/LIGHTHOUSE_CI" },
            { label: "AI Assistant Guide", link: "/reference/claude" },
            {
              label: "Version Management",
              link: "/reference/VERSION_MANAGEMENT",
            },
          ],
        },
        {
          label: "Releases",
          items: [
            { label: "Overview", link: "/releases/" },
            { label: "v0.8.0 Release Notes", link: "/releases/RELEASE_0.8.0" },
            {
              label: "Blog Post",
              link: "/releases/BLOG_POST_ADBLOCK_COMPILER",
            },
          ],
        },
        {
          label: "Authentication & Authorization",
          items: [
            { label: "Overview", link: "/auth/" },
            {
              label: "Multi-Tenancy & Organizations",
              link: "/auth/multi-tenancy",
            },
            {
              label: "Auth Provider Selection",
              link: "/auth/auth-provider-selection",
            },
            {
              label: "Auth Chain Reference",
              link: "/auth/auth-chain-reference",
            },
            { label: "Better Auth + Prisma", link: "/auth/better-auth-prisma" },
            {
              label: "Migration: Clerk → Better Auth",
              link: "/auth/migration-clerk-to-better-auth",
            },
            { label: "Configuration Guide", link: "/auth/configuration" },
            { label: "Developer Guide", link: "/auth/developer-guide" },
            { label: "API Authentication", link: "/auth/api-authentication" },
            { label: "Admin Access", link: "/auth/admin-access" },
            {
              label: "Removing Anonymous Access",
              link: "/auth/removing-anonymous-access",
            },
            { label: "CLI Authentication", link: "/auth/cli-authentication" },
            { label: "Clerk Dashboard Setup", link: "/auth/clerk-setup" },
            {
              label: "Clerk + Cloudflare Integration",
              link: "/auth/clerk-cloudflare-integration",
            },
            { label: "Cloudflare Access", link: "/auth/cloudflare-access" },
            { label: "Postman Auth Testing", link: "/auth/postman-testing" },
            { label: "Email Architecture", link: "/auth/email-architecture" },
            { label: "Resend Contact Sync", link: "/auth/resend-contact-sync" },
            { label: "ZTA Review Fixes", link: "/auth/zta-review-fixes" },
          ],
        },
        {
          label: "Admin System",
          items: [
            { label: "Overview", link: "/admin/" },
            { label: "Subscription Plans", link: "/admin/subscription-plans" },
            { label: "Roles & Permissions", link: "/admin/roles-permissions" },
            { label: "API Reference", link: "/admin/api-reference" },
            { label: "Database Schema", link: "/admin/database-schema" },
            { label: "Feature Flags", link: "/admin/feature-flags" },
            { label: "Neon API Service", link: "/admin/neon-api-service" },
            { label: "Neon Admin Endpoints", link: "/admin/neon-endpoints" },
            { label: "Observability & Audit", link: "/admin/observability" },
            { label: "Operator Guide", link: "/admin/operator-guide" },
          ],
        },
        {
          label: "Security",
          items: [
            {
              label: "Zero Trust Architecture",
              link: "/security/ZERO_TRUST_ARCHITECTURE",
            },
            {
              label: "ZTA Developer Guide",
              link: "/security/ZTA_DEVELOPER_GUIDE",
            },
            {
              label: "API Shield Vulnerability Scanner",
              link: "/security/API_SHIELD_VULNERABILITY_SCANNER",
            },
            {
              label: "Page Shield Integration",
              link: "/security/PAGE_SHIELD_INTEGRATION",
            },
            {
              label: "Automated Web Asset Sync",
              link: "/security/API_SHIELD_WEB_ASSETS",
            },
          ],
        },
        {
          label: "Testing",
          items: [
            { label: "Overview", link: "/testing/" },
            { label: "Testing Guide", link: "/testing/testing" },
            { label: "Database Testing", link: "/testing/database-testing" },
            { label: "E2E Testing", link: "/testing/E2E_TESTING" },
            { label: "Postman Testing", link: "/testing/POSTMAN_TESTING" },
          ],
        },
        {
          label: "Troubleshooting",
          items: [
            { label: "Overview", link: "/troubleshooting/" },
            {
              label: "KB-001: API Not Available",
              link: "/troubleshooting/KB-001-api-not-available",
            },
            {
              label: "KB-002: Hyperdrive Database Down",
              link: "/troubleshooting/KB-002-hyperdrive-database-down",
            },
            {
              label: "KB-003: Database Down After Deploy — Live Session",
              link:
                "/troubleshooting/KB-003-neon-hyperdrive-live-session-2026-03-25",
            },
            {
              label: "KB-004: Prisma WASM Error on Cloudflare Workers",
              link: "/troubleshooting/KB-004-prisma-wasm-cloudflare",
            },
            {
              label: "Neon Troubleshooting",
              link: "/troubleshooting/neon-troubleshooting",
            },
          ],
        },
        {
          label: "Ops Tools",
          items: [
            { label: "Overview", link: "/tools/" },
            { label: "auth-healthcheck", link: "/tools/auth-healthcheck" },
          ],
        },
        {
          label: "Workflows",
          items: [
            { label: "Overview", link: "/workflows/" },
            { label: "Workflows Reference", link: "/workflows/WORKFLOWS" },
            {
              label: "Workflow Linting (actionlint)",
              link: "/workflows/ACTIONLINT",
            },
            { label: "Environment Setup", link: "/workflows/ENV_SETUP" },
            {
              label: "Workflow Diagrams",
              link: "/workflows/WORKFLOW_DIAGRAMS",
            },
            {
              label: "Workflow Improvements",
              link: "/workflows/WORKFLOW_IMPROVEMENTS",
            },
            {
              label: "Workflow Cleanup Summary",
              link: "/workflows/WORKFLOW_CLEANUP_SUMMARY",
            },
          ],
        },
        {
          label: "Threat Intelligence",
          link: "/threat-intel/INGESTION_AND_MCP_DESIGN",
        },
      ],
    }),
  ],
});
