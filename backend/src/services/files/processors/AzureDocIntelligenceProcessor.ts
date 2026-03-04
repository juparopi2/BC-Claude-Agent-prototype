/**
 * Azure Document Intelligence Processor
 *
 * Handles documents using Azure Document Intelligence (prebuilt-read model).
 * Supports PDF and PPTX (each slide = 1 page unit).
 * Extracts text content, page information, language detection, and OCR metadata.
 *
 * Design: Generalizes the original PdfProcessor to support multiple document
 * formats that Azure DI handles natively. DOCX and XLSX retain their own
 * specialized processors (mammoth.js and xlsx) since those are faster and free.
 *
 * @module services/files/processors/AzureDocIntelligenceProcessor
 */

import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer';
import { createChildLogger } from '@/shared/utils/logger';
import { env } from '@/infrastructure/config/environment';
import type { DocumentProcessor, ExtractionResult } from './types';
import { fromAzureAnalyzeResult } from './types';

const logger = createChildLogger({ service: 'AzureDocIntelligenceProcessor' });

/**
 * Azure Document Intelligence Processor
 *
 * Uses Azure Document Intelligence prebuilt-read model to extract text from
 * documents. Handles OCR for scanned documents automatically.
 *
 * Supported formats: PDF, PPTX (and any future format Azure DI supports).
 */
export class AzureDocIntelligenceProcessor implements DocumentProcessor {
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
   * Extract text from a document using Azure Document Intelligence.
   *
   * @param buffer - Document file content as Buffer
   * @param fileName - Original filename (for logging/context)
   * @returns Extraction result with text, page info, languages, and OCR metadata
   * @throws {Error} If Azure Document Intelligence analysis fails or credentials are missing
   */
  async extractText(buffer: Buffer, fileName: string): Promise<ExtractionResult> {
    logger.info({ fileName, fileSize: buffer.length }, 'Starting Azure DI extraction');

    try {
      if (!buffer || buffer.length === 0) {
        throw new Error('Buffer is empty or undefined');
      }

      const client = this.getClient();

      logger.debug({ fileName }, 'Calling Azure Document Intelligence with prebuilt-read model');

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

      const result = fromAzureAnalyzeResult(azureResult, buffer.length);

      logger.info(
        {
          fileName,
          pageCount: result.metadata.pageCount,
          textLength: result.text.length,
          ocrUsed: result.metadata.ocrUsed,
          languagesDetected: result.metadata.languages?.length || 0,
          fileSize: buffer.length,
        },
        'Azure DI extraction completed successfully'
      );

      return result;
    } catch (error) {
      logger.error(
        {
          fileName,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Azure DI extraction failed'
      );

      const errorMessage =
        error instanceof Error
          ? `Failed to extract text from ${fileName}: ${error.message}`
          : `Failed to extract text from ${fileName}: ${String(error)}`;

      throw new Error(errorMessage);
    }
  }
}
