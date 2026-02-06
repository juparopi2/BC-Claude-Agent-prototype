/**
 * RAG Knowledge Agent Definition
 *
 * @module modules/agents/core/definitions/rag-agent
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

export const ragAgentDefinition: AgentDefinition = {
  id: AGENT_ID.RAG_AGENT,
  name: AGENT_DISPLAY_NAME[AGENT_ID.RAG_AGENT],
  icon: AGENT_ICON[AGENT_ID.RAG_AGENT],
  color: AGENT_COLOR[AGENT_ID.RAG_AGENT],
  description: AGENT_DESCRIPTION[AGENT_ID.RAG_AGENT],
  capabilities: [AGENT_CAPABILITY.RAG_SEARCH],
  systemPrompt: `You are a knowledge base expert that searches and analyzes uploaded documents.
Use the search_knowledge_base tool to find relevant information from the user's documents.
Always cite the source documents when providing answers.
If the search returns no results, let the user know and suggest they upload relevant documents.`,
  modelRole: 'rag_agent',
  isUserSelectable: true,
  isSystemAgent: false,
};
