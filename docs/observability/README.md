# Observability

This section covers the full observability stack for `adblock-compiler`, from
edge-level Cloudflare native tools to application-level error tracking with Sentry.

## Contents

| Document | What it covers |
|----------|---------------|
| [Sentry Integration](./SENTRY.md) | Error tracking, performance tracing, Worker wrapper, Frontend RUM (Phase 3), environment variables |
| [Cloudflare Native Observability](./CLOUDFLARE_OBSERVABILITY.md) | Workers Logs, Traces, Analytics Engine, Tail Worker, Logpush |
| [Prometheus Metrics](./PROMETHEUS.md) | `/metrics/prometheus` scrape endpoint, Analytics Engine SQL queries, Grafana |
| [Logpush → R2](./LOGPUSH.md) | Long-term log retention via Cloudflare Logpush to R2 (Phase 1c) |

## Observability layers

```
Inbound Request
      │
      ▼
┌─────────────────────────────────────────────────────┐
│                  Cloudflare Edge                    │
│  WAF • Rate Limiting • Turnstile • Bot Score        │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│                Cloudflare Worker                    │
│                                                     │
│  withSentryWorker()  ──► Sentry (error tracking)    │
│  AnalyticsService    ──► Analytics Engine (metrics) │
│  AdminLogger         ──► Workers Logs (structured)  │
│  withAdminTracing()  ──► CF Traces (spans)          │
└──────────────────────┬──────────────────────────────┘
                       │ tail consumer
                       ▼
┌─────────────────────────────────────────────────────┐
│                  Tail Worker                        │
│  formatSlackAlert()  ──► Slack (critical errors)    │
│  forwardToLogSink()  ──► Logtail / Better Stack     │
│  TAIL_LOGS KV        ──► Short-term log persistence │
└─────────────────────────────────────────────────────┘
```

## Quick environment variable reference

| Variable | Layer | Required | Set via |
|----------|-------|----------|---------|
| `SENTRY_DSN` | Worker + Tail + Frontend RUM | Optional | `wrangler secret put SENTRY_DSN` |
| `SENTRY_RELEASE` | Worker (deploy-time var) | Optional (source map linking) | `wrangler deploy --var SENTRY_RELEASE:$(git rev-parse HEAD)` |
| `ANALYTICS_ACCOUNT_ID` | Worker | Optional (Prometheus) | `wrangler secret put ANALYTICS_ACCOUNT_ID` |
| `ANALYTICS_API_TOKEN` | Worker | Optional (Prometheus) | `wrangler secret put ANALYTICS_API_TOKEN` |
| `SLACK_WEBHOOK_URL` | Tail Worker | Optional | `wrangler secret put SLACK_WEBHOOK_URL` (tail worker) |
| `LOG_SINK_URL` | Tail Worker | Optional | `wrangler secret put LOG_SINK_URL` (tail worker) |
| `LOG_SINK_TOKEN` | Tail Worker | Optional | `wrangler secret put LOG_SINK_TOKEN` (tail worker) |
| `SENTRY_AUTH_TOKEN` | CI only | Optional (source maps) | `gh secret set SENTRY_AUTH_TOKEN` |
| `SENTRY_ORG` | CI only | Optional (source maps) | `gh variable set SENTRY_ORG` |
| `SENTRY_PROJECT` | CI only | Optional (source maps) | `gh variable set SENTRY_PROJECT` |
