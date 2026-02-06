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

describe('supervisor-graph', () => {
  beforeEach(() => {
    // Reset the supervisor graph singleton before each test
    __resetSupervisorGraph();
  });

  describe('getSupervisorGraphAdapter', () => {
    it('should return an object with invoke method', () => {
      const adapter = getSupervisorGraphAdapter();

      expect(adapter).toBeDefined();
      expect(adapter).toHaveProperty('invoke');
      expect(typeof adapter.invoke).toBe('function');
    });

    it('should throw error when invoke is called before initialization', async () => {
      const adapter = getSupervisorGraphAdapter();

      await expect(async () => {
        await adapter.invoke({
          messages: [],
          context: { userId: 'test', sessionId: 'test' },
        });
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

      expect(typeof adapter1.invoke).toBe('function');
      expect(typeof adapter2.invoke).toBe('function');
      expect(adapter1.invoke).toBe(adapter2.invoke);
    });
  });
});
