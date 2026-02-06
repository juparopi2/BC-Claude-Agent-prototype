/**
 * Agent Registry Types
 *
 * Types for frontend consumption of agent metadata.
 * These types are safe to expose to the frontend (no systemPrompt, no modelRole).
 *
 * @module @bc-agent/shared/types/agent-registry
 */

import type { AgentCapability, AgentId } from '../constants/agent-registry.constants';

/** Agent summary safe for frontend (excludes systemPrompt) */
export interface AgentUISummary {
  id: AgentId;
  name: string;
  description: string;
  icon: string;
  color: string;
  capabilities: AgentCapability[];
}

/** Response from GET /api/agents */
export interface AgentListResponse {
  agents: AgentUISummary[];
  count: number;
}
