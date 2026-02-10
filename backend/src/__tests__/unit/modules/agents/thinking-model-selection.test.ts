/**
 * Unit tests for model selection in BC Agent and RAG Agent
 *
 * Tests that both agents correctly use ModelFactory.create() with their role.
 * Extended thinking was removed — agents always use their configured role model.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BusinessCentralAgent } from '@/modules/agents/business-central/bc-agent';
import { RAGAgent } from '@/modules/agents/rag-knowledge/rag-agent';
import type { AgentState } from '@/modules/agents/orchestrator/state';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { getModelConfig } from '@/infrastructure/config/models';
import { ModelFactory } from '@/core/langchain/ModelFactory';

// Mock dependencies
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock BC Agent tools
vi.mock('@/modules/agents/business-central/tools', () => ({
  listAllEntitiesTool: { name: 'list_all_entities', invoke: vi.fn() },
  searchEntityOperationsTool: { name: 'search_entity_operations', invoke: vi.fn() },
  getEntityDetailsTool: { name: 'get_entity_details', invoke: vi.fn() },
  getEntityRelationshipsTool: { name: 'get_entity_relationships', invoke: vi.fn() },
  validateWorkflowStructureTool: { name: 'validate_workflow_structure', invoke: vi.fn() },
  buildKnowledgeBaseWorkflowTool: { name: 'build_knowledge_base_workflow', invoke: vi.fn() },
  getEndpointDocumentationTool: { name: 'get_endpoint_documentation', invoke: vi.fn() },
}));

// Mock RAG Agent tools
vi.mock('@/modules/agents/rag-knowledge/tools', () => ({
  createKnowledgeSearchTool: vi.fn(() => ({ name: 'knowledge_search', invoke: vi.fn() })),
}));

// Mock ModelFactory with factory function
vi.mock('@/core/langchain/ModelFactory', () => {
  const mockCreate = vi.fn();

  return {
    ModelFactory: {
      create: mockCreate,
    },
    __mockCreate: mockCreate,
  };
});

describe('Agent Model Selection', () => {
  // Get the mocked function
  const mockCreate = (ModelFactory as any).create as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock model that returns AIMessage with no tool_calls (terminates after 1 iteration)
    const createMockModel = () => {
      const mockModelWithTools = {
        invoke: vi.fn().mockResolvedValue(
          new AIMessage({
            content: 'Test response',
            // No tool_calls property, so the ReAct loop terminates
          })
        ),
      };

      return {
        bindTools: vi.fn().mockReturnValue(mockModelWithTools),
      };
    };

    mockCreate.mockResolvedValue(createMockModel());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('BusinessCentralAgent', () => {
    it('should use ModelFactory.create(bc_agent)', async () => {
      const agent = new BusinessCentralAgent();
      const state: AgentState = {
        messages: [new HumanMessage('Test message')],
        activeAgent: 'business-central',
        context: {
          userId: 'test-user',
          sessionId: 'test-session',
        },
        toolExecutions: [],
        usedModel: null,
      };

      await agent.invoke(state);

      expect(mockCreate).toHaveBeenCalledWith('bc_agent');
    });

    it('should return bc_agent model name in usedModel', async () => {
      const agent = new BusinessCentralAgent();
      const state: AgentState = {
        messages: [new HumanMessage('Test message')],
        activeAgent: 'business-central',
        context: {
          userId: 'test-user',
          sessionId: 'test-session',
        },
        toolExecutions: [],
        usedModel: null,
      };

      const result = await agent.invoke(state);

      const bcConfig = getModelConfig('bc_agent');
      expect(result.usedModel).toBe(bcConfig.modelName);
    });

    it('should always use bc_agent role regardless of enableThinking option', async () => {
      const agent = new BusinessCentralAgent();
      const state: AgentState = {
        messages: [new HumanMessage('Test message')],
        activeAgent: 'business-central',
        context: {
          userId: 'test-user',
          sessionId: 'test-session',
          options: {
            enableThinking: true,
            thinkingBudget: 15000,
          },
        },
        toolExecutions: [],
        usedModel: null,
      };

      await agent.invoke(state);

      // Should still use bc_agent role, not thinking model
      expect(mockCreate).toHaveBeenCalledWith('bc_agent');
    });
  });

  describe('RAGAgent', () => {
    it('should use ModelFactory.create(rag_agent)', async () => {
      const agent = new RAGAgent();
      const state: AgentState = {
        messages: [new HumanMessage('Test message')],
        activeAgent: 'rag-knowledge',
        context: {
          userId: 'test-user',
          sessionId: 'test-session',
        },
        toolExecutions: [],
        usedModel: null,
      };

      await agent.invoke(state);

      expect(mockCreate).toHaveBeenCalledWith('rag_agent');
    });

    it('should return rag_agent model name in usedModel', async () => {
      const agent = new RAGAgent();
      const state: AgentState = {
        messages: [new HumanMessage('Test message')],
        activeAgent: 'rag-knowledge',
        context: {
          userId: 'test-user',
          sessionId: 'test-session',
        },
        toolExecutions: [],
        usedModel: null,
      };

      const result = await agent.invoke(state);

      const ragConfig = getModelConfig('rag_agent');
      expect(result.usedModel).toBe(ragConfig.modelName);
    });

    it('should always use rag_agent role regardless of enableThinking option', async () => {
      const agent = new RAGAgent();
      const state: AgentState = {
        messages: [new HumanMessage('Test message')],
        activeAgent: 'rag-knowledge',
        context: {
          userId: 'test-user',
          sessionId: 'test-session',
          options: {
            enableThinking: true,
            thinkingBudget: 15000,
          },
        },
        toolExecutions: [],
        usedModel: null,
      };

      await agent.invoke(state);

      // Should still use rag_agent role, not thinking model
      expect(mockCreate).toHaveBeenCalledWith('rag_agent');
    });
  });
});
