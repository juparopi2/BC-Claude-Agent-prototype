/**
 * @module domains/agent/context/FileContextPreparer
 *
 * Prepares file context for agent prompts.
 * Extracted from DirectAgentService context preparation logic.
 *
 * Coordinates:
 * 1. Validation of explicit file attachments
 * 2. Automatic semantic search (optional)
 * 3. Content retrieval from files
 * 4. Context formatting for prompt injection
 *
 * @example
 * ```typescript
 * const preparer = createFileContextPreparer();
 * const result = await preparer.prepare('user-1', 'How to create invoices?', {
 *   attachments: ['file-1', 'file-2'],
 *   enableAutoSemanticSearch: true,
 * });
 * console.log(result.contextText); // <documents>...</documents>
 * ```
 */

import { createChildLogger } from '@/shared/utils/logger';
import { FileService } from '@/services/files/FileService';
import {
  ContextRetrievalService,
  getContextRetrievalService,
} from '@/services/files/context/ContextRetrievalService';
import {
  FileContextPromptBuilder,
  getFileContextPromptBuilder,
} from '@/services/files/context/PromptBuilder';
import type { ParsedFile } from '@/types/file.types';
import type {
  IFileContextPreparer,
  FileContextOptions,
  FileContextPreparationResult,
  FileReference,
  SearchResult,
} from './types';
import {
  SemanticSearchHandler,
  createSemanticSearchHandler,
} from './SemanticSearchHandler';

export class FileContextPreparer implements IFileContextPreparer {
  private readonly logger = createChildLogger({ service: 'FileContextPreparer' });

  constructor(
    private fileService?: FileService,
    private contextRetrieval?: ContextRetrievalService,
    private promptBuilder?: FileContextPromptBuilder,
    private searchHandler?: SemanticSearchHandler
  ) {
    this.fileService = fileService ?? FileService.getInstance();
    this.promptBuilder = promptBuilder ?? getFileContextPromptBuilder();
    this.searchHandler = searchHandler ?? createSemanticSearchHandler();
    // contextRetrieval is initialized lazily since it requires dependencies
  }

  async prepare(
    userId: string,
    prompt: string,
    options?: FileContextOptions
  ): Promise<FileContextPreparationResult> {
    const attachmentIds = options?.attachments ?? [];
    const enableSemanticSearch = options?.enableAutoSemanticSearch ?? false;

    this.logger.debug(
      {
        userId,
        attachmentCount: attachmentIds.length,
        enableSemanticSearch,
        promptLength: prompt.length,
      },
      'Starting file context preparation'
    );

    // 1. Validate and retrieve explicit attachments
    const attachedFiles = await this.validateAttachments(userId, attachmentIds);

    // 2. Run semantic search if enabled
    let searchResults: SearchResult[] = [];
    if (enableSemanticSearch) {
      searchResults = await this.runSemanticSearch(
        userId,
        prompt,
        attachmentIds,
        options
      );
    }

    // 3. Combine files (deduplicate)
    const allFiles = this.combineFiles(attachedFiles, searchResults);

    // 4. Return empty result if no files
    if (allFiles.length === 0) {
      this.logger.debug({ userId }, 'No files to include in context');
      return {
        contextText: '',
        filesIncluded: [],
        semanticSearchUsed: enableSemanticSearch,
        totalFilesProcessed: 0,
      };
    }

    // 5. Retrieve content
    const retrieval = this.contextRetrieval ?? getContextRetrievalService();
    const parsedFiles = allFiles.map((f) => f.parsedFile);
    const retrievalResult = await retrieval.retrieveMultiple(userId, parsedFiles, {
      userQuery: prompt,
    });

    // 6. Build context XML
    const contextText = this.promptBuilder!.buildDocumentContext(retrievalResult.contents);

    // 7. Build file references for result
    const filesIncluded: FileReference[] = retrievalResult.contents.map((content) => {
      const fileInfo = allFiles.find((f) => f.parsedFile.id === content.fileId);
      const textContent = content.content.type === 'text'
        ? content.content.text
        : content.content.type === 'chunks'
          ? content.content.chunks.map((c) => c.text).join('\n\n')
          : '';

      return {
        id: content.fileId,
        name: content.fileName,
        content: textContent,
        source: fileInfo?.source ?? 'attachment',
        score: fileInfo?.score,
      };
    });

    this.logger.info(
      {
        userId,
        filesIncluded: filesIncluded.length,
        semanticSearchUsed: enableSemanticSearch,
        contextLength: contextText.length,
      },
      'File context preparation completed'
    );

    return {
      contextText,
      filesIncluded,
      semanticSearchUsed: enableSemanticSearch,
      totalFilesProcessed: allFiles.length,
    };
  }

  /**
   * Validates explicit file attachments.
   * Throws if any file is not found or user doesn't have access.
   */
  private async validateAttachments(
    userId: string,
    fileIds: string[]
  ): Promise<Array<{ parsedFile: ParsedFile; source: 'attachment' }>> {
    if (fileIds.length === 0) {
      return [];
    }

    const results: Array<{ parsedFile: ParsedFile; source: 'attachment' }> = [];

    for (const fileId of fileIds) {
      const file = await this.fileService!.getFile(userId, fileId);

      if (!file) {
        this.logger.error(
          { userId, fileId },
          'Attachment file not found or access denied'
        );
        throw new Error(`File not found or access denied: ${fileId}`);
      }

      results.push({ parsedFile: file, source: 'attachment' });
    }

    this.logger.debug(
      { userId, validatedCount: results.length },
      'Attachments validated successfully'
    );

    return results;
  }

  /**
   * Runs semantic search with graceful degradation.
   * Returns empty array on error (doesn't fail the request).
   */
  private async runSemanticSearch(
    userId: string,
    query: string,
    excludeFileIds: string[],
    options?: FileContextOptions
  ): Promise<SearchResult[]> {
    try {
      const results = await this.searchHandler!.search(userId, query, {
        threshold: options?.semanticThreshold,
        maxFiles: options?.maxSemanticFiles,
        excludeFileIds,
      });

      this.logger.debug(
        { userId, resultsCount: results.length },
        'Semantic search completed'
      );

      return results;
    } catch (error) {
      this.logger.error(
        { error, userId },
        'Semantic search failed, continuing without search results'
      );
      return [];
    }
  }

  /**
   * Combines attachments and semantic search results.
   * Deduplicates by fileId (attachments take priority).
   */
  private combineFiles(
    attachments: Array<{ parsedFile: ParsedFile; source: 'attachment' }>,
    searchResults: SearchResult[]
  ): Array<{ parsedFile: ParsedFile; source: 'attachment' | 'semantic_search'; score?: number }> {
    const seen = new Set<string>();
    const combined: Array<{
      parsedFile: ParsedFile;
      source: 'attachment' | 'semantic_search';
      score?: number;
    }> = [];

    // Add attachments first (they take priority)
    for (const attachment of attachments) {
      seen.add(attachment.parsedFile.id);
      combined.push(attachment);
    }

    // Add semantic search results (skip duplicates)
    for (const result of searchResults) {
      if (!seen.has(result.fileId)) {
        seen.add(result.fileId);
        // Create a minimal ParsedFile from search result
        // The actual file data will be retrieved by ContextRetrievalService
        combined.push({
          parsedFile: {
            id: result.fileId,
            name: result.fileName,
            // These fields will be populated when retrieving content
            userId: '',
            mimeType: '',
            sizeBytes: 0,
            blobPath: '',
            hasExtractedText: false,
            embeddingStatus: 'pending',
            createdAt: new Date(),
            updatedAt: new Date(),
            isFavorite: false,
            isFolder: false,
          } as ParsedFile,
          source: 'semantic_search',
          score: result.score,
        });
      }
    }

    return combined;
  }
}

/**
 * Factory function to create FileContextPreparer instances.
 */
export function createFileContextPreparer(
  fileService?: FileService,
  contextRetrieval?: ContextRetrievalService,
  promptBuilder?: FileContextPromptBuilder,
  searchHandler?: SemanticSearchHandler
): FileContextPreparer {
  return new FileContextPreparer(
    fileService,
    contextRetrieval,
    promptBuilder,
    searchHandler
  );
}
