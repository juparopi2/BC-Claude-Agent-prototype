/**
 * Excel Document Processor
 *
 * Handles Excel files (xlsx, xls) using the xlsx library.
 * Converts sheets to CSV format for readable text extraction.
 *
 * @module services/files/processors/ExcelProcessor
 */

import * as XLSX from 'xlsx';
import { createChildLogger } from '@/shared/utils/logger';
import type { DocumentProcessor, ExtractionResult } from './types';

const logger = createChildLogger({ service: 'ExcelProcessor' });

/**
 * Excel Document Processor
 *
 * Extracts text from Excel files by converting sheets to CSV format.
 * Uses the official xlsx SDK for workbook parsing.
 */
export class ExcelProcessor implements DocumentProcessor {
  /**
   * Extract text from Excel document
   *
   * @param buffer - File content as Buffer
   * @param fileName - Original filename (for logging/context)
   * @returns Extraction result with converted text and metadata
   * @throws {Error} If Excel parsing fails or buffer is invalid
   */
  async extractText(buffer: Buffer, fileName: string): Promise<ExtractionResult> {
    logger.info({ fileName, fileSize: buffer.length }, 'Starting Excel extraction');

    try {
      // 1. Validate buffer
      if (!buffer || buffer.length === 0) {
        throw new Error('Buffer is empty or undefined');
      }

      // 2. Read workbook from buffer
      let workbook: XLSX.WorkBook;
      try {
        workbook = XLSX.read(buffer, { type: 'buffer' });
      } catch (error) {
        throw new Error(
          `Failed to parse Excel file: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Validate workbook structure
      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error('Excel file contains no sheets');
      }

      // 3. Convert each sheet to CSV/text
      const textParts: string[] = [];

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];

        if (!sheet) {
          logger.warn({ fileName, sheetName }, 'Sheet not found in workbook, skipping');
          continue;
        }

        // Add sheet header
        textParts.push(`## Sheet: ${sheetName}\n`);

        // Convert sheet to CSV
        try {
          const csv = XLSX.utils.sheet_to_csv(sheet);

          if (csv.trim().length === 0) {
            textParts.push('(empty sheet)\n');
          } else {
            textParts.push(csv);
            textParts.push('\n'); // Add spacing between sheets
          }
        } catch (error) {
          logger.warn(
            {
              fileName,
              sheetName,
              error: error instanceof Error ? error.message : String(error),
            },
            'Failed to convert sheet to CSV, skipping'
          );
          textParts.push('(failed to read sheet)\n');
        }
      }

      // 4. Concatenate all sheets
      const text = textParts.join('\n').trim();

      // Validate extracted text
      if (text.length === 0) {
        logger.warn({ fileName }, 'Extracted text is empty after processing all sheets');
      }

      // 5. Extract metadata
      const pageCount = workbook.SheetNames.length;
      const title = workbook.Props?.Title;
      const author = workbook.Props?.Author;

      const result: ExtractionResult = {
        text,
        metadata: {
          pageCount,
          title,
          author,
          fileSize: buffer.length,
          ocrUsed: false,
        },
      };

      logger.info(
        {
          fileName,
          textLength: text.length,
          sheetCount: pageCount,
          fileSize: buffer.length,
          hasTitle: !!title,
          hasAuthor: !!author,
        },
        'Excel extraction completed successfully'
      );

      return result;
    } catch (error) {
      logger.error(
        {
          fileName,
          error: error instanceof Error ? error.message : String(error),
        },
        'Excel extraction failed'
      );

      throw new Error(
        `Failed to extract text from Excel file ${fileName}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
