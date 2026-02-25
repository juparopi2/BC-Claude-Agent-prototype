import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildReactAgents } from '@modules/agents/supervisor/agent-builders';
import { getAgentRegistry, resetAgentRegistry } from '@modules/agents/core/registry/AgentRegistry';
import { registerAgents } from '@modules/agents/core/registry/registerAgents';

// vi.hoisted ensures these are initialized before vi.mock factories run
const { mockModel, mockBoundModel, mockEnforcerResult, mockCreateFirstCallEnforcer, mockGetModelConfig } = vi.hoisted(() => {
  const boundModel = {
    invoke: vi.fn().mockResolvedValue({ content: 'bound' }),
  };
  const model = {
    invoke: vi.fn().mockResolvedValue({ content: 'test' }),
    bindTools: vi.fn().mockReturnValue(boundModel),
  };
  const enforcerResult = {
    invoke: vi.fn().mockResolvedValue({ content: 'enforced' }),
    kwargs: { tools: [{ name: 'mock_tool' }] },
  };
  const createEnforcer = vi.fn().mockReturnValue(enforcerResult);
  const getConfig = vi.fn();
  return {
    mockModel: model,
    mockBoundModel: boundModel,
    mockEnforcerResult: enforcerResult,
    mockCreateFirstCallEnforcer: createEnforcer,
    mockGetModelConfig: getConfig,
  };
});

// Mock ModelFactory to avoid real API calls
vi.mock('@/core/langchain/ModelFactory', () => ({
  ModelFactory: {
    create: vi.fn().mockResolvedValue(mockModel),
  },
}));

// Mock FirstCallToolEnforcer
vi.mock('@/core/langchain/FirstCallToolEnforcer', () => ({
  createFirstCallEnforcer: (...args: unknown[]) => mockCreateFirstCallEnforcer(...args),
}));

// Mock getModelConfig — defaults set in beforeEach, overridable per-test
vi.mock('@/infrastructure/config/models', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/infrastructure/config/models')>();
  // Wire the hoisted mock to delegate to real implementation by default
  mockGetModelConfig.mockImplementation(actual.getModelConfig);
  return {
    ...actual,
    getModelConfig: mockGetModelConfig,
  };
});

// Mock createReactAgent since it needs a real model
vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: vi.fn().mockReturnValue({
    invoke: vi.fn().mockResolvedValue({ messages: [] }),
  }),
}));

// Mock graphing tools to avoid import issues
vi.mock('@/modules/agents/graphing/tools', () => ({
  listAvailableChartsTool: { name: 'list_available_charts', description: 'List charts', schema: {} },
  getChartDetailsTool: { name: 'get_chart_details', description: 'Chart details', schema: {} },
  validateChartConfigTool: { name: 'validate_chart_config', description: 'Validate config', schema: {} },
}));

// Mock research tools (Anthropic server-side tools) to avoid import issues
vi.mock('@/modules/agents/research/tools', () => ({
  webSearchTool: { name: 'web_search', description: 'Web search', type: 'web_search_20250305' },
  webFetchTool: { name: 'web_fetch', description: 'Web fetch', type: 'web_fetch_20250910' },
  codeExecutionTool: { name: 'code_execution', description: 'Code execution', type: 'code_execution_20250825' },
}));

// Mock RAG tools to include the new visual search tools
vi.mock('@/modules/agents/rag-knowledge/tools', () => ({
  searchKnowledgeTool: { name: 'search_knowledge', description: 'Search knowledge', schema: {} },
  visualImageSearchTool: { name: 'visualImageSearch', description: 'Visual image search', schema: {} },
  findSimilarImagesTool: { name: 'findSimilarImages', description: 'Find similar images', schema: {} },
}));

// Mock BC tools to avoid file system dependencies
vi.mock('@/modules/agents/business-central/tools', () => ({
  listAllEntitiesTool: { name: 'listAllEntities', description: 'List entities', schema: {} },
  searchEntityOperationsTool: { name: 'searchEntityOperations', description: 'Search', schema: {} },
  getEntityDetailsTool: { name: 'getEntityDetails', description: 'Details', schema: {} },
  getEntityRelationshipsTool: { name: 'getEntityRelationships', description: 'Relations', schema: {} },
  validateWorkflowStructureTool: { name: 'validateWorkflowStructure', description: 'Validate', schema: {} },
  buildKnowledgeBaseWorkflowTool: { name: 'buildKnowledgeBaseWorkflow', description: 'Build', schema: {} },
  getEndpointDocumentationTool: { name: 'getEndpointDocumentation', description: 'Docs', schema: {} },
}));

describe('agent-builders', () => {
  beforeEach(() => {
    resetAgentRegistry();
    registerAgents();
    vi.clearAllMocks();
    // Restore default enforcer mock
    mockCreateFirstCallEnforcer.mockReturnValue(mockEnforcerResult);
  });

  describe('buildReactAgents', () => {
    it('should build agents for BC, RAG, Graphing, and Research', async () => {
      const agents = await buildReactAgents();

      expect(agents).toHaveLength(4);
    });

    it('should create agents with id, name, and agent properties', async () => {
      const agents = await buildReactAgents();

      agents.forEach((agent) => {
        expect(agent).toHaveProperty('id');
        expect(agent).toHaveProperty('name');
        expect(agent).toHaveProperty('agent');
        expect(typeof agent.id).toBe('string');
        expect(typeof agent.name).toBe('string');
        expect(agent.agent).toBeTruthy();
      });
    });

    it('should create BC agent with correct id', async () => {
      const agents = await buildReactAgents();

      const bcAgent = agents.find((a) => a.id === 'bc-agent');
      expect(bcAgent).toBeDefined();
      expect(bcAgent?.name).toBeTruthy();
    });

    it('should create RAG agent with correct id', async () => {
      const agents = await buildReactAgents();

      const ragAgent = agents.find((a) => a.id === 'rag-agent');
      expect(ragAgent).toBeDefined();
      expect(ragAgent?.name).toBeTruthy();
    });

    it('should not create supervisor agent (supervisor is not a react agent)', async () => {
      const agents = await buildReactAgents();

      const supervisorAgent = agents.find((a) => a.id === 'supervisor');
      expect(supervisorAgent).toBeUndefined();
    });

    it('should create agents with unique ids', async () => {
      const agents = await buildReactAgents();

      const ids = agents.map((a) => a.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should create agents that match registry entries', async () => {
      const registry = getAgentRegistry();
      const agents = await buildReactAgents();

      agents.forEach((agent) => {
        const registryEntry = registry.get(agent.id);
        expect(registryEntry).toBeDefined();
        expect(registryEntry?.name).toBe(agent.name);
      });
    });

    it('should NOT include handoff tools (supervisor handles routing)', async () => {
      const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
      const mockCreateReactAgent = vi.mocked(createReactAgent);

      await buildReactAgents();

      for (const call of mockCreateReactAgent.mock.calls) {
        const config = call[0] as { tools: Array<{ name: string }>; name: string };
        const tools = config.tools;

        // No tool should be a handoff/transfer tool
        const handoffTools = tools.filter(
          (t) => typeof t.name === 'string' && t.name.startsWith('transfer_to_')
        );
        expect(handoffTools).toHaveLength(0);
      }
    });

    it('should pass enforced model (not raw model) to createReactAgent for client-tool agents', async () => {
      const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
      const mockCreateReactAgent = vi.mocked(createReactAgent);

      await buildReactAgents();

      // Verify the enforced model is passed for agents with client-side tools (BC, RAG, Graphing).
      // Research agent uses Anthropic server-side tools and binds directly — its llm is not the enforcer.
      const clientToolAgentNames = ['bc-agent', 'rag-agent', 'graphing-agent'];
      const clientToolCalls = mockCreateReactAgent.mock.calls.filter((call) => {
        const config = call[0] as { name?: string };
        return clientToolAgentNames.includes(config.name ?? '');
      });

      expect(clientToolCalls).toHaveLength(3);
      for (const call of clientToolCalls) {
        const config = call[0] as { llm: unknown };
        expect(config.llm).toBe(mockEnforcerResult);
        expect(config.llm).not.toBe(mockModel);
      }
    });

    it('should call createFirstCallEnforcer with model and domain tools for each agent', async () => {
      await buildReactAgents();

      // 3 client-tool worker agents: BC, RAG, Graphing
      // Research agent uses Anthropic server-side tools (bindTools directly), no enforcer needed
      expect(mockCreateFirstCallEnforcer).toHaveBeenCalledTimes(3);

      // Each call should receive the model and an array of tools
      for (const call of mockCreateFirstCallEnforcer.mock.calls) {
        expect(call[0]).toBe(mockModel);
        expect(Array.isArray(call[1])).toBe(true);
        expect((call[1] as unknown[]).length).toBeGreaterThan(0);
      }
    });

    it('should throw if agent has thinking enabled with tools', async () => {
      const { getModelConfig: realGetModelConfig } =
        await vi.importActual<typeof import('@/infrastructure/config/models')>(
          '@/infrastructure/config/models'
        );

      // Override: return thinking enabled for bc_agent role
      mockGetModelConfig.mockImplementation((role: string) => {
        if (role === 'bc_agent') {
          return {
            role: 'bc_agent',
            description: 'test',
            modelString: 'test-model',
            provider: 'anthropic' as const,
            modelName: 'test-model',
            temperature: 0.3,
            maxTokens: 16384,
            thinking: { type: 'enabled' as const, budget_tokens: 5000 },
          };
        }
        return realGetModelConfig(role as import('@/infrastructure/config/models').ModelRole);
      });

      await expect(buildReactAgents()).rejects.toThrow(
        'cannot use tool_choice enforcement with thinking enabled'
      );
    });
  });
});
