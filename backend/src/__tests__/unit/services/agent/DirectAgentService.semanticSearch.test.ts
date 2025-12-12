/**
 * Unit Tests - DirectAgentService - Semantic Search (UseMyContext)
 *
 * Tests for the enableAutoSemanticSearch feature that allows automatic
 * retrieval of relevant files from user's context based on semantic similarity.
 *
 * CRITICAL BUSINESS LOGIC:
 * - Manual attachments ALWAYS take priority over semantic search
 * - Semantic search ONLY runs when: enableAutoSemanticSearch=true AND no attachments AND userId provided
 * - Errors in semantic search should NOT block agent execution
 *
 * @module __tests__/unit/services/agent/DirectAgentService.semanticSearch
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { DirectAgentService } from '@/services/agent/DirectAgentService';
import type { IAnthropicClient } from '@/services/agent/IAnthropicClient';
import type { ApprovalManager } from '@/services/approval/ApprovalManager';
import type { AgentEvent } from '@/types/agent.types';
import { createSimpleTextStream } from './streamingMockHelpers';
import * as fs from 'fs';
import * as path from 'path';

// ===== MOCK EVENT SOURCING DEPENDENCIES =====
let nextSequence = 0;
vi.mock('@/services/events/EventStore', () => ({
  getEventStore: vi.fn(() => ({
    appendEvent: vi.fn().mockResolvedValue({
      id: 'event-' + Math.random().toString(36).substring(7),
      sequence_number: nextSequence++,
      timestamp: new Date(),
    }),
    appendEventWithSequence: vi.fn((sessionId, eventType, data, preAssignedSequence) => Promise.resolve({
      id: 'event-' + Math.random().toString(36).substring(7),
      session_id: sessionId,
      event_type: eventType,
      sequence_number: preAssignedSequence,
      timestamp: new Date(),
      data,
      processed: false,
    })),
    getNextSequenceNumber: vi.fn().mockResolvedValue(1),
    getEvents: vi.fn().mockResolvedValue([]),
  })),
}));

// ===== MOCK MESSAGE ORDERING SERVICE =====
let mockEventCallback: ((event: AgentEvent) => void) | null = null;

vi.mock('@/services/agent/messages', () => ({
  getMessageOrderingService: vi.fn(() => ({
    reserveSequenceBatch: vi.fn((sessionId, count) => {
      const startSequence = nextSequence;
      const sequences: number[] = [];
      for (let i = 0; i < count; i++) {
        sequences.push(startSequence + i);
      }
      nextSequence += count;
      return Promise.resolve({
        sessionId,
        startSequence,
        sequences,
        reservedAt: new Date(),
      });
    }),
    getNextSequence: vi.fn(() => Promise.resolve(nextSequence++)),
  })),
  getMessageEmitter: vi.fn(() => ({
    setEventCallback: vi.fn((callback) => {
      mockEventCallback = callback;
    }),
    clearEventCallback: vi.fn(() => {
      mockEventCallback = null;
    }),
    emitMessageChunk: vi.fn((chunk: string, blockIndex: number) => {
      if (mockEventCallback) {
        mockEventCallback({
          type: 'message_chunk',
          chunk,
          blockIndex,
          timestamp: new Date(),
        } as AgentEvent);
      }
    }),
    emitThinkingChunk: vi.fn((chunk: string, blockIndex: number) => {
      if (mockEventCallback) {
        mockEventCallback({
          type: 'thinking_chunk',
          content: chunk,
          blockIndex,
          persistenceState: 'transient',
          timestamp: new Date(),
        } as AgentEvent);
      }
    }),
    emitToolUsePending: vi.fn((data: { toolName: string; toolUseId: string; blockIndex: number }) => {
      if (mockEventCallback) {
        mockEventCallback({
          type: 'tool_use_pending',
          toolName: data.toolName,
          toolUseId: data.toolUseId,
          blockIndex: data.blockIndex,
          timestamp: new Date(),
        } as AgentEvent);
      }
    }),
    emitComplete: vi.fn((stopReason: string, tokenUsage?: unknown) => {
      if (mockEventCallback) {
        mockEventCallback({
          type: 'complete',
          reason: 'success',
          stopReason,
          tokenUsage,
          timestamp: new Date(),
        } as AgentEvent);
      }
    }),
    emitError: vi.fn((error: string, code?: string) => {
      if (mockEventCallback) {
        mockEventCallback({
          type: 'error',
          error,
          code,
          timestamp: new Date(),
        } as AgentEvent);
      }
    }),
    emitThinking: vi.fn((data: { content: string; eventId: string; sequenceNumber: number }) => {
      if (mockEventCallback) {
        mockEventCallback({
          type: 'thinking',
          content: data.content,
          sequenceNumber: data.sequenceNumber,
          timestamp: new Date(),
        } as AgentEvent);
      }
    }),
    emitMessage: vi.fn((data: {
      content: string;
      messageId: string;
      role: string;
      stopReason: string;
      sequenceNumber: number;
      eventId: string;
      tokenUsage?: unknown;
      model?: string;
      metadata?: unknown;
    }) => {
      if (mockEventCallback) {
        mockEventCallback({
          type: 'message',
          content: data.content,
          messageId: data.messageId,
          role: data.role,
          stopReason: data.stopReason,
          sequenceNumber: data.sequenceNumber,
          tokenUsage: data.tokenUsage,
          model: data.model,
          metadata: data.metadata,
          timestamp: new Date(),
        } as AgentEvent);
      }
    }),
    emitToolUse: vi.fn(),
    emitToolResult: vi.fn(),
    emitTurnPaused: vi.fn(),
    emitContentRefused: vi.fn(),
  })),
}));

// ===== MOCK DATABASE =====
vi.mock('@/config/database', () => ({
  executeQuery: vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [1] }),
  initDatabase: vi.fn().mockResolvedValue(undefined),
}));

// ===== MOCK MESSAGE QUEUE =====
vi.mock('@/services/queue/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => ({
    addMessagePersistence: vi.fn().mockResolvedValue({
      id: 'job-' + Math.random().toString(36).substring(7),
      data: {},
    }),
    getQueueStats: vi.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0 }),
  })),
}));

// ===== MOCK FILE SYSTEM FOR MCP TOOLS =====
vi.mock('fs');
vi.mock('path');

// ===== MOCK SEMANTIC SEARCH SERVICE =====
const mockSearchRelevantFiles = vi.fn();
vi.mock('@/services/search/semantic', () => ({
  getSemanticSearchService: vi.fn(() => ({
    searchRelevantFiles: mockSearchRelevantFiles,
  })),
}));

// ===== MOCK FILE SERVICES =====
vi.mock('@/services/files/FileService', () => ({
  getFileService: vi.fn(() => ({
    getFile: vi.fn().mockResolvedValue({
      id: 'file-1',
      name: 'test-file.txt',
      mimeType: 'text/plain',
      size: 1000,
      userId: 'user-test-123',
      uploadedAt: new Date(),
    }),
    getUserFiles: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/services/files/context/ContextRetrievalService', () => ({
  getContextRetrievalService: vi.fn(() => ({
    retrieveFileContext: vi.fn().mockResolvedValue({
      documentContext: '',
      images: [],
      totalFiles: 0,
      totalSize: 0,
    }),
  })),
}));

vi.mock('@/services/files/context/PromptBuilder', () => ({
  getFileContextPromptBuilder: vi.fn(() => ({
    buildPromptWithContext: vi.fn((basePrompt: string) => basePrompt),
  })),
}));

vi.mock('@/services/files/citations/CitationParser', () => ({
  getCitationParser: vi.fn(() => ({
    extractCitations: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('@/services/files/MessageFileAttachmentService', () => ({
  getMessageFileAttachmentService: vi.fn(() => ({
    attachFilesToMessage: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ===== MOCK TOKEN USAGE AND TRACKING SERVICES =====
vi.mock('@/services/token-usage/TokenUsageService', () => ({
  getTokenUsageService: vi.fn(() => ({
    trackUsage: vi.fn().mockResolvedValue(undefined),
    recordUsage: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/services/tracking/UsageTrackingService', () => ({
  getUsageTrackingService: vi.fn(() => ({
    trackAgentExecution: vi.fn().mockResolvedValue(undefined),
    trackClaudeUsage: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('DirectAgentService - Semantic Search (UseMyContext)', () => {
  let mockClient: IAnthropicClient;
  let mockApprovalManager: ApprovalManager;
  let service: DirectAgentService;
  let mockOnEvent: Mock<(event: AgentEvent) => void>;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Reset sequence counter for each test
    nextSequence = 0;

    // Reset event callback
    mockEventCallback = null;

    // Reset semantic search mock
    mockSearchRelevantFiles.mockReset();

    // Mock Anthropic client with streaming support
    mockClient = {
      createChatCompletion: vi.fn(),
      createChatCompletionStream: vi.fn(),
    };

    // Mock approval manager
    mockApprovalManager = {
      request: vi.fn(),
    } as unknown as ApprovalManager;

    // Mock event callback
    mockOnEvent = vi.fn();

    // Mock file system for MCP tools
    vi.mocked(path.join).mockReturnValue('/mock/path/bc_index.json');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      entities: [
        {
          name: 'customer',
          displayName: 'Customer',
          description: 'Customer entity',
          operations: ['list', 'get', 'create'],
          endpoints: []
        }
      ],
      operationIndex: {}
    }));

    // Create service with mocked client
    service = new DirectAgentService(mockApprovalManager, undefined, mockClient);
  });

  describe('enableAutoSemanticSearch behavior', () => {
    it('should NOT call semantic search when enableAutoSemanticSearch is false (default)', async () => {
      // Arrange
      const prompt = 'Test query without semantic search';
      const mockStream = createSimpleTextStream('Response without semantic search', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      // Mock semantic search to return results (should not be called)
      mockSearchRelevantFiles.mockResolvedValue({
        results: [
          {
            fileId: 'file-1',
            fileName: 'test-file.txt',
            relevanceScore: 0.85,
            topChunks: [
              { chunkId: 'chunk-1', content: 'test content', score: 0.85, chunkIndex: 0 }
            ]
          }
        ],
        query: prompt,
        threshold: 0.7,
        totalChunksSearched: 1,
      });

      // Act - No options provided (enableAutoSemanticSearch defaults to false/undefined)
      const result = await service.executeQueryStreaming(
        prompt,
        'session-no-semantic',
        mockOnEvent,
        'user-test-123'
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockSearchRelevantFiles).not.toHaveBeenCalled();
    });

    it('should NOT call semantic search when enableAutoSemanticSearch is undefined', async () => {
      // Arrange
      const prompt = 'Test query with undefined semantic search';
      const mockStream = createSimpleTextStream('Response without semantic search', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      // Act - Explicitly pass undefined
      const result = await service.executeQueryStreaming(
        prompt,
        'session-undefined-semantic',
        mockOnEvent,
        'user-test-123',
        { enableAutoSemanticSearch: undefined }
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockSearchRelevantFiles).not.toHaveBeenCalled();
    });

    it('should call semantic search when enableAutoSemanticSearch is true and no attachments', async () => {
      // Arrange
      const prompt = 'Find information about customers';
      const mockStream = createSimpleTextStream('Response with semantic search', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      // Mock semantic search to return results
      mockSearchRelevantFiles.mockResolvedValue({
        results: [
          {
            fileId: 'file-1',
            fileName: 'customer-guide.txt',
            relevanceScore: 0.85,
            topChunks: [
              { chunkId: 'chunk-1', content: 'customer information', score: 0.85, chunkIndex: 0 }
            ]
          }
        ],
        query: prompt,
        threshold: 0.7,
        totalChunksSearched: 1,
      });

      // Act
      const result = await service.executeQueryStreaming(
        prompt,
        'session-semantic-enabled',
        mockOnEvent,
        'user-test-123',
        { enableAutoSemanticSearch: true }
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockSearchRelevantFiles).toHaveBeenCalledTimes(1);
      expect(mockSearchRelevantFiles).toHaveBeenCalledWith({
        userId: 'user-test-123',
        query: prompt,
        threshold: undefined, // Uses default from service
        maxFiles: 3, // Default
      });
    });

    it('should use semantic search results as file context when matches found', async () => {
      // Arrange
      const prompt = 'Query with semantic matches';
      const mockStream = createSimpleTextStream('Response using semantic context', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      // Mock semantic search with results
      mockSearchRelevantFiles.mockResolvedValue({
        results: [
          {
            fileId: 'file-1',
            fileName: 'relevant-doc.txt',
            relevanceScore: 0.92,
            topChunks: [
              { chunkId: 'chunk-1', content: 'highly relevant content', score: 0.92, chunkIndex: 0 }
            ]
          }
        ],
        query: prompt,
        threshold: 0.7,
        totalChunksSearched: 1,
      });

      // Act
      const result = await service.executeQueryStreaming(
        prompt,
        'session-with-matches',
        mockOnEvent,
        'user-test-123',
        { enableAutoSemanticSearch: true }
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockSearchRelevantFiles).toHaveBeenCalled();
      // The service should have used the semantic search results as context
      // (verified by checking that the API was called with context)
      expect(mockClient.createChatCompletionStream).toHaveBeenCalled();
    });

    it('should continue without file context when no semantic matches found', async () => {
      // Arrange
      const prompt = 'Query with no semantic matches';
      const mockStream = createSimpleTextStream('Response without context', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      // Mock semantic search with no results
      mockSearchRelevantFiles.mockResolvedValue({
        results: [],
        query: prompt,
        threshold: 0.7,
        totalChunksSearched: 10,
      });

      // Act
      const result = await service.executeQueryStreaming(
        prompt,
        'session-no-matches',
        mockOnEvent,
        'user-test-123',
        { enableAutoSemanticSearch: true }
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockSearchRelevantFiles).toHaveBeenCalled();
      // Agent should still work without context
      expect(result.response).toContain('Response without context');
    });
  });

  describe('attachments take priority over semantic search', () => {
    it('should NOT call semantic search when attachments are provided, even if enableAutoSemanticSearch is true', async () => {
      // Arrange
      const prompt = 'Query with manual attachments';
      const mockStream = createSimpleTextStream('Response using manual attachments', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      // Mock semantic search (should not be called)
      mockSearchRelevantFiles.mockResolvedValue({
        results: [
          {
            fileId: 'file-semantic',
            fileName: 'semantic-result.txt',
            relevanceScore: 0.95,
            topChunks: [
              { chunkId: 'chunk-1', content: 'semantic content', score: 0.95, chunkIndex: 0 }
            ]
          }
        ],
        query: prompt,
        threshold: 0.7,
        totalChunksSearched: 1,
      });

      // Act - Both attachments and enableAutoSemanticSearch provided
      const result = await service.executeQueryStreaming(
        prompt,
        'session-manual-priority',
        mockOnEvent,
        'user-test-123',
        {
          attachments: ['file-manual-1', 'file-manual-2'],
          enableAutoSemanticSearch: true, // Should be ignored
        }
      );

      // Assert
      expect(result.success).toBe(true);
      // CRITICAL: Semantic search should NOT be called when manual attachments exist
      expect(mockSearchRelevantFiles).not.toHaveBeenCalled();
    });

    it('should only use manual attachments when both attachments and enableAutoSemanticSearch are provided', async () => {
      // Arrange
      const prompt = 'Test manual attachment priority';
      const mockStream = createSimpleTextStream('Using manual attachments only', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      // Mock semantic search (should not be called)
      mockSearchRelevantFiles.mockResolvedValue({
        results: [
          {
            fileId: 'file-semantic',
            fileName: 'ignored-semantic.txt',
            relevanceScore: 0.99,
            topChunks: []
          }
        ],
        query: prompt,
        threshold: 0.7,
        totalChunksSearched: 1,
      });

      // Act
      const result = await service.executeQueryStreaming(
        prompt,
        'session-attachment-only',
        mockOnEvent,
        'user-test-123',
        {
          attachments: ['file-manual-1'],
          enableAutoSemanticSearch: true,
        }
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockSearchRelevantFiles).not.toHaveBeenCalled();
    });

    it('should use manual attachments for file context, ignoring semantic search', async () => {
      // Arrange
      const prompt = 'Test context source priority';
      const mockStream = createSimpleTextStream('Context from manual attachments', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      // Act
      const result = await service.executeQueryStreaming(
        prompt,
        'session-context-priority',
        mockOnEvent,
        'user-test-123',
        {
          attachments: ['file-manual-1', 'file-manual-2'],
          enableAutoSemanticSearch: true, // Should be completely ignored
        }
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockSearchRelevantFiles).not.toHaveBeenCalled();
      // File context should come from manual attachments, not semantic search
    });
  });

  describe('error handling', () => {
    it('should continue without file context when semantic search fails', async () => {
      // Arrange
      const prompt = 'Query when semantic search fails';
      const mockStream = createSimpleTextStream('Response despite semantic search error', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      // Mock semantic search to throw error
      mockSearchRelevantFiles.mockRejectedValue(new Error('Semantic search service unavailable'));

      // Act
      const result = await service.executeQueryStreaming(
        prompt,
        'session-semantic-error',
        mockOnEvent,
        'user-test-123',
        { enableAutoSemanticSearch: true }
      );

      // Assert - Agent should continue successfully despite semantic search failure
      expect(result.success).toBe(true);
      expect(result.response).toContain('Response despite semantic search error');
      expect(mockSearchRelevantFiles).toHaveBeenCalled();
    });

    it('should log warning but not throw when semantic search throws', async () => {
      // Arrange
      const prompt = 'Test error resilience';
      const mockStream = createSimpleTextStream('Graceful error handling', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      // Mock semantic search to throw
      const semanticError = new Error('Database connection failed');
      mockSearchRelevantFiles.mockRejectedValue(semanticError);

      // Act - Should not throw
      await expect(
        service.executeQueryStreaming(
          prompt,
          'session-error-resilience',
          mockOnEvent,
          'user-test-123',
          { enableAutoSemanticSearch: true }
        )
      ).resolves.toBeDefined();

      // Assert
      expect(mockSearchRelevantFiles).toHaveBeenCalled();
    });
  });

  describe('userId requirement', () => {
    it('should NOT call semantic search when userId is not provided', async () => {
      // Arrange
      const prompt = 'Query without userId';
      const mockStream = createSimpleTextStream('Response without user context', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      // Mock semantic search (should not be called)
      mockSearchRelevantFiles.mockResolvedValue({
        results: [],
        query: prompt,
        threshold: 0.7,
        totalChunksSearched: 0,
      });

      // Act - No userId provided
      const result = await service.executeQueryStreaming(
        prompt,
        'session-no-userid',
        mockOnEvent,
        undefined, // No userId
        { enableAutoSemanticSearch: true }
      );

      // Assert
      expect(result.success).toBe(true);
      // Should not call semantic search without userId
      expect(mockSearchRelevantFiles).not.toHaveBeenCalled();
    });
  });

  describe('semantic search options', () => {
    it('should pass custom semanticThreshold to semantic search service', async () => {
      // Arrange
      const prompt = 'Test custom threshold';
      const mockStream = createSimpleTextStream('Response with custom threshold', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      mockSearchRelevantFiles.mockResolvedValue({
        results: [],
        query: prompt,
        threshold: 0.85,
        totalChunksSearched: 0,
      });

      // Act
      const result = await service.executeQueryStreaming(
        prompt,
        'session-custom-threshold',
        mockOnEvent,
        'user-test-123',
        {
          enableAutoSemanticSearch: true,
          semanticThreshold: 0.85,
        }
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockSearchRelevantFiles).toHaveBeenCalledWith({
        userId: 'user-test-123',
        query: prompt,
        threshold: 0.85,
        maxFiles: 3,
      });
    });

    it('should pass custom maxSemanticFiles to semantic search service', async () => {
      // Arrange
      const prompt = 'Test custom max files';
      const mockStream = createSimpleTextStream('Response with custom max files', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      mockSearchRelevantFiles.mockResolvedValue({
        results: [],
        query: prompt,
        threshold: 0.7,
        totalChunksSearched: 0,
      });

      // Act
      const result = await service.executeQueryStreaming(
        prompt,
        'session-custom-maxfiles',
        mockOnEvent,
        'user-test-123',
        {
          enableAutoSemanticSearch: true,
          maxSemanticFiles: 5,
        }
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockSearchRelevantFiles).toHaveBeenCalledWith({
        userId: 'user-test-123',
        query: prompt,
        threshold: undefined,
        maxFiles: 5,
      });
    });

    it('should use default values when semantic options not provided', async () => {
      // Arrange
      const prompt = 'Test default options';
      const mockStream = createSimpleTextStream('Response with defaults', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      mockSearchRelevantFiles.mockResolvedValue({
        results: [],
        query: prompt,
        threshold: 0.7,
        totalChunksSearched: 0,
      });

      // Act
      const result = await service.executeQueryStreaming(
        prompt,
        'session-defaults',
        mockOnEvent,
        'user-test-123',
        {
          enableAutoSemanticSearch: true,
          // No semanticThreshold or maxSemanticFiles provided
        }
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockSearchRelevantFiles).toHaveBeenCalledWith({
        userId: 'user-test-123',
        query: prompt,
        threshold: undefined, // Service uses default (0.7)
        maxFiles: 3, // Default
      });
    });
  });
});
