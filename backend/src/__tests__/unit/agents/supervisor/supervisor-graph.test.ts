import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSupervisorGraphAdapter, __resetSupervisorGraph } from '@modules/agents/supervisor/supervisor-graph';

// Mock ModelFactory to avoid real API calls
vi.mock('@/core/langchain/ModelFactory', () => ({
  ModelFactory: {
    create: vi.fn().mockResolvedValue({
      bindTools: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue({ content: 'test' }),
      }),
      invoke: vi.fn().mockResolvedValue({ content: 'test' }),
    }),
  },
}));

// Mock createSupervisor from @langchain/langgraph-supervisor
vi.mock('@langchain/langgraph-supervisor', () => ({
  createSupervisor: vi.fn().mockReturnValue({
    compile: vi.fn().mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ messages: [] }),
      stream: vi.fn().mockReturnValue((async function* () {
        yield { messages: [] };
      })()),
      getState: vi.fn().mockResolvedValue({ tasks: [] }),
    }),
  }),
}));

// Mock createReactAgent
vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: vi.fn().mockReturnValue({
    invoke: vi.fn().mockResolvedValue({ messages: [] }),
  }),
}));

// Mock checkpointer to avoid database connection
vi.mock('@/infrastructure/checkpointer', () => ({
  getCheckpointer: vi.fn().mockReturnValue({}),
}));

// Mock analytics to avoid database connection
vi.mock('@/domains/analytics', () => ({
  getAgentAnalyticsService: vi.fn().mockReturnValue({
    recordInvocation: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('supervisor-graph', () => {
  beforeEach(() => {
    // Reset the supervisor graph singleton before each test
    __resetSupervisorGraph();
  });

  describe('getSupervisorGraphAdapter', () => {
    it('should return an object with stream method', () => {
      const adapter = getSupervisorGraphAdapter();

      expect(adapter).toBeDefined();
      expect(adapter).toHaveProperty('stream');
      expect(typeof adapter.stream).toBe('function');
    });

    it('should throw error when stream is called before initialization', async () => {
      const adapter = getSupervisorGraphAdapter();

      await expect(async () => {
        // Consume the async generator to trigger the throw
        for await (const _ of adapter.stream({
          messages: [],
          context: { userId: 'test', sessionId: 'test' },
        })) {
          // no-op
        }
      }).rejects.toThrow('Supervisor graph not initialized');
    });

    it('should return same adapter instance on multiple calls (singleton)', () => {
      const adapter1 = getSupervisorGraphAdapter();
      const adapter2 = getSupervisorGraphAdapter();

      expect(adapter1).toBe(adapter2);
    });

    it('should have consistent interface across calls', () => {
      const adapter1 = getSupervisorGraphAdapter();
      const adapter2 = getSupervisorGraphAdapter();

      expect(typeof adapter1.stream).toBe('function');
      expect(typeof adapter2.stream).toBe('function');
      expect(adapter1.stream).toBe(adapter2.stream);
    });
  });
});
