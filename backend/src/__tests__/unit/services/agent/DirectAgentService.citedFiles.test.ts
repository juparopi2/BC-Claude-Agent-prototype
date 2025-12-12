/**
 * Unit Tests - DirectAgentService - citedFiles in complete event
 *
 * Tests for the citedFiles feature that includes file metadata in the complete event
 * so the frontend can enable clickable citations after streaming completes.
 *
 * TDD: These tests are written FIRST (RED phase) before implementation.
 *
 * BUSINESS LOGIC:
 * - When files are used (manual attachments or semantic search), include them in complete event
 * - citedFiles contains { fileName, fileId } for each file used
 * - Frontend uses citedFiles to build citationFileMap for clickable citations
 *
 * @module __tests__/unit/services/agent/DirectAgentService.citedFiles
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { DirectAgentService } from '@/services/agent/DirectAgentService';
import type { IAnthropicClient } from '@/services/agent/IAnthropicClient';
import type { ApprovalManager } from '@/services/approval/ApprovalManager';
import type { AgentEvent, CompleteEvent } from '@bc-agent/shared';
import { createSimpleTextStream } from './streamingMockHelpers';
import * as fs from 'fs';
import * as path from 'path';

// ===== TYPE EXTENSION FOR CITED FILES =====
// This type will need to be added to CompleteEvent in agent.types.ts
interface CitedFile {
  fileName: string;
  fileId: string;
}

interface CompleteEventWithCitedFiles extends CompleteEvent {
  citedFiles?: CitedFile[];
}

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
let capturedCompleteEvent: CompleteEventWithCitedFiles | null = null;

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
    emitToolUsePending: vi.fn(),
    emitComplete: vi.fn((stopReason: string, tokenUsage?: unknown, sessionId?: string, citedFiles?: CitedFile[]) => {
      const event: CompleteEventWithCitedFiles = {
        type: 'complete',
        reason: 'success',
        stopReason,
        tokenUsage,
        sessionId,
        citedFiles: citedFiles && citedFiles.length > 0 ? citedFiles : undefined,
        timestamp: new Date(),
        eventId: 'event-complete',
        persistenceState: 'pending',
      } as CompleteEventWithCitedFiles;
      capturedCompleteEvent = event;
      if (mockEventCallback) {
        mockEventCallback(event as AgentEvent);
      }
    }),
    emitError: vi.fn(),
    emitThinking: vi.fn(),
    emitMessage: vi.fn(),
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
const mockGetFile = vi.fn();
vi.mock('@/services/files/FileService', () => ({
  getFileService: vi.fn(() => ({
    getFile: mockGetFile,
    getUserFiles: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/services/files/context/ContextRetrievalService', () => ({
  getContextRetrievalService: vi.fn(() => ({
    retrieveMultiple: vi.fn().mockResolvedValue({
      contents: [
        {
          fileName: 'test-file.txt',
          content: 'Mock document content',
          mimeType: 'text/plain',
          isImage: false,
        }
      ],
      failures: [],
      totalTokens: 100,
      truncated: false,
    }),
  })),
}));

vi.mock('@/services/files/context/PromptBuilder', () => ({
  getFileContextPromptBuilder: vi.fn(() => ({
    buildPromptWithContext: vi.fn((basePrompt: string) => basePrompt),
    buildDocumentContext: vi.fn(() => 'Document context from files'),
    buildSystemInstructions: vi.fn(() => 'System instructions'),
    getImageContents: vi.fn(() => []),
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

describe('DirectAgentService - citedFiles in complete event', () => {
  let mockClient: IAnthropicClient;
  let mockApprovalManager: ApprovalManager;
  let service: DirectAgentService;
  let mockOnEvent: Mock<(event: AgentEvent) => void>;
  let receivedEvents: AgentEvent[];

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Reset sequence counter for each test
    nextSequence = 0;

    // Reset event callback and captured event
    mockEventCallback = null;
    capturedCompleteEvent = null;

    // Reset semantic search mock
    mockSearchRelevantFiles.mockReset();

    // Reset file service mock
    mockGetFile.mockReset();

    // Track received events
    receivedEvents = [];

    // Mock Anthropic client with streaming support
    mockClient = {
      createChatCompletion: vi.fn(),
      createChatCompletionStream: vi.fn(),
    };

    // Mock approval manager
    mockApprovalManager = {
      request: vi.fn(),
    } as unknown as ApprovalManager;

    // Mock event callback that captures events
    mockOnEvent = vi.fn((event: AgentEvent) => {
      receivedEvents.push(event);
    });

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

  describe('citedFiles with manual attachments', () => {
    it('should include citedFiles in complete event when manual attachments provided', async () => {
      // Arrange
      const prompt = 'Analyze this document';
      const mockStream = createSimpleTextStream('Analysis complete based on [report.pdf]', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      // Mock file service to return file metadata
      mockGetFile.mockResolvedValue({
        id: 'file-123',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        size: 1000,
        userId: 'user-test-123',
        uploadedAt: new Date(),
      });

      // Act
      const result = await service.executeQueryStreaming(
        prompt,
        'session-manual-attachments',
        mockOnEvent,
        'user-test-123',
        {
          attachments: ['file-123'],
        }
      );

      // Assert
      expect(result.success).toBe(true);

      // Find the complete event
      const completeEvent = receivedEvents.find(e => e.type === 'complete') as CompleteEventWithCitedFiles | undefined;
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.citedFiles).toBeDefined();
      expect(completeEvent?.citedFiles).toHaveLength(1);
      expect(completeEvent?.citedFiles?.[0]).toEqual({
        fileName: 'report.pdf',
        fileId: 'file-123',
      });
    });

    it('should include multiple files in citedFiles when multiple attachments provided', async () => {
      // Arrange
      const prompt = 'Compare these documents';
      const mockStream = createSimpleTextStream('Comparison of [doc1.pdf] and [doc2.xlsx]', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      // Mock file service to return different files
      mockGetFile
        .mockResolvedValueOnce({
          id: 'file-1',
          name: 'doc1.pdf',
          mimeType: 'application/pdf',
          size: 1000,
          userId: 'user-test-123',
          uploadedAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'file-2',
          name: 'doc2.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size: 2000,
          userId: 'user-test-123',
          uploadedAt: new Date(),
        });

      // Act
      const result = await service.executeQueryStreaming(
        prompt,
        'session-multiple-attachments',
        mockOnEvent,
        'user-test-123',
        {
          attachments: ['file-1', 'file-2'],
        }
      );

      // Assert
      expect(result.success).toBe(true);

      const completeEvent = receivedEvents.find(e => e.type === 'complete') as CompleteEventWithCitedFiles | undefined;
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.citedFiles).toBeDefined();
      expect(completeEvent?.citedFiles).toHaveLength(2);
      expect(completeEvent?.citedFiles).toContainEqual({
        fileName: 'doc1.pdf',
        fileId: 'file-1',
      });
      expect(completeEvent?.citedFiles).toContainEqual({
        fileName: 'doc2.xlsx',
        fileId: 'file-2',
      });
    });
  });

  describe('citedFiles with semantic search', () => {
    it('should include citedFiles in complete event when semantic search returns files', async () => {
      // Arrange
      const prompt = 'What does the contract say about payments?';
      const mockStream = createSimpleTextStream('Based on [contract.pdf], payments are due...', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      // Mock semantic search to return results
      mockSearchRelevantFiles.mockResolvedValue({
        results: [
          {
            fileId: 'file-contract',
            fileName: 'contract.pdf',
            relevanceScore: 0.92,
            topChunks: [
              { chunkId: 'chunk-1', content: 'payment terms...', score: 0.92, chunkIndex: 0 }
            ]
          }
        ],
        query: prompt,
        threshold: 0.7,
        totalChunksSearched: 10,
      });

      // Mock file service to return file when fetching by ID (semantic search calls getFile)
      mockGetFile.mockResolvedValue({
        id: 'file-contract',
        name: 'contract.pdf',
        mimeType: 'application/pdf',
        size: 1000,
        userId: 'user-test-123',
        uploadedAt: new Date(),
      });

      // Act
      const result = await service.executeQueryStreaming(
        prompt,
        'session-semantic-search',
        mockOnEvent,
        'user-test-123',
        {
          enableAutoSemanticSearch: true,
        }
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockSearchRelevantFiles).toHaveBeenCalled();

      const completeEvent = receivedEvents.find(e => e.type === 'complete') as CompleteEventWithCitedFiles | undefined;
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.citedFiles).toBeDefined();
      expect(completeEvent?.citedFiles).toHaveLength(1);
      expect(completeEvent?.citedFiles?.[0]).toEqual({
        fileName: 'contract.pdf',
        fileId: 'file-contract',
      });
    });

    it('should include multiple files from semantic search in citedFiles', async () => {
      // Arrange
      const prompt = 'Summarize the project documents';
      const mockStream = createSimpleTextStream('Summary based on [plan.docx] and [budget.xlsx]', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      // Mock semantic search with multiple results
      mockSearchRelevantFiles.mockResolvedValue({
        results: [
          {
            fileId: 'file-plan',
            fileName: 'plan.docx',
            relevanceScore: 0.88,
            topChunks: [{ chunkId: 'c1', content: 'project plan...', score: 0.88, chunkIndex: 0 }]
          },
          {
            fileId: 'file-budget',
            fileName: 'budget.xlsx',
            relevanceScore: 0.82,
            topChunks: [{ chunkId: 'c2', content: 'budget data...', score: 0.82, chunkIndex: 0 }]
          }
        ],
        query: prompt,
        threshold: 0.7,
        totalChunksSearched: 20,
      });

      // Mock file service to return files when converting semantic search results
      mockGetFile
        .mockResolvedValueOnce({
          id: 'file-plan',
          name: 'plan.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 2000,
          userId: 'user-test-123',
          uploadedAt: new Date(),
        })
        .mockResolvedValueOnce({
          id: 'file-budget',
          name: 'budget.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          size: 3000,
          userId: 'user-test-123',
          uploadedAt: new Date(),
        });

      // Act
      const result = await service.executeQueryStreaming(
        prompt,
        'session-multiple-semantic',
        mockOnEvent,
        'user-test-123',
        {
          enableAutoSemanticSearch: true,
        }
      );

      // Assert
      expect(result.success).toBe(true);

      const completeEvent = receivedEvents.find(e => e.type === 'complete') as CompleteEventWithCitedFiles | undefined;
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.citedFiles).toHaveLength(2);
      expect(completeEvent?.citedFiles).toContainEqual({
        fileName: 'plan.docx',
        fileId: 'file-plan',
      });
      expect(completeEvent?.citedFiles).toContainEqual({
        fileName: 'budget.xlsx',
        fileId: 'file-budget',
      });
    });
  });

  describe('citedFiles when no files used', () => {
    it('should have undefined citedFiles when no attachments and semantic search disabled', async () => {
      // Arrange
      const prompt = 'Hello, how are you?';
      const mockStream = createSimpleTextStream('I am doing well!', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      // Act
      const result = await service.executeQueryStreaming(
        prompt,
        'session-no-files',
        mockOnEvent,
        'user-test-123'
        // No attachments, no enableAutoSemanticSearch
      );

      // Assert
      expect(result.success).toBe(true);

      const completeEvent = receivedEvents.find(e => e.type === 'complete') as CompleteEventWithCitedFiles | undefined;
      expect(completeEvent).toBeDefined();
      // citedFiles should be undefined (not an empty array) when no files used
      expect(completeEvent?.citedFiles).toBeUndefined();
    });

    it('should have undefined citedFiles when semantic search returns no results', async () => {
      // Arrange
      const prompt = 'Query with no matching files';
      const mockStream = createSimpleTextStream('I cannot find relevant files', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      // Mock semantic search with no results
      mockSearchRelevantFiles.mockResolvedValue({
        results: [],
        query: prompt,
        threshold: 0.7,
        totalChunksSearched: 50,
      });

      // Act
      const result = await service.executeQueryStreaming(
        prompt,
        'session-no-matches',
        mockOnEvent,
        'user-test-123',
        {
          enableAutoSemanticSearch: true,
        }
      );

      // Assert
      expect(result.success).toBe(true);
      expect(mockSearchRelevantFiles).toHaveBeenCalled();

      const completeEvent = receivedEvents.find(e => e.type === 'complete') as CompleteEventWithCitedFiles | undefined;
      expect(completeEvent).toBeDefined();
      // No files found, so citedFiles should be undefined
      expect(completeEvent?.citedFiles).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should fail with error when manual attachment is invalid (security)', async () => {
      // Arrange
      const prompt = 'Analyze files';

      // First file succeeds, second file fails
      mockGetFile
        .mockResolvedValueOnce({
          id: 'file-1',
          name: 'success.pdf',
          mimeType: 'application/pdf',
          size: 1000,
          userId: 'user-test-123',
          uploadedAt: new Date(),
        })
        .mockResolvedValueOnce(null); // File not found returns null

      // Act - Manual attachments MUST be valid (security requirement)
      const result = await service.executeQueryStreaming(
        prompt,
        'session-invalid-attachment',
        mockOnEvent,
        'user-test-123',
        {
          attachments: ['file-1', 'file-missing'],
        }
      );

      // Assert - Should fail with security error
      expect(result.success).toBe(false);
      expect(result.error).toContain('Access denied or file not found');
    });

    it('should continue gracefully when semantic search file lookup fails', async () => {
      // Arrange
      const prompt = 'Find related documents';
      const mockStream = createSimpleTextStream('Analysis done with partial results', 'end_turn');
      vi.mocked(mockClient.createChatCompletionStream).mockReturnValueOnce(mockStream);

      // Mock semantic search returns 2 files
      mockSearchRelevantFiles.mockResolvedValue({
        results: [
          { fileId: 'file-good', fileName: 'good.pdf', relevanceScore: 0.9, topChunks: [] },
          { fileId: 'file-bad', fileName: 'missing.pdf', relevanceScore: 0.8, topChunks: [] },
        ],
        query: prompt,
        threshold: 0.7,
        totalChunksSearched: 10,
      });

      // First file lookup succeeds, second returns null (file was deleted)
      mockGetFile
        .mockResolvedValueOnce({
          id: 'file-good',
          name: 'good.pdf',
          mimeType: 'application/pdf',
          size: 1000,
          userId: 'user-test-123',
          uploadedAt: new Date(),
        })
        .mockResolvedValueOnce(null); // File was deleted between search and lookup

      // Act - Should continue with available files
      const result = await service.executeQueryStreaming(
        prompt,
        'session-partial-semantic',
        mockOnEvent,
        'user-test-123',
        {
          enableAutoSemanticSearch: true,
        }
      );

      // Assert - Should succeed with partial files
      expect(result.success).toBe(true);

      const completeEvent = receivedEvents.find(e => e.type === 'complete') as CompleteEventWithCitedFiles | undefined;
      expect(completeEvent).toBeDefined();
      // Should include only the file that was found
      expect(completeEvent?.citedFiles).toBeDefined();
      expect(completeEvent?.citedFiles).toHaveLength(1);
      expect(completeEvent?.citedFiles?.[0]).toEqual({
        fileName: 'good.pdf',
        fileId: 'file-good',
      });
    });
  });
});
