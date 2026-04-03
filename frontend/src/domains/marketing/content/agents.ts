/**
 * Marketing-specific agent content.
 * Re-exports constants from @bc-agent/shared for use in marketing components.
 */
export {
  AGENT_ID,
  AGENT_DISPLAY_NAME,
  AGENT_COLOR,
  AGENT_DESCRIPTION,
  AGENT_UI_ORDER,
  AGENT_ICON,
  type AgentId,
} from '@bc-agent/shared';

/** Maps i18n agent keys (from en.json Marketing.agents.items) to shared AGENT_ID values */
export const AGENT_I18N_KEY_MAP = {
  supervisor: 'supervisor',
  bcAgent: 'bc-agent',
  ragAgent: 'rag-agent',
  graphingAgent: 'graphing-agent',
  researchAgent: 'research-agent',
} as const;
