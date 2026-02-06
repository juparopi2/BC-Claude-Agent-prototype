/**
 * @module __tests__/integration/domains/agent/orchestration/AgentOrchestrator.integration.test
 *
 * Integration tests for AgentOrchestrator with synchronous execution model.
 * Tests the orchestrator with mocked external services.
 *
 * Tests focus on:
 * - Simple end-to-end flow
 * - Error handling
 * - Input validation
 * - Persistence coordination
 */

import { describe, it, expect, beforeEach, vi, afterEach, type Mock } from 'vitest';
import { randomUUID } from 'crypto';
import { AIMessage } from '@langchain/core/messages';
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
vi.mock('@/modules/agents/supervisor', () => ({
  getSupervisorGraphAdapter: vi.fn().mockReturnValue({
    invoke: vi.fn(),
  }),
  initializeSupervisorGraph: vi.fn(),
  resumeSupervisor: vi.fn(),
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

// Import after mocks are set up
import { getSupervisorGraphAdapter } from '@/modules/agents/supervisor';
import { FileService } from '@/services/files/FileService';
import { getSemanticSearchService } from '@/services/semantic-search/SemanticSearchService';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a mock AgentState result from orchestratorGraph.invoke()
 */
function createMockInvokeResult(content: string, inputTokens = 50, outputTokens = 10) {
  return {
    messages: [
      { content: 'Test prompt', _getType: () => 'human' },
      new AIMessage({
        content,
        response_metadata: {
          stop_reason: 'end_turn',
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
          },
        },
      }),
    ],
    toolExecutions: [],
  };
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('AgentOrchestrator Integration', () => {
  let mockInvoke: Mock;
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
    mockInvoke = (getSupervisorGraphAdapter() as any).invoke as Mock;
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
      appendEventWithSequence: vi.fn().mockImplementation(
        async (sessionId, eventType, data, preAssignedSequence) => ({
          id: `evt-${randomUUID()}`,
          sequence_number: preAssignedSequence,
          timestamp: new Date(),
          processed: false,
        })
      ),
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
    it('should process simple text response end-to-end', async () => {
      // Arrange: Mock invoke to return response
      mockInvoke.mockResolvedValue(createMockInvokeResult('Hello World!', 50, 10));

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
      // Arrange
      mockInvoke.mockResolvedValue(createMockInvokeResult('Response', 50, 10));

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
      mockInvoke.mockRejectedValue(new Error('LangGraph execution failed'));

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

      mockInvoke.mockResolvedValue(createMockInvokeResult('Response', 50, 10));

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
    it('should persist user message before execution', async () => {
      mockInvoke.mockResolvedValue(createMockInvokeResult('Response', 50, 10));

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

    it('should persist agent message after execution', async () => {
      mockInvoke.mockResolvedValue(createMockInvokeResult('Response', 50, 10));

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
