/**
 * Unit tests for thinking model selection in BC Agent and RAG Agent
 *
 * Tests that both agents correctly select the thinking-enabled model
 * when state.context.options.enableThinking is true.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BusinessCentralAgent } from '@/modules/agents/business-central/bc-agent';
import { RAGAgent } from '@/modules/agents/rag-knowledge/rag-agent';
import type { AgentState } from '@/modules/agents/orchestrator/state';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { ModelRoleConfigs, getModelConfig } from '@/infrastructure/config/models';
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
  const mockCreateForThinking = vi.fn();

  return {
    ModelFactory: {
      create: mockCreate,
      createForThinking: mockCreateForThinking,
    },
    __mockCreate: mockCreate,
    __mockCreateForThinking: mockCreateForThinking,
  };
});

describe('Agent Thinking Model Selection', () => {
  // Get the mocked functions
  const mockCreate = (ModelFactory as any).create as ReturnType<typeof vi.fn>;
  const mockCreateForThinking = (ModelFactory as any).createForThinking as ReturnType<typeof vi.fn>;

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
    mockCreateForThinking.mockResolvedValue(createMockModel());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('BusinessCentralAgent', () => {
    it('should use ModelFactory.create(bc_agent) when thinking is disabled (default)', async () => {
      const agent = new BusinessCentralAgent();
      const state: AgentState = {
        messages: [new HumanMessage('Test message')],
        activeAgent: 'business-central',
        context: {
          userId: 'test-user',
          sessionId: 'test-session',
          // No options.enableThinking - defaults to false
        },
        toolExecutions: [],
        usedModel: null,
      };

      await agent.invoke(state);

      expect(mockCreate).toHaveBeenCalledWith('bc_agent');
      expect(mockCreateForThinking).not.toHaveBeenCalled();
    });

    it('should use ModelFactory.createForThinking(bc_agent, budget) when thinking is enabled', async () => {
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

      expect(mockCreateForThinking).toHaveBeenCalledWith('bc_agent', 15000);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should return orchestrator model name in usedModel when thinking is enabled', async () => {
      const agent = new BusinessCentralAgent();
      const state: AgentState = {
        messages: [new HumanMessage('Test message')],
        activeAgent: 'business-central',
        context: {
          userId: 'test-user',
          sessionId: 'test-session',
          options: {
            enableThinking: true,
          },
        },
        toolExecutions: [],
        usedModel: null,
      };

      const result = await agent.invoke(state);

      expect(result.usedModel).toBe(ModelRoleConfigs['orchestrator'].modelName);
    });

    it('should return bc_agent model name in usedModel when thinking is disabled', async () => {
      const agent = new BusinessCentralAgent();
      const state: AgentState = {
        messages: [new HumanMessage('Test message')],
        activeAgent: 'business-central',
        context: {
          userId: 'test-user',
          sessionId: 'test-session',
          options: {
            enableThinking: false,
          },
        },
        toolExecutions: [],
        usedModel: null,
      };

      const result = await agent.invoke(state);

      const bcConfig = getModelConfig('bc_agent');
      expect(result.usedModel).toBe(bcConfig.modelName);
    });

    it('should use default thinkingBudget of 10000 when not specified', async () => {
      const agent = new BusinessCentralAgent();
      const state: AgentState = {
        messages: [new HumanMessage('Test message')],
        activeAgent: 'business-central',
        context: {
          userId: 'test-user',
          sessionId: 'test-session',
          options: {
            enableThinking: true,
            // thinkingBudget not specified - should default to 10000
          },
        },
        toolExecutions: [],
        usedModel: null,
      };

      await agent.invoke(state);

      expect(mockCreateForThinking).toHaveBeenCalledWith('bc_agent', 10000);
    });

    it('should pass custom thinkingBudget through correctly', async () => {
      const agent = new BusinessCentralAgent();
      const customBudget = 25000;
      const state: AgentState = {
        messages: [new HumanMessage('Test message')],
        activeAgent: 'business-central',
        context: {
          userId: 'test-user',
          sessionId: 'test-session',
          options: {
            enableThinking: true,
            thinkingBudget: customBudget,
          },
        },
        toolExecutions: [],
        usedModel: null,
      };

      await agent.invoke(state);

      expect(mockCreateForThinking).toHaveBeenCalledWith('bc_agent', customBudget);
    });
  });

  describe('RAGAgent', () => {
    it('should use ModelFactory.create(rag_agent) when thinking is disabled (default)', async () => {
      const agent = new RAGAgent();
      const state: AgentState = {
        messages: [new HumanMessage('Test message')],
        activeAgent: 'rag-knowledge',
        context: {
          userId: 'test-user',
          sessionId: 'test-session',
          // No options.enableThinking - defaults to false
        },
        toolExecutions: [],
        usedModel: null,
      };

      await agent.invoke(state);

      expect(mockCreate).toHaveBeenCalledWith('rag_agent');
      expect(mockCreateForThinking).not.toHaveBeenCalled();
    });

    it('should use ModelFactory.createForThinking(rag_agent, budget) when thinking is enabled', async () => {
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

      expect(mockCreateForThinking).toHaveBeenCalledWith('rag_agent', 15000);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should return orchestrator model name in usedModel when thinking is enabled', async () => {
      const agent = new RAGAgent();
      const state: AgentState = {
        messages: [new HumanMessage('Test message')],
        activeAgent: 'rag-knowledge',
        context: {
          userId: 'test-user',
          sessionId: 'test-session',
          options: {
            enableThinking: true,
          },
        },
        toolExecutions: [],
        usedModel: null,
      };

      const result = await agent.invoke(state);

      expect(result.usedModel).toBe(ModelRoleConfigs['orchestrator'].modelName);
    });

    it('should return rag_agent model name in usedModel when thinking is disabled', async () => {
      const agent = new RAGAgent();
      const state: AgentState = {
        messages: [new HumanMessage('Test message')],
        activeAgent: 'rag-knowledge',
        context: {
          userId: 'test-user',
          sessionId: 'test-session',
          options: {
            enableThinking: false,
          },
        },
        toolExecutions: [],
        usedModel: null,
      };

      const result = await agent.invoke(state);

      const ragConfig = getModelConfig('rag_agent');
      expect(result.usedModel).toBe(ragConfig.modelName);
    });

    it('should use default thinkingBudget of 10000 when not specified', async () => {
      const agent = new RAGAgent();
      const state: AgentState = {
        messages: [new HumanMessage('Test message')],
        activeAgent: 'rag-knowledge',
        context: {
          userId: 'test-user',
          sessionId: 'test-session',
          options: {
            enableThinking: true,
            // thinkingBudget not specified - should default to 10000
          },
        },
        toolExecutions: [],
        usedModel: null,
      };

      await agent.invoke(state);

      expect(mockCreateForThinking).toHaveBeenCalledWith('rag_agent', 10000);
    });

    it('should pass custom thinkingBudget through correctly', async () => {
      const agent = new RAGAgent();
      const customBudget = 20000;
      const state: AgentState = {
        messages: [new HumanMessage('Test message')],
        activeAgent: 'rag-knowledge',
        context: {
          userId: 'test-user',
          sessionId: 'test-session',
          options: {
            enableThinking: true,
            thinkingBudget: customBudget,
          },
        },
        toolExecutions: [],
        usedModel: null,
      };

      await agent.invoke(state);

      expect(mockCreateForThinking).toHaveBeenCalledWith('rag_agent', customBudget);
    });
  });
});
