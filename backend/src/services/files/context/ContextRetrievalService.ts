/**
 * Context Retrieval Service
 *
 * Phase 5: Chat Integration with Files
 * Retrieves file content based on context strategy for LLM injection.
 *
 * Strategies:
 * - DIRECT_CONTENT: Download from blob (images as base64, text as string)
 * - EXTRACTED_TEXT: Get extracted_text from database
 * - RAG_CHUNKS: Search for relevant chunks using vector similarity
 */

import { ContextStrategyFactory, getContextStrategyFactory } from './ContextStrategyFactory';
import type { FileForStrategy } from './types';
import type {
  RetrievedContent,
  RetrievalOptions,
  MultiRetrievalResult,
  RetrievalFailure,
  FileContent,
  ChunkContent,
} from './retrieval.types';
import type { ParsedFile } from '@/types/file.types';
import type { SearchResult } from '@/services/search/types';
import { createChildLogger } from '@/shared/utils/logger';

/** Interface for FileService dependency */
interface IFileService {
  getFile(userId: string, fileId: string): Promise<ParsedFile | null>;
  getFileWithExtractedText(userId: string, fileId: string): Promise<(ParsedFile & { extractedText: string | null }) | null>;
}

/** Interface for FileUploadService dependency */
interface IFileUploadService {
  downloadFromBlob(blobPath: string): Promise<Buffer>;
}

/** Interface for VectorSearchService dependency */
interface IVectorSearchService {
  search(query: { embedding: number[]; userId: string; top?: number; filter?: string }): Promise<SearchResult[]>;
}

/** Interface for EmbeddingService dependency */
interface IEmbeddingService {
  embedText(text: string): Promise<number[]>;
}

/** MIME types that should be returned as text (not base64) */
const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/html',
  'text/markdown',
  'text/csv',
  'text/xml',
  'application/json',
  'application/xml',
]);

// Note: MAX_DIRECT_SIZE (30MB) is handled by ContextStrategyFactory
// This service trusts the strategy decision

/** Default max chunks for RAG retrieval */
const DEFAULT_MAX_CHUNKS = 5;

/** Default max total tokens */
const DEFAULT_MAX_TOTAL_TOKENS = 100000;

export class ContextRetrievalService {
  private strategyFactory: ContextStrategyFactory;
  private fileService: IFileService;
  private fileUploadService: IFileUploadService;
  private vectorSearchService: IVectorSearchService;
  private embeddingService: IEmbeddingService;
  private log = createChildLogger({ service: 'ContextRetrievalService' });

  constructor(
    fileService: IFileService,
    fileUploadService: IFileUploadService,
    vectorSearchService: IVectorSearchService,
    embeddingService: IEmbeddingService,
    strategyFactory?: ContextStrategyFactory
  ) {
    this.fileService = fileService;
    this.fileUploadService = fileUploadService;
    this.vectorSearchService = vectorSearchService;
    this.embeddingService = embeddingService;
    this.strategyFactory = strategyFactory ?? getContextStrategyFactory();
  }

  /**
   * Retrieves content for a single file based on optimal strategy
   *
   * @param userId - User ID for ownership validation
   * @param file - File metadata
   * @param options - Retrieval options (userQuery for RAG, etc.)
   * @returns Retrieved content with strategy used
   */
  async retrieveContent(
    userId: string,
    file: ParsedFile,
    options: RetrievalOptions = {}
  ): Promise<RetrievedContent> {
    const fileForStrategy: FileForStrategy = {
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      hasExtractedText: file.hasExtractedText,
      embeddingStatus: file.embeddingStatus,
    };

    const { strategy, reason } = this.strategyFactory.selectStrategy(fileForStrategy);
    this.log.debug({ fileId: file.id, strategy, reason }, 'Selected context strategy');

    // For RAG strategy without query, fallback to extracted text
    if (strategy === 'RAG_CHUNKS' && !options.userQuery) {
      this.log.debug({ fileId: file.id }, 'No query for RAG, falling back to EXTRACTED_TEXT');
      return this.retrieveExtractedText(userId, file);
    }

    switch (strategy) {
      case 'DIRECT_CONTENT':
        return this.retrieveDirectContent(userId, file);

      case 'EXTRACTED_TEXT':
        return this.retrieveExtractedText(userId, file);

      case 'RAG_CHUNKS':
        return this.retrieveRagChunks(userId, file, options);

      default:
        throw new Error(`Unknown strategy: ${strategy}`);
    }
  }

  /**
   * Retrieves content for multiple files
   *
   * @param userId - User ID for ownership validation
   * @param files - Array of file metadata
   * @param options - Retrieval options
   * @returns Retrieved contents and any failures
   */
  async retrieveMultiple(
    userId: string,
    files: ParsedFile[],
    options: RetrievalOptions = {}
  ): Promise<MultiRetrievalResult> {
    const contents: RetrievedContent[] = [];
    const failures: RetrievalFailure[] = [];
    let totalTokens = 0;
    let truncated = false;

    const maxTotalTokens = options.maxTotalTokens ?? DEFAULT_MAX_TOTAL_TOKENS;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;

      try {
        const content = await this.retrieveContent(userId, file, options);

        // Estimate tokens for this content
        const contentTokens = this.estimateTokens(content);

        // Check if adding this would exceed limit
        // Always include at least the first successful file
        if (contents.length > 0 && totalTokens + contentTokens > maxTotalTokens) {
          this.log.warn(
            { fileId: file.id, totalTokens, contentTokens, maxTotalTokens },
            'Token limit reached, truncating remaining files'
          );
          truncated = true;
          break;
        }

        contents.push(content);
        totalTokens += contentTokens;

        // Check if we've exceeded limit after adding (for logging/truncation flag)
        if (totalTokens > maxTotalTokens && i < files.length - 1) {
          this.log.warn(
            { totalTokens, maxTotalTokens, remainingFiles: files.length - i - 1 },
            'Token limit exceeded, will truncate remaining files'
          );
          truncated = true;
          break;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.log.error({ fileId: file.id, error: errorMessage }, 'Failed to retrieve file content');
        failures.push({
          fileId: file.id,
          fileName: file.name,
          reason: errorMessage,
        });
      }
    }

    return {
      contents,
      failures,
      totalTokens,
      truncated,
    };
  }

  /**
   * Retrieves direct content from blob storage
   */
  private async retrieveDirectContent(_userId: string, file: ParsedFile): Promise<RetrievedContent> {
    const buffer = await this.fileUploadService.downloadFromBlob(file.blobPath);

    // Determine if this should be text or base64
    const isTextType = TEXT_MIME_TYPES.has(file.mimeType) || file.mimeType.startsWith('text/');
    const isImage = file.mimeType.startsWith('image/');

    let content: FileContent;

    if (isImage) {
      // Images always as base64 for Claude Vision
      content = {
        type: 'base64',
        mimeType: file.mimeType,
        data: buffer.toString('base64'),
      };
    } else if (isTextType) {
      // Text files as plain text
      content = {
        type: 'text',
        text: buffer.toString('utf-8'),
      };
    } else {
      // Other files (PDFs, etc.) as base64
      content = {
        type: 'base64',
        mimeType: file.mimeType,
        data: buffer.toString('base64'),
      };
    }

    return {
      fileId: file.id,
      fileName: file.name,
      strategy: 'DIRECT_CONTENT',
      content,
    };
  }

  /**
   * Retrieves extracted text from database
   */
  private async retrieveExtractedText(userId: string, file: ParsedFile): Promise<RetrievedContent> {
    const fileWithText = await this.fileService.getFileWithExtractedText(userId, file.id);

    if (!fileWithText?.extractedText) {
      throw new Error(`Extracted text not found for file ${file.id}`);
    }

    return {
      fileId: file.id,
      fileName: file.name,
      strategy: 'EXTRACTED_TEXT',
      content: {
        type: 'text',
        text: fileWithText.extractedText,
      },
    };
  }

  /**
   * Retrieves relevant chunks via vector search
   */
  private async retrieveRagChunks(
    userId: string,
    file: ParsedFile,
    options: RetrievalOptions
  ): Promise<RetrievedContent> {
    const userQuery = options.userQuery!; // Already validated in retrieveContent
    const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;

    // Generate embedding for query
    const queryEmbedding = await this.embeddingService.embedText(userQuery);

    // Search for relevant chunks in this file
    const searchResults = await this.vectorSearchService.search({
      embedding: queryEmbedding,
      userId,
      top: maxChunks,
      filter: `fileId eq '${file.id}'`,
    });

    const chunks: ChunkContent[] = searchResults.map((result) => ({
      chunkIndex: result.chunkIndex,
      text: result.content,
      relevanceScore: result.score,
    }));

    return {
      fileId: file.id,
      fileName: file.name,
      strategy: 'RAG_CHUNKS',
      content: {
        type: 'chunks',
        chunks,
      },
    };
  }

  /**
   * Estimates token count for retrieved content
   * Uses rough heuristic: ~4 characters per token
   */
  private estimateTokens(content: RetrievedContent): number {
    switch (content.content.type) {
      case 'text':
        return Math.ceil(content.content.text.length / 4);

      case 'chunks':
        return content.content.chunks.reduce(
          (sum, chunk) => sum + Math.ceil(chunk.text.length / 4),
          0
        );

      case 'base64':
        // Base64 images don't count against text token limit in the same way
        // They use their own budgeting in Claude
        return 0;

      default:
        return 0;
    }
  }
}

// Singleton instance
let instance: ContextRetrievalService | null = null;

/**
 * Gets the singleton instance of ContextRetrievalService
 * Note: Requires initialization with dependencies first
 */
export function getContextRetrievalService(): ContextRetrievalService {
  if (!instance) {
    throw new Error('ContextRetrievalService not initialized. Call initContextRetrievalService first.');
  }
  return instance;
}

/**
 * Initializes the singleton instance with dependencies
 */
export function initContextRetrievalService(
  fileService: IFileService,
  fileUploadService: IFileUploadService,
  vectorSearchService: IVectorSearchService,
  embeddingService: IEmbeddingService
): ContextRetrievalService {
  instance = new ContextRetrievalService(
    fileService,
    fileUploadService,
    vectorSearchService,
    embeddingService
  );
  return instance;
}
