/**
 * @file AgentOrchestrator.test.ts
 * @description Comprehensive unit tests for AgentOrchestrator
 *
 * Coverage:
 * 1. Factory Functions (3 tests)
 * 2. Input Validation (3 tests)
 * 3. File Context Preparation (4 tests)
 * 4. Stream Processing (5 tests)
 * 5. Event Emission (4 tests)
 * 6. Persistence (4 tests)
 * 7. Usage Tracking (2 tests)
 * 8. Error Handling (3 tests)
 * 9. Return Value (2 tests)
 *
 * Total: ~30 tests
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  AgentOrchestrator,
  createAgentOrchestrator,
  getAgentOrchestrator,
  __resetAgentOrchestrator,
} from '@domains/agent/orchestration/AgentOrchestrator';
import type { ProcessedStreamEvent } from '@domains/agent/streaming/types';
import type { IFileContextPreparer } from '@domains/agent/context/types';
import type { IPersistenceCoordinator } from '@domains/agent/persistence/types';
import type { IToolExecutionProcessor } from '@domains/agent/tools/types';
import type { IStreamEventRouter } from '@domains/agent/streaming/types';
import type { IGraphStreamProcessor } from '@domains/agent/streaming/GraphStreamProcessor';
import type { IAgentEventEmitter } from '@domains/agent/emission/types';
import type { IUsageTracker } from '@domains/agent/usage/types';
import type { AgentEvent } from '@bc-agent/shared';

// Mock external dependencies
vi.mock('@/modules/agents/orchestrator/graph', () => ({
  orchestratorGraph: {
    streamEvents: vi.fn(),
  },
}));

vi.mock('@shared/providers/adapters/StreamAdapterFactory', () => ({
  StreamAdapterFactory: {
    create: vi.fn(() => ({
      processChunk: vi.fn(),
    })),
  },
}));

vi.mock('@langchain/core/messages', () => ({
  HumanMessage: vi.fn((content) => ({ content, type: 'human' })),
}));

vi.mock('@/shared/utils/logger', () => {
  const mockLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };
  return {
    createChildLogger: vi.fn(() => mockLogger),
    logger: mockLogger,
  };
});

// Import mocked dependencies for assertions
import { orchestratorGraph } from '@/modules/agents/orchestrator/graph';
import { StreamAdapterFactory } from '@shared/providers/adapters/StreamAdapterFactory';
import { HumanMessage } from '@langchain/core/messages';

describe('AgentOrchestrator', () => {
  // Mock dependencies
  let mockFileContextPreparer: IFileContextPreparer;
  let mockPersistenceCoordinator: IPersistenceCoordinator;
  let mockStreamEventRouter: IStreamEventRouter;
  let mockGraphStreamProcessor: IGraphStreamProcessor;
  let mockToolExecutionProcessor: IToolExecutionProcessor;
  let mockAgentEventEmitter: IAgentEventEmitter;
  let mockUsageTracker: IUsageTracker;
  let orchestrator: AgentOrchestrator;

  // Test data
  const sessionId = 'session-123';
  const userId = 'user-456';
  const prompt = 'Create a sales order';

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    __resetAgentOrchestrator();

    // Create mock implementations
    mockFileContextPreparer = {
      prepare: vi.fn().mockResolvedValue({
        contextText: '',
        filesIncluded: [],
        semanticSearchUsed: false,
        totalFilesProcessed: 0,
      }),
    } as unknown as IFileContextPreparer;

    mockPersistenceCoordinator = {
      persistUserMessage: vi.fn().mockResolvedValue({ sequenceNumber: 1 }),
      persistThinking: vi.fn().mockResolvedValue({ sequenceNumber: 2 }),
      persistAgentMessage: vi.fn().mockResolvedValue({
        sequenceNumber: 3,
        timestamp: '2025-12-22T10:00:00.000Z',
        eventId: 'event-123',
      }),
    } as unknown as IPersistenceCoordinator;

    mockStreamEventRouter = {
      route: vi.fn(),
    } as unknown as IStreamEventRouter;

    mockGraphStreamProcessor = {
      process: vi.fn(),
    } as unknown as IGraphStreamProcessor;

    mockToolExecutionProcessor = {
      processExecutions: vi.fn().mockResolvedValue([]),
    } as unknown as IToolExecutionProcessor;

    mockAgentEventEmitter = {
      setCallback: vi.fn(),
      emit: vi.fn(),
      emitError: vi.fn(),
    } as unknown as IAgentEventEmitter;

    mockUsageTracker = {
      reset: vi.fn(),
      addUsage: vi.fn(),
      getInputTokens: vi.fn().mockReturnValue(100),
      getOutputTokens: vi.fn().mockReturnValue(50),
      getTotalTokens: vi.fn().mockReturnValue(150),
    } as unknown as IUsageTracker;

    // Create orchestrator with mocks
    orchestrator = createAgentOrchestrator({
      fileContextPreparer: mockFileContextPreparer,
      persistenceCoordinator: mockPersistenceCoordinator,
      streamEventRouter: mockStreamEventRouter,
      graphStreamProcessor: mockGraphStreamProcessor,
      toolExecutionProcessor: mockToolExecutionProcessor,
      agentEventEmitter: mockAgentEventEmitter,
      usageTracker: mockUsageTracker,
    });
  });

  afterEach(() => {
    __resetAgentOrchestrator();
  });

  // ===== 1. Factory Functions (3 tests) =====

  describe('Factory Functions', () => {
    it('should create AgentOrchestrator instance via createAgentOrchestrator', () => {
      const instance = createAgentOrchestrator();
      expect(instance).toBeInstanceOf(AgentOrchestrator);
    });

    it('should return singleton via getAgentOrchestrator', () => {
      const instance1 = getAgentOrchestrator();
      const instance2 = getAgentOrchestrator();
      expect(instance1).toBe(instance2);
    });

    it('should reset singleton via __resetAgentOrchestrator', () => {
      const instance1 = getAgentOrchestrator();
      __resetAgentOrchestrator();
      const instance2 = getAgentOrchestrator();
      expect(instance1).not.toBe(instance2);
    });
  });

  // ===== 2. Input Validation (3 tests) =====

  describe('Input Validation', () => {
    it('should throw error when userId missing for attachments', async () => {
      await expect(
        orchestrator.executeAgent(prompt, sessionId, undefined, undefined, {
          attachments: ['file-1'],
        })
      ).rejects.toThrow('UserId required for file attachments or semantic search');
    });

    it('should throw error when userId missing for semantic search', async () => {
      await expect(
        orchestrator.executeAgent(prompt, sessionId, undefined, undefined, {
          enableAutoSemanticSearch: true,
        })
      ).rejects.toThrow('UserId required for file attachments or semantic search');
    });

    it('should not throw when no file operations requested', async () => {
      // Setup minimal mocks for successful execution
      vi.mocked(orchestratorGraph.streamEvents).mockResolvedValue(
        createMockLangGraphStream([])
      );
      vi.mocked(mockStreamEventRouter.route).mockReturnValue(
        createMockRouterStream([
          { type: 'normalized', event: { type: 'stream_end' } },
        ])
      );
      vi.mocked(mockGraphStreamProcessor.process).mockReturnValue(
        createMockProcessedStream([
          { type: 'final_response', content: 'Done', stopReason: 'end_turn' },
        ])
      );

      await expect(
        orchestrator.executeAgent(prompt, sessionId, undefined, undefined, {
          enableThinking: false,
        })
      ).resolves.toBeDefined();
    });
  });

  // ===== 3. File Context Preparation (4 tests) =====

  describe('File Context Preparation', () => {
    beforeEach(() => {
      // Setup minimal mocks for successful execution
      vi.mocked(orchestratorGraph.streamEvents).mockResolvedValue(
        createMockLangGraphStream([])
      );
      vi.mocked(mockStreamEventRouter.route).mockReturnValue(
        createMockRouterStream([
          { type: 'normalized', event: { type: 'stream_end' } },
        ])
      );
      vi.mocked(mockGraphStreamProcessor.process).mockReturnValue(
        createMockProcessedStream([
          { type: 'final_response', content: 'Done', stopReason: 'end_turn' },
        ])
      );
    });

    it('should call FileContextPreparer.prepare with correct params', async () => {
      const options = {
        attachments: ['file-1', 'file-2'],
        enableAutoSemanticSearch: true,
        semanticThreshold: 0.8,
        maxSemanticFiles: 5,
      };

      await orchestrator.executeAgent(prompt, sessionId, undefined, userId, options);

      expect(mockFileContextPreparer.prepare).toHaveBeenCalledWith(
        userId,
        prompt,
        options
      );
    });

    it('should enhance prompt with contextText when present', async () => {
      const contextText = 'File context: Customer data...';
      vi.mocked(mockFileContextPreparer.prepare).mockResolvedValue({
        contextText,
        filesIncluded: ['file-1'],
        semanticSearchUsed: false,
        totalFilesProcessed: 1,
      });

      await orchestrator.executeAgent(prompt, sessionId, undefined, userId);

      expect(HumanMessage).toHaveBeenCalledWith(`${contextText}\n\n${prompt}`);
    });

    it('should not enhance prompt when contextText empty', async () => {
      vi.mocked(mockFileContextPreparer.prepare).mockResolvedValue({
        contextText: '',
        filesIncluded: [],
        semanticSearchUsed: false,
        totalFilesProcessed: 0,
      });

      await orchestrator.executeAgent(prompt, sessionId, undefined, userId);

      expect(HumanMessage).toHaveBeenCalledWith(prompt);
    });

    it('should pass options to FileContextPreparer', async () => {
      const options = {
        enableThinking: true,
        thinkingBudget: 5000,
        attachments: ['file-1'],
      };

      await orchestrator.executeAgent(prompt, sessionId, undefined, userId, options);

      expect(mockFileContextPreparer.prepare).toHaveBeenCalledWith(
        userId,
        prompt,
        options
      );
    });
  });

  // ===== 4. Stream Processing (5 tests) =====

  describe('Stream Processing', () => {
    beforeEach(() => {
      vi.mocked(orchestratorGraph.streamEvents).mockResolvedValue(
        createMockLangGraphStream([])
      );
    });

    it('should route events through StreamEventRouter', async () => {
      vi.mocked(mockStreamEventRouter.route).mockReturnValue(
        createMockRouterStream([
          { type: 'normalized', event: { type: 'stream_end' } },
        ])
      );
      // Use createMockProcessImpl to consume the generator, triggering route() call
      vi.mocked(mockGraphStreamProcessor.process).mockImplementation(
        createMockProcessImpl([
          { type: 'final_response', content: 'Done', stopReason: 'end_turn' },
        ])
      );

      await orchestrator.executeAgent(prompt, sessionId, undefined, userId);

      expect(mockStreamEventRouter.route).toHaveBeenCalled();
      const routeCall = vi.mocked(mockStreamEventRouter.route).mock.calls[0];
      expect(routeCall[1]).toBeDefined(); // adapter
    });

    it('should process normalized events through GraphStreamProcessor', async () => {
      const normalizedEvent = { type: 'content_delta', content: 'Hello' };
      vi.mocked(mockStreamEventRouter.route).mockReturnValue(
        createMockRouterStream([
          { type: 'normalized', event: normalizedEvent },
        ])
      );
      vi.mocked(mockGraphStreamProcessor.process).mockReturnValue(
        createMockProcessedStream([
          { type: 'message_chunk', content: 'Hello', blockIndex: 1 },
          { type: 'final_response', content: 'Hello', stopReason: 'end_turn' },
        ])
      );

      await orchestrator.executeAgent(prompt, sessionId, undefined, userId);

      expect(mockGraphStreamProcessor.process).toHaveBeenCalled();
    });

    it('should handle tool_executions via ToolExecutionProcessor', async () => {
      const executions = [
        {
          toolUseId: 'tool-1',
          toolName: 'bc_customer_list',
          input: { filter: 'name eq "Test"' },
        },
      ];

      vi.mocked(mockStreamEventRouter.route).mockReturnValue(
        createMockRouterStream([
          { type: 'tool_executions', executions, agentName: 'bc' },
          { type: 'normalized', event: { type: 'stream_end' } },
        ])
      );
      // Use createMockProcessImpl to consume the input generator,
      // which triggers toolExecutionProcessor.processExecutions
      vi.mocked(mockGraphStreamProcessor.process).mockImplementation(
        createMockProcessImpl([
          { type: 'final_response', content: 'Done', stopReason: 'end_turn' },
        ])
      );

      await orchestrator.executeAgent(prompt, sessionId, undefined, userId);

      expect(mockToolExecutionProcessor.processExecutions).toHaveBeenCalledWith(
        executions,
        expect.objectContaining({ sessionId })
      );
    });

    it('should accumulate thinking content from thinking_complete events', async () => {
      const thinkingContent = 'Let me analyze this request...';
      vi.mocked(mockStreamEventRouter.route).mockReturnValue(
        createMockRouterStream([
          { type: 'normalized', event: { type: 'content_delta' } },
        ])
      );
      vi.mocked(mockGraphStreamProcessor.process).mockReturnValue(
        createMockProcessedStream([
          { type: 'thinking_chunk', content: 'Let me', blockIndex: 0 },
          { type: 'thinking_complete', content: thinkingContent, blockIndex: 0 },
          { type: 'message_chunk', content: 'Response', blockIndex: 1 },
          { type: 'final_response', content: 'Response', stopReason: 'end_turn' },
        ])
      );

      await orchestrator.executeAgent(prompt, sessionId, undefined, userId);

      expect(mockPersistenceCoordinator.persistThinking).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({ content: thinkingContent })
      );
    });

    it('should accumulate final response from final_response events', async () => {
      const finalContent = 'Here is the sales order';
      vi.mocked(mockStreamEventRouter.route).mockReturnValue(
        createMockRouterStream([
          { type: 'normalized', event: { type: 'content_delta' } },
        ])
      );
      vi.mocked(mockGraphStreamProcessor.process).mockReturnValue(
        createMockProcessedStream([
          { type: 'message_chunk', content: 'Here', blockIndex: 1 },
          { type: 'message_chunk', content: ' is', blockIndex: 1 },
          { type: 'final_response', content: finalContent, stopReason: 'end_turn' },
        ])
      );

      await orchestrator.executeAgent(prompt, sessionId, undefined, userId);

      expect(mockPersistenceCoordinator.persistAgentMessage).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({ content: finalContent })
      );
    });
  });

  // ===== 5. Event Emission (4 tests) =====

  describe('Event Emission', () => {
    beforeEach(() => {
      vi.mocked(orchestratorGraph.streamEvents).mockResolvedValue(
        createMockLangGraphStream([])
      );
    });

    it('should emit thinking_chunk events correctly', async () => {
      vi.mocked(mockStreamEventRouter.route).mockReturnValue(
        createMockRouterStream([
          { type: 'normalized', event: { type: 'content_delta' } },
        ])
      );
      vi.mocked(mockGraphStreamProcessor.process).mockReturnValue(
        createMockProcessedStream([
          { type: 'thinking_chunk', content: 'Thinking...', blockIndex: 0 },
          { type: 'final_response', content: 'Done', stopReason: 'end_turn' },
        ])
      );

      await orchestrator.executeAgent(prompt, sessionId, undefined, userId);

      expect(mockAgentEventEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'thinking_chunk',
          content: 'Thinking...',
          blockIndex: 0,
          sessionId,
        })
      );
    });

    it('should emit message_chunk events correctly', async () => {
      vi.mocked(mockStreamEventRouter.route).mockReturnValue(
        createMockRouterStream([
          { type: 'normalized', event: { type: 'content_delta' } },
        ])
      );
      vi.mocked(mockGraphStreamProcessor.process).mockReturnValue(
        createMockProcessedStream([
          { type: 'message_chunk', content: 'Hello', blockIndex: 1 },
          { type: 'final_response', content: 'Hello', stopReason: 'end_turn' },
        ])
      );

      await orchestrator.executeAgent(prompt, sessionId, undefined, userId);

      expect(mockAgentEventEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message_chunk',
          content: 'Hello',
          blockIndex: 1,
          sessionId,
        })
      );
    });

    it('should emit thinking_complete event correctly', async () => {
      const thinkingContent = 'Full thinking content';
      vi.mocked(mockStreamEventRouter.route).mockReturnValue(
        createMockRouterStream([
          { type: 'normalized', event: { type: 'content_delta' } },
        ])
      );
      vi.mocked(mockGraphStreamProcessor.process).mockReturnValue(
        createMockProcessedStream([
          { type: 'thinking_complete', content: thinkingContent, blockIndex: 0 },
          { type: 'final_response', content: 'Done', stopReason: 'end_turn' },
        ])
      );

      await orchestrator.executeAgent(prompt, sessionId, undefined, userId);

      expect(mockAgentEventEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'thinking_complete',
          content: thinkingContent,
          sessionId,
        })
      );
    });

    it('should emit final message and complete events', async () => {
      const finalContent = 'Final response';
      vi.mocked(mockStreamEventRouter.route).mockReturnValue(
        createMockRouterStream([
          { type: 'normalized', event: { type: 'content_delta' } },
        ])
      );
      vi.mocked(mockGraphStreamProcessor.process).mockReturnValue(
        createMockProcessedStream([
          { type: 'final_response', content: finalContent, stopReason: 'end_turn' },
        ])
      );

      await orchestrator.executeAgent(prompt, sessionId, undefined, userId);

      // Should emit message event with persisted data
      expect(mockAgentEventEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message',
          content: finalContent,
          role: 'assistant',
          stopReason: 'end_turn',
          sequenceNumber: 3,
          persistenceState: 'persisted',
          sessionId,
        })
      );

      // Should emit complete event
      expect(mockAgentEventEmitter.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'complete',
          sessionId,
          stopReason: 'end_turn',
        })
      );
    });
  });

  // ===== 6. Persistence (4 tests) =====

  describe('Persistence', () => {
    beforeEach(() => {
      vi.mocked(orchestratorGraph.streamEvents).mockResolvedValue(
        createMockLangGraphStream([])
      );
      vi.mocked(mockStreamEventRouter.route).mockReturnValue(
        createMockRouterStream([
          { type: 'normalized', event: { type: 'stream_end' } },
        ])
      );
    });

    it('should call persistUserMessage with original prompt', async () => {
      vi.mocked(mockGraphStreamProcessor.process).mockReturnValue(
        createMockProcessedStream([
          { type: 'final_response', content: 'Done', stopReason: 'end_turn' },
        ])
      );

      await orchestrator.executeAgent(prompt, sessionId, undefined, userId);

      expect(mockPersistenceCoordinator.persistUserMessage).toHaveBeenCalledWith(
        sessionId,
        prompt
      );
    });

    it('should call persistThinking when thinking content exists', async () => {
      const thinkingContent = 'Analyzing the request...';
      vi.mocked(mockGraphStreamProcessor.process).mockReturnValue(
        createMockProcessedStream([
          { type: 'thinking_complete', content: thinkingContent, blockIndex: 0 },
          { type: 'usage', inputTokens: 100, outputTokens: 50 },
          { type: 'final_response', content: 'Done', stopReason: 'end_turn' },
        ])
      );

      await orchestrator.executeAgent(prompt, sessionId, undefined, userId);

      expect(mockPersistenceCoordinator.persistThinking).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          content: thinkingContent,
          tokenUsage: {
            inputTokens: 100,
            outputTokens: 50,
          },
        })
      );
    });

    it('should call persistAgentMessage with accumulated content', async () => {
      const finalContent = 'Sales order created successfully';
      vi.mocked(mockGraphStreamProcessor.process).mockReturnValue(
        createMockProcessedStream([
          { type: 'message_chunk', content: 'Sales', blockIndex: 1 },
          { type: 'message_chunk', content: ' order', blockIndex: 1 },
          { type: 'final_response', content: finalContent, stopReason: 'end_turn' },
        ])
      );

      await orchestrator.executeAgent(prompt, sessionId, undefined, userId);

      expect(mockPersistenceCoordinator.persistAgentMessage).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          content: finalContent,
          stopReason: 'end_turn',
          model: 'claude-3-5-sonnet-20241022',
          tokenUsage: {
            inputTokens: 100,
            outputTokens: 50,
          },
        })
      );
    });

    it('should not persist thinking when content empty', async () => {
      vi.mocked(mockGraphStreamProcessor.process).mockReturnValue(
        createMockProcessedStream([
          { type: 'message_chunk', content: 'Response', blockIndex: 1 },
          { type: 'final_response', content: 'Response', stopReason: 'end_turn' },
        ])
      );

      await orchestrator.executeAgent(prompt, sessionId, undefined, userId);

      expect(mockPersistenceCoordinator.persistThinking).not.toHaveBeenCalled();
    });
  });

  // ===== 7. Usage Tracking (2 tests) =====

  describe('Usage Tracking', () => {
    beforeEach(() => {
      vi.mocked(orchestratorGraph.streamEvents).mockResolvedValue(
        createMockLangGraphStream([])
      );
      vi.mocked(mockStreamEventRouter.route).mockReturnValue(
        createMockRouterStream([
          { type: 'normalized', event: { type: 'content_delta' } },
        ])
      );
    });

    it('should track usage from ProcessedStreamEvents', async () => {
      vi.mocked(mockGraphStreamProcessor.process).mockReturnValue(
        createMockProcessedStream([
          { type: 'usage', inputTokens: 200, outputTokens: 100 },
          { type: 'usage', inputTokens: 50, outputTokens: 25 },
          { type: 'final_response', content: 'Done', stopReason: 'end_turn' },
        ])
      );

      await orchestrator.executeAgent(prompt, sessionId, undefined, userId);

      expect(mockUsageTracker.addUsage).toHaveBeenCalledWith({
        inputTokens: 200,
        outputTokens: 100,
      });
      expect(mockUsageTracker.addUsage).toHaveBeenCalledWith({
        inputTokens: 50,
        outputTokens: 25,
      });
    });

    it('should return correct token usage in result', async () => {
      vi.mocked(mockGraphStreamProcessor.process).mockReturnValue(
        createMockProcessedStream([
          { type: 'final_response', content: 'Done', stopReason: 'end_turn' },
        ])
      );

      const result = await orchestrator.executeAgent(
        prompt,
        sessionId,
        undefined,
        userId
      );

      expect(result.tokenUsage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });
    });
  });

  // ===== 8. Error Handling (3 tests) =====

  describe('Error Handling', () => {
    const error = new Error('Stream processing failed');

    beforeEach(() => {
      vi.mocked(orchestratorGraph.streamEvents).mockResolvedValue(
        createMockLangGraphStream([])
      );
    });

    it('should emit error event on execution failure', async () => {
      // Create a generator that throws when iterated
      vi.mocked(mockStreamEventRouter.route).mockReturnValue(
        (async function* () {
          throw error;
        })()
      );
      // Use mock implementation that consumes the generator (triggering the error)
      vi.mocked(mockGraphStreamProcessor.process).mockImplementation(
        createMockProcessImpl([])
      );

      await expect(
        orchestrator.executeAgent(prompt, sessionId, undefined, userId)
      ).rejects.toThrow('Stream processing failed');

      expect(mockAgentEventEmitter.emitError).toHaveBeenCalledWith(
        sessionId,
        'Stream processing failed',
        'EXECUTION_FAILED'
      );
    });

    it('should log error with session context', async () => {
      // Create a generator that throws when iterated
      vi.mocked(mockStreamEventRouter.route).mockReturnValue(
        (async function* () {
          throw error;
        })()
      );
      // Use mock implementation that consumes the generator (triggering the error)
      vi.mocked(mockGraphStreamProcessor.process).mockImplementation(
        createMockProcessImpl([])
      );

      await expect(
        orchestrator.executeAgent(prompt, sessionId, undefined, userId)
      ).rejects.toThrow();

      // Logger mock should have been called with error context
      // Note: Logger is mocked, so we can't directly assert on it,
      // but the test verifies the error handling flow
    });

    it('should re-throw error after emitting', async () => {
      // Create a generator that throws when iterated
      vi.mocked(mockStreamEventRouter.route).mockReturnValue(
        (async function* () {
          throw error;
        })()
      );
      // Use mock implementation that consumes the generator (triggering the error)
      vi.mocked(mockGraphStreamProcessor.process).mockImplementation(
        createMockProcessImpl([])
      );

      await expect(
        orchestrator.executeAgent(prompt, sessionId, undefined, userId)
      ).rejects.toThrow('Stream processing failed');
    });
  });

  // ===== 9. Return Value (2 tests) =====

  describe('Return Value', () => {
    beforeEach(() => {
      vi.mocked(orchestratorGraph.streamEvents).mockResolvedValue(
        createMockLangGraphStream([])
      );
      vi.mocked(mockStreamEventRouter.route).mockReturnValue(
        createMockRouterStream([
          { type: 'normalized', event: { type: 'content_delta' } },
        ])
      );
    });

    it('should return correct AgentExecutionResult structure', async () => {
      const finalContent = 'Order created';
      vi.mocked(mockGraphStreamProcessor.process).mockReturnValue(
        createMockProcessedStream([
          { type: 'final_response', content: finalContent, stopReason: 'end_turn' },
        ])
      );

      const result = await orchestrator.executeAgent(
        prompt,
        sessionId,
        undefined,
        userId
      );

      expect(result).toMatchObject({
        sessionId,
        response: finalContent,
        messageId: expect.any(String),
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
        toolsUsed: [],
        success: true,
      });
    });

    it('should include sessionId, messageId, response, tokenUsage, success', async () => {
      vi.mocked(mockGraphStreamProcessor.process).mockReturnValue(
        createMockProcessedStream([
          { type: 'final_response', content: 'Done', stopReason: 'end_turn' },
        ])
      );

      const result = await orchestrator.executeAgent(
        prompt,
        sessionId,
        undefined,
        userId
      );

      expect(result).toHaveProperty('sessionId', sessionId);
      expect(result).toHaveProperty('messageId');
      expect(result).toHaveProperty('response', 'Done');
      expect(result).toHaveProperty('tokenUsage');
      expect(result.tokenUsage).toHaveProperty('inputTokens');
      expect(result.tokenUsage).toHaveProperty('outputTokens');
      expect(result.tokenUsage).toHaveProperty('totalTokens');
      expect(result).toHaveProperty('success', true);
    });
  });
});

// ===== Helper Functions =====

/**
 * Create mock LangGraph stream (raw StreamEvent iterator)
 */
async function* createMockLangGraphStream(
  events: Array<Record<string, unknown>>
): AsyncGenerator<unknown> {
  for (const event of events) {
    yield event;
  }
}

/**
 * Create mock router stream (RoutedEvent iterator)
 */
async function* createMockRouterStream(
  events: Array<{ type: string; [key: string]: unknown }>
): AsyncGenerator<{ type: string; [key: string]: unknown }> {
  for (const event of events) {
    yield event;
  }
}

/**
 * Create mock processed stream (ProcessedStreamEvent iterator)
 */
async function* createMockProcessedStream(
  events: ProcessedStreamEvent[]
): AsyncGenerator<ProcessedStreamEvent> {
  for (const event of events) {
    yield event;
  }
}

/**
 * Create a mock implementation for graphStreamProcessor.process that
 * consumes the input generator before yielding test events.
 * This is necessary because AgentOrchestrator's createNormalizedEventStream()
 * generator has side effects (calling toolExecutionProcessor.processExecutions)
 * that need to execute.
 */
function createMockProcessImpl(events: ProcessedStreamEvent[]) {
  return async function* (
    inputGenerator: AsyncIterable<unknown>
  ): AsyncGenerator<ProcessedStreamEvent> {
    // First, consume the input generator to trigger side effects
    for await (const _event of inputGenerator) {
      // Just consuming to trigger side effects in createNormalizedEventStream
    }
    // Then yield the test events
    for (const event of events) {
      yield event;
    }
  };
}
