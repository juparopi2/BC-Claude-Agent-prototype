/**
 * Agent Registration Bootstrap
 *
 * Registers all agent definitions and tool bindings at application startup.
 * Call this before mounting routes or processing requests.
 *
 * @module modules/agents/core/registry/registerAgents
 */

import { getAgentRegistry } from './AgentRegistry';
import { bcAgentDefinition } from '../definitions/bc-agent.definition';
import { ragAgentDefinition } from '../definitions/rag-agent.definition';
import { graphingAgentDefinition } from '../definitions/graphing-agent.definition';
import { supervisorDefinition } from '../definitions/supervisor.definition';
import {
  listAllEntitiesTool,
  searchEntityOperationsTool,
  getEntityDetailsTool,
  getEntityRelationshipsTool,
  validateWorkflowStructureTool,
  buildKnowledgeBaseWorkflowTool,
  getEndpointDocumentationTool,
} from '@/modules/agents/business-central/tools';
import { knowledgeSearchTool, filteredKnowledgeSearchTool } from '@/modules/agents/rag-knowledge/tools';
import {
  listAvailableChartsTool,
  getChartDetailsTool,
  validateChartConfigTool,
} from '@/modules/agents/graphing/tools';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'RegisterAgents' });

/**
 * Register all agents and their tools in the AgentRegistry.
 *
 * - BC Agent: 7 static tools from business-central/tools.ts
 * - RAG Agent: 2 static tools (userId resolved at runtime via config.configurable)
 * - Graphing Agent: 3 catalog-driven tools from graphing/tools.ts
 * - Supervisor: no tools (orchestrates other agents)
 */
export function registerAgents(): void {
  const registry = getAgentRegistry();

  // Skip if already registered (idempotent)
  if (registry.size > 0) {
    logger.info('Agent registry already populated, skipping registration');
    return;
  }

  // BC Agent with static tools
  registry.registerWithTools(bcAgentDefinition, {
    staticTools: [
      listAllEntitiesTool,
      searchEntityOperationsTool,
      getEntityDetailsTool,
      getEntityRelationshipsTool,
      validateWorkflowStructureTool,
      buildKnowledgeBaseWorkflowTool,
      getEndpointDocumentationTool,
    ],
  });

  // RAG Agent with static tools (userId resolved via config.configurable at runtime)
  registry.registerWithTools(ragAgentDefinition, {
    staticTools: [knowledgeSearchTool, filteredKnowledgeSearchTool],
  });

  // Graphing Agent with 3 catalog-driven tools
  registry.registerWithTools(graphingAgentDefinition, {
    staticTools: [listAvailableChartsTool, getChartDetailsTool, validateChartConfigTool],
  });

  // Supervisor (no tools - orchestrates other agents)
  registry.register(supervisorDefinition);

  logger.info(
    { agentCount: registry.size },
    'All 4 agents registered successfully'
  );
}
