/**
 * FileProcessingService - Blob Download Path Unit Tests (PRD-100)
 *
 * Pre-refactor safety-net tests for the blob download path that now uses
 * ContentProviderFactory instead of directly calling FileUploadService.
 *
 * Tests verify the NEW code path (processFile → FileRepository.getSourceType →
 * ContentProviderFactory.getProvider → provider.getContent).
 *
 * Dynamic imports in processFile (FileRepository, connectors) are intercepted
 * by vi.mock() — Vitest hoists vi.mock() calls before module evaluation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// MOCKS (must come before imports that use them)
// ============================================================================

// ----- FileRepository (used via dynamic import in processFile) -----
const mockIsFileActive = vi.hoisted(() => vi.fn());
const mockGetSourceType = vi.hoisted(() => vi.fn());
const mockSaveExtractedText = vi.hoisted(() => vi.fn());

vi.mock('@/services/files/repository/FileRepository', () => ({
  getFileRepository: vi.fn(() => ({
    isFileActiveForProcessing: mockIsFileActive,
    getSourceType: mockGetSourceType,
    saveExtractedText: mockSaveExtractedText,
  })),
}));

// ----- ContentProviderFactory (used via dynamic import in processFile) -----
const mockGetContent = vi.hoisted(() => vi.fn());
const mockGetProvider = vi.hoisted(() => vi.fn(() => ({ getContent: mockGetContent })));

vi.mock('@/services/connectors', () => ({
  getContentProviderFactory: vi.fn(() => ({
    getProvider: mockGetProvider,
  })),
}));

// ----- FileService (saveExtractedText) -----
const mockFSSaveText = vi.hoisted(() => vi.fn());

vi.mock('@/services/files/FileService', () => ({
  FileService: {
    getInstance: vi.fn(() => ({
      saveExtractedText: mockFSSaveText,
    })),
  },
}));

// ----- FileEventEmitter -----
const mockEmitProgress = vi.hoisted(() => vi.fn());
const mockEmitCompletion = vi.hoisted(() => vi.fn());
const mockEmitError = vi.hoisted(() => vi.fn());

vi.mock('@/domains/files/emission', () => ({
  getFileEventEmitter: vi.fn(() => ({
    emitProgress: mockEmitProgress,
    emitCompletion: mockEmitCompletion,
    emitError: mockEmitError,
  })),
}));

// ----- UsageTrackingService (fire-and-forget; don't block tests) -----
vi.mock('@/domains/billing/tracking/UsageTrackingService', () => ({
  getUsageTrackingService: vi.fn(() => ({
    trackTextExtraction: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ----- ImageEmbeddingRepository (dynamic import inside persistImageEmbedding) -----
vi.mock('@/repositories/ImageEmbeddingRepository', () => ({
  getImageEmbeddingRepository: vi.fn(() => ({
    upsert: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ----- Message Queue (prevent BullMQ connection attempts) -----
vi.mock('@/infrastructure/queue/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => ({
    addEmbeddingGenerationJob: vi.fn().mockResolvedValue('mock-job-id'),
  })),
}));

// ----- Logger -----
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ----- Processor mocks (prevent Azure SDK initialisation) -----
vi.mock('@/services/files/processors/PdfProcessor', () => ({
  PdfProcessor: vi.fn().mockImplementation(() => ({
    extractText: vi.fn().mockResolvedValue({
      text: 'extracted text',
      metadata: { pageCount: 1, ocrUsed: false },
    }),
  })),
}));

vi.mock('@/services/files/processors/AzureDocIntelligenceProcessor', () => ({
  AzureDocIntelligenceProcessor: vi.fn().mockImplementation(() => ({
    extractText: vi.fn().mockResolvedValue({
      text: 'extracted text',
      metadata: { pageCount: 1, ocrUsed: true },
    }),
  })),
}));

vi.mock('@/services/files/processors/DocxProcessor', () => ({
  DocxProcessor: vi.fn().mockImplementation(() => ({
    extractText: vi.fn().mockResolvedValue({
      text: 'extracted docx text',
      metadata: { pageCount: 1, ocrUsed: false },
    }),
  })),
}));

vi.mock('@/services/files/processors/ExcelProcessor', () => ({
  ExcelProcessor: vi.fn().mockImplementation(() => ({
    extractText: vi.fn().mockResolvedValue({
      text: 'sheet1\n| A | B |',
      metadata: { pageCount: 1, ocrUsed: false, sheetCount: 2 },
    }),
  })),
}));

vi.mock('@/services/files/processors/TextProcessor', () => ({
  TextProcessor: vi.fn().mockImplementation(() => ({
    extractText: vi.fn().mockResolvedValue({
      text: 'plain text content',
      metadata: { pageCount: 1, ocrUsed: false },
    }),
  })),
}));

vi.mock('@/services/files/processors/ImageProcessor', () => ({
  ImageProcessor: vi.fn().mockImplementation(() => ({
    extractText: vi.fn().mockResolvedValue({
      text: 'image caption',
      metadata: { pageCount: 1, ocrUsed: false },
    }),
  })),
  trackImageUsage: vi.fn().mockResolvedValue(undefined),
}));

// ============================================================================
// Import under test (after all mocks)
// ============================================================================

import {
  FileProcessingService,
  __resetFileProcessingService,
} from '@/services/files/FileProcessingService';
import type { FileProcessingJob } from '@/infrastructure/queue/types';

// ============================================================================
// TEST HELPERS
// ============================================================================

const USER_ID = 'USER-AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const FILE_ID = 'FILE-11111111-2222-3333-4444-555566667777';
const SESSION_ID = 'SESS-AAAABBBB-CCCC-DDDD-EEEE-FFFFAAAABBBB';

function makeJob(overrides: Partial<FileProcessingJob> = {}): FileProcessingJob {
  return {
    fileId: FILE_ID,
    userId: USER_ID,
    sessionId: SESSION_ID,
    mimeType: 'text/plain',
    fileName: 'document.txt',
    attemptNumber: 1,
    maxAttempts: 2,
    ...overrides,
  };
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('FileProcessingService - blob download path (PRD-100)', () => {
  let service: FileProcessingService;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetFileProcessingService();
    service = FileProcessingService.getInstance();

    // Default: file is active and source type is 'local'
    mockIsFileActive.mockResolvedValue(true);
    mockGetSourceType.mockResolvedValue('local');
    // Default: provider returns a buffer
    mockGetContent.mockResolvedValue({
      buffer: Buffer.from('hello world'),
      mimeType: 'text/plain',
    });
    // Default: save succeeds
    mockFSSaveText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    __resetFileProcessingService();
  });

  // ==========================================================================
  // Successful download
  // ==========================================================================

  describe('successful download', () => {
    it('calls getProvider with sourceType and getContent with fileId and userId', async () => {
      const job = makeJob({ mimeType: 'text/plain' });

      await service.processFile(job);

      expect(mockGetSourceType).toHaveBeenCalledWith(USER_ID, FILE_ID);
      expect(mockGetProvider).toHaveBeenCalledWith('local');
      expect(mockGetContent).toHaveBeenCalledWith(FILE_ID, USER_ID);
    });

    it('proceeds to text extraction after successful download', async () => {
      const job = makeJob({ mimeType: 'text/plain' });

      await service.processFile(job);

      // If extraction succeeded, saveExtractedText must have been called
      expect(mockFSSaveText).toHaveBeenCalledWith(USER_ID, FILE_ID, expect.any(String));
    });

    it('emits completion event on success', async () => {
      const job = makeJob({ mimeType: 'text/plain' });

      await service.processFile(job);

      expect(mockEmitCompletion).toHaveBeenCalledOnce();
    });
  });

  // ==========================================================================
  // Download failure → rethrows
  // ==========================================================================

  describe('download failure', () => {
    it('rethrows error from provider.getContent (triggering BullMQ retry)', async () => {
      const downloadError = new Error('Azure blob unavailable');
      mockGetContent.mockRejectedValue(downloadError);

      const job = makeJob({ mimeType: 'text/plain' });

      await expect(service.processFile(job)).rejects.toThrow('Azure blob unavailable');
    });

    it('emits error event when download fails', async () => {
      mockGetContent.mockRejectedValue(new Error('Network timeout'));

      const job = makeJob({ mimeType: 'text/plain' });

      await expect(service.processFile(job)).rejects.toThrow();

      expect(mockEmitError).toHaveBeenCalledOnce();
      expect(mockFSSaveText).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Deleted file (graceful skip)
  // ==========================================================================

  describe('deleted file (graceful skip)', () => {
    it('returns early without processing when file is not active', async () => {
      mockIsFileActive.mockResolvedValue(false);

      const job = makeJob({ mimeType: 'text/plain' });

      // Should resolve without throwing
      await expect(service.processFile(job)).resolves.toBeUndefined();

      // None of the pipeline steps should have executed
      expect(mockGetSourceType).not.toHaveBeenCalled();
      expect(mockGetProvider).not.toHaveBeenCalled();
      expect(mockGetContent).not.toHaveBeenCalled();
      expect(mockFSSaveText).not.toHaveBeenCalled();
      expect(mockEmitCompletion).not.toHaveBeenCalled();
      expect(mockEmitError).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Processor selection by MIME type
  // ==========================================================================

  describe('processor selection', () => {
    it('completes processing for text/plain mime type', async () => {
      const job = makeJob({ mimeType: 'text/plain' });

      await service.processFile(job);

      expect(mockFSSaveText).toHaveBeenCalledOnce();
    });

    it('completes processing for application/json mime type', async () => {
      const job = makeJob({ mimeType: 'application/json' });

      await service.processFile(job);

      expect(mockFSSaveText).toHaveBeenCalledOnce();
    });

    it('throws for unsupported mime type', async () => {
      const job = makeJob({ mimeType: 'application/octet-stream' });

      await expect(service.processFile(job)).rejects.toThrow(
        'No processor found for MIME type: application/octet-stream'
      );
    });

    it('completes processing for application/pdf mime type', async () => {
      const job = makeJob({ mimeType: 'application/pdf' });

      await service.processFile(job);

      expect(mockFSSaveText).toHaveBeenCalledOnce();
    });

    it('completes processing for docx mime type', async () => {
      const job = makeJob({
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      await service.processFile(job);

      expect(mockFSSaveText).toHaveBeenCalledOnce();
    });
  });
});
