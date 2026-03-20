/**
 * Worker request router — migrated to Hono in Phase 1.
 *
 * All routing logic now lives in `worker/hono-app.ts`.
 * This file re-exports `handleRequest` for backward compatibility.
 *
 * @see worker/hono-app.ts — Hono app instance and route declarations
 * @see docs/architecture/hono-routing.md — architecture overview
 */

export { handleRequest } from '../hono-app.ts';
