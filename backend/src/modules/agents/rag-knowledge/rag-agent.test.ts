
import { RAGAgent } from './rag-agent';
import { AgentState } from '../orchestrator/state';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('openai', () => {
  return {
    OpenAI: class {
      embeddings = {
        create: vi.fn()
      }
    }
  };
});

// Mock dependencies - factory must be self-contained (vi.mock is hoisted)
vi.mock('../../../core/langchain/ModelFactory', () => ({
  ModelFactory: {
    create: vi.fn().mockReturnValue({
      bindTools: vi.fn().mockReturnThis(),
      invoke: vi.fn().mockResolvedValue({
        content: 'Mock RAG Response',
        _getType: () => 'ai',
        additional_kwargs: {},
        response_metadata: {},
      }),
    }),
  },
}));

vi.mock('./tools', () => ({
  createKnowledgeSearchTool: vi.fn().mockReturnValue({
    name: 'search_knowledge_base',
  }),
}));

describe('RAGAgent', () => {
  let agent: RAGAgent;
  let mockState: AgentState;

  beforeEach(() => {
    agent = new RAGAgent();
    mockState = {
      messages: [],
      activeAgent: 'rag-knowledge',
      context: {
        userId: 'test-user-id',
      },
    };
  });

  it('should be defined', () => {
    expect(agent).toBeDefined();
    expect(agent.name).toBe('rag-knowledge');
  });

  it('should return error if userId is missing', async () => {
    const s = { ...mockState, context: {} };
    const result = await agent.invoke(s);
    expect(result.messages?.[0]?.content).toContain('Error: No user context');
  });

  it('should bind tools and invoke model', async () => {
    const result = await agent.invoke(mockState);
    // Agent returns Partial<AgentState> with messages array
    expect(result).toHaveProperty('messages');
    expect(result.messages).toHaveLength(1);
    expect(result.messages?.[0]?.content).toBe('Mock RAG Response');
  });
});
