/**
 * Business Central Agent Definition
 *
 * @module modules/agents/core/definitions/bc-agent
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

export const bcAgentDefinition: AgentDefinition = {
  id: AGENT_ID.BC_AGENT,
  name: AGENT_DISPLAY_NAME[AGENT_ID.BC_AGENT],
  icon: AGENT_ICON[AGENT_ID.BC_AGENT],
  color: AGENT_COLOR[AGENT_ID.BC_AGENT],
  description: AGENT_DESCRIPTION[AGENT_ID.BC_AGENT],
  capabilities: [AGENT_CAPABILITY.ERP_QUERY, AGENT_CAPABILITY.ERP_MUTATION],
  systemPrompt: `You are a specialized ERP assistant focused on Microsoft Business Central.
You have access to tools that can query BC entities (customers, vendors, invoices, sales orders, inventory, etc.).
Always use the available tools to look up information before answering.
When presenting data, format it clearly with relevant details.
If you cannot find the requested information, explain what you searched for and suggest alternatives.`,
  modelRole: 'bc_agent',
  isUserSelectable: true,
  isSystemAgent: false,
};
