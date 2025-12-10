/**
 * Document Processors
 *
 * Barrel export for all document processors.
 * @module services/files/processors
 */

// Types (re-exported from Azure SDK as source of truth)
export type {
  DocumentProcessor,
  ExtractionResult,
  ExtractionMetadata,
  AzureDocumentResult,
  AzureAnalyzeResult,
  DocumentStyle,
  DocumentPage,
  DocumentLanguage,
  PageInfo,
  LanguageDetection,
  OcrDetection,
} from './types';

// Utility functions for Azure SDK type conversions
export {
  toPageInfo,
  toLanguageDetection,
  detectOcrUsage,
  fromAzureAnalyzeResult,
} from './types';

// Processors
export { TextProcessor } from './TextProcessor';
export { PdfProcessor } from './PdfProcessor';
export { DocxProcessor } from './DocxProcessor';
export { ExcelProcessor } from './ExcelProcessor';
