/**
 * Barrel export for the `worker/agents` module.
 *
 * Exports the typed agent registry, the ZTA auth middleware, and the
 * Hono sub-app router that mounts all `/agents/*` routes.
 */

export { AGENT_REGISTRY, getAgentBySlug, getEnabledAgents } from './registry.ts';
export type { AgentRegistryEntry } from './registry.ts';
export { handleAgentRequest, runAgentAuthGate } from './agent-auth.ts';
export { agentRouter } from './agent-router.ts';
