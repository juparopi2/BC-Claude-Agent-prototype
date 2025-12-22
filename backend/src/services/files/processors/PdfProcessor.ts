/**
 * PDF Document Processor
 *
 * Handles PDF files using Azure Document Intelligence (prebuilt-read model).
 * Extracts text content, page information, language detection, and OCR metadata.
 *
 * @module services/files/processors/PdfProcessor
 */

import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer';
import { createChildLogger } from '@/shared/utils/logger';
import { env } from '@/infrastructure/config/environment';
import type { DocumentProcessor, ExtractionResult } from './types';
import { fromAzureAnalyzeResult } from './types';

const logger = createChildLogger({ service: 'PdfProcessor' });

/**
 * PDF Document Processor
 *
 * Uses Azure Document Intelligence prebuilt-read model to extract text from PDFs.
 * Handles OCR for scanned documents automatically.
 */
export class PdfProcessor implements DocumentProcessor {
  private client: DocumentAnalysisClient | null = null;

  /**
   * Get or create Azure Document Intelligence client
   *
   * @returns Configured DocumentAnalysisClient
   * @throws {Error} If Azure Document Intelligence credentials are not configured
   */
  private getClient(): DocumentAnalysisClient {
    if (!this.client) {
      const endpoint = env.AZURE_DI_ENDPOINT;
      const key = env.AZURE_DI_KEY;

      if (!endpoint || !key) {
        throw new Error(
          'Azure Document Intelligence credentials not configured. ' +
            'Please set AZURE_DI_ENDPOINT and AZURE_DI_KEY environment variables.'
        );
      }

      logger.debug({ endpoint }, 'Creating Azure Document Intelligence client');
      this.client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));
    }

    return this.client;
  }

  /**
   * Extract text from PDF document
   *
   * @param buffer - PDF file content as Buffer
   * @param fileName - Original filename (for logging/context)
   * @returns Extraction result with text, page info, languages, and OCR metadata
   * @throws {Error} If Azure Document Intelligence analysis fails or credentials are missing
   *
   * @example
   * ```typescript
   * const processor = new PdfProcessor();
   * const result = await processor.extractText(pdfBuffer, 'invoice.pdf');
   * console.log(result.text); // Extracted text content
   * console.log(result.metadata.pageCount); // Number of pages
   * console.log(result.metadata.ocrUsed); // Whether OCR was used
   * ```
   */
  async extractText(buffer: Buffer, fileName: string): Promise<ExtractionResult> {
    logger.info({ fileName, fileSize: buffer.length }, 'Starting PDF extraction');

    try {
      // Validate buffer
      if (!buffer || buffer.length === 0) {
        throw new Error('Buffer is empty or undefined');
      }

      // Get Azure Document Intelligence client
      const client = this.getClient();

      logger.debug({ fileName }, 'Calling Azure Document Intelligence with prebuilt-read model');

      // Analyze document with prebuilt-read model
      const poller = await client.beginAnalyzeDocument('prebuilt-read', buffer);
      const azureResult = await poller.pollUntilDone();

      logger.debug(
        {
          fileName,
          modelId: azureResult.modelId,
          apiVersion: azureResult.apiVersion,
          pageCount: azureResult.pages?.length,
        },
        'Azure Document Intelligence analysis completed'
      );

      // Convert Azure result to ExtractionResult using canonical converter
      const result = fromAzureAnalyzeResult(azureResult, buffer.length);

      // Log extraction metrics
      logger.info(
        {
          fileName,
          pageCount: result.metadata.pageCount,
          textLength: result.text.length,
          ocrUsed: result.metadata.ocrUsed,
          languagesDetected: result.metadata.languages?.length || 0,
          fileSize: buffer.length,
        },
        'PDF extraction completed successfully'
      );

      return result;
    } catch (error) {
      logger.error(
        {
          fileName,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        'PDF extraction failed'
      );

      // Enhance error message with context
      const errorMessage =
        error instanceof Error
          ? `Failed to extract text from PDF ${fileName}: ${error.message}`
          : `Failed to extract text from PDF ${fileName}: ${String(error)}`;

      throw new Error(errorMessage);
    }
  }
}
