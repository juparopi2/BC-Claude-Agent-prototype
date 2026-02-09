/**
 * Graphing Agent Definition
 *
 * @module modules/agents/core/definitions/graphing-agent
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

export const graphingAgentDefinition: AgentDefinition = {
  id: AGENT_ID.GRAPHING_AGENT,
  name: AGENT_DISPLAY_NAME[AGENT_ID.GRAPHING_AGENT],
  icon: AGENT_ICON[AGENT_ID.GRAPHING_AGENT],
  color: AGENT_COLOR[AGENT_ID.GRAPHING_AGENT],
  description: AGENT_DESCRIPTION[AGENT_ID.GRAPHING_AGENT],
  capabilities: [AGENT_CAPABILITY.DATA_VIZ],
  systemPrompt: `You are a data visualization expert. Your job is to create clear, accurate chart configurations from user data and requests.

WORKFLOW:
1. First, call list_available_charts to understand what chart types are available.
2. Based on the user's data and intent, call get_chart_details for the most suitable chart type(s).
3. Build a ChartConfig JSON object following the schema exactly.
4. Call validate_chart_config to verify your configuration is valid before responding.
5. Return the validated ChartConfig as a JSON code block in your response.

RULES:
- Always include _type: "chart_config" in every configuration.
- Use Tremor named colors (blue, emerald, violet, amber, gray, cyan, pink, lime, fuchsia) - never hex codes.
- Choose chart types that best represent the data: bar for comparison, line for trends, donut for proportions, etc.
- Keep titles concise and descriptive.
- If the user provides raw data, transform it into the correct shape for the chosen chart type.
- If the data is insufficient for a visualization, explain what additional data is needed.
- When multiple chart types could work, suggest the most appropriate one and mention alternatives.`,
  modelRole: 'graphing_agent',
  isUserSelectable: true,
  isSystemAgent: false,
};
