/**
 * FileProcessingService Unit Tests
 *
 * Comprehensive tests for FileProcessingService orchestration logic.
 * Tests verify processor routing, status updates, WebSocket events, and error handling.
 *
 * Pattern: vi.hoisted() + manual re-setup in beforeEach
 * Based on: FileService.test.ts (passing pattern)
 *
 * Coverage Target: >90%
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileProcessingService, getFileProcessingService, __resetFileProcessingService } from '@/services/files/FileProcessingService';
import type { FileProcessingJob } from '@services/queue/MessageQueue';
import type { ExtractionResult } from '@/services/files/processors/types';

// ===== MOCK DEPENDENCIES (vi.hoisted pattern) =====

// Mock FileService
const mockUpdateProcessingStatus = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockFileServiceGetInstance = vi.hoisted(() =>
  vi.fn(() => ({
    updateProcessingStatus: mockUpdateProcessingStatus,
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

// Mock Logger
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  createChildLogger: vi.fn(() => mockLogger),
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
    mockDownloadFromBlob.mockResolvedValue(Buffer.from('mock file content'));
    mockIsSocketServiceInitialized.mockReturnValue(true);
    mockSocketTo.mockReturnValue({ emit: mockSocketEmit });

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

  // ========== SUITE 3: STATUS UPDATES (3 TESTS) ==========
  describe('Status Updates', () => {
    it('should update status to "processing" at start', async () => {
      const job = createMockJob();

      await service.processFile(job);

      // Verify first updateProcessingStatus call (processing)
      expect(mockUpdateProcessingStatus).toHaveBeenNthCalledWith(
        1,
        'test-user-456',
        'test-file-123',
        'processing',
        undefined
      );
    });

    it('should update status to "completed" with extracted text on success', async () => {
      const job = createMockJob();

      await service.processFile(job);

      // Verify second updateProcessingStatus call (completed)
      expect(mockUpdateProcessingStatus).toHaveBeenNthCalledWith(
        2,
        'test-user-456',
        'test-file-123',
        'completed',
        'Extracted plain text content'
      );
    });

    it('should update status to "failed" on error', async () => {
      const job = createMockJob();
      const testError = new Error('Processor failure');
      mockTextProcessorExtractText.mockRejectedValueOnce(testError);

      await expect(service.processFile(job)).rejects.toThrow('Processor failure');

      // Verify updateProcessingStatus was called with 'failed'
      expect(mockUpdateProcessingStatus).toHaveBeenCalledWith(
        'test-user-456',
        'test-file-123',
        'failed',
        undefined
      );
    });
  });

  // ========== SUITE 4: WEBSOCKET EVENTS (6 TESTS) ==========
  describe('WebSocket Events', () => {
    it('should emit progress events at key stages', async () => {
      const job = createMockJob();

      await service.processFile(job);

      // Verify all progress events were emitted (0%, 20%, 30%, 70%, 90%)
      expect(mockSocketEmit).toHaveBeenCalledWith(
        'file:processing',
        expect.objectContaining({
          type: 'file:processing_progress',
          fileId: 'test-file-123',
          status: 'processing',
          progress: 0,
        })
      );

      expect(mockSocketEmit).toHaveBeenCalledWith(
        'file:processing',
        expect.objectContaining({
          progress: 20,
        })
      );

      expect(mockSocketEmit).toHaveBeenCalledWith(
        'file:processing',
        expect.objectContaining({
          progress: 30,
        })
      );

      expect(mockSocketEmit).toHaveBeenCalledWith(
        'file:processing',
        expect.objectContaining({
          progress: 70,
        })
      );

      expect(mockSocketEmit).toHaveBeenCalledWith(
        'file:processing',
        expect.objectContaining({
          progress: 90,
        })
      );
    });

    it('should emit completion event with stats', async () => {
      const job = createMockJob({ mimeType: 'application/pdf' });

      await service.processFile(job);

      // Verify completion event with PDF stats
      expect(mockSocketEmit).toHaveBeenCalledWith(
        'file:processing',
        expect.objectContaining({
          type: 'file:processing_completed',
          fileId: 'test-file-123',
          status: 'completed',
          stats: {
            textLength: expect.any(Number),
            pageCount: 3,
            ocrUsed: true,
          },
          progress: 100,
        })
      );
    });

    it('should emit error event on failure', async () => {
      const job = createMockJob();
      const testError = new Error('Download failed');
      mockDownloadFromBlob.mockRejectedValueOnce(testError);

      await expect(service.processFile(job)).rejects.toThrow('Download failed');

      // Verify error event
      expect(mockSocketEmit).toHaveBeenCalledWith(
        'file:processing',
        expect.objectContaining({
          type: 'file:processing_failed',
          fileId: 'test-file-123',
          status: 'failed',
          error: 'Download failed',
        })
      );
    });

    it('should skip WebSocket events when sessionId is undefined', async () => {
      const job = createMockJob({ sessionId: undefined });

      await service.processFile(job);

      // Verify no WebSocket events were emitted
      expect(mockSocketEmit).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: undefined,
          fileId: 'test-file-123',
        }),
        expect.stringContaining('Skipping progress event')
      );
    });

    it('should skip WebSocket events when Socket.IO not initialized', async () => {
      mockIsSocketServiceInitialized.mockReturnValue(false);
      const job = createMockJob();

      await service.processFile(job);

      // Verify no WebSocket events were emitted
      expect(mockSocketEmit).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'test-session-789',
        }),
        expect.stringContaining('Socket.IO not initialized')
      );
    });

    it('should not throw if WebSocket emit fails', async () => {
      mockSocketEmit.mockImplementation(() => {
        throw new Error('WebSocket emit failed');
      });

      const job = createMockJob();

      // Should complete successfully despite WebSocket error
      await expect(service.processFile(job)).resolves.not.toThrow();

      // Verify error was logged but not rethrown
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.any(Error),
          sessionId: 'test-session-789',
          fileId: 'test-file-123',
        }),
        'Failed to emit progress event'
      );
    });
  });

  // ========== SUITE 5: BLOB DOWNLOAD (2 TESTS) ==========
  describe('Blob Download', () => {
    it('should download blob from FileUploadService', async () => {
      const job = createMockJob({ blobPath: 'users/test/files/report.pdf' });

      await service.processFile(job);

      // Verify downloadFromBlob was called with correct path
      expect(mockDownloadFromBlob).toHaveBeenCalledWith('users/test/files/report.pdf');
    });

    it('should pass downloaded buffer to processor', async () => {
      const mockBuffer = Buffer.from('test file content bytes');
      mockDownloadFromBlob.mockResolvedValueOnce(mockBuffer);

      const job = createMockJob({ mimeType: 'text/plain' });

      await service.processFile(job);

      // Verify processor received the buffer
      expect(mockTextProcessorExtractText).toHaveBeenCalledWith(
        mockBuffer,
        'test.txt'
      );
    });
  });

  // ========== SUITE 6: ERROR HANDLING (5 TESTS) ==========
  describe('Error Handling', () => {
    it('should rethrow error after updating status to "failed"', async () => {
      const job = createMockJob();
      const testError = new Error('Processor crashed');
      mockTextProcessorExtractText.mockRejectedValueOnce(testError);

      await expect(service.processFile(job)).rejects.toThrow('Processor crashed');

      // Verify status was updated to 'failed'
      expect(mockUpdateProcessingStatus).toHaveBeenCalledWith(
        'test-user-456',
        'test-file-123',
        'failed',
        undefined
      );
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

    it('should handle blob download failure', async () => {
      const job = createMockJob();
      const testError = new Error('Blob not found');
      mockDownloadFromBlob.mockRejectedValueOnce(testError);

      await expect(service.processFile(job)).rejects.toThrow('Blob not found');

      // Verify status was updated to 'failed'
      expect(mockUpdateProcessingStatus).toHaveBeenCalledWith(
        'test-user-456',
        'test-file-123',
        'failed',
        undefined
      );
    });

    it('should handle database update failure during error recovery', async () => {
      const job = createMockJob();
      const processorError = new Error('Extraction failed');
      const dbError = new Error('Database connection lost');

      mockTextProcessorExtractText.mockRejectedValueOnce(processorError);
      // First call is 'processing' status (succeeds), second call is 'failed' status (fails)
      mockUpdateProcessingStatus.mockResolvedValueOnce(undefined);
      mockUpdateProcessingStatus.mockRejectedValueOnce(dbError);

      // Should throw the database error (second failure)
      await expect(service.processFile(job)).rejects.toThrow('Database connection lost');

      // Verify error was logged (processor error triggers logging before DB error)
      expect(mockLogger.error).toHaveBeenCalled();
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
});
