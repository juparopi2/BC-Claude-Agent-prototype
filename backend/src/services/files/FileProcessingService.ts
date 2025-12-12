/**
 * File Processing Service
 *
 * Orchestrates document text extraction for uploaded files.
 * Called by MessageQueue background workers via dynamic import.
 *
 * Architecture:
 * - Processor registry maps MIME types to extraction strategies
 * - Downloads files from Azure Blob Storage
 * - Updates database with extracted text and status
 * - Emits WebSocket progress events to connected clients
 *
 * Processors:
 * - PDF: PdfProcessor (Azure Document Intelligence with OCR)
 * - DOCX: DocxProcessor (mammoth.js)
 * - XLSX: ExcelProcessor (xlsx library with markdown formatting)
 * - Plain text: TextProcessor (UTF-8 decoding)
 *
 * WebSocket Events:
 * - `file:processing_progress` - Progress updates (0-100%)
 * - `file:processing_completed` - Success with stats
 * - `file:processing_failed` - Error details
 *
 * @module services/files/FileProcessingService
 */

import { createChildLogger } from '@/utils/logger';
import { FileService } from './FileService';
import { getFileUploadService } from './FileUploadService';
import { getSocketIO, isSocketServiceInitialized } from '@services/websocket/SocketService';
import { getUsageTrackingService } from '@services/tracking/UsageTrackingService';
import { TextProcessor } from './processors/TextProcessor';
import { PdfProcessor } from './processors/PdfProcessor';
import { DocxProcessor } from './processors/DocxProcessor';
import { ExcelProcessor } from './processors/ExcelProcessor';
import { ImageProcessor } from './processors/ImageProcessor';
import type { DocumentProcessor, ExtractionResult } from './processors/types';
import type { FileProcessingJob } from '@services/queue/MessageQueue';
import type { ProcessingStatus } from '@/types/file.types';

const logger = createChildLogger({ service: 'FileProcessingService' });

/**
 * File Processing Service
 *
 * Singleton service that orchestrates document text extraction.
 * Registers processors for different MIME types and routes jobs accordingly.
 */
export class FileProcessingService {
  private static instance: FileProcessingService | null = null;

  /** Processor registry: MIME type → DocumentProcessor */
  private processors: Map<string, DocumentProcessor>;

  private constructor() {
    this.processors = new Map();
    this.registerProcessors();
    logger.info('FileProcessingService initialized');
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): FileProcessingService {
    if (!FileProcessingService.instance) {
      FileProcessingService.instance = new FileProcessingService();
    }
    return FileProcessingService.instance;
  }

  /**
   * Register all document processors
   *
   * Maps MIME types to processor instances.
   * Supports multiple MIME types per processor (e.g., plain text variants).
   */
  private registerProcessors(): void {
    // PDF Processor
    const pdfProcessor = new PdfProcessor();
    this.processors.set('application/pdf', pdfProcessor);

    // DOCX Processor
    const docxProcessor = new DocxProcessor();
    this.processors.set(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      docxProcessor
    );

    // XLSX Processor
    const excelProcessor = new ExcelProcessor();
    this.processors.set(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      excelProcessor
    );

    // Plain Text Processor (multiple MIME types)
    const textProcessor = new TextProcessor();
    const textMimeTypes = [
      'text/plain',
      'text/csv',
      'text/markdown',
      'text/javascript',
      'text/html',
      'text/css',
      'application/json',
    ];

    textMimeTypes.forEach((mimeType) => {
      this.processors.set(mimeType, textProcessor);
    });

    // Image Processor (Azure Computer Vision for embeddings)
    const imageProcessor = new ImageProcessor();
    const imageMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ];

    imageMimeTypes.forEach((mimeType) => {
      this.processors.set(mimeType, imageProcessor);
    });

    logger.info(
      { processorCount: this.processors.size, mimeTypes: Array.from(this.processors.keys()) },
      'Document processors registered'
    );
  }

  /**
   * Process uploaded file
   *
   * Orchestrates the complete processing pipeline:
   * 1. Update status to 'processing'
   * 2. Download blob from storage
   * 3. Extract text using appropriate processor
   * 4. Update database with extracted text and 'completed' status
   * 5. Emit WebSocket events for progress tracking
   *
   * @param job - File processing job from MessageQueue
   * @throws Error if processing fails (will trigger BullMQ retry)
   */
  public async processFile(job: FileProcessingJob): Promise<void> {
    const { fileId, userId, sessionId, mimeType, blobPath, fileName } = job;

    logger.info(
      { fileId, userId, sessionId, mimeType, fileName },
      'Starting file processing'
    );

    try {
      // Step 1: Update status to 'processing' and emit 0% progress
      await this.updateStatus(userId, fileId, 'processing');
      this.emitProgress(sessionId, fileId, 0, 'processing');

      // Step 2: Download blob from storage (emit 20% progress)
      logger.debug({ fileId, blobPath }, 'Downloading blob from storage');
      const fileUploadService = getFileUploadService();
      const buffer = await fileUploadService.downloadFromBlob(blobPath);
      this.emitProgress(sessionId, fileId, 20, 'processing');

      logger.info(
        { fileId, bufferSize: buffer.length },
        'Blob downloaded successfully'
      );

      // Step 3: Get processor for MIME type (emit 30% progress)
      const processor = this.processors.get(mimeType);
      if (!processor) {
        throw new Error(`No processor found for MIME type: ${mimeType}`);
      }
      this.emitProgress(sessionId, fileId, 30, 'processing');

      logger.debug({ fileId, mimeType, processor: processor.constructor.name }, 'Processor selected');

      // Step 4: Extract text (emit 70% progress after completion)
      logger.debug({ fileId, fileName }, 'Extracting text from document');
      const result: ExtractionResult = await processor.extractText(buffer, fileName);
      this.emitProgress(sessionId, fileId, 70, 'processing');

      logger.info(
        {
          fileId,
          textLength: result.text.length,
          pageCount: result.metadata.pageCount,
          ocrUsed: result.metadata.ocrUsed,
        },
        'Text extraction completed'
      );

      // Step 4.5: Track usage for billing (fire-and-forget)
      this.trackExtractionUsage(userId, fileId, mimeType, result).catch((err) => {
        logger.warn({ err, fileId, userId }, 'Failed to track text extraction usage');
      });

      // Step 5: Update database with extracted text and 'completed' status (emit 90% progress)
      await this.updateStatus(userId, fileId, 'completed', result.text);
      this.emitProgress(sessionId, fileId, 90, 'processing');

      // Step 5.5: Enqueue file chunking job (fire-and-forget)
      // This triggers the chunking → embedding → AI Search indexing pipeline
      this.enqueueChunkingJob(userId, fileId, sessionId, mimeType).catch((err) => {
        logger.warn({ err, fileId, userId }, 'Failed to enqueue chunking job');
      });

      // Step 6: Emit completion event (100% progress)
      this.emitCompletion(sessionId, fileId, result);
      logger.info({ fileId, userId }, 'File processing completed successfully');
    } catch (error) {
      // On error: Update status to 'failed' and emit error event
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error(
        {
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
          fileId,
          userId,
          mimeType,
          fileName,
        },
        'File processing failed'
      );

      // Update database status
      await this.updateStatus(userId, fileId, 'failed');

      // Emit error event
      this.emitError(sessionId, fileId, errorMessage);

      // Rethrow to trigger BullMQ retry
      throw error;
    }
  }

  /**
   * Update file processing status in database
   *
   * @param userId - User ID for ownership check
   * @param fileId - File ID
   * @param status - New processing status
   * @param extractedText - Optional extracted text (for 'completed' status)
   */
  private async updateStatus(
    userId: string,
    fileId: string,
    status: ProcessingStatus,
    extractedText?: string
  ): Promise<void> {
    try {
      const fileService = FileService.getInstance();
      await fileService.updateProcessingStatus(userId, fileId, status, extractedText);

      logger.debug({ userId, fileId, status, hasText: !!extractedText }, 'Status updated in database');
    } catch (error) {
      logger.error(
        { error, userId, fileId, status },
        'Failed to update processing status in database'
      );
      throw error;
    }
  }

  /**
   * Emit progress event via WebSocket
   *
   * @param sessionId - Session ID (optional, for WebSocket room targeting)
   * @param fileId - File ID
   * @param progress - Progress percentage (0-100)
   * @param status - Processing status string
   */
  private emitProgress(
    sessionId: string | undefined,
    fileId: string,
    progress: number,
    status: string
  ): void {
    if (!sessionId || !isSocketServiceInitialized()) {
      logger.debug(
        { sessionId, fileId, progress },
        'Skipping progress event: no session or Socket.IO not initialized'
      );
      return;
    }

    try {
      const io = getSocketIO();
      io.to(sessionId).emit('file:processing', {
        type: 'file:processing_progress',
        fileId,
        status,
        progress,
        timestamp: new Date().toISOString(),
      });

      logger.debug({ sessionId, fileId, progress, status }, 'Progress event emitted');
    } catch (error) {
      logger.error({ error, sessionId, fileId, progress }, 'Failed to emit progress event');
      // Don't throw - WebSocket errors should not fail the job
    }
  }

  /**
   * Emit completion event via WebSocket
   *
   * @param sessionId - Session ID (optional, for WebSocket room targeting)
   * @param fileId - File ID
   * @param result - Extraction result with text and metadata
   */
  private emitCompletion(
    sessionId: string | undefined,
    fileId: string,
    result: ExtractionResult
  ): void {
    if (!sessionId || !isSocketServiceInitialized()) {
      logger.debug(
        { sessionId, fileId },
        'Skipping completion event: no session or Socket.IO not initialized'
      );
      return;
    }

    try {
      const io = getSocketIO();
      io.to(sessionId).emit('file:processing', {
        type: 'file:processing_completed',
        fileId,
        status: 'completed',
        stats: {
          textLength: result.text.length,
          pageCount: result.metadata.pageCount || 0,
          ocrUsed: result.metadata.ocrUsed || false,
        },
        progress: 100,
        timestamp: new Date().toISOString(),
      });

      logger.debug({ sessionId, fileId, textLength: result.text.length }, 'Completion event emitted');
    } catch (error) {
      logger.error({ error, sessionId, fileId }, 'Failed to emit completion event');
      // Don't throw - WebSocket errors should not fail the job
    }
  }

  /**
   * Emit error event via WebSocket
   *
   * @param sessionId - Session ID (optional, for WebSocket room targeting)
   * @param fileId - File ID
   * @param errorMessage - Error message
   */
  private emitError(
    sessionId: string | undefined,
    fileId: string,
    errorMessage: string
  ): void {
    if (!sessionId || !isSocketServiceInitialized()) {
      logger.debug(
        { sessionId, fileId },
        'Skipping error event: no session or Socket.IO not initialized'
      );
      return;
    }

    try {
      const io = getSocketIO();
      io.to(sessionId).emit('file:processing', {
        type: 'file:processing_failed',
        fileId,
        status: 'failed',
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });

      logger.debug({ sessionId, fileId, errorMessage }, 'Error event emitted');
    } catch (error) {
      logger.error({ error, sessionId, fileId }, 'Failed to emit error event');
      // Don't throw - WebSocket errors should not fail the job
    }
  }

  /**
   * Track text extraction usage for billing
   *
   * Maps MIME type to processor type and calls UsageTrackingService.
   * This is fire-and-forget - errors are logged but don't fail the job.
   *
   * @param userId - User ID for usage attribution
   * @param fileId - File ID for tracking
   * @param mimeType - MIME type to determine processor cost
   * @param result - Extraction result with metadata
   */
  private async trackExtractionUsage(
    userId: string,
    fileId: string,
    mimeType: string,
    result: ExtractionResult
  ): Promise<void> {
    const usageTrackingService = getUsageTrackingService();

    // Map MIME type to processor type for cost calculation
    const processorType = this.getProcessorTypeFromMimeType(mimeType);

    const pageCount = result.metadata.pageCount || 1;
    const metadata: Record<string, unknown> = {
      processor_type: processorType,
      ocr_used: result.metadata.ocrUsed || false,
      text_length: result.text.length,
      mime_type: mimeType,
    };

    // For Excel, add sheet count if available
    if (processorType === 'excel' && result.metadata.sheetCount) {
      metadata.sheet_count = result.metadata.sheetCount;
    }

    await usageTrackingService.trackTextExtraction(userId, fileId, pageCount, metadata);

    logger.debug(
      { userId, fileId, processorType, pageCount, ocrUsed: metadata.ocr_used },
      'Text extraction usage tracked'
    );
  }

  /**
   * Map MIME type to processor type for cost calculation
   *
   * @param mimeType - File MIME type
   * @returns Processor type: 'pdf' | 'docx' | 'excel' | 'text'
   */
  private getProcessorTypeFromMimeType(mimeType: string): 'pdf' | 'docx' | 'excel' | 'text' {
    switch (mimeType) {
      case 'application/pdf':
        return 'pdf';
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return 'docx';
      case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        return 'excel';
      default:
        // All text-based formats (text/*, application/json, etc.)
        return 'text';
    }
  }

  /**
   * Enqueue file chunking job
   *
   * Triggers the chunking → embedding → AI Search indexing pipeline.
   * This is a fire-and-forget operation - errors are logged but don't fail processing.
   *
   * @param userId - User ID
   * @param fileId - File ID
   * @param sessionId - Session ID (optional)
   * @param mimeType - File MIME type
   */
  private async enqueueChunkingJob(
    userId: string,
    fileId: string,
    sessionId: string | undefined,
    mimeType: string
  ): Promise<void> {
    // Dynamic import to avoid circular dependencies
    const { getMessageQueue } = await import('../queue/MessageQueue');
    const messageQueue = getMessageQueue();

    const jobId = await messageQueue.addFileChunkingJob({
      fileId,
      userId,
      sessionId,
      mimeType,
    });

    logger.info(
      { fileId, userId, jobId, mimeType },
      'File chunking job enqueued'
    );
  }
}

/**
 * Get FileProcessingService singleton instance
 */
export function getFileProcessingService(): FileProcessingService {
  return FileProcessingService.getInstance();
}

/**
 * Reset singleton for testing
 *
 * @internal Only for testing - DO NOT use in production
 */
export function __resetFileProcessingService(): void {
  (FileProcessingService as any).instance = null; // eslint-disable-line @typescript-eslint/no-explicit-any
}
