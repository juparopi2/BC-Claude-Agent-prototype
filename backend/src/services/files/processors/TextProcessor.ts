/**
 * Text Document Processor
 *
 * Handles plain text files (txt, csv, md, etc.).
 * Simply decodes buffer as UTF-8 text.
 *
 * @module services/files/processors/TextProcessor
 */

import { createChildLogger } from '@/shared/utils/logger';
import type { DocumentProcessor, ExtractionResult } from './types';

const logger = createChildLogger({ service: 'TextProcessor' });

/**
 * Text Document Processor
 *
 * Extracts text from plain text files by decoding UTF-8 buffer.
 */
export class TextProcessor implements DocumentProcessor {
  /**
   * Extract text from plain text document
   *
   * @param buffer - File content as Buffer
   * @param fileName - Original filename (for logging/context)
   * @returns Extraction result with decoded text and metadata
   * @throws {Error} If UTF-8 decoding fails or buffer is empty
   */
  async extractText(buffer: Buffer, fileName: string): Promise<ExtractionResult> {
    // Validate buffer first (before accessing .length)
    if (!buffer || buffer.length === 0) {
      logger.error({ fileName }, 'Buffer is empty or undefined');
      throw new Error(
        `Failed to extract text from ${fileName}: Buffer is empty or undefined`
      );
    }

    logger.info({ fileName, fileSize: buffer.length }, 'Starting text extraction');

    try {

      // Decode UTF-8 text
      const text = buffer.toString('utf-8');

      // Trim whitespace
      const trimmedText = text.trim();

      // Validate extracted text
      if (trimmedText.length === 0) {
        logger.warn({ fileName }, 'Extracted text is empty after trimming');
      }

      const result: ExtractionResult = {
        text: trimmedText,
        metadata: {
          fileSize: buffer.length,
          ocrUsed: false,
        },
      };

      logger.info(
        {
          fileName,
          textLength: trimmedText.length,
          fileSize: buffer.length,
        },
        'Text extraction completed successfully'
      );

      return result;
    } catch (error) {
      logger.error(
        {
          fileName,
          error: error instanceof Error ? error.message : String(error),
        },
        'Text extraction failed'
      );

      throw new Error(
        `Failed to extract text from ${fileName}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
