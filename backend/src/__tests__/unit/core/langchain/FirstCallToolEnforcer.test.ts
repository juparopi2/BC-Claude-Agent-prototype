import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFirstCallEnforcer } from '@/core/langchain/FirstCallToolEnforcer';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';

/**
 * Creates a mock BaseChatModel with bindTools support.
 *
 * bindTools returns a mock RunnableBinding with:
 * - invoke() that resolves to { content: 'forced' } or { content: 'auto' }
 * - kwargs.tools set (so createReactAgent's _shouldBindTools detects pre-binding)
 */
function createMockModel() {
  const forcedInvoke = vi.fn().mockResolvedValue({ content: 'forced-response' });
  const autoInvoke = vi.fn().mockResolvedValue({ content: 'auto-response' });

  // Track which binding was created
  const forcedBinding = {
    invoke: forcedInvoke,
    kwargs: { tools: [{ name: 'tool1' }], tool_choice: 'any' },
  };
  const autoBinding = {
    invoke: autoInvoke,
    kwargs: { tools: [{ name: 'tool1' }] },
  };

  let bindCallCount = 0;
  const model = {
    invoke: vi.fn(),
    bindTools: vi.fn().mockImplementation((_tools: unknown, kwargs?: Record<string, unknown>) => {
      bindCallCount++;
      if (kwargs?.tool_choice === 'any') {
        return forcedBinding;
      }
      return autoBinding;
    }),
  } as unknown as BaseChatModel;

  return { model, forcedInvoke, autoInvoke, forcedBinding, autoBinding, getBindCallCount: () => bindCallCount };
}

function createMockTools(count = 1): StructuredToolInterface[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `tool_${i}`,
    description: `Mock tool ${i}`,
    schema: {},
    invoke: vi.fn(),
    lc_namespace: ['test'],
  })) as unknown as StructuredToolInterface[];
}

describe('FirstCallToolEnforcer', () => {
  describe('createFirstCallEnforcer', () => {
    it('should throw if model does not support bindTools', () => {
      const modelWithoutBindTools = {
        invoke: vi.fn(),
      } as unknown as BaseChatModel;

      expect(() =>
        createFirstCallEnforcer(modelWithoutBindTools, createMockTools())
      ).toThrow('Model does not support bindTools');
    });

    it('should call bindTools twice (forced + auto)', () => {
      const { model } = createMockModel();
      const tools = createMockTools(2);

      createFirstCallEnforcer(model, tools);

      expect(model.bindTools).toHaveBeenCalledTimes(2);
      expect(model.bindTools).toHaveBeenCalledWith(tools, { tool_choice: 'any' });
      expect(model.bindTools).toHaveBeenCalledWith(tools);
    });

    it('should return an object with kwargs.tools (RunnableBinding-compatible)', () => {
      const { model } = createMockModel();
      const tools = createMockTools();

      const result = createFirstCallEnforcer(model, tools);

      // createReactAgent checks kwargs.tools to detect pre-bound models
      const binding = result as unknown as { kwargs: { tools: unknown[] } };
      expect(binding.kwargs).toBeDefined();
      expect(binding.kwargs.tools).toBeDefined();
      expect(Array.isArray(binding.kwargs.tools)).toBe(true);
    });

    it('should delegate first invoke to forced model (tool_choice: any)', async () => {
      const { model, forcedInvoke, autoInvoke } = createMockModel();
      const result = createFirstCallEnforcer(model, createMockTools());

      await result.invoke('test input', { configurable: { thread_id: 'thread-1' } });

      expect(forcedInvoke).toHaveBeenCalledTimes(1);
      expect(autoInvoke).not.toHaveBeenCalled();
    });

    it('should delegate subsequent invokes to auto model (tool_choice: auto)', async () => {
      const { model, forcedInvoke, autoInvoke } = createMockModel();
      const result = createFirstCallEnforcer(model, createMockTools());

      const config = { configurable: { thread_id: 'thread-1' } };

      await result.invoke('input 1', config);
      await result.invoke('input 2', config);
      await result.invoke('input 3', config);

      expect(forcedInvoke).toHaveBeenCalledTimes(1);
      expect(autoInvoke).toHaveBeenCalledTimes(2);
    });

    it('should reset counter when thread_id changes', async () => {
      const { model, forcedInvoke, autoInvoke } = createMockModel();
      const result = createFirstCallEnforcer(model, createMockTools());

      // First thread
      await result.invoke('input', { configurable: { thread_id: 'thread-A' } });
      await result.invoke('input', { configurable: { thread_id: 'thread-A' } });

      // New thread — should reset to forced
      await result.invoke('input', { configurable: { thread_id: 'thread-B' } });

      // thread-A: 1 forced + 1 auto; thread-B: 1 forced
      expect(forcedInvoke).toHaveBeenCalledTimes(2);
      expect(autoInvoke).toHaveBeenCalledTimes(1);
    });

    it('should handle concurrent threads independently', async () => {
      const { model, forcedInvoke, autoInvoke } = createMockModel();
      const result = createFirstCallEnforcer(model, createMockTools());

      // Thread A first call
      await result.invoke('input', { configurable: { thread_id: 'thread-A' } });
      // Thread B first call
      await result.invoke('input', { configurable: { thread_id: 'thread-B' } });
      // Thread A second call
      await result.invoke('input', { configurable: { thread_id: 'thread-A' } });
      // Thread B second call
      await result.invoke('input', { configurable: { thread_id: 'thread-B' } });

      // Both threads get forced on first call
      expect(forcedInvoke).toHaveBeenCalledTimes(2);
      // Both threads get auto on second call
      expect(autoInvoke).toHaveBeenCalledTimes(2);
    });

    it('should use __default__ key when thread_id is undefined', async () => {
      const { model, forcedInvoke, autoInvoke } = createMockModel();
      const result = createFirstCallEnforcer(model, createMockTools());

      // No configurable at all
      await result.invoke('input 1');
      await result.invoke('input 2');

      expect(forcedInvoke).toHaveBeenCalledTimes(1);
      expect(autoInvoke).toHaveBeenCalledTimes(1);
    });

    it('should pass input and options through to delegate', async () => {
      const { model, forcedInvoke } = createMockModel();
      const result = createFirstCallEnforcer(model, createMockTools());

      const input = [{ role: 'user', content: 'hello' }];
      const options = {
        configurable: { thread_id: 'test', userId: 'USER-1' },
        recursionLimit: 50,
      };

      await result.invoke(input, options);

      expect(forcedInvoke).toHaveBeenCalledWith(input, options);
    });

    it('should work with multiple tools', () => {
      const { model } = createMockModel();
      const tools = createMockTools(5);

      const result = createFirstCallEnforcer(model, tools);

      expect(result).toBeDefined();
      expect(model.bindTools).toHaveBeenCalledWith(tools, { tool_choice: 'any' });
      expect(model.bindTools).toHaveBeenCalledWith(tools);
    });

    it('should work with a single tool', () => {
      const { model } = createMockModel();
      const tools = createMockTools(1);

      const result = createFirstCallEnforcer(model, tools);

      expect(result).toBeDefined();
      expect(model.bindTools).toHaveBeenCalledWith(tools, { tool_choice: 'any' });
    });
  });
});
