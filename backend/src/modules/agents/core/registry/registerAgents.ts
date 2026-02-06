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
import { createKnowledgeSearchTool } from '@/modules/agents/rag-knowledge/tools';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'RegisterAgents' });

/**
 * Register all agents and their tools in the AgentRegistry.
 *
 * - BC Agent: 7 static tools from business-central/tools.ts
 * - RAG Agent: dynamic tool factory (user-scoped via createKnowledgeSearchTool)
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

  // RAG Agent with dynamic tool factory (tools require userId at creation time)
  registry.registerWithTools(ragAgentDefinition, {
    toolFactory: (userId: string) => [createKnowledgeSearchTool(userId)],
  });

  // Supervisor (no tools - orchestrates other agents)
  registry.register(supervisorDefinition);

  logger.info(
    { agentCount: registry.size },
    'All agents registered successfully'
  );
}
