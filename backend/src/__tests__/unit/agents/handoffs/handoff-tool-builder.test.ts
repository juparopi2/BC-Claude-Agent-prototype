import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildHandoffToolsForAgent } from '@modules/agents/handoffs/handoff-tool-builder';
import { resetAgentRegistry } from '@modules/agents/core/registry/AgentRegistry';
import { registerAgents } from '@modules/agents/core/registry/registerAgents';

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
}));

describe('handoff-tool-builder', () => {
  beforeEach(() => {
    resetAgentRegistry();
    registerAgents();
  });

  describe('buildHandoffToolsForAgent', () => {
    it('should create N-1 handoff tools (one per other worker agent)', () => {
      const tools = buildHandoffToolsForAgent('bc-agent');

      // BC agent should get a handoff tool to RAG agent (the only other worker)
      expect(tools).toHaveLength(1);
    });

    it('should not create self-transfer tool', () => {
      const tools = buildHandoffToolsForAgent('bc-agent');

      const selfTransfer = tools.find(t => t.name === 'transfer_to_bc-agent');
      expect(selfTransfer).toBeUndefined();
    });

    it('should create transfer_to_rag-agent for BC agent', () => {
      const tools = buildHandoffToolsForAgent('bc-agent');

      const ragTransfer = tools.find(t => t.name === 'transfer_to_rag-agent');
      expect(ragTransfer).toBeDefined();
    });

    it('should create transfer_to_bc-agent for RAG agent', () => {
      const tools = buildHandoffToolsForAgent('rag-agent');

      const bcTransfer = tools.find(t => t.name === 'transfer_to_bc-agent');
      expect(bcTransfer).toBeDefined();
    });

    it('should not create tools for system agents', () => {
      // Supervisor is a system agent - no transfer_to_supervisor should exist
      const bcTools = buildHandoffToolsForAgent('bc-agent');
      const supervisorTransfer = bcTools.find(t => t.name === 'transfer_to_supervisor');
      expect(supervisorTransfer).toBeUndefined();
    });

    it('should include description with agent display name', () => {
      const tools = buildHandoffToolsForAgent('bc-agent');
      const ragTransfer = tools.find(t => t.name === 'transfer_to_rag-agent');

      expect(ragTransfer?.description).toContain('Knowledge Base Expert');
    });
  });
});
