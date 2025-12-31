/**
 * @module __tests__/integration/domains/agent/orchestration/AgentOrchestrator.integration.test
 *
 * Integration tests for AgentOrchestrator.
 * Tests the orchestrator with mocked external services.
 *
 * Note: Multi-event accumulation scenarios (thinking, tool execution) are covered
 * extensively in unit tests (30 tests in AgentOrchestrator.test.ts).
 * These integration tests focus on:
 * - Simple end-to-end flow
 * - Error handling
 * - Input validation
 * - Persistence coordination
 */

import { describe, it, expect, beforeEach, vi, afterEach, type Mock } from 'vitest';
import { randomUUID } from 'crypto';
import type { StreamEvent } from '@langchain/core/tracers/log_stream';
import { createAgentOrchestrator, __resetAgentOrchestrator } from '@domains/agent/orchestration/AgentOrchestrator';
import { PersistenceCoordinator } from '@domains/agent/persistence/PersistenceCoordinator';
import type {
  AgentEvent,
  MessageEvent,
  ErrorEvent,
} from '@bc-agent/shared';
import type { EventStore } from '@/services/events/EventStore';
import type { MessageQueue } from '@/infrastructure/queue/MessageQueue';

// ============================================================================
// Mock External Services BEFORE imports
// ============================================================================

// Mock LangGraph
vi.mock('@/modules/agents/orchestrator/graph', () => ({
  orchestratorGraph: {
    streamEvents: vi.fn(),
  },
}));

// Mock FileService
vi.mock('@/services/files/FileService', () => ({
  FileService: {
    getInstance: () => ({
      getFile: vi.fn(),
    }),
  },
}));

// Mock SemanticSearchService
vi.mock('@/services/semantic-search/SemanticSearchService', () => ({
  getSemanticSearchService: () => ({
    searchRelevantFiles: vi.fn(),
  }),
}));

// Mock ContextRetrievalService
vi.mock('@/services/files/context/ContextRetrievalService', () => ({
  getContextRetrievalService: () => ({
    retrieveMultiple: vi.fn().mockResolvedValue({
      contents: [],
    }),
  }),
}));

// Mock PromptBuilder
vi.mock('@/services/files/context/PromptBuilder', () => ({
  getFileContextPromptBuilder: () => ({
    buildDocumentContext: vi.fn().mockReturnValue(''),
  }),
}));

// Mock StreamAdapterFactory to return a mock adapter that processes our test events
vi.mock('@shared/providers/adapters/StreamAdapterFactory', () => ({
  StreamAdapterFactory: {
    create: vi.fn(() => ({
      processChunk: (event: { event: string; name: string; data?: Record<string, unknown> }) => {
        // Handle content delta events
        if (event.event === 'on_chat_model_stream' && event.name === 'ChatAnthropic') {
          const chunk = event.data?.chunk as Record<string, unknown> | undefined;
          if (chunk?.delta && typeof chunk.delta === 'object') {
            const delta = chunk.delta as Record<string, unknown>;
            if (delta.type === 'text_delta' && typeof delta.text === 'string') {
              return {
                type: 'content_delta',
                content: delta.text,
                timestamp: new Date(),
                metadata: { blockIndex: chunk.index ?? 0 },
              };
            }
          }
        }
        // Handle stream end events
        if (event.event === 'on_chat_model_end' && event.name === 'ChatAnthropic') {
          const output = event.data?.output as Record<string, unknown> | undefined;
          const usage = output?.usage as Record<string, number> | undefined;
          return {
            type: 'stream_end',
            timestamp: new Date(),
            metadata: { blockIndex: 0 },
            raw: { stop_reason: output?.stop_reason ?? 'end_turn' },
            usage: usage ? {
              inputTokens: usage.input_tokens ?? 0,
              outputTokens: usage.output_tokens ?? 0,
            } : undefined,
          };
        }
        return null;
      },
      normalizeStopReason: (stopReason: string) => {
        // Simulate Anthropic adapter behavior
        const mapping: Record<string, string> = {
          'end_turn': 'success',
          'max_tokens': 'max_turns',
          'tool_use': 'success',
          'stop_sequence': 'success',
        };
        return mapping[stopReason] ?? 'success';
      },
    })),
  },
}));

// Import after mocks are set up
import { orchestratorGraph } from '@/modules/agents/orchestrator/graph';
import { FileService } from '@/services/files/FileService';
import { getSemanticSearchService } from '@/services/semantic-search/SemanticSearchService';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a mock LangGraph stream that yields events.
 */
async function* createMockLangGraphStream(events: StreamEvent[]): AsyncIterable<StreamEvent> {
  for (const event of events) {
    yield event;
  }
}

/**
 * Create a properly formatted content delta event (text streaming).
 */
function createContentDeltaEvent(content: string, blockIndex = 0): StreamEvent {
  return {
    event: 'on_chat_model_stream',
    name: 'ChatAnthropic',
    run_id: randomUUID(),
    tags: [],
    metadata: {},
    data: {
      chunk: {
        type: 'content_block_delta',
        index: blockIndex,
        delta: {
          type: 'text_delta',
          text: content,
        },
      },
    },
  };
}

/**
 * Create a stream end event with usage information.
 */
function createStreamEndEvent(inputTokens = 100, outputTokens = 50): StreamEvent {
  return {
    event: 'on_chat_model_end',
    name: 'ChatAnthropic',
    run_id: randomUUID(),
    tags: [],
    metadata: {},
    data: {
      output: {
        id: randomUUID(),
        content: [{ type: 'text', text: '' }],
        role: 'assistant',
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'end_turn',
        type: 'message',
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        },
      },
    },
  };
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('AgentOrchestrator Integration', () => {
  let mockStreamEvents: Mock;
  let mockGetFile: Mock;
  let mockSearchRelevantFiles: Mock;
  let mockAppendEvent: Mock;
  let mockAddMessagePersistence: Mock;
  let mockEventStore: Partial<EventStore>;
  let mockMessageQueue: Partial<MessageQueue>;
  let persistenceCoordinator: PersistenceCoordinator;

  beforeEach(() => {
    // Reset singleton
    __resetAgentOrchestrator();

    // Get references to mocked module functions
    mockStreamEvents = orchestratorGraph.streamEvents as Mock;
    mockGetFile = FileService.getInstance().getFile as Mock;
    mockSearchRelevantFiles = getSemanticSearchService().searchRelevantFiles as Mock;

    // Create mock EventStore and MessageQueue objects
    let sequenceCounter = 1;
    mockAppendEvent = vi.fn().mockImplementation(async () => ({
      id: `evt-${randomUUID()}`,
      sequence_number: sequenceCounter++,
      timestamp: new Date(),
      processed: false,
    }));

    mockAddMessagePersistence = vi.fn().mockResolvedValue(undefined);

    mockEventStore = {
      appendEvent: mockAppendEvent,
    } as Partial<EventStore>;

    mockMessageQueue = {
      addMessagePersistence: mockAddMessagePersistence,
    } as Partial<MessageQueue>;

    // Create PersistenceCoordinator with mocked dependencies
    persistenceCoordinator = new PersistenceCoordinator(
      mockEventStore as EventStore,
      mockMessageQueue as MessageQueue
    );

    // Setup default mock behaviors for other services
    mockGetFile.mockResolvedValue(null);
    mockSearchRelevantFiles.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Simple Text Response Flow
  // ==========================================================================

  describe('simple text response flow', () => {
    it('should process simple text streaming end-to-end', async () => {
      // Arrange: Mock LangGraph stream with simple content
      const mockEvents = createMockLangGraphStream([
        createContentDeltaEvent('Hello '),
        createContentDeltaEvent('World!'),
        createStreamEndEvent(50, 10),
      ]);
      mockStreamEvents.mockResolvedValue(mockEvents);

      // Create orchestrator with mocked persistence
      const orchestrator = createAgentOrchestrator({
        persistenceCoordinator,
      });
      const events: AgentEvent[] = [];

      // Act: Execute agent
      const result = await orchestrator.executeAgentSync(
        'Say hello',
        'session-1',
        (event) => events.push(event),
        'user-1'
      );

      // Assert: Result structure
      expect(result.success).toBe(true);
      expect(result.sessionId).toBe('session-1');
      expect(result.response).toBe('Hello World!');
      expect(result.tokenUsage).toBeDefined();
      expect(result.tokenUsage?.inputTokens).toBe(50);
      expect(result.tokenUsage?.outputTokens).toBe(10);

      // Assert: Events were emitted correctly
      expect(events.length).toBeGreaterThan(0);

      // Verify message chunks were emitted
      const messageChunks = events.filter((e) => e.type === 'message_chunk');
      expect(messageChunks.length).toBeGreaterThanOrEqual(2);

      // Verify final message event
      const messageEvent = events.find((e): e is MessageEvent => e.type === 'message');
      expect(messageEvent).toBeDefined();
      expect(messageEvent?.content).toBe('Hello World!');

      // Verify complete event
      const completeEvent = events.find((e) => e.type === 'complete');
      expect(completeEvent).toBeDefined();

      // Assert: Persistence was called
      expect(mockAppendEvent).toHaveBeenCalled();
      expect(mockAddMessagePersistence).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Event Emission
  // ==========================================================================

  describe('event emission', () => {
    it('should emit events with auto-incrementing index', async () => {
      // Arrange: Stream with multiple events
      const mockEvents = createMockLangGraphStream([
        createContentDeltaEvent('Chunk 1'),
        createContentDeltaEvent('Chunk 2'),
        createContentDeltaEvent('Chunk 3'),
        createStreamEndEvent(50, 10),
      ]);
      mockStreamEvents.mockResolvedValue(mockEvents);

      const orchestrator = createAgentOrchestrator({ persistenceCoordinator });
      const events: AgentEvent[] = [];

      // Act
      await orchestrator.executeAgentSync(
        'Test indexing',
        'session-2',
        (event) => events.push(event),
        'user-1'
      );

      // Assert: Events have eventIndex
      const eventsWithIndex = events.filter((e) => 'eventIndex' in e);
      expect(eventsWithIndex.length).toBeGreaterThan(0);

      // Verify indices are sequential
      const indices = eventsWithIndex.map((e) => (e as { eventIndex: number }).eventIndex);
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]).toBe(indices[i - 1]! + 1);
      }
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    it('should emit error event when LangGraph execution fails', async () => {
      // Arrange: Mock LangGraph failure
      mockStreamEvents.mockRejectedValue(new Error('LangGraph execution failed'));

      const orchestrator = createAgentOrchestrator({ persistenceCoordinator });
      const events: AgentEvent[] = [];

      // Act & Assert: Should throw and emit error event
      await expect(
        orchestrator.executeAgentSync(
          'Test error event',
          'session-3',
          (event) => events.push(event),
          'user-1'
        )
      ).rejects.toThrow('LangGraph execution failed');

      // Assert: Error event emitted
      const errorEvent = events.find((e): e is ErrorEvent => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.error).toContain('LangGraph execution failed');
    });

    it('should propagate persistence errors', async () => {
      // Arrange: Mock persistence failure
      mockAppendEvent.mockRejectedValueOnce(new Error('Database connection failed'));

      const mockEvents = createMockLangGraphStream([
        createContentDeltaEvent('Response'),
        createStreamEndEvent(50, 10),
      ]);
      mockStreamEvents.mockResolvedValue(mockEvents);

      const orchestrator = createAgentOrchestrator({ persistenceCoordinator });

      // Act & Assert: Should throw error
      await expect(
        orchestrator.executeAgentSync('Test persistence error', 'session-4', undefined, 'user-1')
      ).rejects.toThrow('Database connection failed');
    });

    it('should throw error when userId missing for file attachments', async () => {
      // Arrange: Try to use attachments without userId
      const orchestrator = createAgentOrchestrator({ persistenceCoordinator });

      // Act & Assert: Should throw immediately
      await expect(
        orchestrator.executeAgentSync(
          'Test',
          'session-5',
          undefined,
          undefined, // No userId
          { attachments: ['file-1'] } // But has attachments
        )
      ).rejects.toThrow('UserId required');
    });

    it('should throw error when userId missing for semantic search', async () => {
      // Arrange: Try to use semantic search without userId
      const orchestrator = createAgentOrchestrator({ persistenceCoordinator });

      // Act & Assert: Should throw immediately
      await expect(
        orchestrator.executeAgentSync(
          'Test',
          'session-6',
          undefined,
          undefined, // No userId
          { enableAutoSemanticSearch: true }
        )
      ).rejects.toThrow('UserId required');
    });
  });

  // ==========================================================================
  // Persistence Integration
  // ==========================================================================

  describe('persistence integration', () => {
    it('should persist user message before streaming', async () => {
      const mockEvents = createMockLangGraphStream([
        createContentDeltaEvent('Response'),
        createStreamEndEvent(50, 10),
      ]);
      mockStreamEvents.mockResolvedValue(mockEvents);

      const orchestrator = createAgentOrchestrator({ persistenceCoordinator });

      await orchestrator.executeAgentSync(
        'Test message',
        'session-7',
        undefined,
        'user-1'
      );

      // User message should be persisted
      expect(mockAppendEvent).toHaveBeenCalled();
      // Verify the first call was for user_message_sent
      const firstCall = mockAppendEvent.mock.calls[0];
      expect(firstCall?.[0]).toBe('session-7');
      expect(firstCall?.[1]).toBe('user_message_sent');
    });

    it('should persist agent message after streaming', async () => {
      const mockEvents = createMockLangGraphStream([
        createContentDeltaEvent('Response'),
        createStreamEndEvent(50, 10),
      ]);
      mockStreamEvents.mockResolvedValue(mockEvents);

      const orchestrator = createAgentOrchestrator({ persistenceCoordinator });

      await orchestrator.executeAgentSync(
        'Test',
        'session-8',
        undefined,
        'user-1'
      );

      // Agent message should be persisted
      expect(mockAddMessagePersistence).toHaveBeenCalled();
    });
  });
});
