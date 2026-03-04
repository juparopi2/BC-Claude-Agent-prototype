import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AzureDocIntelligenceProcessor } from '@services/files/processors/AzureDocIntelligenceProcessor';
import type { AnalyzeResult } from '@azure/ai-form-recognizer';
import { DocumentAnalysisClient } from '@azure/ai-form-recognizer';

// =============================================================================
// Mock Azure SDK
// =============================================================================

const mockPollUntilDone = vi.fn();
const mockBeginAnalyzeDocument = vi.fn();

vi.mock('@azure/ai-form-recognizer', () => {
  const mockClient = vi.fn().mockImplementation(() => ({
    beginAnalyzeDocument: mockBeginAnalyzeDocument,
  }));

  return {
    DocumentAnalysisClient: mockClient,
    AzureKeyCredential: vi.fn().mockImplementation((key: string) => ({ key })),
  };
});

// Get reference to the mocked DocumentAnalysisClient constructor
const MockedDocumentAnalysisClient = vi.mocked(DocumentAnalysisClient);

// =============================================================================
// Mock Logger
// =============================================================================

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/shared/utils/logger', () => ({
  logger: mockLogger,
  createChildLogger: vi.fn(() => mockLogger),
}));

// =============================================================================
// Mock Environment (default: credentials NOT set)
// =============================================================================

const mockEnv = vi.hoisted(() => ({
  AZURE_DI_ENDPOINT: undefined as string | undefined,
  AZURE_DI_KEY: undefined as string | undefined,
}));

vi.mock('@/infrastructure/config/environment', () => ({
  env: mockEnv,
}));

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a minimal Azure AnalyzeResult fixture for testing
 */
function createAzureAnalyzeResult(overrides?: Partial<AnalyzeResult>): AnalyzeResult {
  return {
    modelId: 'prebuilt-read',
    apiVersion: '2023-07-31',
    content: 'This is extracted text from a document.',
    pages: [
      {
        pageNumber: 1,
        width: 8.5,
        height: 11,
        unit: 'inch',
        words: [
          { content: 'This', polygon: [], confidence: 0.99, span: { offset: 0, length: 4 } },
          { content: 'is', polygon: [], confidence: 0.99, span: { offset: 5, length: 2 } },
          { content: 'extracted', polygon: [], confidence: 0.99, span: { offset: 8, length: 9 } },
        ],
        lines: [
          {
            content: 'This is extracted text',
            polygon: [],
            spans: [{ offset: 0, length: 22 }],
          },
        ],
        spans: [{ offset: 0, length: 40 }],
      },
    ],
    languages: [
      {
        locale: 'en-US',
        confidence: 0.95,
        spans: [{ offset: 0, length: 40 }],
      },
    ],
    styles: [],
    ...overrides,
  } as AnalyzeResult;
}

/**
 * Create Azure AnalyzeResult with handwritten content (OCR used)
 */
function createAzureAnalyzeResultWithOCR(): AnalyzeResult {
  return createAzureAnalyzeResult({
    styles: [
      {
        isHandwritten: true,
        confidence: 0.92,
        spans: [{ offset: 0, length: 40 }],
      },
    ],
  });
}

/**
 * Create Azure AnalyzeResult with multiple pages
 */
function createAzureAnalyzeResultMultiPage(): AnalyzeResult {
  return createAzureAnalyzeResult({
    content: 'Page 1 content.\n\nPage 2 content.',
    pages: [
      {
        pageNumber: 1,
        width: 8.5,
        height: 11,
        unit: 'inch',
        words: [
          { content: 'Page', polygon: [], confidence: 0.99, span: { offset: 0, length: 4 } },
          { content: '1', polygon: [], confidence: 0.99, span: { offset: 5, length: 1 } },
        ],
        lines: [
          {
            content: 'Page 1 content.',
            polygon: [],
            spans: [{ offset: 0, length: 15 }],
          },
        ],
        spans: [{ offset: 0, length: 15 }],
      },
      {
        pageNumber: 2,
        width: 8.5,
        height: 11,
        unit: 'inch',
        words: [
          { content: 'Page', polygon: [], confidence: 0.99, span: { offset: 17, length: 4 } },
          { content: '2', polygon: [], confidence: 0.99, span: { offset: 22, length: 1 } },
        ],
        lines: [
          {
            content: 'Page 2 content.',
            polygon: [],
            spans: [{ offset: 17, length: 15 }],
          },
        ],
        spans: [{ offset: 17, length: 15 }],
      },
    ],
  });
}

// =============================================================================
// Test Suite
// =============================================================================

describe('AzureDocIntelligenceProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset environment to defaults (no credentials)
    mockEnv.AZURE_DI_ENDPOINT = undefined;
    mockEnv.AZURE_DI_KEY = undefined;

    // Reset Azure SDK mocks
    mockBeginAnalyzeDocument.mockReset();
    mockPollUntilDone.mockReset();
  });

  describe('Configuration validation', () => {
    it('should throw error when AZURE_DI_ENDPOINT is not configured', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const buffer = Buffer.from('fake-document-content');

      mockEnv.AZURE_DI_ENDPOINT = undefined;
      mockEnv.AZURE_DI_KEY = 'test-key';

      await expect(processor.extractText(buffer, 'test.pptx')).rejects.toThrow(
        'Azure Document Intelligence credentials not configured. ' +
          'Please set AZURE_DI_ENDPOINT and AZURE_DI_KEY environment variables.'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'test.pptx',
          error: expect.stringContaining('Azure Document Intelligence credentials not configured'),
        }),
        'Azure DI extraction failed'
      );
    });

    it('should throw error when AZURE_DI_KEY is not configured', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const buffer = Buffer.from('fake-document-content');

      mockEnv.AZURE_DI_ENDPOINT = 'https://test.cognitiveservices.azure.com/';
      mockEnv.AZURE_DI_KEY = undefined;

      await expect(processor.extractText(buffer, 'test.pptx')).rejects.toThrow(
        'Azure Document Intelligence credentials not configured. ' +
          'Please set AZURE_DI_ENDPOINT and AZURE_DI_KEY environment variables.'
      );
    });

    it('should throw error when both AZURE_DI_ENDPOINT and AZURE_DI_KEY are not configured', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const buffer = Buffer.from('fake-document-content');

      mockEnv.AZURE_DI_ENDPOINT = undefined;
      mockEnv.AZURE_DI_KEY = undefined;

      await expect(processor.extractText(buffer, 'test.pptx')).rejects.toThrow(
        'Azure Document Intelligence credentials not configured. ' +
          'Please set AZURE_DI_ENDPOINT and AZURE_DI_KEY environment variables.'
      );
    });

    it('should create Azure client only once (lazy initialization)', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const buffer = Buffer.from('fake-document-content');

      mockEnv.AZURE_DI_ENDPOINT = 'https://test.cognitiveservices.azure.com/';
      mockEnv.AZURE_DI_KEY = 'test-key-123';

      const azureResult = createAzureAnalyzeResult();
      mockPollUntilDone.mockResolvedValue(azureResult);
      mockBeginAnalyzeDocument.mockResolvedValue({ pollUntilDone: mockPollUntilDone });

      // Call extractText twice
      await processor.extractText(buffer, 'slide1.pptx');
      await processor.extractText(buffer, 'slide2.pptx');

      // DocumentAnalysisClient constructor should be called only once
      expect(MockedDocumentAnalysisClient).toHaveBeenCalledTimes(1);
      expect(MockedDocumentAnalysisClient).toHaveBeenCalledWith(
        'https://test.cognitiveservices.azure.com/',
        expect.objectContaining({ key: 'test-key-123' })
      );
    });
  });

  describe('extractText() - successful extraction', () => {
    beforeEach(() => {
      // Set valid credentials for successful tests
      mockEnv.AZURE_DI_ENDPOINT = 'https://test.cognitiveservices.azure.com/';
      mockEnv.AZURE_DI_KEY = 'test-key-123';
    });

    it('should extract text from valid document buffer', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const buffer = Buffer.from('fake-document-content');
      const azureResult = createAzureAnalyzeResult();

      mockPollUntilDone.mockResolvedValue(azureResult);
      mockBeginAnalyzeDocument.mockResolvedValue({ pollUntilDone: mockPollUntilDone });

      const result = await processor.extractText(buffer, 'presentation.pptx');

      expect(result.text).toBe('This is extracted text from a document.');
      expect(result.metadata.pageCount).toBe(1);
      expect(result.metadata.fileSize).toBe(buffer.length);
      expect(result.metadata.azureApiVersion).toBe('2023-07-31');
      expect(result.metadata.azureModelId).toBe('prebuilt-read');

      expect(mockBeginAnalyzeDocument).toHaveBeenCalledWith('prebuilt-read', buffer);
      expect(mockPollUntilDone).toHaveBeenCalledOnce();
    });

    it('should return correct metadata from Azure response', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const buffer = Buffer.from('fake-document-content');
      const azureResult = createAzureAnalyzeResultMultiPage();

      mockPollUntilDone.mockResolvedValue(azureResult);
      mockBeginAnalyzeDocument.mockResolvedValue({ pollUntilDone: mockPollUntilDone });

      const result = await processor.extractText(buffer, 'multi-slide.pptx');

      expect(result.text).toBe('Page 1 content.\n\nPage 2 content.');
      expect(result.metadata.pageCount).toBe(2);
      expect(result.metadata.pages).toHaveLength(2);

      // Check first page metadata
      expect(result.metadata.pages![0]).toEqual({
        pageNumber: 1,
        width: 8.5,
        height: 11,
        unit: 'inch',
        wordCount: 2,
        lineCount: 1,
      });

      // Check second page metadata
      expect(result.metadata.pages![1]).toEqual({
        pageNumber: 2,
        width: 8.5,
        height: 11,
        unit: 'inch',
        wordCount: 2,
        lineCount: 1,
      });

      // Check language detection
      expect(result.metadata.languages).toHaveLength(1);
      expect(result.metadata.languages![0]).toEqual({
        locale: 'en-US',
        confidence: 0.95,
      });
    });

    it('should detect OCR usage via styles (isHandwritten)', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const buffer = Buffer.from('fake-document-content');
      const azureResult = createAzureAnalyzeResultWithOCR();

      mockPollUntilDone.mockResolvedValue(azureResult);
      mockBeginAnalyzeDocument.mockResolvedValue({ pollUntilDone: mockPollUntilDone });

      const result = await processor.extractText(buffer, 'handwritten.pptx');

      expect(result.metadata.ocrUsed).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'handwritten.pptx',
          ocrUsed: true,
        }),
        'Azure DI extraction completed successfully'
      );
    });

    it('should set ocrUsed to false when no handwritten content detected', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const buffer = Buffer.from('fake-document-content');
      const azureResult = createAzureAnalyzeResult({
        styles: [
          {
            isHandwritten: false,
            confidence: 0.99,
            spans: [{ offset: 0, length: 40 }],
          },
        ],
      });

      mockPollUntilDone.mockResolvedValue(azureResult);
      mockBeginAnalyzeDocument.mockResolvedValue({ pollUntilDone: mockPollUntilDone });

      const result = await processor.extractText(buffer, 'typed-doc.pptx');

      expect(result.metadata.ocrUsed).toBe(false);
    });

    it('should set ocrUsed to false when styles array is empty', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const buffer = Buffer.from('fake-document-content');
      const azureResult = createAzureAnalyzeResult({
        styles: [],
      });

      mockPollUntilDone.mockResolvedValue(azureResult);
      mockBeginAnalyzeDocument.mockResolvedValue({ pollUntilDone: mockPollUntilDone });

      const result = await processor.extractText(buffer, 'no-styles.pptx');

      expect(result.metadata.ocrUsed).toBe(false);
    });

    it('should log extraction metrics on successful extraction', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const buffer = Buffer.from('fake-document-content');
      const azureResult = createAzureAnalyzeResult();

      mockPollUntilDone.mockResolvedValue(azureResult);
      mockBeginAnalyzeDocument.mockResolvedValue({ pollUntilDone: mockPollUntilDone });

      await processor.extractText(buffer, 'metrics.pptx');

      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          fileName: 'metrics.pptx',
          fileSize: buffer.length,
        },
        'Starting Azure DI extraction'
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        {
          fileName: 'metrics.pptx',
          modelId: 'prebuilt-read',
          apiVersion: '2023-07-31',
          pageCount: 1,
        },
        'Azure Document Intelligence analysis completed'
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          fileName: 'metrics.pptx',
          pageCount: 1,
          textLength: 39,
          ocrUsed: false,
          languagesDetected: 1,
          fileSize: buffer.length,
        },
        'Azure DI extraction completed successfully'
      );
    });
  });

  describe('extractText() - error handling', () => {
    beforeEach(() => {
      // Set valid credentials for error handling tests
      mockEnv.AZURE_DI_ENDPOINT = 'https://test.cognitiveservices.azure.com/';
      mockEnv.AZURE_DI_KEY = 'test-key-123';
    });

    it('should throw error when buffer is empty', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const emptyBuffer = Buffer.from('');

      await expect(processor.extractText(emptyBuffer, 'empty.pptx')).rejects.toThrow(
        'Failed to extract text from empty.pptx: Buffer is empty or undefined'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'empty.pptx',
          error: 'Buffer is empty or undefined',
        }),
        'Azure DI extraction failed'
      );
    });

    it('should throw error when Azure API fails', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const buffer = Buffer.from('fake-document-content');

      const azureError = new Error('Azure Document Intelligence service unavailable');
      mockBeginAnalyzeDocument.mockRejectedValue(azureError);

      await expect(processor.extractText(buffer, 'api-error.pptx')).rejects.toThrow(
        'Failed to extract text from api-error.pptx: Azure Document Intelligence service unavailable'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'api-error.pptx',
          error: 'Azure Document Intelligence service unavailable',
          stack: expect.any(String),
        }),
        'Azure DI extraction failed'
      );
    });

    it('should throw error when polling fails (timeout)', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const buffer = Buffer.from('fake-document-content');

      mockBeginAnalyzeDocument.mockResolvedValue({ pollUntilDone: mockPollUntilDone });
      mockPollUntilDone.mockRejectedValue(new Error('Polling timeout'));

      await expect(processor.extractText(buffer, 'polling-error.pptx')).rejects.toThrow(
        'Failed to extract text from polling-error.pptx: Polling timeout'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'polling-error.pptx',
          error: 'Polling timeout',
        }),
        'Azure DI extraction failed'
      );
    });

    it('should handle non-Error exceptions gracefully', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const buffer = Buffer.from('fake-document-content');

      // Throw a non-Error object (e.g., string)
      mockBeginAnalyzeDocument.mockRejectedValue('String error');

      await expect(processor.extractText(buffer, 'string-error.pptx')).rejects.toThrow(
        'Failed to extract text from string-error.pptx: String error'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'string-error.pptx',
          error: 'String error',
          stack: undefined,
        }),
        'Azure DI extraction failed'
      );
    });

    it('should enhance error message with filename context (no PDF prefix)', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const buffer = Buffer.from('fake-document-content');

      mockBeginAnalyzeDocument.mockRejectedValue(new Error('Invalid API key'));

      // Error message uses generic "Failed to extract text from {fileName}"
      // (NOT "Failed to extract text from PDF {fileName}" as in PdfProcessor)
      await expect(processor.extractText(buffer, 'slides-2023.pptx')).rejects.toThrow(
        'Failed to extract text from slides-2023.pptx: Invalid API key'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'slides-2023.pptx',
          error: 'Invalid API key',
        }),
        'Azure DI extraction failed'
      );
    });
  });

  describe('Edge cases', () => {
    beforeEach(() => {
      // Set valid credentials for edge case tests
      mockEnv.AZURE_DI_ENDPOINT = 'https://test.cognitiveservices.azure.com/';
      mockEnv.AZURE_DI_KEY = 'test-key-123';
    });

    it('should handle Azure result with no languages detected', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const buffer = Buffer.from('fake-document-content');
      const azureResult = createAzureAnalyzeResult({
        languages: undefined,
      });

      mockPollUntilDone.mockResolvedValue(azureResult);
      mockBeginAnalyzeDocument.mockResolvedValue({ pollUntilDone: mockPollUntilDone });

      const result = await processor.extractText(buffer, 'no-language.pptx');

      expect(result.metadata.languages).toBeUndefined();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          languagesDetected: 0,
        }),
        'Azure DI extraction completed successfully'
      );
    });

    it('should handle Azure result with no pages (edge case)', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const buffer = Buffer.from('fake-document-content');
      const azureResult = createAzureAnalyzeResult({
        pages: undefined,
      });

      mockPollUntilDone.mockResolvedValue(azureResult);
      mockBeginAnalyzeDocument.mockResolvedValue({ pollUntilDone: mockPollUntilDone });

      const result = await processor.extractText(buffer, 'no-pages.pptx');

      expect(result.metadata.pageCount).toBeUndefined();
      expect(result.metadata.pages).toBeUndefined();
    });

    it('should handle very large document buffers', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const largeBuffer = Buffer.alloc(50 * 1024 * 1024); // 50 MB
      const azureResult = createAzureAnalyzeResultMultiPage();

      mockPollUntilDone.mockResolvedValue(azureResult);
      mockBeginAnalyzeDocument.mockResolvedValue({ pollUntilDone: mockPollUntilDone });

      const result = await processor.extractText(largeBuffer, 'large.pptx');

      expect(result.text).toBe('Page 1 content.\n\nPage 2 content.');
      expect(result.metadata.fileSize).toBe(50 * 1024 * 1024);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'large.pptx',
          fileSize: 50 * 1024 * 1024,
        }),
        'Starting Azure DI extraction'
      );
    });

    it('should handle document with empty text content', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const buffer = Buffer.from('fake-document-content');
      const azureResult = createAzureAnalyzeResult({
        content: '',
      });

      mockPollUntilDone.mockResolvedValue(azureResult);
      mockBeginAnalyzeDocument.mockResolvedValue({ pollUntilDone: mockPollUntilDone });

      const result = await processor.extractText(buffer, 'empty-content.pptx');

      expect(result.text).toBe('');
      expect(result.metadata.pageCount).toBe(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          textLength: 0,
        }),
        'Azure DI extraction completed successfully'
      );
    });

    it('should work with PDF files (not only PPTX) since it is format-agnostic', async () => {
      const processor = new AzureDocIntelligenceProcessor();
      const buffer = Buffer.from('fake-pdf-content');
      const azureResult = createAzureAnalyzeResult();

      mockPollUntilDone.mockResolvedValue(azureResult);
      mockBeginAnalyzeDocument.mockResolvedValue({ pollUntilDone: mockPollUntilDone });

      // AzureDocIntelligenceProcessor is generic — it works with any Azure DI-supported format
      const result = await processor.extractText(buffer, 'document.pdf');

      expect(result.text).toBe('This is extracted text from a document.');
      expect(result.metadata.pageCount).toBe(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: 'document.pdf' }),
        'Starting Azure DI extraction'
      );
    });
  });
});
