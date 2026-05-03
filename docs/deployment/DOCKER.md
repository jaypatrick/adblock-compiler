# Docker Deployment

This page covers building and running the bloqr-backend stack using Docker and Docker Compose.

## Prerequisites

- Docker 24+ and Docker Compose v2
- A `.env` file based on `.env.example` (copy and fill in your secrets)

## Build & Run

```bash
# Build the image
docker compose build

# Start the stack (Worker dev server + Angular SSR frontend)
docker compose up -d

# Tail logs
docker compose logs -f bloqr-backend
```

The Worker is served at `http://localhost:8787` by default.  Override the port
by setting `PORT=<port>` in your `.env` file or by passing `-e PORT=9000` to
`docker compose run`.

## Production

Use the production Compose file which enables restart policies and removes the
dev override volumes:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Required environment variables

| Variable | Required | Description |
|---|---|---|
| `SENTRY_DSN` | No | Sentry ingest URL for error tracking |
| `SENTRY_RELEASE` | No | Git SHA / tag for Sentry source-map association |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | OTLP collector endpoint (e.g. Grafana, Honeycomb) |
| `COMPILER_VERSION` | Yes | Compiler version string shown in `/api/version` |
| `CLERK_SECRET_KEY` | Yes | Clerk backend secret key |
| `ADMIN_KEY` | Yes | Admin API key |

See `.env.example` for the full list.
