/// <reference types="@cloudflare/workers-types" />

/**
 * Browser routes — stub only.
 *
 * Browser routes will be added in a future PR.
 */

import { OpenAPIHono } from '@hono/zod-openapi';

import type { Env } from '../types.ts';
import type { Variables } from './shared.ts';

// Stub — browser routes will be added in a future PR.
export const browserRoutes = new OpenAPIHono<{ Bindings: Env; Variables: Variables }>();
