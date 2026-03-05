/**
 * FileProcessingService Unit Tests
 *
 * Comprehensive tests for FileProcessingService orchestration logic.
 * Tests verify processor routing, text saving, WebSocket events, and error handling.
 *
 * IMPORTANT: FileProcessingService does NOT manage pipeline_status transitions.
 * Workers own state transitions via CAS. This service only:
 * - Extracts text via processors
 * - Saves extracted text via saveExtractedText (no status change)
 * - Emits WebSocket progress events
 *
 * Pattern: vi.hoisted() + manual re-setup in beforeEach
 * Based on: FileService.test.ts (passing pattern)
 *
 * Coverage Target: >90%
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileProcessingService, getFileProcessingService, __resetFileProcessingService } from '@/services/files/FileProcessingService';
import type { FileProcessingJob } from '@/infrastructure/queue/types';
import type { ExtractionResult } from '@/services/files/processors/types';
import { ALLOWED_MIME_TYPES } from '@bc-agent/shared';

// ===== MOCK DEPENDENCIES (vi.hoisted pattern) =====

// Mock FileService
const mockUpdateProcessingStatus = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSaveExtractedText = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockFileServiceGetInstance = vi.hoisted(() =>
  vi.fn(() => ({
    updateProcessingStatus: mockUpdateProcessingStatus,
    saveExtractedText: mockSaveExtractedText,
  }))
);

vi.mock('@/services/files/FileService', () => ({
  FileService: {
    getInstance: mockFileServiceGetInstance,
  },
}));

// Mock FileUploadService
const mockDownloadFromBlob = vi.hoisted(() => vi.fn().mockResolvedValue(Buffer.from('mock file content')));
const mockGetFileUploadService = vi.hoisted(() =>
  vi.fn(() => ({
    downloadFromBlob: mockDownloadFromBlob,
  }))
);

vi.mock('@/services/files/FileUploadService', () => ({
  getFileUploadService: mockGetFileUploadService,
}));

// Mock SocketService
const mockSocketEmit = vi.hoisted(() => vi.fn());
const mockSocketTo = vi.hoisted(() => vi.fn(() => ({ emit: mockSocketEmit })));
const mockGetSocketIO = vi.hoisted(() =>
  vi.fn(() => ({
    to: mockSocketTo,
  }))
);
const mockIsSocketServiceInitialized = vi.hoisted(() => vi.fn(() => true));

vi.mock('@services/websocket/SocketService', () => ({
  getSocketIO: mockGetSocketIO,
  isSocketServiceInitialized: mockIsSocketServiceInitialized,
}));

// Mock FileEventEmitter (D25 Sprint 3)
const mockEmitProgress = vi.hoisted(() => vi.fn());
const mockEmitCompletion = vi.hoisted(() => vi.fn());
const mockEmitError = vi.hoisted(() => vi.fn());
const mockGetFileEventEmitter = vi.hoisted(() =>
  vi.fn(() => ({
    emitProgress: mockEmitProgress,
    emitCompletion: mockEmitCompletion,
    emitError: mockEmitError,
    emitReadinessChanged: vi.fn(),
    emitPermanentlyFailed: vi.fn(),
  }))
);

vi.mock('@/domains/files/emission', () => ({
  getFileEventEmitter: mockGetFileEventEmitter,
}));

// Mock Processors
const mockTextProcessorExtractText = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    text: 'Extracted plain text content',
    metadata: {
      pageCount: 1,
      ocrUsed: false,
      fileSize: 1024,
    },
  } as ExtractionResult)
);

const mockPdfProcessorExtractText = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    text: 'Extracted PDF content via Azure Document Intelligence',
    metadata: {
      pageCount: 3,
      ocrUsed: true,
      fileSize: 512000,
    },
  } as ExtractionResult)
);

const mockDocxProcessorExtractText = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    text: 'Extracted DOCX content via mammoth.js',
    metadata: {
      pageCount: 5,
      ocrUsed: false,
      fileSize: 102400,
    },
  } as ExtractionResult)
);

const mockExcelProcessorExtractText = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    text: '| Column A | Column B |\n|----------|----------|\n| Value 1  | Value 2  |',
    metadata: {
      pageCount: 2,
      ocrUsed: false,
      fileSize: 204800,
    },
  } as ExtractionResult)
);

vi.mock('@/services/files/processors/TextProcessor', () => ({
  TextProcessor: vi.fn().mockImplementation(() => ({
    extractText: mockTextProcessorExtractText,
  })),
}));

vi.mock('@/services/files/processors/PdfProcessor', () => ({
  PdfProcessor: vi.fn().mockImplementation(() => ({
    extractText: mockPdfProcessorExtractText,
  })),
}));

vi.mock('@/services/files/processors/DocxProcessor', () => ({
  DocxProcessor: vi.fn().mockImplementation(() => ({
    extractText: mockDocxProcessorExtractText,
  })),
}));

vi.mock('@/services/files/processors/ExcelProcessor', () => ({
  ExcelProcessor: vi.fn().mockImplementation(() => ({
    extractText: mockExcelProcessorExtractText,
  })),
}));

const mockAzureDocIntelligenceProcessorExtractText = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    text: 'Extracted PPTX content via Azure Document Intelligence',
    metadata: {
      pageCount: 10,
      ocrUsed: false,
      fileSize: 1024000,
    },
  } as ExtractionResult)
);

vi.mock('@/services/files/processors/AzureDocIntelligenceProcessor', () => ({
  AzureDocIntelligenceProcessor: vi.fn().mockImplementation(() => ({
    extractText: mockAzureDocIntelligenceProcessorExtractText,
  })),
}));

const mockImageProcessorExtractText = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    text: '[Image: test.jpg]',
    metadata: {
      fileSize: 50000,
      ocrUsed: false,
      imageFormat: 'jpeg',
      embeddingGenerated: false,
    },
  } as ExtractionResult)
);

vi.mock('@/services/files/processors/ImageProcessor', () => ({
  ImageProcessor: vi.fn().mockImplementation(() => ({
    extractText: mockImageProcessorExtractText,
  })),
  trackImageUsage: vi.fn().mockResolvedValue(undefined),
}));

// Mock Logger
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => mockLogger),
}));

// Mock FileRepository
const mockIsFileActiveForProcessing = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const mockGetSourceType = vi.hoisted(() => vi.fn().mockResolvedValue('local'));
const mockGetFileRepository = vi.hoisted(() =>
  vi.fn(() => ({
    isFileActiveForProcessing: mockIsFileActiveForProcessing,
    getSourceType: mockGetSourceType,
  }))
);

vi.mock('@/services/files/repository/FileRepository', () => ({
  getFileRepository: mockGetFileRepository,
}));

// Mock ContentProviderFactory (PRD-100)
const mockProviderGetContent = vi.hoisted(() => vi.fn().mockResolvedValue({ buffer: Buffer.from('mock file content') }));
const mockGetProvider = vi.hoisted(() => vi.fn(() => ({ getContent: mockProviderGetContent })));
const mockGetContentProviderFactory = vi.hoisted(() => vi.fn(() => ({ getProvider: mockGetProvider })));

vi.mock('@/services/connectors', () => ({
  getContentProviderFactory: mockGetContentProviderFactory,
}));

// ===== TEST SUITE =====

describe('FileProcessingService', () => {
  let service: FileProcessingService;

  const createMockJob = (overrides?: Partial<FileProcessingJob>): FileProcessingJob => ({
    fileId: 'test-file-123',
    userId: 'test-user-456',
    sessionId: 'test-session-789',
    mimeType: 'text/plain',
    blobPath: 'users/test-user/files/test.txt',
    fileName: 'test.txt',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-setup mock implementations after clearAllMocks
    mockUpdateProcessingStatus.mockResolvedValue(undefined);
    mockSaveExtractedText.mockResolvedValue(undefined);
    mockDownloadFromBlob.mockResolvedValue(Buffer.from('mock file content'));
    mockIsSocketServiceInitialized.mockReturnValue(true);
    mockSocketTo.mockReturnValue({ emit: mockSocketEmit });
    mockIsFileActiveForProcessing.mockResolvedValue(true); // Mock file is active by default
    mockGetSourceType.mockResolvedValue('local'); // Default source type for local files
    mockProviderGetContent.mockResolvedValue({ buffer: Buffer.from('mock file content') });

    // Re-setup FileEventEmitter mocks (D25 Sprint 3)
    mockEmitProgress.mockImplementation(() => {});
    mockEmitCompletion.mockImplementation(() => {});
    mockEmitError.mockImplementation(() => {});

    mockTextProcessorExtractText.mockResolvedValue({
      text: 'Extracted plain text content',
      metadata: { pageCount: 1, ocrUsed: false, fileSize: 1024 },
    } as ExtractionResult);

    mockPdfProcessorExtractText.mockResolvedValue({
      text: 'Extracted PDF content via Azure Document Intelligence',
      metadata: { pageCount: 3, ocrUsed: true, fileSize: 512000 },
    } as ExtractionResult);

    mockDocxProcessorExtractText.mockResolvedValue({
      text: 'Extracted DOCX content via mammoth.js',
      metadata: { pageCount: 5, ocrUsed: false, fileSize: 102400 },
    } as ExtractionResult);

    mockExcelProcessorExtractText.mockResolvedValue({
      text: '| Column A | Column B |\n|----------|----------|\n| Value 1  | Value 2  |',
      metadata: { pageCount: 2, ocrUsed: false, fileSize: 204800 },
    } as ExtractionResult);

    mockAzureDocIntelligenceProcessorExtractText.mockResolvedValue({
      text: 'Extracted PPTX content via Azure Document Intelligence',
      metadata: { pageCount: 10, ocrUsed: false, fileSize: 1024000 },
    } as ExtractionResult);

    mockImageProcessorExtractText.mockResolvedValue({
      text: '[Image: test.jpg]',
      metadata: { fileSize: 50000, ocrUsed: false, imageFormat: 'jpeg', embeddingGenerated: false },
    } as ExtractionResult);

    // Reset singleton instance
    __resetFileProcessingService();
    service = getFileProcessingService();
  });

  afterEach(() => {
    __resetFileProcessingService();
  });

  // ========== SUITE 1: SINGLETON PATTERN (2 TESTS) ==========
  describe('Singleton Pattern', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = getFileProcessingService();
      const instance2 = getFileProcessingService();
      const instance3 = FileProcessingService.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
    });

    it('should reset singleton for testing with __resetFileProcessingService', () => {
      const instance1 = getFileProcessingService();
      __resetFileProcessingService();
      const instance2 = getFileProcessingService();

      expect(instance1).not.toBe(instance2);
    });
  });

  // ========== SUITE 2: PROCESSOR ROUTING (5 TESTS) ==========
  describe('Processor Routing', () => {
    it('should route text/plain to TextProcessor', async () => {
      const job = createMockJob({ mimeType: 'text/plain' });

      await service.processFile(job);

      expect(mockTextProcessorExtractText).toHaveBeenCalledWith(
        expect.any(Buffer),
        'test.txt'
      );
      expect(mockPdfProcessorExtractText).not.toHaveBeenCalled();
      expect(mockDocxProcessorExtractText).not.toHaveBeenCalled();
      expect(mockExcelProcessorExtractText).not.toHaveBeenCalled();
    });

    it('should route application/pdf to PdfProcessor', async () => {
      const job = createMockJob({
        mimeType: 'application/pdf',
        fileName: 'invoice.pdf',
      });

      await service.processFile(job);

      expect(mockPdfProcessorExtractText).toHaveBeenCalledWith(
        expect.any(Buffer),
        'invoice.pdf'
      );
      expect(mockTextProcessorExtractText).not.toHaveBeenCalled();
      expect(mockDocxProcessorExtractText).not.toHaveBeenCalled();
      expect(mockExcelProcessorExtractText).not.toHaveBeenCalled();
    });

    it('should route DOCX MIME type to DocxProcessor', async () => {
      const job = createMockJob({
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileName: 'report.docx',
      });

      await service.processFile(job);

      expect(mockDocxProcessorExtractText).toHaveBeenCalledWith(
        expect.any(Buffer),
        'report.docx'
      );
      expect(mockTextProcessorExtractText).not.toHaveBeenCalled();
      expect(mockPdfProcessorExtractText).not.toHaveBeenCalled();
      expect(mockExcelProcessorExtractText).not.toHaveBeenCalled();
    });

    it('should route XLSX MIME type to ExcelProcessor', async () => {
      const job = createMockJob({
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileName: 'budget.xlsx',
      });

      await service.processFile(job);

      expect(mockExcelProcessorExtractText).toHaveBeenCalledWith(
        expect.any(Buffer),
        'budget.xlsx'
      );
      expect(mockTextProcessorExtractText).not.toHaveBeenCalled();
      expect(mockPdfProcessorExtractText).not.toHaveBeenCalled();
      expect(mockDocxProcessorExtractText).not.toHaveBeenCalled();
    });

    it('should throw error for unsupported MIME type', async () => {
      // Note: image/* types are now supported via ImageProcessor
      // Using video/mp4 as an example of truly unsupported MIME type
      const job = createMockJob({
        mimeType: 'video/mp4',
        fileName: 'video.mp4',
      });

      await expect(service.processFile(job)).rejects.toThrow(
        'No processor found for MIME type: video/mp4'
      );

      // Verify error logging
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'No processor found for MIME type: video/mp4',
          fileId: 'test-file-123',
          mimeType: 'video/mp4',
        }),
        'File processing failed'
      );
    });
  });

  // ========== SUITE 3: TEXT SAVING (no status transitions) ==========
  describe('Text Saving (no status transitions)', () => {
    it('should save extracted text via saveExtractedText', async () => {
      const job = createMockJob();

      await service.processFile(job);

      expect(mockSaveExtractedText).toHaveBeenCalledWith(
        'test-user-456',
        'test-file-123',
        'Extracted plain text content'
      );
    });

    it('should NOT call updateProcessingStatus (worker responsibility)', async () => {
      const job = createMockJob();

      await service.processFile(job);

      // Service must NOT touch pipeline_status — that's the worker's job via CAS
      expect(mockUpdateProcessingStatus).not.toHaveBeenCalled();
    });

    it('should NOT set FAILED on error (worker responsibility)', async () => {
      const job = createMockJob();
      const testError = new Error('Processor failure');
      mockTextProcessorExtractText.mockRejectedValueOnce(testError);

      await expect(service.processFile(job)).rejects.toThrow('Processor failure');

      // Service must NOT transition to FAILED — worker handles CAS to FAILED
      expect(mockUpdateProcessingStatus).not.toHaveBeenCalled();
      expect(mockSaveExtractedText).not.toHaveBeenCalled();
    });
  });

  // ========== SUITE 4: WEBSOCKET EVENTS (6 TESTS) ==========
  describe('WebSocket Events', () => {
    it('should emit progress events at key stages via FileEventEmitter', async () => {
      const job = createMockJob();

      await service.processFile(job);

      // Verify all progress events were emitted via FileEventEmitter (0%, 20%, 30%, 70%, 90%)
      expect(mockEmitProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'test-file-123',
          userId: 'test-user-456',
          sessionId: 'test-session-789',
        }),
        expect.objectContaining({
          progress: 0,
          status: 'extracting',
          attemptNumber: 1,
          maxAttempts: 2,
        })
      );

      expect(mockEmitProgress).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ progress: 20 })
      );

      expect(mockEmitProgress).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ progress: 30 })
      );

      expect(mockEmitProgress).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ progress: 70 })
      );

      expect(mockEmitProgress).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ progress: 90 })
      );
    });

    it('should emit completion event with stats via FileEventEmitter', async () => {
      const job = createMockJob({ mimeType: 'application/pdf' });

      await service.processFile(job);

      // Verify completion event with PDF stats via FileEventEmitter
      expect(mockEmitCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'test-file-123',
          userId: 'test-user-456',
          sessionId: 'test-session-789',
        }),
        expect.objectContaining({
          textLength: expect.any(Number),
          pageCount: 3,
          ocrUsed: true,
        })
      );
    });

    it('should emit error event on failure via FileEventEmitter', async () => {
      const job = createMockJob();
      const testError = new Error('Download failed');
      mockProviderGetContent.mockRejectedValueOnce(testError);

      await expect(service.processFile(job)).rejects.toThrow('Download failed');

      // Verify error event via FileEventEmitter
      expect(mockEmitError).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'test-file-123',
          userId: 'test-user-456',
          sessionId: 'test-session-789',
        }),
        'Download failed'
      );
    });

    it('should pass undefined sessionId to FileEventEmitter (emitter handles skip)', async () => {
      const job = createMockJob({ sessionId: undefined });

      await service.processFile(job);

      // FileEventEmitter handles the skip internally - verify it was still called
      expect(mockEmitProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'test-file-123',
          userId: 'test-user-456',
          sessionId: undefined,
        }),
        expect.any(Object)
      );
    });

    it('should call FileEventEmitter regardless of Socket.IO state (emitter handles check)', async () => {
      mockIsSocketServiceInitialized.mockReturnValue(false);
      const job = createMockJob();

      await service.processFile(job);

      // FileEventEmitter handles the Socket.IO check internally
      // FileProcessingService just calls the emitter
      expect(mockEmitProgress).toHaveBeenCalled();
      expect(mockEmitCompletion).toHaveBeenCalled();
    });

    it('should call FileEventEmitter methods for all event types', async () => {
      const job = createMockJob();

      await service.processFile(job);

      // Verify all emitter methods are called
      expect(mockEmitProgress).toHaveBeenCalled();
      expect(mockEmitCompletion).toHaveBeenCalled();

      // emitError is not called on success
      expect(mockEmitError).not.toHaveBeenCalled();
    });
  });

  // ========== SUITE 5: CONTENT PROVIDER (2 TESTS) ==========
  describe('Content Provider', () => {
    it('should download content via ContentProviderFactory', async () => {
      const job = createMockJob();

      await service.processFile(job);

      // Verify getSourceType was called and provider was used
      expect(mockGetSourceType).toHaveBeenCalledWith('test-user-456', 'test-file-123');
      expect(mockGetProvider).toHaveBeenCalledWith('local');
      expect(mockProviderGetContent).toHaveBeenCalledWith('test-file-123', 'test-user-456');
    });

    it('should pass downloaded buffer to processor', async () => {
      const mockBuffer = Buffer.from('test file content bytes');
      mockProviderGetContent.mockResolvedValueOnce({ buffer: mockBuffer });

      const job = createMockJob({ mimeType: 'text/plain' });

      await service.processFile(job);

      // Verify processor received the buffer
      expect(mockTextProcessorExtractText).toHaveBeenCalledWith(
        mockBuffer,
        'test.txt'
      );
    });
  });

  // ========== SUITE 6: ERROR HANDLING (4 TESTS) ==========
  describe('Error Handling', () => {
    it('should rethrow error without updating status (worker responsibility)', async () => {
      const job = createMockJob();
      const testError = new Error('Processor crashed');
      mockTextProcessorExtractText.mockRejectedValueOnce(testError);

      await expect(service.processFile(job)).rejects.toThrow('Processor crashed');

      // Service must NOT touch pipeline_status — worker handles CAS to FAILED
      expect(mockUpdateProcessingStatus).not.toHaveBeenCalled();
    });

    it('should log detailed error information', async () => {
      const job = createMockJob({ mimeType: 'application/pdf' });
      const testError = new Error('Azure Document Intelligence API error');
      mockPdfProcessorExtractText.mockRejectedValueOnce(testError);

      await expect(service.processFile(job)).rejects.toThrow('Azure Document Intelligence API error');

      // Verify error logging
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Azure Document Intelligence API error',
          stack: expect.any(String),
          fileId: 'test-file-123',
          userId: 'test-user-456',
          mimeType: 'application/pdf',
          fileName: 'test.txt',
        }),
        'File processing failed'
      );
    });

    it('should handle non-Error thrown values', async () => {
      const job = createMockJob();
      mockTextProcessorExtractText.mockRejectedValueOnce('String error');

      await expect(service.processFile(job)).rejects.toBe('String error');

      // Verify error was converted to string for logging
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'String error',
          stack: undefined,
        }),
        'File processing failed'
      );
    });

    it('should handle content provider download failure', async () => {
      const job = createMockJob();
      const testError = new Error('Blob not found');
      mockProviderGetContent.mockRejectedValueOnce(testError);

      await expect(service.processFile(job)).rejects.toThrow('Blob not found');

      // Service must NOT touch pipeline_status — worker handles CAS to FAILED
      expect(mockUpdateProcessingStatus).not.toHaveBeenCalled();
    });
  });

  // ========== SUITE 7: MULTIPLE MIME TYPE SUPPORT (3 TESTS) ==========
  describe('Multiple MIME Type Support', () => {
    it('should route text/csv to TextProcessor', async () => {
      const job = createMockJob({
        mimeType: 'text/csv',
        fileName: 'data.csv',
      });

      await service.processFile(job);

      expect(mockTextProcessorExtractText).toHaveBeenCalledWith(
        expect.any(Buffer),
        'data.csv'
      );
    });

    it('should route text/markdown to TextProcessor', async () => {
      const job = createMockJob({
        mimeType: 'text/markdown',
        fileName: 'README.md',
      });

      await service.processFile(job);

      expect(mockTextProcessorExtractText).toHaveBeenCalledWith(
        expect.any(Buffer),
        'README.md'
      );
    });

    it('should route application/json to TextProcessor', async () => {
      const job = createMockJob({
        mimeType: 'application/json',
        fileName: 'config.json',
      });

      await service.processFile(job);

      expect(mockTextProcessorExtractText).toHaveBeenCalledWith(
        expect.any(Buffer),
        'config.json'
      );
    });
  });

  // ========== SUITE 8: LOGGING (3 TESTS) ==========
  describe('Logging', () => {
    it('should log processing start', async () => {
      const job = createMockJob();

      await service.processFile(job);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'test-file-123',
          userId: 'test-user-456',
          sessionId: 'test-session-789',
          mimeType: 'text/plain',
          fileName: 'test.txt',
        }),
        'Starting file processing'
      );
    });

    it('should log text extraction completion', async () => {
      const job = createMockJob({ mimeType: 'application/pdf' });

      await service.processFile(job);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'test-file-123',
          textLength: expect.any(Number),
          pageCount: 3,
          ocrUsed: true,
        }),
        'Text extraction completed'
      );
    });

    it('should log processing success', async () => {
      const job = createMockJob();

      await service.processFile(job);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'test-file-123',
          userId: 'test-user-456',
        }),
        'File processing completed successfully'
      );
    });
  });

  // ========== SUITE 9: PPTX AND IMAGE PROCESSOR ROUTING ==========
  describe('PPTX and Image Processor Routing', () => {
    it('should route PPTX to AzureDocIntelligenceProcessor', async () => {
      const job = createMockJob({
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        fileName: 'slides.pptx',
      });

      await service.processFile(job);

      expect(mockAzureDocIntelligenceProcessorExtractText).toHaveBeenCalledWith(
        expect.any(Buffer),
        'slides.pptx'
      );
      expect(mockPdfProcessorExtractText).not.toHaveBeenCalled();
      expect(mockTextProcessorExtractText).not.toHaveBeenCalled();
      expect(mockDocxProcessorExtractText).not.toHaveBeenCalled();
      expect(mockExcelProcessorExtractText).not.toHaveBeenCalled();
      expect(mockImageProcessorExtractText).not.toHaveBeenCalled();
    });

    it('should route image/svg+xml to TextProcessor', async () => {
      const job = createMockJob({ mimeType: 'image/svg+xml', fileName: 'logo.svg' });

      await service.processFile(job);

      expect(mockTextProcessorExtractText).toHaveBeenCalledWith(
        expect.any(Buffer),
        'logo.svg'
      );
      expect(mockImageProcessorExtractText).not.toHaveBeenCalled();
    });

    it('should route image/bmp to ImageProcessor', async () => {
      const job = createMockJob({ mimeType: 'image/bmp', fileName: 'bitmap.bmp' });

      await service.processFile(job);

      expect(mockImageProcessorExtractText).toHaveBeenCalledWith(
        expect.any(Buffer),
        'bitmap.bmp'
      );
      expect(mockTextProcessorExtractText).not.toHaveBeenCalled();
      expect(mockPdfProcessorExtractText).not.toHaveBeenCalled();
    });

    it('should route image/tiff to ImageProcessor', async () => {
      const job = createMockJob({ mimeType: 'image/tiff', fileName: 'scan.tiff' });

      await service.processFile(job);

      expect(mockImageProcessorExtractText).toHaveBeenCalledWith(
        expect.any(Buffer),
        'scan.tiff'
      );
      expect(mockTextProcessorExtractText).not.toHaveBeenCalled();
      expect(mockPdfProcessorExtractText).not.toHaveBeenCalled();
    });

    it('should route image/jpeg to ImageProcessor', async () => {
      const job = createMockJob({ mimeType: 'image/jpeg', fileName: 'photo.jpg' });

      await service.processFile(job);

      expect(mockImageProcessorExtractText).toHaveBeenCalledWith(
        expect.any(Buffer),
        'photo.jpg'
      );
    });

    it('should route image/png to ImageProcessor', async () => {
      const job = createMockJob({ mimeType: 'image/png', fileName: 'screenshot.png' });

      await service.processFile(job);

      expect(mockImageProcessorExtractText).toHaveBeenCalledWith(
        expect.any(Buffer),
        'screenshot.png'
      );
    });
  });

  // ========== SUITE 10: BILLING TYPE FROM MIME TYPE ==========
  describe('Billing Processor Type Mapping', () => {
    it('should route PPTX through AzureDocIntelligenceProcessor for billing type "pptx"', async () => {
      // getProcessorTypeFromMimeType is private; we verify the "pptx" path is exercised
      // by confirming end-to-end processing succeeds and the right processor is called.
      // The billing type mapping is an implementation detail validated by the processor selection.
      const job = createMockJob({
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        fileName: 'deck.pptx',
      });

      await service.processFile(job);

      // AzureDocIntelligenceProcessor (not PdfProcessor) handles PPTX
      expect(mockAzureDocIntelligenceProcessorExtractText).toHaveBeenCalledWith(
        expect.any(Buffer),
        'deck.pptx'
      );
      // Confirm correct processor was selected (not the PDF one)
      expect(mockPdfProcessorExtractText).not.toHaveBeenCalled();
    });

    it('should route PPTX and save its extracted text', async () => {
      const job = createMockJob({
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        fileName: 'quarterly.pptx',
      });

      await service.processFile(job);

      // Verify PPTX text was saved
      expect(mockSaveExtractedText).toHaveBeenCalledWith(
        'test-user-456',
        'test-file-123',
        'Extracted PPTX content via Azure Document Intelligence'
      );
    });

    it('should complete PPTX processing and emit completion event with PPTX metadata', async () => {
      const job = createMockJob({
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        fileName: 'annual-review.pptx',
      });

      await service.processFile(job);

      // Verify completion event contains PPTX metadata (10 pages per mock)
      expect(mockEmitCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'test-file-123',
          userId: 'test-user-456',
        }),
        expect.objectContaining({
          pageCount: 10,
          ocrUsed: false,
        })
      );
    });
  });

  // ========== SUITE 11: PARAMETRIC — ALL ALLOWED_MIME_TYPES HAVE A PROCESSOR ==========
  describe('Processor Coverage — every ALLOWED_MIME_TYPE has a registered processor', () => {
    it.each(ALLOWED_MIME_TYPES as readonly string[])(
      'should have a processor registered for MIME type: %s',
      async (mimeType) => {
        const job = createMockJob({ mimeType, fileName: `test-file.${mimeType.split('/')[1]}` });

        // Every ALLOWED_MIME_TYPE must resolve to a processor without throwing
        // "No processor found for MIME type: ..."
        await expect(service.processFile(job)).resolves.not.toThrow();
      }
    );
  });
});
