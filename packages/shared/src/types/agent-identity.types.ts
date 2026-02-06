/**
 * Agent Identity Types
 *
 * Shared types for agent identity tracking in multi-agent architecture.
 * Used by both frontend (UI badges) and backend (state schema).
 *
 * @module @bc-agent/shared/types/agent-identity
 */

import type { AgentId } from '../constants/agent-registry.constants';

/**
 * Agent Identity
 *
 * Identifies which agent generated a response.
 * Carried in LangGraph state and emitted via WebSocket events.
 */
export interface AgentIdentity {
  /** Agent ID from AGENT_ID constants */
  agentId: AgentId;
  /** Human-readable display name */
  agentName: string;
  /** Emoji icon for UI display */
  agentIcon?: string;
  /** Hex color for UI theming */
  agentColor?: string;
}
