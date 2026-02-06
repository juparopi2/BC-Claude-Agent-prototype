/**
 * Agent Identity Schemas
 *
 * Zod schemas for validating agent identity and agent changed events.
 *
 * @module @bc-agent/shared/schemas/agent-identity
 */

import { z } from 'zod';

/**
 * Schema for AgentIdentity
 * Validates agent identity objects in WebSocket events.
 */
export const AgentIdentitySchema = z.object({
  agentId: z.string().min(1, 'agentId is required'),
  agentName: z.string().min(1, 'agentName is required'),
  agentIcon: z.string().optional(),
  agentColor: z.string().optional(),
});

export type AgentIdentityInput = z.infer<typeof AgentIdentitySchema>;

/**
 * Schema for AgentChangedEvent
 * Validates the agent_changed WebSocket event payload.
 */
export const AgentChangedEventSchema = z.object({
  type: z.literal('agent_changed'),
  sessionId: z.string().optional(),
  timestamp: z.string(),
  eventId: z.string(),
  persistenceState: z.enum(['pending', 'queued', 'persisted', 'failed', 'transient']),
  previousAgent: AgentIdentitySchema,
  currentAgent: AgentIdentitySchema,
});

export type AgentChangedEventInput = z.infer<typeof AgentChangedEventSchema>;
