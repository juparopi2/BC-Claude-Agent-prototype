
import { BusinessCentralAgent } from './bc-agent';
import { AgentState } from '../orchestrator/state';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies - factory must be self-contained (vi.mock is hoisted)
vi.mock('../../../core/langchain/ModelFactory', () => ({
  ModelFactory: {
    create: vi.fn().mockReturnValue({
      bindTools: vi.fn().mockReturnThis(),
      invoke: vi.fn().mockResolvedValue({
        content: 'Mock BC Response',
        _getType: () => 'ai',
        additional_kwargs: {},
        response_metadata: {},
      }),
    }),
  },
}));

describe('BusinessCentralAgent', () => {
  let agent: BusinessCentralAgent;
  let mockState: AgentState;

  beforeEach(() => {
    agent = new BusinessCentralAgent();
    mockState = {
      messages: [],
      activeAgent: 'business-central',
      context: {},
    };
  });

  it('should be defined', () => {
    expect(agent).toBeDefined();
    expect(agent.name).toBe('business-central');
  });

  it('should bind tools and invoke model', async () => {
    const result = await agent.invoke(mockState);
    // Agent returns Partial<AgentState> with messages array
    expect(result).toHaveProperty('messages');
    expect(result.messages).toHaveLength(1);
    expect(result.messages?.[0]?.content).toBe('Mock BC Response');
  });
});
