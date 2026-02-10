import { describe, it, expect, beforeEach, vi } from 'vitest';
import { processUserAgentSelection } from '@modules/agents/handoffs/user-handoff';
import { resetAgentRegistry } from '@modules/agents/core/registry/AgentRegistry';
import { registerAgents } from '@modules/agents/core/registry/registerAgents';
import { AGENT_ID, AGENT_DISPLAY_NAME } from '@bc-agent/shared';

// Mock BC tools and RAG tools to avoid file system dependencies
vi.mock('@/modules/agents/business-central/tools', () => ({
  listAllEntitiesTool: { name: 'listAllEntities', description: 'List entities', schema: {} },
  searchEntityOperationsTool: { name: 'searchEntityOperations', description: 'Search', schema: {} },
  getEntityDetailsTool: { name: 'getEntityDetails', description: 'Details', schema: {} },
  getEntityRelationshipsTool: { name: 'getEntityRelationships', description: 'Relations', schema: {} },
  validateWorkflowStructureTool: { name: 'validateWorkflowStructure', description: 'Validate', schema: {} },
  buildKnowledgeBaseWorkflowTool: { name: 'buildKnowledgeBaseWorkflow', description: 'Build', schema: {} },
  getEndpointDocumentationTool: { name: 'getEndpointDocumentation', description: 'Docs', schema: {} },
}));

vi.mock('@/modules/agents/rag-knowledge/tools', () => ({
  knowledgeSearchTool: { name: 'knowledgeSearch', description: 'Search knowledge', schema: {} },
  filteredKnowledgeSearchTool: { name: 'filteredKnowledgeSearch', description: 'Filtered search', schema: {} },
}));

describe('user-handoff', () => {
  beforeEach(() => {
    resetAgentRegistry();
    registerAgents();
  });

  describe('processUserAgentSelection', () => {
    it('should return correct AgentIdentity for BC agent', () => {
      const result = processUserAgentSelection(AGENT_ID.BC_AGENT);

      expect(result.targetAgent.agentId).toBe(AGENT_ID.BC_AGENT);
      expect(result.targetAgent.agentName).toBe(AGENT_DISPLAY_NAME[AGENT_ID.BC_AGENT]);
      expect(result.targetAgent.agentIcon).toBeDefined();
      expect(result.targetAgent.agentColor).toBeDefined();
    });

    it('should return correct AgentIdentity for RAG agent', () => {
      const result = processUserAgentSelection(AGENT_ID.RAG_AGENT);

      expect(result.targetAgent.agentId).toBe(AGENT_ID.RAG_AGENT);
      expect(result.targetAgent.agentName).toBe(AGENT_DISPLAY_NAME[AGENT_ID.RAG_AGENT]);
    });

    it('should throw for unknown agent ID', () => {
      expect(() => processUserAgentSelection('unknown-agent')).toThrow('Unknown agent');
    });

    it('should throw for system agents (supervisor)', () => {
      expect(() => processUserAgentSelection(AGENT_ID.SUPERVISOR)).toThrow('system agent');
    });

    it('should return identity with all fields populated', () => {
      const result = processUserAgentSelection(AGENT_ID.BC_AGENT);

      expect(result.targetAgent).toEqual({
        agentId: 'bc-agent',
        agentName: 'Business Central Expert',
        agentIcon: expect.any(String),
        agentColor: expect.any(String),
      });
    });
  });
});
