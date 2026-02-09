/**
 * User Handoff (PRD-040)
 *
 * Handles user-initiated agent selection from the frontend UI.
 * Validates the target agent via the registry and returns identity info.
 *
 * @module modules/agents/handoffs/user-handoff
 */

import type { AgentId, AgentIdentity } from '@bc-agent/shared';
import {
  AGENT_DISPLAY_NAME,
  AGENT_ICON,
  AGENT_COLOR,
} from '@bc-agent/shared';
import { getAgentRegistry } from '../core/registry/AgentRegistry';

/**
 * Result of processing a user agent selection.
 */
export interface UserAgentSelectionResult {
  /** Identity of the selected agent */
  targetAgent: AgentIdentity;
}

/**
 * Process a user-initiated agent selection.
 *
 * Validates the target agent:
 * - Must exist in the registry
 * - Must be user-selectable (isUserSelectable: true)
 * - Must not be a system agent (isSystemAgent: false)
 *
 * @param targetAgentId - The agent ID selected by the user
 * @returns The target agent's identity for event emission
 * @throws Error if agent is invalid, not found, or not selectable
 */
export function processUserAgentSelection(targetAgentId: string): UserAgentSelectionResult {
  const registry = getAgentRegistry();
  const agentDef = registry.get(targetAgentId as AgentId);

  if (!agentDef) {
    throw new Error(`Unknown agent: "${targetAgentId}"`);
  }

  if (agentDef.isSystemAgent) {
    throw new Error(`Cannot select system agent: "${targetAgentId}"`);
  }

  if (!agentDef.isUserSelectable) {
    throw new Error(`Agent "${targetAgentId}" is not user-selectable`);
  }

  const agentId = agentDef.id;

  return {
    targetAgent: {
      agentId,
      agentName: AGENT_DISPLAY_NAME[agentId],
      agentIcon: AGENT_ICON[agentId],
      agentColor: AGENT_COLOR[agentId],
    },
  };
}
