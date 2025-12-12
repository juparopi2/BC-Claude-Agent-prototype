/**
 * File Context Integration Tests - DirectAgentService
 *
 * Tests for Phase 5: Chat Integration with Files
 *
 * Test Categories:
 * 1. prepareFileContext() - File retrieval and prompt building
 * 2. recordFileUsage() - Citation parsing and attachment recording
 * 3. executeQueryStreaming integration - Full flow with attachments
 *
 * Following TDD: Tests written FIRST, then implementation.
 *
 * @module __tests__/unit/services/agent/DirectAgentService.fileContext
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { DirectAgentService } from '@/services/agent/DirectAgentService';
import type { IAnthropicClient } from '@/services/agent/IAnthropicClient';
import type { ApprovalManager } from '@/services/approval/ApprovalManager';
import type { AgentEvent, FileContextResult } from '@/types/agent.types';
import type { ParsedFile } from '@/types/file.types';
import type { RetrievedContent, MultiRetrievalResult } from '@/services/files/context/retrieval.types';
import { createSimpleTextStream } from './streamingMockHelpers';

// ===== MOCK EVENT SOURCING DEPENDENCIES =====
let nextSequence = 0;
vi.mock('@/services/events/EventStore', () => ({
  getEventStore: vi.fn(() => ({
    appendEvent: vi.fn().mockResolvedValue({
      id: 'event-' + Math.random().toString(36).substring(7),
      sequence_number: nextSequence++,
      timestamp: new Date().toISOString(),
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
    emitThinkingChunk: vi.fn(),
    emitToolUsePending: vi.fn(),
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
    emitError: vi.fn(),
    emitThinking: vi.fn(),
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

// ===== MOCK MESSAGE QUEUE =====
vi.mock('@/services/queue/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => ({
    addMessagePersistence: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ===== MOCK MESSAGE SERVICE =====
vi.mock('@/services/messages/MessageService', () => ({
  getMessageService: vi.fn(() => ({
    updateToolResult: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ===== MOCK TOKEN USAGE SERVICE =====
vi.mock('@/services/token-usage/TokenUsageService', () => ({
  getTokenUsageService: vi.fn(() => ({
    recordUsage: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ===== MOCK USAGE TRACKING SERVICE =====
vi.mock('@/services/tracking/UsageTrackingService', () => ({
  getUsageTrackingService: vi.fn(() => ({
    trackClaudeUsage: vi.fn().mockResolvedValue(undefined),
    trackToolExecution: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ===== MOCK DATABASE =====
vi.mock('@/config/database', () => ({
  executeQuery: vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [1] }),
  initDatabase: vi.fn().mockResolvedValue(undefined),
}));

// ===== MOCK FILE SYSTEM FOR MCP TOOLS =====
vi.mock('fs');
vi.mock('path');

// ===== MOCK FILE CONTEXT SERVICES =====
const mockRetrieveMultiple = vi.fn<[], Promise<MultiRetrievalResult>>();
const mockBuildDocumentContext = vi.fn<[RetrievedContent[]], string>();
const mockBuildSystemInstructions = vi.fn<[string[]], string>();
const mockGetImageContents = vi.fn<[RetrievedContent[]], Array<{ mimeType: string; data: string }>>();

vi.mock('@/services/files/context/ContextRetrievalService', () => ({
  getContextRetrievalService: vi.fn(() => ({
    retrieveMultiple: mockRetrieveMultiple,
  })),
}));

vi.mock('@/services/files/context/PromptBuilder', () => ({
  getFileContextPromptBuilder: vi.fn(() => ({
    buildDocumentContext: mockBuildDocumentContext,
    buildSystemInstructions: mockBuildSystemInstructions,
    getImageContents: mockGetImageContents,
  })),
}));

// ===== MOCK CITATION PARSER =====
const mockParseCitations = vi.fn();

vi.mock('@/services/files/citations/CitationParser', () => ({
  getCitationParser: vi.fn(() => ({
    parseCitations: mockParseCitations,
  })),
}));

// ===== MOCK MESSAGE FILE ATTACHMENT SERVICE =====
const mockRecordAttachments = vi.fn();

vi.mock('@/services/files/MessageFileAttachmentService', () => ({
  getMessageFileAttachmentService: vi.fn(() => ({
    recordAttachments: mockRecordAttachments,
  })),
}));

// ===== MOCK FILE SERVICE (for validation) =====
const mockGetFile = vi.fn();

vi.mock('@/services/files/FileService', () => ({
  getFileService: vi.fn(() => ({
    getFile: mockGetFile,
  })),
}));

// ===== TEST DATA =====
import * as fs from 'fs';
import * as path from 'path';

const mockBCIndex = {
  entities: [],
  operationIndex: {},
};

// ===== TEST HELPERS =====
function createMockParsedFile(overrides: Partial<ParsedFile> = {}): ParsedFile {
  return {
    id: 'file-' + Math.random().toString(36).substring(7),
    userId: 'user-123',
    name: 'test-document.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    blobPath: 'users/user-123/files/test.pdf',
    processingStatus: 'completed',
    embeddingStatus: 'completed',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockRetrievedContent(overrides: Partial<RetrievedContent> = {}): RetrievedContent {
  return {
    fileId: 'file-123',
    fileName: 'test-document.pdf',
    strategy: 'EXTRACTED_TEXT',
    content: { type: 'text', text: 'Test content from the document.' },
    ...overrides,
  };
}

describe('DirectAgentService - File Context Integration', () => {
  let mockClient: IAnthropicClient;
  let mockApprovalManager: ApprovalManager;
  let service: DirectAgentService;
  let mockOnEvent: Mock<(event: AgentEvent) => void>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset sequence counter
    nextSequence = 0;
    mockEventCallback = null;

    // Mock Anthropic client
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

    // Setup file system mocks for MCP tools
    vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => JSON.stringify(mockBCIndex));

    // Create service instance with mocks
    service = new DirectAgentService(mockApprovalManager, undefined, mockClient);

    // Default mock implementations
    mockRetrieveMultiple.mockResolvedValue({
      contents: [],
      failures: [],
      totalTokens: 0,
      truncated: false,
    });
    mockBuildDocumentContext.mockReturnValue('');
    mockBuildSystemInstructions.mockReturnValue('');
    mockGetImageContents.mockReturnValue([]);
    mockParseCitations.mockReturnValue({
      originalText: '',
      processedText: '',
      citations: [],
      matchedFileIds: [],
    });
    mockRecordAttachments.mockResolvedValue({ success: true, recordsCreated: 0 });
    mockGetFile.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================
  // Ciclo 2: prepareFileContext Tests
  // ============================================

  describe('prepareFileContext', () => {
    describe('2.1 - Returns empty context when no attachments', () => {
      it('should return empty FileContextResult when files array is empty', async () => {
        const files: ParsedFile[] = [];

        // Note: prepareFileContext is private, we test it through executeQueryStreaming
        // For unit testing the private method, we'll test the behavior indirectly
        // by checking that no file context services are called

        vi.mocked(mockClient.createChatCompletionStream).mockReturnValue(
          createSimpleTextStream('Hello!', 'end_turn')
        );

        await service.executeQueryStreaming(
          'Hello',
          'session-123',
          mockOnEvent,
          'user-123',
          { attachments: [] }
        );

        // File context services should NOT be called with empty attachments
        expect(mockRetrieveMultiple).not.toHaveBeenCalled();
        expect(mockBuildDocumentContext).not.toHaveBeenCalled();
      });
    });

    describe('2.2 - Retrieves content from text file', () => {
      it('should retrieve and format content from a text-based file', async () => {
        const mockFile = createMockParsedFile({ id: 'file-1', name: 'report.pdf' });
        mockGetFile.mockResolvedValue(mockFile);

        const mockContent = createMockRetrievedContent({
          fileId: 'file-1',
          fileName: 'report.pdf',
          content: { type: 'text', text: 'Revenue increased by 15%' },
        });

        mockRetrieveMultiple.mockResolvedValue({
          contents: [mockContent],
          failures: [],
          totalTokens: 100,
          truncated: false,
        });

        mockBuildDocumentContext.mockReturnValue(
          '<documents><document id="file-1" name="report.pdf">Revenue increased by 15%</document></documents>'
        );
        mockBuildSystemInstructions.mockReturnValue(
          'The user has attached: report.pdf. Cite using [report.pdf] format.'
        );

        vi.mocked(mockClient.createChatCompletionStream).mockReturnValue(
          createSimpleTextStream('Based on [report.pdf], revenue increased.', 'end_turn')
        );

        await service.executeQueryStreaming(
          'What does the report say?',
          'session-123',
          mockOnEvent,
          'user-123',
          { attachments: ['file-1'] }
        );

        // Verify file validation was called
        expect(mockGetFile).toHaveBeenCalledWith('user-123', 'file-1');

        // Verify retrieval was called with correct params
        expect(mockRetrieveMultiple).toHaveBeenCalledWith(
          'user-123',
          [mockFile],
          expect.objectContaining({
            userQuery: 'What does the report say?',
          })
        );

        // Verify prompt building was called
        expect(mockBuildDocumentContext).toHaveBeenCalledWith([mockContent]);
        expect(mockBuildSystemInstructions).toHaveBeenCalledWith(['report.pdf']);
      });
    });

    describe('2.3 - Handles multiple files with token budget', () => {
      it('should retrieve multiple files respecting token budget', async () => {
        const mockFile1 = createMockParsedFile({ id: 'file-1', name: 'doc1.pdf' });
        const mockFile2 = createMockParsedFile({ id: 'file-2', name: 'doc2.pdf' });

        mockGetFile.mockImplementation((_userId: string, fileId: string) => {
          if (fileId === 'file-1') return Promise.resolve(mockFile1);
          if (fileId === 'file-2') return Promise.resolve(mockFile2);
          return Promise.resolve(null);
        });

        const mockContent1 = createMockRetrievedContent({ fileId: 'file-1', fileName: 'doc1.pdf' });
        const mockContent2 = createMockRetrievedContent({ fileId: 'file-2', fileName: 'doc2.pdf' });

        mockRetrieveMultiple.mockResolvedValue({
          contents: [mockContent1, mockContent2],
          failures: [],
          totalTokens: 5000,
          truncated: false,
        });

        mockBuildDocumentContext.mockReturnValue('<documents>...</documents>');
        mockBuildSystemInstructions.mockReturnValue('Files attached: doc1.pdf, doc2.pdf');

        vi.mocked(mockClient.createChatCompletionStream).mockReturnValue(
          createSimpleTextStream('Answer based on both docs.', 'end_turn')
        );

        await service.executeQueryStreaming(
          'Compare the documents',
          'session-123',
          mockOnEvent,
          'user-123',
          { attachments: ['file-1', 'file-2'] }
        );

        // Should have retrieved both files
        expect(mockRetrieveMultiple).toHaveBeenCalledWith(
          'user-123',
          expect.arrayContaining([mockFile1, mockFile2]),
          expect.any(Object)
        );
      });
    });

    describe('2.4 - Extracts images for Claude Vision', () => {
      it('should extract image contents for Vision API', async () => {
        const mockImageFile = createMockParsedFile({
          id: 'img-1',
          name: 'screenshot.png',
          mimeType: 'image/png',
        });

        mockGetFile.mockResolvedValue(mockImageFile);

        const mockImageContent = createMockRetrievedContent({
          fileId: 'img-1',
          fileName: 'screenshot.png',
          strategy: 'DIRECT_CONTENT',
          content: { type: 'base64', mimeType: 'image/png', data: 'iVBORw0KGgo=' },
        });

        mockRetrieveMultiple.mockResolvedValue({
          contents: [mockImageContent],
          failures: [],
          totalTokens: 0,
          truncated: false,
        });

        mockBuildDocumentContext.mockReturnValue(''); // No text for images
        mockGetImageContents.mockReturnValue([
          { mimeType: 'image/png', data: 'iVBORw0KGgo=' },
        ]);

        vi.mocked(mockClient.createChatCompletionStream).mockReturnValue(
          createSimpleTextStream('I see a screenshot showing...', 'end_turn')
        );

        await service.executeQueryStreaming(
          'What is in this image?',
          'session-123',
          mockOnEvent,
          'user-123',
          { attachments: ['img-1'] }
        );

        // Verify image extraction was called
        expect(mockGetImageContents).toHaveBeenCalledWith([mockImageContent]);
      });
    });

    describe('2.5 - Generates system instructions', () => {
      it('should generate citation instructions with file names', async () => {
        const mockFile = createMockParsedFile({ id: 'file-1', name: 'financial-report.xlsx' });
        mockGetFile.mockResolvedValue(mockFile);

        mockRetrieveMultiple.mockResolvedValue({
          contents: [createMockRetrievedContent({ fileName: 'financial-report.xlsx' })],
          failures: [],
          totalTokens: 100,
          truncated: false,
        });

        vi.mocked(mockClient.createChatCompletionStream).mockReturnValue(
          createSimpleTextStream('Response', 'end_turn')
        );

        await service.executeQueryStreaming(
          'Query',
          'session-123',
          mockOnEvent,
          'user-123',
          { attachments: ['file-1'] }
        );

        expect(mockBuildSystemInstructions).toHaveBeenCalledWith(['financial-report.xlsx']);
      });
    });

    describe('2.6 - Handles retrieval errors gracefully', () => {
      it('should continue with successful files when some fail', async () => {
        const mockFile1 = createMockParsedFile({ id: 'file-1', name: 'good.pdf' });
        const mockFile2 = createMockParsedFile({ id: 'file-2', name: 'missing.pdf' });

        mockGetFile.mockImplementation((_userId: string, fileId: string) => {
          if (fileId === 'file-1') return Promise.resolve(mockFile1);
          if (fileId === 'file-2') return Promise.resolve(mockFile2);
          return Promise.resolve(null);
        });

        // One file succeeds, one fails
        mockRetrieveMultiple.mockResolvedValue({
          contents: [createMockRetrievedContent({ fileId: 'file-1', fileName: 'good.pdf' })],
          failures: [{ fileId: 'file-2', fileName: 'missing.pdf', reason: 'Blob not found' }],
          totalTokens: 100,
          truncated: false,
        });

        vi.mocked(mockClient.createChatCompletionStream).mockReturnValue(
          createSimpleTextStream('Response using good.pdf', 'end_turn')
        );

        // Should not throw
        const result = await service.executeQueryStreaming(
          'Query',
          'session-123',
          mockOnEvent,
          'user-123',
          { attachments: ['file-1', 'file-2'] }
        );

        expect(result.success).toBe(true);
        // Should still call document context with successful file
        expect(mockBuildDocumentContext).toHaveBeenCalled();
      });
    });
  });

  // ============================================
  // Ciclo 4: recordFileUsage Tests
  // ============================================

  describe('recordFileUsage', () => {
    describe('4.1 - Parses citations from response', () => {
      it('should parse and record citations from Claude response', async () => {
        const mockFile = createMockParsedFile({ id: 'file-1', name: 'report.pdf' });
        mockGetFile.mockResolvedValue(mockFile);

        mockRetrieveMultiple.mockResolvedValue({
          contents: [createMockRetrievedContent({ fileId: 'file-1', fileName: 'report.pdf' })],
          failures: [],
          totalTokens: 100,
          truncated: false,
        });

        // Claude cites the file
        mockParseCitations.mockReturnValue({
          originalText: 'According to [report.pdf], revenue increased.',
          processedText: 'According to [report.pdf], revenue increased.',
          citations: [{ rawText: '[report.pdf]', fileName: 'report.pdf', fileId: 'file-1' }],
          matchedFileIds: ['file-1'],
        });

        vi.mocked(mockClient.createChatCompletionStream).mockReturnValue(
          createSimpleTextStream('According to [report.pdf], revenue increased.', 'end_turn')
        );

        await service.executeQueryStreaming(
          'What does the report say?',
          'session-123',
          mockOnEvent,
          'user-123',
          { attachments: ['file-1'] }
        );

        // Citation parser should be called with the response text and file map
        expect(mockParseCitations).toHaveBeenCalledWith(
          expect.stringContaining('According to [report.pdf]'),
          expect.any(Map)
        );
      });
    });

    describe('4.2 - Records direct attachments', () => {
      it('should record direct attachments when user attaches files', async () => {
        const mockFile = createMockParsedFile({ id: 'file-1', name: 'doc.pdf' });
        mockGetFile.mockResolvedValue(mockFile);

        mockRetrieveMultiple.mockResolvedValue({
          contents: [createMockRetrievedContent()],
          failures: [],
          totalTokens: 100,
          truncated: false,
        });

        vi.mocked(mockClient.createChatCompletionStream).mockReturnValue(
          createSimpleTextStream('Response without citations', 'end_turn')
        );

        await service.executeQueryStreaming(
          'Query',
          'session-123',
          mockOnEvent,
          'user-123',
          { attachments: ['file-1'] }
        );

        // Should record direct attachments
        expect(mockRecordAttachments).toHaveBeenCalledWith(
          expect.any(String), // messageId
          ['file-1'],
          'direct'
        );
      });
    });

    describe('4.3 - Handles response without citations', () => {
      it('should only record direct attachments when response has no citations', async () => {
        const mockFile = createMockParsedFile({ id: 'file-1', name: 'doc.pdf' });
        mockGetFile.mockResolvedValue(mockFile);

        mockRetrieveMultiple.mockResolvedValue({
          contents: [createMockRetrievedContent()],
          failures: [],
          totalTokens: 100,
          truncated: false,
        });

        mockParseCitations.mockReturnValue({
          originalText: 'No citations here',
          processedText: 'No citations here',
          citations: [],
          matchedFileIds: [],
        });

        vi.mocked(mockClient.createChatCompletionStream).mockReturnValue(
          createSimpleTextStream('No citations here', 'end_turn')
        );

        await service.executeQueryStreaming(
          'Query',
          'session-123',
          mockOnEvent,
          'user-123',
          { attachments: ['file-1'] }
        );

        // Should record direct but NOT citation attachments
        expect(mockRecordAttachments).toHaveBeenCalledWith(
          expect.any(String),
          ['file-1'],
          'direct'
        );
        // Should NOT have been called with 'citation' type (or called with empty array)
        const citationCalls = mockRecordAttachments.mock.calls.filter(
          (call) => call[2] === 'citation'
        );
        expect(citationCalls.every((call) => call[1].length === 0 || call === undefined)).toBe(true);
      });
    });

    describe('4.4 - Avoids duplicates between direct and citation', () => {
      it('should not record same file as both direct and citation', async () => {
        const mockFile = createMockParsedFile({ id: 'file-1', name: 'report.pdf' });
        mockGetFile.mockResolvedValue(mockFile);

        mockRetrieveMultiple.mockResolvedValue({
          contents: [createMockRetrievedContent({ fileId: 'file-1', fileName: 'report.pdf' })],
          failures: [],
          totalTokens: 100,
          truncated: false,
        });

        // User attaches file AND Claude cites the same file
        mockParseCitations.mockReturnValue({
          originalText: 'According to [report.pdf]...',
          processedText: 'According to [report.pdf]...',
          citations: [{ rawText: '[report.pdf]', fileName: 'report.pdf', fileId: 'file-1' }],
          matchedFileIds: ['file-1'], // Same as direct attachment
        });

        vi.mocked(mockClient.createChatCompletionStream).mockReturnValue(
          createSimpleTextStream('According to [report.pdf]...', 'end_turn')
        );

        await service.executeQueryStreaming(
          'Query',
          'session-123',
          mockOnEvent,
          'user-123',
          { attachments: ['file-1'] }
        );

        // Direct attachment should be recorded
        expect(mockRecordAttachments).toHaveBeenCalledWith(
          expect.any(String),
          ['file-1'],
          'direct'
        );

        // Citation should NOT include file-1 (it's already in direct)
        const citationCalls = mockRecordAttachments.mock.calls.filter(
          (call) => call[2] === 'citation' && call[1].includes('file-1')
        );
        expect(citationCalls.length).toBe(0);
      });
    });
  });

  // ============================================
  // Ciclo 3 & 5: Integration Tests
  // ============================================

  describe('executeQueryStreaming with attachments', () => {
    describe('3.1 - Injects context when attachments present', () => {
      it('should inject document context into user message', async () => {
        const mockFile = createMockParsedFile({ id: 'file-1', name: 'data.csv' });
        mockGetFile.mockResolvedValue(mockFile);

        mockRetrieveMultiple.mockResolvedValue({
          contents: [createMockRetrievedContent({ fileName: 'data.csv' })],
          failures: [],
          totalTokens: 100,
          truncated: false,
        });

        mockBuildDocumentContext.mockReturnValue('<documents><document id="file-1">CSV data</document></documents>');

        let capturedMessages: unknown[] = [];
        vi.mocked(mockClient.createChatCompletionStream).mockImplementation((params: unknown) => {
          capturedMessages = (params as { messages: unknown[] }).messages;
          return createSimpleTextStream('Response', 'end_turn');
        });

        await service.executeQueryStreaming(
          'Analyze this data',
          'session-123',
          mockOnEvent,
          'user-123',
          { attachments: ['file-1'] }
        );

        // User message should contain the document context
        const userMessage = capturedMessages.find((m: unknown) => (m as { role: string }).role === 'user');
        expect(userMessage).toBeDefined();
        expect((userMessage as { content: string }).content).toContain('<documents>');
        expect((userMessage as { content: string }).content).toContain('Analyze this data');
      });
    });

    describe('3.3 - Normal flow without attachments', () => {
      it('should work normally when no attachments provided', async () => {
        vi.mocked(mockClient.createChatCompletionStream).mockReturnValue(
          createSimpleTextStream('Hello!', 'end_turn')
        );

        const result = await service.executeQueryStreaming(
          'Hello',
          'session-123',
          mockOnEvent,
          'user-123'
          // No attachments option
        );

        expect(result.success).toBe(true);
        expect(mockRetrieveMultiple).not.toHaveBeenCalled();
        expect(mockRecordAttachments).not.toHaveBeenCalled();
      });
    });

    describe('5.2 - No recording without attachments', () => {
      it('should not call recordFileUsage when no attachments', async () => {
        vi.mocked(mockClient.createChatCompletionStream).mockReturnValue(
          createSimpleTextStream('Response', 'end_turn')
        );

        await service.executeQueryStreaming(
          'Query without attachments',
          'session-123',
          mockOnEvent,
          'user-123'
        );

        expect(mockParseCitations).not.toHaveBeenCalled();
        expect(mockRecordAttachments).not.toHaveBeenCalled();
      });
    });

    describe('5.3 - Recording errors do not fail response', () => {
      it('should complete successfully even if recording fails', async () => {
        const mockFile = createMockParsedFile({ id: 'file-1' });
        mockGetFile.mockResolvedValue(mockFile);

        mockRetrieveMultiple.mockResolvedValue({
          contents: [createMockRetrievedContent()],
          failures: [],
          totalTokens: 100,
          truncated: false,
        });

        // Recording throws error
        mockRecordAttachments.mockRejectedValue(new Error('Database error'));

        vi.mocked(mockClient.createChatCompletionStream).mockReturnValue(
          createSimpleTextStream('Response', 'end_turn')
        );

        // Should NOT throw
        const result = await service.executeQueryStreaming(
          'Query',
          'session-123',
          mockOnEvent,
          'user-123',
          { attachments: ['file-1'] }
        );

        expect(result.success).toBe(true);
      });
    });
  });

  // ============================================
  // Validation Tests (existing behavior)
  // ============================================

  describe('Attachment Validation', () => {
    it('should return error result when file not found', async () => {
      mockGetFile.mockResolvedValue(null);

      const result = await service.executeQueryStreaming(
        'Query',
        'session-123',
        mockOnEvent,
        'user-123',
        { attachments: ['non-existent-file'] }
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Access denied or file not found/);
    });

    it('should return error result when userId not provided for attachments', async () => {
      const result = await service.executeQueryStreaming(
        'Query',
        'session-123',
        mockOnEvent,
        undefined, // No userId
        { attachments: ['file-1'] }
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/UserId required/);
    });
  });
});
