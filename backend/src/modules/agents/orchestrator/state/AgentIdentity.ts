/**
 * Agent Identity Annotation
 *
 * LangGraph annotation for tracking which agent is currently active.
 * Uses "replace entirely" reducer — each agent overwrites the identity.
 *
 * @module agents/orchestrator/state/AgentIdentity
 */

import { Annotation } from '@langchain/langgraph';
import type { AgentIdentity } from '@bc-agent/shared';
import {
  AGENT_ID,
  AGENT_DISPLAY_NAME,
  AGENT_ICON,
  AGENT_COLOR,
} from '@bc-agent/shared';

/**
 * Default agent identity (Supervisor).
 * Used when no agent has explicitly set identity yet.
 */
export const DEFAULT_AGENT_IDENTITY: AgentIdentity = {
  agentId: AGENT_ID.SUPERVISOR,
  agentName: AGENT_DISPLAY_NAME[AGENT_ID.SUPERVISOR],
  agentIcon: AGENT_ICON[AGENT_ID.SUPERVISOR],
  agentColor: AGENT_COLOR[AGENT_ID.SUPERVISOR],
};

/**
 * LangGraph Annotation for agent identity.
 * Reducer: replace entirely (incoming overwrites existing).
 */
export const AgentIdentityAnnotation = Annotation<AgentIdentity>({
  reducer: (_existing, incoming) => incoming,
  default: () => ({ ...DEFAULT_AGENT_IDENTITY }),
});
