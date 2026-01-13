/**
 * Document Processor Types
 *
 * Shared interfaces for all document processors.
 * Types are derived from official Azure SDK where applicable (source of truth).
 *
 * @module services/files/processors/types
 */

import type {
  AnalyzeResult as AzureAnalyzeResult,
  DocumentStyle,
  DocumentPage,
  DocumentLanguage,
} from '@azure/ai-form-recognizer';

// =============================================================================
// Re-exported Azure SDK Types (Source of Truth)
// =============================================================================

/**
 * Azure Document Intelligence analysis result
 * Re-exported from @azure/ai-form-recognizer for type inference
 */
export type { AzureAnalyzeResult, DocumentStyle, DocumentPage, DocumentLanguage };

/**
 * Subset of Azure AnalyzeResult relevant for text extraction
 * Derived from @azure/ai-form-recognizer AnalyzeResult
 */
export type AzureDocumentResult = Pick<
  AzureAnalyzeResult,
  'content' | 'pages' | 'styles' | 'languages' | 'apiVersion' | 'modelId'
>;

// =============================================================================
// Extraction Metadata (Derived from Azure SDK types)
// =============================================================================

/**
 * OCR detection result derived from DocumentStyle.isHandwritten
 * @see {@link DocumentStyle} from @azure/ai-form-recognizer
 */
export interface OcrDetection {
  /** Whether handwritten content was detected (from DocumentStyle.isHandwritten) */
  hasHandwrittenContent: boolean;
  /** Confidence of OCR detection (from DocumentStyle.confidence) */
  ocrConfidence?: number;
}

/**
 * Page information derived from DocumentPage
 * @see {@link DocumentPage} from @azure/ai-form-recognizer
 */
export interface PageInfo {
  /** 1-based page number (from DocumentPage.pageNumber) */
  pageNumber: number;
  /** Page width (from DocumentPage.width) */
  width?: number;
  /** Page height (from DocumentPage.height) */
  height?: number;
  /** Length unit: 'pixel' for images, 'inch' for PDF (from DocumentPage.unit) */
  unit?: string;
  /** Word count on this page (computed from DocumentPage.words?.length) */
  wordCount?: number;
  /** Line count on this page (computed from DocumentPage.lines?.length) */
  lineCount?: number;
}

/**
 * Language detection result derived from DocumentLanguage
 * @see {@link DocumentLanguage} from @azure/ai-form-recognizer
 */
export interface LanguageDetection {
  /** ISO 639-1 language code or BCP 47 tag (from DocumentLanguage.locale) */
  locale: string;
  /** Confidence of language detection (from DocumentLanguage.confidence) */
  confidence: number;
}

// =============================================================================
// Extraction Result Interface
// =============================================================================

/**
 * Metadata for extracted content
 *
 * Fields are derived from Azure SDK types where applicable:
 * - pageCount: computed from AzureAnalyzeResult.pages.length
 * - ocrUsed: derived from DocumentStyle.isHandwritten
 * - pages: derived from DocumentPage[]
 * - languages: derived from DocumentLanguage[]
 */
export interface ExtractionMetadata {
  /** Number of pages (PDF) or sheets (XLSX), computed from pages.length */
  pageCount?: number;

  /** Document title if available (processor-specific) */
  title?: string;

  /** Document author if available (processor-specific) */
  author?: string;

  /**
   * Whether OCR was used for extraction
   * Derived from DocumentStyle.isHandwritten in Azure results
   */
  ocrUsed?: boolean;

  /** Original file size in bytes */
  fileSize?: number;

  /**
   * Detailed page information
   * Derived from DocumentPage[] in Azure results
   */
  pages?: PageInfo[];

  /**
   * Detected languages
   * Derived from DocumentLanguage[] in Azure results
   */
  languages?: LanguageDetection[];

  /**
   * Azure API version used (for Azure Document Intelligence)
   * From AzureAnalyzeResult.apiVersion
   */
  azureApiVersion?: string;

  /**
   * Azure model ID used (for Azure Document Intelligence)
   * From AzureAnalyzeResult.modelId
   */
  azureModelId?: string;

  /** Processor-specific additional metadata */
  [key: string]: unknown;
}

/**
 * Result of text extraction from a document
 *
 * The `text` field corresponds to:
 * - Azure Document Intelligence: AzureAnalyzeResult.content
 * - Mammoth (DOCX): extracted raw text
 * - XLSX: converted markdown tables
 * - Text files: UTF-8 decoded content
 * - Images: AI-generated caption (D26) or placeholder text like "[Image: filename.jpg]"
 */
export interface ExtractionResult {
  /**
   * Extracted text content
   * For Azure results, this is AzureAnalyzeResult.content
   * For images, this is the AI-generated caption (D26) or a placeholder
   */
  text: string;

  /** Document metadata derived from processor output */
  metadata: ExtractionMetadata;

  /**
   * Image embedding vector (1024 dimensions)
   *
   * Only populated for image files processed by ImageProcessor.
   * Generated via Azure Computer Vision VectorizeImage API.
   * Used for semantic image search in Azure AI Search.
   */
  imageEmbedding?: number[];

  /**
   * AI-generated caption/description for images (D26 feature)
   *
   * Only populated for image files processed by ImageProcessor.
   * Generated via Azure Computer Vision Image Analysis API.
   * Used for improved semantic search relevance in multimodal RAG.
   */
  imageCaption?: string;

  /**
   * Confidence score for the image caption (0-1)
   *
   * Only populated when imageCaption is present.
   */
  imageCaptionConfidence?: number;
}

// =============================================================================
// Document Processor Interface
// =============================================================================

/**
 * Document Processor Interface
 *
 * All processors must implement this interface.
 * The contract ensures consistent output regardless of document type.
 */
export interface DocumentProcessor {
  /**
   * Extract text from document buffer
   *
   * @param buffer - File content as Buffer
   * @param fileName - Original filename (for logging/context)
   * @returns Extraction result with text and metadata
   *
   * @example
   * ```typescript
   * const processor = new PdfProcessor();
   * const result = await processor.extractText(pdfBuffer, 'document.pdf');
   * console.log(result.text); // Extracted text (AzureAnalyzeResult.content)
   * console.log(result.metadata.pageCount); // Number of pages
   * console.log(result.metadata.ocrUsed); // Whether OCR was used
   * ```
   */
  extractText(buffer: Buffer, fileName: string): Promise<ExtractionResult>;
}

// =============================================================================
// Utility Types for Processor Implementations
// =============================================================================

/**
 * Helper to convert Azure DocumentPage to PageInfo
 */
export function toPageInfo(page: DocumentPage): PageInfo {
  return {
    pageNumber: page.pageNumber,
    width: page.width,
    height: page.height,
    unit: page.unit,
    wordCount: page.words?.length,
    lineCount: page.lines?.length,
  };
}

/**
 * Helper to convert Azure DocumentLanguage to LanguageDetection
 */
export function toLanguageDetection(lang: DocumentLanguage): LanguageDetection {
  return {
    locale: lang.locale,
    confidence: lang.confidence,
  };
}

/**
 * Helper to detect if OCR was used from Azure styles
 * Checks DocumentStyle.isHandwritten flag
 */
export function detectOcrUsage(styles?: DocumentStyle[]): boolean {
  if (!styles || styles.length === 0) return false;
  return styles.some((style) => style.isHandwritten === true);
}

/**
 * Convert Azure AnalyzeResult to ExtractionResult
 * This is the canonical way to transform Azure SDK output
 */
export function fromAzureAnalyzeResult(
  result: AzureDocumentResult,
  fileSize?: number
): ExtractionResult {
  return {
    text: result.content,
    metadata: {
      pageCount: result.pages?.length,
      ocrUsed: detectOcrUsage(result.styles),
      pages: result.pages?.map(toPageInfo),
      languages: result.languages?.map(toLanguageDetection),
      azureApiVersion: result.apiVersion,
      azureModelId: result.modelId,
      fileSize,
    },
  };
}
