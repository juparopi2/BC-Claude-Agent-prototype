/**
 * Supervisor Agent Definition
 *
 * The supervisor routes queries to specialized agents and coordinates
 * multi-step tasks. It is a system agent, not user-selectable.
 *
 * @module modules/agents/core/definitions/supervisor
 */

import {
  AGENT_ID,
  AGENT_DISPLAY_NAME,
  AGENT_ICON,
  AGENT_COLOR,
  AGENT_DESCRIPTION,
  AGENT_CAPABILITY,
} from '@bc-agent/shared';
import type { AgentDefinition } from '../registry/AgentDefinition';

export const supervisorDefinition: AgentDefinition = {
  id: AGENT_ID.SUPERVISOR,
  name: AGENT_DISPLAY_NAME[AGENT_ID.SUPERVISOR],
  icon: AGENT_ICON[AGENT_ID.SUPERVISOR],
  color: AGENT_COLOR[AGENT_ID.SUPERVISOR],
  description: AGENT_DESCRIPTION[AGENT_ID.SUPERVISOR],
  capabilities: [AGENT_CAPABILITY.GENERAL],
  systemPrompt: `You are a supervisor that routes user queries to the most appropriate specialist agent.
Analyze the user's intent and delegate to the correct agent.
Available agents will be provided to you at runtime.`,
  modelRole: 'orchestrator',
  isUserSelectable: false,
  isSystemAgent: true,
};
