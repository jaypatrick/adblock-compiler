# Cloudflare Containers Deployment Guide

This guide explains how to deploy the Adblock Compiler to Cloudflare Containers.

## Overview

Cloudflare Containers allows you to deploy Docker containers globally alongside your Workers. The container configuration is set up in `wrangler.toml` and the container image is defined in `Dockerfile.container`.

---

## What is a Cloudflare Container? (And how is it different from Docker?)

This is one of the most commonly misunderstood aspects of the platform. **Cloudflare Containers use a Docker/OCI image format**, but the lifecycle and management model is completely different from a traditional Docker container.

### The mental model

| | Cloudflare Container | Traditional Docker Container |
|---|---|---|
| **Image format** | Standard OCI/Docker image ✅ | Standard OCI/Docker image ✅ |
| **You manage the host** | No — Cloudflare handles it | Yes — your server, Kubernetes, ECS, etc. |
| **Startup trigger** | On-demand, by a Durable Object | Manual, orchestrator, or scheduled |
| **Always on?** | No — sleeps after idle timeout | Can be long-running, always-on |
| **Scaling** | Cloudflare handles globally | You configure replicas/HPA/etc. |
| **State** | Ephemeral by default | Can be stateful with volumes |
| **Your entire app stack on the image?** | No — only the computation layer | Yes, typically |

**Key point:** Unlike a traditional "self-contained" Docker app where your entire stack (web server, app, dependencies) lives on the image, Cloudflare Containers are **one layer** of a larger Workers platform architecture. The Worker handles HTTP routing, auth, rate limiting, and CORS. The Container handles only the heavy computation that exceeds Worker CPU limits.

### This app's architecture

```
HTTP Request
    → Cloudflare Worker (stateless, handles auth/routing/rate-limiting)
        → AdblockCompiler Durable Object (stateful, owns container lifecycle)
            → Container (Linux process — runs container-server.ts)
                → WorkerCompiler (AGTree AST parsing, filter compilation)
```

The Durable Object is the "brain" — it has a 1:1 relationship with the Container instance and manages when it starts and stops. The Angular frontend and the SSR Worker (`adblock-compiler-frontend`) never interact with the container directly.

---

## When does the Container activate?

The container is **not always running**. It follows an on-demand lifecycle:

1. A request hits `POST /compile/container` on the backend Worker
2. The Worker resolves the `ADBLOCK_COMPILER` Durable Object via `env.ADBLOCK_COMPILER.get(id)`
3. The Durable Object (which extends `Container`) **automatically starts the container** if it isn't already running
4. The container cold-starts from the Docker image (typically a few hundred milliseconds to ~2 seconds)
5. The Durable Object proxies the request to `container-server.ts` on port 8787
6. `container-server.ts` handles the compilation using `WorkerCompiler` and returns the result
7. After **10 minutes of inactivity** (`sleepAfter = '10m'`), the container is automatically suspended — no charges while idle

### Why use a Container instead of a Worker directly?

Cloudflare Workers have a **10ms–30ms CPU time limit** per request (soft/hard). For large blocklist compilations — full AGTree AST parsing across hundreds of sources — this limit can be hit. The Container has no such CPU time limit and runs as a normal Linux process.

---

## UI Container Status Widget — Not Yet Implemented

> **⚠️ Status: Missing**

There is currently **no UI widget** in the Angular frontend that displays when the container is active, spinning up, or sleeping. The admin dashboard and performance page show general API health from `/api/health`, but this does not reflect container lifecycle.

A container status indicator would be useful to show users when they hit `/compile/container` and the container is cold-starting (which adds latency). This would require:

1. **Backend:** A new `GET /api/container/status` endpoint that checks the container's state via the Durable Object binding
2. **Frontend service:** An Angular service polling or subscribing to that endpoint
3. **UI component:** A status chip/badge showing `sleeping`, `starting`, or `running` with an appropriate visual indicator (e.g. the pulsing `.status-dot` already defined in `styles.css`)

This is tracked as a future enhancement. See [GitHub Issues](https://github.com/jaypatrick/adblock-compiler/issues) to create a tracking issue.

---

## Known Gotchas

These are the most common configuration mistakes that cause silent or hard-to-diagnose failures.

### 1. Missing `--platform=linux/amd64` in `Dockerfile.container`

Cloudflare Containers **only runs `linux/amd64` images**. If you build on Apple Silicon (M1/M2/M3) or an ARM-based CI runner without pinning the platform, Docker will produce an `arm64` image that will silently fail to start on Cloudflare.

The `FROM` line in `Dockerfile.container` must read:

```dockerfile
FROM --platform=linux/amd64 denoland/deno:${DENO_VERSION}
```

### 2. `enable_containers` in `wrangler.toml [dev]`

The `[dev]` section of `wrangler.toml` contains an `enable_containers` flag:

```toml
[dev]
# Set to true on Linux/macOS or WSL. Must be false on native Windows
# because Cloudflare Containers requires a Linux Docker daemon.
enable_containers = true
```

- **Linux / macOS / WSL** — `enable_containers = true` (the default in this repo) runs containers in local `wrangler dev`. Docker Desktop on Mac with Apple Silicon uses Rosetta 2 to run the `linux/amd64` image transparently.
- **Native Windows** — set `enable_containers = false` and use WSL instead (see [Windows Limitation](#windows-limitation)).

### 3. `CONTAINER_SECRET` environment variable

The container server (`worker/container-server.ts`) requires the `CONTAINER_SECRET` environment variable to be set. Requests to `POST /compile` are rejected with `503 Service Unavailable` if the variable is missing or with `401 Unauthorized` if the header value doesn't match.

Set it locally by adding a line to `.dev.vars`:

```
CONTAINER_SECRET=your-local-secret
```

For production, add it as a Worker Secret:

```bash
npx wrangler secret put CONTAINER_SECRET
```

## Current Configuration

### `wrangler.toml`

```toml
[[containers]]
class_name = "AdblockCompiler"
image = "./Dockerfile.container"
max_instances = 5

[[durable_objects.bindings]]
class_name = "AdblockCompiler"
name = "ADBLOCK_COMPILER"

[[migrations]]
new_sqlite_classes = ["AdblockCompiler"]
tag = "v1"

[dev]
enable_containers = true
```

### `worker/worker.ts`

The `AdblockCompiler` class extends the `Container` class from `@cloudflare/containers`:

```typescript
import { Container } from '@cloudflare/containers';

export class AdblockCompiler extends Container {
    override defaultPort = 8787;
    override sleepAfter = '10m';

    override onStart(): void {
        console.log('[AdblockCompiler] Container started');
    }

    override onStop(_: { exitCode: number; reason: string }): void {
        console.log('[AdblockCompiler] Container stopped');
    }

    override onError(error: unknown): void {
        console.error('[AdblockCompiler] Container error:', error);
    }
}
```

### `Dockerfile.container`

A minimal Deno image that runs `worker/container-server.ts` — a lightweight HTTP server that handles compilation requests forwarded by the Worker.

## Prerequisites

1. **Docker must be running** — Wrangler uses Docker to build and push images
   ```bash
docker info
```
   If this fails, start Docker Desktop or your Docker daemon.

2. **Wrangler authentication** — Authenticate with your Cloudflare account:
   ```bash
deno task wrangler login
```

3. **Container support in your Cloudflare plan** — Containers are available on the Workers Paid plan.

## Deployment Steps

### 1. Deploy to Cloudflare

```bash
deno task wrangler:deploy
```

This command will:

- Build the Docker container image from `Dockerfile.container`
- Push the image to Cloudflare's Container Registry (backed by R2)
- Deploy your Worker with the container binding
- Configure Cloudflare's network to spawn container instances on-demand

### 2. Wait for Provisioning

After the first deployment, **wait 2–3 minutes** before making requests. Unlike Workers, containers take time to be provisioned across the edge network.

### 3. Check Deployment Status

```bash
npx wrangler containers list
```

This shows all containers in your account and their deployment status.

## Local Development

### Windows Limitation

**Containers are not supported for local development on Windows.** You have two options:

1. **Use WSL** (Windows Subsystem for Linux)
   ```powershell
   wsl
   cd /mnt/d/source/adblock-compiler
   deno task wrangler:dev
   ```

2. **Disable containers for local dev** (current configuration)
   The `wrangler.toml` has `enable_containers = false` in the `[dev]` section, which allows you to develop the Worker functionality locally without containers.

### Local Development Without Containers

You can still test the Worker API locally:

```bash
deno task wrangler:dev
```

Visit http://localhost:8787 to access:

- `/api` — API documentation
- `/compile` — JSON compilation endpoint
- `/compile/stream` — Streaming compilation with SSE
- `/compile/container` — Container-proxied compilation endpoint
- `/metrics` — Request metrics

**Note:** The `ADBLOCK_COMPILER` Durable Object binding is available in local dev. With `enable_containers = true` (the default), `wrangler dev` will start the Docker container automatically. On native Windows without WSL, set `enable_containers = false` in the `[dev]` section of `wrangler.toml`.

### Health Check

Use the `container:health` script to quickly verify that a running container server is healthy:

```bash
# Check local container (defaults to http://localhost:8787)
deno task container:health

# Check a deployed container with the compile smoke-test
deno task container:health -- --url https://adblock-compiler.jayson-knight.workers.dev --secret my-secret

# Override the request timeout
deno task container:health -- --url http://localhost:8787 --timeout 30
```

The script:
1. Hits `GET /health` and validates the response shape (`{ status: "ok", version: string }`) with Zod.
2. Optionally sends a minimal `POST /compile` smoke-test when `--secret` is provided.
3. Prints a pass/fail summary and exits with code `0` (all pass) or `1` (any failure).

## Container Architecture

The `AdblockCompiler` class in `worker/worker.ts` extends the `Container` base class from `@cloudflare/containers`, which handles container lifecycle, request proxying, and automatic restart:

```typescript
import { Container } from '@cloudflare/containers';

export class AdblockCompiler extends Container {
    defaultPort = 8787;
    sleepAfter = '10m';
}
```

### How It Works

1. A request reaches the Cloudflare Worker (`worker/worker.ts`)
2. The Worker passes the request to an `AdblockCompiler` Durable Object instance
3. The `AdblockCompiler` (which extends `Container`) starts a container instance if one isn't already running
4. The container (`Dockerfile.container`) runs `worker/container-server.ts` — a Deno HTTP server
5. The server handles the compilation request using `WorkerCompiler` and returns the result
6. The container sleeps after 10 minutes of inactivity (`sleepAfter = '10m')

### Container Server Endpoints

`worker/container-server.ts` exposes:

| Method | Path       | Description                                 |
|--------|------------|---------------------------------------------|
| GET    | `/health`  | Liveness probe — returns `{ status: 'ok' }` |
| POST   | `/compile` | Compile a filter list, returns plain text   |

## Container API Route

The Worker exposes `POST /compile/container` which proxies requests to the `AdblockCompiler` Durable Object container via the `ADBLOCK_COMPILER` binding.

### Endpoint

`POST /compile/container`

### Required Environment Variables

| Variable | Description |
|---|---|
| `ADBLOCK_COMPILER` | Durable Object binding to the container (configured in `wrangler.toml`) |
| `CONTAINER_SECRET` | Shared secret forwarded as `X-Container-Secret` header to authenticate Worker → Container requests |

Set `CONTAINER_SECRET` locally in `.dev.vars`:

```
CONTAINER_SECRET=dev-local-secret
```

For production:

```bash
wrangler secret put CONTAINER_SECRET
```

### Request

Same body as `POST /compile` — a JSON object matching `CompileRequestSchema` / `ConfigurationSchema`.

### Response

- **`200 OK`** — `text/plain` compiled filter list output
- **`400 Bad Request`** — Invalid request body (Zod validation error from the container)
- **`401 Unauthorized`** — `X-Container-Secret` header mismatch
- **`503 Service Unavailable`** — `ADBLOCK_COMPILER` binding or `CONTAINER_SECRET` not configured, or container server has missing `CONTAINER_SECRET`

### Middleware

The route applies the same middleware stack as other compile routes:

1. `bodySizeMiddleware()` — enforces `MAX_REQUEST_BODY_MB` limit
2. `rateLimitMiddleware()` — tier-based rate limiting
3. `turnstileMiddleware()` — Cloudflare Turnstile human verification

## Production Deployment Workflow

1. **Build and test locally** (without containers)
   ```bash
   deno task wrangler:dev
   ```

2. **Test Docker image** (optional)
   ```bash
   docker build -f Dockerfile.container -t adblock-compiler-container:test .
   docker run -p 8787:8787 adblock-compiler-container:test
   curl http://localhost:8787/health
   ```

3. **Deploy to Cloudflare**
   ```bash
   deno task wrangler:deploy
   ```

4. **Check deployment status**
   ```bash
   npx wrangler containers list
   ```

5. **Monitor logs**
   ```bash
   deno task wrangler:tail
   ```

## Container Configuration Options

### Scaling

```toml
[[containers]]
class_name = "AdblockCompiler"
image = "./Dockerfile.container"
max_instances = 5  # Maximum concurrent container instances
```

### Sleep Timeout

Configured in `worker/worker.ts` on the `AdblockCompiler` class:

```typescript
sleepAfter = '10m';  // Stop the container after 10 minutes of inactivity
```

## Bindings Available

The container/worker has access to:

- `env.COMPILATION_CACHE` — KV Namespace for caching compiled results
- `env.RATE_LIMIT` — KV Namespace for rate limiting
- `env.METRICS` — KV Namespace for metrics storage
- `env.FILTER_STORAGE` — R2 Bucket for filter list storage
- `env.ASSETS` — Static assets (HTML, CSS, JS)
- `env.COMPILER_VERSION` — Version string
- `env.ADBLOCK_COMPILER` — Durable Object binding to container
- `env.CONTAINER_SECRET` — Shared secret for Worker → Container authentication (`X-Container-Secret` header)

## Cost Considerations

- Containers are billed per millisecond of runtime (10ms granularity)
- Automatically scale to zero when not in use (`sleepAfter = '10m')`
- No charges when idle
- Container registry storage is free (backed by R2)

## Troubleshooting

### Docker not running

```
Error: Docker is not running
```

**Solution:** Start Docker Desktop and run `docker info` to verify.

### Container won't provision

```
Error: Container failed to start
```

**Solution:**

1. Check `npx wrangler containers list` for status
2. Check container logs with `deno task wrangler:tail`
3. Verify `Dockerfile.container` builds locally: `docker build -f Dockerfile.container -t test .`

### Image architecture mismatch

If the container starts but immediately crashes (or Cloudflare reports an image error), the image was likely built for the wrong CPU architecture.

**Cause:** The `FROM` line in `Dockerfile.container` is missing the `--platform=linux/amd64` flag. Builds on Apple Silicon or ARM CI runners default to `arm64`, which Cloudflare Containers cannot run.

**Solution:** Ensure `Dockerfile.container` uses:
```dockerfile
FROM --platform=linux/amd64 denoland/deno:${DENO_VERSION}
```
Then rebuild and redeploy.

### Container request body rejected (400 / 503)

- **503 Service Unavailable** — `CONTAINER_SECRET` is not set in the container environment. Add it to `.dev.vars` for local dev or run `npx wrangler secret put CONTAINER_SECRET` for production.
- **401 Unauthorized** — The `X-Container-Secret` header sent by the Worker doesn't match `CONTAINER_SECRET`. Ensure both sides use the same value.
- **400 Bad Request with JSON details** — The request body failed Zod schema validation. Inspect the `details` field in the JSON response for field-level error messages.

### Module not found errors

If you see `Cannot find module '@cloudflare/containers'`:

**Solution:** Run `pnpm install` to install the `@cloudflare/containers` package.

## Next Steps

1. **Deploy to production:**
   ```bash
   deno task wrangler:deploy
   ```

2. **Set up custom domain** (optional)
   ```bash
   npx wrangler deployments domains add <your-domain>
   ```

3. **Monitor performance**
   ```bash
   deno task wrangler:tail
   ```

4. **Update container configuration** as needed in `wrangler.toml` and `worker/worker.ts`

5. **Implement container status UI widget** — see the [UI Container Status Widget](#ui-container-status-widget--not-yet-implemented) section above for requirements.

## Resources

- [Cloudflare Containers Documentation](https://developers.cloudflare.com/containers/)
- [@cloudflare/containers package](https://github.com/cloudflare/containers)
- [Wrangler CLI Documentation](https://developers.cloudflare.com/workers/wrangler/)
- [Container Examples](https://developers.cloudflare.com/containers/examples/)
- [Containers Limits](https://developers.cloudflare.com/containers/platform-details/#limits)

## Support

For issues or questions:

- GitHub Issues: https://github.com/jaypatrick/adblock-compiler/issues
- Cloudflare Discord: https://discord.gg/cloudflaredev
