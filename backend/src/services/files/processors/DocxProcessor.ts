/**
 * DOCX Document Processor
 *
 * Handles Microsoft Word .docx files using mammoth library.
 * Extracts raw text from DOCX documents.
 *
 * @module services/files/processors/DocxProcessor
 */

import mammoth from 'mammoth';
import { createChildLogger } from '@/shared/utils/logger';
import type { DocumentProcessor, ExtractionResult } from './types';

const logger = createChildLogger({ service: 'DocxProcessor' });

/**
 * DOCX Document Processor
 *
 * Extracts text from Microsoft Word .docx files using mammoth.
 * Uses mammoth.extractRawText() for simple text extraction without formatting.
 */
export class DocxProcessor implements DocumentProcessor {
  /**
   * Extract text from DOCX document
   *
   * @param buffer - File content as Buffer
   * @param fileName - Original filename (for logging/context)
   * @returns Extraction result with text and metadata
   * @throws {Error} If buffer is invalid or mammoth extraction fails
   */
  async extractText(buffer: Buffer, fileName: string): Promise<ExtractionResult> {
    logger.info({ fileName, fileSize: buffer.length }, 'Starting DOCX extraction');

    try {
      // Validate buffer
      if (!buffer || buffer.length === 0) {
        throw new Error('Buffer is empty or undefined');
      }

      // Extract raw text using mammoth
      const result = await mammoth.extractRawText({ buffer });

      // Log warnings if mammoth encountered any issues
      if (result.messages && result.messages.length > 0) {
        const warnings = result.messages.filter((msg) => msg.type === 'warning');
        const errors = result.messages.filter((msg) => msg.type === 'error');

        if (warnings.length > 0) {
          logger.warn(
            {
              fileName,
              warningCount: warnings.length,
              warnings: warnings.map((w) => w.message),
            },
            'Mammoth reported warnings during extraction'
          );
        }

        if (errors.length > 0) {
          logger.error(
            {
              fileName,
              errorCount: errors.length,
              errors: errors.map((e) => e.message),
            },
            'Mammoth reported errors during extraction'
          );
        }
      }

      // Trim whitespace from extracted text
      const trimmedText = result.value.trim();

      // Validate extracted text
      if (trimmedText.length === 0) {
        logger.warn({ fileName }, 'Extracted text is empty after trimming');
      }

      const extractionResult: ExtractionResult = {
        text: trimmedText,
        metadata: {
          fileSize: buffer.length,
          ocrUsed: false, // mammoth does not use OCR
        },
      };

      logger.info(
        {
          fileName,
          textLength: trimmedText.length,
          fileSize: buffer.length,
          messageCount: result.messages.length,
        },
        'DOCX extraction completed successfully'
      );

      return extractionResult;
    } catch (error) {
      logger.error(
        {
          fileName,
          error: error instanceof Error ? error.message : String(error),
        },
        'DOCX extraction failed'
      );

      throw new Error(
        `Failed to extract text from ${fileName}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
