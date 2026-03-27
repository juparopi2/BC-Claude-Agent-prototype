/**
 * @module domains/agent/orchestration/context/MessageContextBuilder
 *
 * Builds message context including file attachments and multi-modal content.
 * Extracted from AgentOrchestrator (lines 168-249).
 *
 * ## Responsibilities
 *
 * 1. Prepare file context via FileContextPreparer
 * 2. Resolve chat attachments to Anthropic content blocks
 * 3. Convert to LangChain-compatible format
 * 4. Build HumanMessage with multi-modal content if needed
 * 5. Build graph inputs with context and options
 *
 * @example
 * ```typescript
 * const builder = new MessageContextBuilder(fileContextPreparer, attachmentResolver);
 * const { inputs, contextResult } = await builder.build(prompt, userId, sessionId, options);
 * const result = await graph.invoke(inputs);
 * ```
 */

import { HumanMessage, type MessageContent as LCMessageContent } from '@langchain/core/messages';
import type { LangChainContentBlock, AnthropicAttachmentContentBlock, AttachmentRoutingMetadata, SessionFileReference } from '@bc-agent/shared';
import type { IFileContextPreparer, FileContextPreparationResult, MentionScope } from '@domains/agent/context';
import type { AttachmentContentResolver } from '@/domains/chat-attachments';
import { convertToLangChainFormat } from '@shared/providers/utils/content-format';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'MessageContextBuilder' });

/**
 * Content block item for multi-modal message arrays.
 */
type ContentBlockItem = { type: 'text'; text: string } | LangChainContentBlock;

/**
 * Content for a message: either a simple string or an array of content blocks.
 */
type MessageContent = string | ContentBlockItem[];

/**
 * Options for building message context.
 */
export interface MessageContextOptions {
  /** File attachment IDs to include as context */
  attachments?: string[];
  /** Enable automatic semantic search */
  enableAutoSemanticSearch?: boolean;
  /** Chat attachment IDs to resolve and send to Anthropic */
  chatAttachments?: string[];
  /** Enable extended thinking */
  enableThinking?: boolean;
  /** Token budget for extended thinking */
  thinkingBudget?: number;
  /** Target agent ID for explicit agent selection */
  targetAgentId?: string;
  /** File/folder IDs from @mentions to scope semantic search */
  mentionedFileIds?: string[];
  /**
   * Rich mention metadata from the chat message (FileMention[]).
   * When provided alongside mentionedFileIds, used by MentionScopeResolver for
   * accurate resolution (site mentions, deduplication, accurate counts).
   */
  mentions?: Array<{
    fileId: string;
    name: string;
    isFolder: boolean;
    type?: 'file' | 'folder' | 'site';
    siteId?: string;
  }>;
  /** Enable web search capability — supervisor will be hinted to prefer research-agent */
  enableWebSearch?: boolean;
}

/**
 * Image embedding for a chat attachment (used by find_similar_images tool).
 */
export interface ChatImageEmbedding {
  attachmentId: string;
  name: string;
  embedding: number[];
}

/**
 * Result of building message context.
 */
export interface MessageContextBuildResult {
  /** Graph inputs ready for invoke() */
  inputs: {
    messages: HumanMessage[];
    activeAgent: string;
    context: {
      userId?: string;
      sessionId: string;
      fileContext: FileContextPreparationResult;
      options: {
        enableThinking: boolean;
        thinkingBudget: number;
        targetAgentId?: string;
        enableWebSearch?: boolean;
        scopeFileIds?: string[];
        /** Pre-built OData scope filter from MentionScopeResolver for RAG tools. */
        scopeFilter?: string;
        chatImageEmbeddings?: ChatImageEmbedding[];
        /** Whether any chat attachment requires sandbox file processing */
        requiresFileProcessing?: boolean;
        /** MIME types of non-native attachments (for supervisor routing hints) */
        nonNativeFileTypes?: string[];
        /** Session-level file references for cross-turn container_upload persistence */
        sessionFileReferences?: SessionFileReference[];
      };
    };
  };
  /** File context result for tracking */
  contextResult: FileContextPreparationResult;
}

/**
 * Build XML annotation describing user @mentions for LLM context.
 * Placed before <documents> so the LLM sees mention intent first.
 *
 * When resolvedMentions are present (from MentionScopeResolver), uses them for
 * accurate counts and site support. Falls back to legacy mentionedFiles otherwise.
 */
function buildMentionsAnnotation(mentionScope: MentionScope): string {
  const lines: string[] = ['<user_mentions>'];

  // Prefer rich ResolvedMention data from MentionScopeResolver
  if (mentionScope.resolvedMentions?.length) {
    for (const rm of mentionScope.resolvedMentions) {
      if (rm.type === 'site') {
        lines.push(`<mention type="site" id="${rm.id}" name="${rm.name}" file_count="${rm.fileCount ?? 0}" />`);
      } else if (rm.type === 'folder') {
        lines.push(`<mention type="folder" id="${rm.id}" name="${rm.name}" descendant_file_count="${rm.descendantFileCount ?? 0}" />`);
      } else {
        lines.push(`<mention type="file" id="${rm.id}" name="${rm.name}" />`);
      }
    }

    // Emit warnings as XML comments so the LLM can see deduplication notices
    if (mentionScope.warnings?.length) {
      for (const w of mentionScope.warnings) {
        lines.push(`<!-- warning: ${w} -->`);
      }
    }
  } else {
    // Legacy fallback: use the old mentionedFiles structure
    for (const m of mentionScope.mentionedFiles) {
      if (m.isFolder) {
        const descendantCount = mentionScope.scopeFileIds.length;
        lines.push(`<mention type="folder" id="${m.fileId}" name="${m.fileName}" descendant_file_count="${descendantCount}" />`);
      } else {
        lines.push(`<mention type="file" id="${m.fileId}" name="${m.fileName}" mime_type="${m.mimeType}" />`);
      }
    }
  }

  lines.push('</user_mentions>');
  return lines.join('\n');
}

/**
 * Build message content with optional multi-modal attachments.
 *
 * @param prompt - User's message prompt
 * @param contextResult - File context from FileContextPreparer
 * @param langChainBlocks - Attachment content blocks in LangChain format
 * @returns Content for HumanMessage (string or array)
 */
export function buildMessageContent(
  prompt: string,
  contextResult: FileContextPreparationResult,
  langChainBlocks: LangChainContentBlock[]
): MessageContent {
  // Build mentions annotation if scope is present
  const mentionsXml = contextResult.mentionScope?.mentionedFiles.length
    ? buildMentionsAnnotation(contextResult.mentionScope)
    : '';

  if (langChainBlocks.length > 0) {
    // Use multi-modal format with content array
    const contentBlocks: ContentBlockItem[] = [];

    // Add document/image blocks first
    contentBlocks.push(...langChainBlocks);

    // Add mentions annotation before context text
    if (mentionsXml) {
      contentBlocks.push({ type: 'text', text: mentionsXml });
    }

    // Add context text if present
    if (contextResult.contextText) {
      contentBlocks.push({ type: 'text', text: contextResult.contextText });
    }

    // Add the user prompt last
    contentBlocks.push({ type: 'text', text: prompt });

    return contentBlocks;
  } else {
    // Use simple string format (original behavior)
    const parts: string[] = [];
    if (mentionsXml) parts.push(mentionsXml);
    if (contextResult.contextText) parts.push(contextResult.contextText);
    parts.push(prompt);
    return parts.join('\n\n');
  }
}

/**
 * Build graph inputs for orchestratorGraph.invoke().
 *
 * @param messageContent - Content for HumanMessage
 * @param userId - User ID for multi-tenant context
 * @param sessionId - Session ID
 * @param contextResult - File context for tracking
 * @param options - Execution options
 * @param chatImageEmbeddings - Pre-computed image embeddings for chat attachments
 * @returns Graph inputs object
 */
export function buildGraphInputs(
  messageContent: MessageContent,
  userId: string | undefined,
  sessionId: string,
  contextResult: FileContextPreparationResult,
  options?: MessageContextOptions,
  chatImageEmbeddings?: ChatImageEmbedding[],
  routingMetadata?: AttachmentRoutingMetadata,
  sessionFileReferences?: SessionFileReference[]
): MessageContextBuildResult['inputs'] {
  return {
    messages: [
      typeof messageContent === 'string'
        ? new HumanMessage(messageContent)
        // ContentBlockItem[] maps to LangChain ContentBlock[] at runtime
        : new HumanMessage({ content: messageContent as unknown as LCMessageContent }),
    ],
    activeAgent: 'supervisor',
    context: {
      userId,
      sessionId,
      fileContext: contextResult,
      options: {
        enableThinking: options?.enableThinking ?? false,
        thinkingBudget: options?.thinkingBudget ?? 10000,
        targetAgentId: options?.targetAgentId,
        enableWebSearch: options?.enableWebSearch,
        scopeFileIds: contextResult.mentionScope?.scopeFileIds,
        // Pass the pre-built OData filter for RAG tools (preferred over raw scopeFileIds)
        scopeFilter: contextResult.mentionScope?.searchFilter ?? undefined,
        chatImageEmbeddings: chatImageEmbeddings?.length ? chatImageEmbeddings : undefined,
        requiresFileProcessing: routingMetadata?.hasContainerUploads,
        nonNativeFileTypes: routingMetadata?.nonNativeTypes?.length
          ? routingMetadata.nonNativeTypes
          : undefined,
        sessionFileReferences: sessionFileReferences?.length ? sessionFileReferences : undefined,
      },
    },
  };
}

/**
 * Builds message context including file attachments.
 */
export class MessageContextBuilder {
  constructor(
    private readonly fileContextPreparer: IFileContextPreparer,
    private readonly attachmentContentResolver: AttachmentContentResolver
  ) {}

  /**
   * Build complete message context for graph execution.
   *
   * @param prompt - User's message prompt
   * @param userId - User ID for multi-tenant context
   * @param sessionId - Session ID
   * @param options - Build options
   * @returns Graph inputs and context result
   */
  async build(
    prompt: string,
    userId: string,
    sessionId: string,
    options?: MessageContextOptions
  ): Promise<MessageContextBuildResult> {
    // Step 1: Prepare file context
    // Pass mentions (rich metadata) alongside mentionedFileIds so MentionScopeResolver
    // can use the full FileMention shape (type, siteId) for accurate resolution.
    const contextResult = await this.fileContextPreparer.prepare(userId, prompt, {
      attachments: options?.attachments,
      enableAutoSemanticSearch: options?.enableAutoSemanticSearch,
      scopeFileIds: options?.mentionedFileIds,
      mentions: options?.mentions,
    });

    // Step 2: Resolve chat attachments to content blocks (with routing classification)
    const anthropicBlocks: AnthropicAttachmentContentBlock[] = [];
    let routingMetadata: AttachmentRoutingMetadata | undefined;
    if (options?.chatAttachments?.length) {
      const resolveResult = await this.attachmentContentResolver.resolve(
        userId,
        options.chatAttachments,
        { includeRoutingMetadata: true }
      );
      for (const resolved of resolveResult.attachments) {
        anthropicBlocks.push(resolved.contentBlock);
      }
      routingMetadata = resolveResult.routingMetadata;
      logger.debug(
        {
          sessionId,
          resolvedCount: resolveResult.attachments.length,
          hasContainerUploads: routingMetadata.hasContainerUploads,
          nonNativeTypes: routingMetadata.nonNativeTypes,
        },
        'Resolved chat attachments for message'
      );
    }

    // Step 2b: Resolve @mentioned individual files to content blocks (images, PDFs, text, binary→container_upload)
    const mentionBlocks: (AnthropicAttachmentContentBlock | { type: 'text'; text: string })[] = [];
    if (contextResult.mentionScope?.mentionedFiles.length && userId) {
      const mentionResult = await this.resolveMentionContentBlocks(
        userId,
        sessionId,
        contextResult.mentionScope.mentionedFiles
      );
      mentionBlocks.push(...mentionResult.blocks);

      // Merge mention routing metadata with chat-attachment routing metadata
      if (mentionResult.routingMetadata) {
        if (!routingMetadata) {
          routingMetadata = mentionResult.routingMetadata;
        } else {
          routingMetadata = {
            hasContainerUploads: routingMetadata.hasContainerUploads || mentionResult.routingMetadata.hasContainerUploads,
            nonNativeTypes: [...new Set([
              ...routingMetadata.nonNativeTypes,
              ...mentionResult.routingMetadata.nonNativeTypes,
            ])],
          };
        }
      }

      logger.debug(
        { sessionId, mentionBlockCount: mentionResult.blocks.length, hasMentionContainerUploads: !!mentionResult.routingMetadata?.hasContainerUploads },
        'Resolved mention content blocks for message'
      );
    }

    // Step 2c: Generate image embeddings for chat attachments (for find_similar_images tool)
    let chatImageEmbeddings: ChatImageEmbedding[] | undefined;
    if (options?.chatAttachments?.length && userId) {
      chatImageEmbeddings = await this.generateChatImageEmbeddings(
        userId,
        sessionId,
        options.chatAttachments
      );
    }

    // Step 2d: Fetch session-level file references for cross-turn container_upload persistence
    let sessionFileReferences: SessionFileReference[] | undefined;
    try {
      const { getChatAttachmentService } = await import('@/domains/chat-attachments');
      const attachmentService = getChatAttachmentService();
      sessionFileReferences = await attachmentService.getSessionFileReferences(userId, sessionId);
      if (sessionFileReferences.length > 0) {
        logger.info(
          { sessionId, count: sessionFileReferences.length },
          'Fetched session file references for cross-turn persistence'
        );
      }
    } catch (err) {
      const errorInfo = err instanceof Error
        ? { message: err.message }
        : { value: String(err) };
      logger.warn(
        { sessionId, error: errorInfo },
        'Failed to fetch session file references, skipping'
      );
    }

    // Step 3: Convert to LangChain format
    // Separate mention text blocks from binary blocks (images/PDFs)
    const mentionTextBlocks = mentionBlocks.filter(
      (b): b is { type: 'text'; text: string } => b.type === 'text'
    );
    const mentionBinaryBlocks = mentionBlocks.filter(
      (b): b is AnthropicAttachmentContentBlock => b.type !== 'text'
    );

    const allAnthropicBlocks = [...anthropicBlocks, ...mentionBinaryBlocks];
    const langChainBlocks = convertToLangChainFormat(allAnthropicBlocks);

    // Add mention text blocks as LangChain text content blocks
    const allLangChainBlocks = [
      ...langChainBlocks,
      ...mentionTextBlocks.map(b => ({ type: 'text' as const, text: b.text })),
    ];

    // Step 4: Build message content
    const messageContent = buildMessageContent(prompt, contextResult, allLangChainBlocks);

    // Step 5: Build graph inputs (includes routing metadata for supervisor hints)
    const inputs = buildGraphInputs(
      messageContent,
      userId,
      sessionId,
      contextResult,
      options,
      chatImageEmbeddings,
      routingMetadata,
      sessionFileReferences
    );

    return { inputs, contextResult };
  }

  /**
   * Resolve @mentioned individual files as LLM content blocks.
   *
   * Iterates mentionedFiles, skipping folders. For each individual file:
   * - Images: base64 image block (max 30MB)
   * - PDFs: base64 document block (max 32MB)
   * - Text-based: text block with file name header (max 10MB)
   * - Binary (docx, xlsx): skipped — already in semantic search context as chunked text
   *
   * Max 5 content blocks to avoid token explosion.
   */
  private async resolveMentionContentBlocks(
    userId: string,
    sessionId: string,
    mentionedFiles: Array<{ fileId: string; fileName: string; mimeType: string; isFolder: boolean }>
  ): Promise<{
    blocks: Array<AnthropicAttachmentContentBlock | { type: 'text'; text: string }>;
    routingMetadata?: AttachmentRoutingMetadata;
  }> {
    const { getFileService } = await import('@/services/files/FileService');
    const { getFileUploadService } = await import('@/services/files/FileUploadService');
    const { isImageMimeType, getAttachmentRoutingCategory } = await import('@bc-agent/shared');

    const TEXT_MIME_TYPES = new Set([
      'text/plain',
      'text/markdown',
      'text/csv',
      'text/html',
      'application/json',
      'text/javascript',
      'text/css',
    ]);

    const MAX_MENTION_BLOCKS = 5;
    const MAX_IMAGE_BYTES = 30 * 1024 * 1024;  // 30MB
    const MAX_PDF_BYTES = 32 * 1024 * 1024;    // 32MB
    const MAX_TEXT_BYTES = 10 * 1024 * 1024;   // 10MB
    const MAX_BINARY_BYTES = 32 * 1024 * 1024; // 32MB Anthropic Files API limit

    const blocks: Array<AnthropicAttachmentContentBlock | { type: 'text'; text: string }> = [];
    let hasContainerUploads = false;
    const nonNativeTypes: string[] = [];
    const fileService = getFileService();
    const uploadService = getFileUploadService();

    for (const mention of mentionedFiles) {
      if (blocks.length >= MAX_MENTION_BLOCKS) {
        logger.warn(
          { userId, limit: MAX_MENTION_BLOCKS },
          'Mention content block limit reached, skipping remaining mentions'
        );
        break;
      }

      // Skip folders — they are used for scoping semantic search, not direct content
      if (mention.isFolder) continue;

      try {
        const file = await fileService.getFile(userId, mention.fileId);
        if (!file) {
          logger.warn({ fileId: mention.fileId, userId }, 'Mentioned file not found, skipping');
          continue;
        }

        if (isImageMimeType(file.mimeType)) {
          // Image block — prefer SAS URL (no download, no checkpoint bloat); fall back to base64 for external files
          if (file.sizeBytes > MAX_IMAGE_BYTES) {
            logger.warn(
              { fileId: mention.fileId, sizeBytes: file.sizeBytes },
              'Mentioned image too large, skipping'
            );
            continue;
          }

          if (file.blobPath) {
            // Preferred: SAS URL (no download, no checkpoint bloat)
            const sasUrl = uploadService.generateReadSasUrl(file.blobPath);
            blocks.push({
              type: 'image',
              source: { type: 'url', url: sasUrl },
            } as AnthropicAttachmentContentBlock);
          } else {
            // External file (OneDrive/SharePoint): download via content provider → base64
            const { getContentProviderFactory } = await import('@/services/connectors');
            const provider = getContentProviderFactory().getProvider(file.sourceType);
            const { buffer } = await provider.getContent(file.id, file.userId);
            blocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: file.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: buffer.toString('base64'),
              },
            } as AnthropicAttachmentContentBlock);
          }
        } else if (file.mimeType === 'application/pdf') {
          // PDF document block — prefer SAS URL; fall back to base64 for external files
          if (file.sizeBytes > MAX_PDF_BYTES) {
            logger.warn(
              { fileId: mention.fileId, sizeBytes: file.sizeBytes },
              'Mentioned PDF too large, skipping'
            );
            continue;
          }

          if (file.blobPath) {
            const sasUrl = uploadService.generateReadSasUrl(file.blobPath);
            blocks.push({
              type: 'document',
              source: { type: 'url', url: sasUrl },
            } as AnthropicAttachmentContentBlock);
          } else {
            // External file (OneDrive/SharePoint): download via content provider → base64
            const { getContentProviderFactory } = await import('@/services/connectors');
            const provider = getContentProviderFactory().getProvider(file.sourceType);
            const { buffer } = await provider.getContent(file.id, file.userId);
            blocks.push({
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: buffer.toString('base64'),
              },
            } as AnthropicAttachmentContentBlock);
          }
        } else if (TEXT_MIME_TYPES.has(file.mimeType)) {
          // Text block
          if (file.sizeBytes > MAX_TEXT_BYTES) {
            logger.warn(
              { fileId: mention.fileId, sizeBytes: file.sizeBytes },
              'Mentioned text file too large, skipping'
            );
            continue;
          }

          let buffer: Buffer;
          if (file.blobPath) {
            buffer = await uploadService.downloadFromBlob(file.blobPath);
          } else {
            // External file (OneDrive/SharePoint): download via content provider
            const { getContentProviderFactory } = await import('@/services/connectors');
            const provider = getContentProviderFactory().getProvider(file.sourceType);
            const result = await provider.getContent(file.id, file.userId);
            buffer = result.buffer;
          }
          const content = buffer.toString('utf-8');
          blocks.push({
            type: 'text',
            text: `[File: ${mention.fileName}]\n${content}`,
          });
        } else if (getAttachmentRoutingCategory(file.mimeType) === 'container_upload') {
          // Binary files (XLSX, DOCX, PPTX) → upload to Anthropic Files API for sandbox access
          if (!file.blobPath) {
            logger.warn(
              { fileId: mention.fileId, sourceType: file.sourceType, mimeType: file.mimeType },
              'Container upload for external file without blobPath not yet supported, falling back to semantic search context'
            );
            continue;
          }
          if (file.sizeBytes > MAX_BINARY_BYTES) {
            logger.warn(
              { fileId: mention.fileId, sizeBytes: file.sizeBytes, mimeType: file.mimeType },
              'Mentioned binary file too large for container upload, falling back to semantic search'
            );
            continue;
          }
          try {
            const { getChatAttachmentService } = await import('@/domains/chat-attachments');
            const attachmentService = getChatAttachmentService();
            const result = await attachmentService.createFromMentionedFile({
              userId,
              sessionId,
              sourceFileId: mention.fileId,
              fileName: mention.fileName,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
              blobPath: file.blobPath!,
            });
            blocks.push({
              type: 'container_upload',
              file_id: result.anthropicFileId,
            } as AnthropicAttachmentContentBlock);
            hasContainerUploads = true;
            nonNativeTypes.push(file.mimeType);
            logger.info(
              {
                fileId: mention.fileId,
                anthropicFileId: result.anthropicFileId,
                mimeType: file.mimeType,
              },
              'Created container upload for @mentioned binary file'
            );
          } catch (uploadError) {
            const uploadErrorInfo = uploadError instanceof Error
              ? { message: uploadError.message, name: uploadError.name }
              : { value: String(uploadError) };
            logger.warn(
              { fileId: mention.fileId, mimeType: file.mimeType, error: uploadErrorInfo },
              'Failed to create container upload for mentioned file, falling back to semantic search'
            );
          }
        } else {
          // Truly unsupported types — skip
          logger.debug(
            { fileId: mention.fileId, mimeType: file.mimeType },
            'Mentioned file type not supported for content blocks, skipping'
          );
        }
      } catch (error) {
        // Token expiration errors should bubble up to trigger reconnect UI
        const { ConnectionTokenExpiredError } = await import('@/services/connectors');
        if (error instanceof ConnectionTokenExpiredError) {
          logger.warn(
            { fileId: mention.fileId, userId, connectionId: (error as unknown as { connectionId?: string }).connectionId },
            'Connection token expired while resolving mention content — re-throwing for reconnect flow'
          );
          throw error;
        }

        const errorInfo = error instanceof Error
          ? { message: error.message, name: error.name }
          : { value: String(error) };
        logger.warn(
          { fileId: mention.fileId, userId, error: errorInfo },
          'Failed to resolve mention content block, skipping'
        );
      }
    }

    return {
      blocks,
      routingMetadata: hasContainerUploads
        ? { hasContainerUploads: true, nonNativeTypes }
        : undefined,
    };
  }

  /**
   * Generate image embeddings for chat attachments.
   * Used by find_similar_images tool for visual similarity search.
   * Only generates embeddings for image MIME types — other types are skipped.
   */
  private async generateChatImageEmbeddings(
    userId: string,
    sessionId: string,
    chatAttachmentIds: string[]
  ): Promise<ChatImageEmbedding[] | undefined> {
    try {
      const { getChatAttachmentService } = await import('@/domains/chat-attachments');
      const { isImageMimeType } = await import('@bc-agent/shared');
      const { getCohereEmbeddingService } = await import('@/services/search/embeddings/CohereEmbeddingService');
      const { getFileUploadService } = await import('@/services/files/FileUploadService');

      const cohereService = getCohereEmbeddingService();
      const attachmentService = getChatAttachmentService();
      const uploadService = getFileUploadService();

      const embeddings: ChatImageEmbedding[] = [];

      for (const attachmentId of chatAttachmentIds) {
        try {
          // Use getAttachmentRecord to access blob_path (not exposed on ParsedChatAttachment)
          const record = await attachmentService.getAttachmentRecord(userId, attachmentId);
          if (!record || !isImageMimeType(record.mime_type)) continue;

          const buffer = await uploadService.downloadFromBlob(record.blob_path);
          const base64Data = buffer.toString('base64');
          const imageEmbedding = await cohereService.embedImage(base64Data, 'search_document', { userId });
          embeddings.push({
            attachmentId,
            name: record.name,
            embedding: imageEmbedding.embedding,
          });
        } catch (err) {
          const errorInfo = err instanceof Error
            ? { message: err.message }
            : { value: String(err) };
          logger.warn(
            { attachmentId, error: errorInfo },
            'Failed to generate image embedding for chat attachment, skipping'
          );
        }
      }

      if (embeddings.length > 0) {
        logger.debug(
          { sessionId, count: embeddings.length },
          'Generated chat image embeddings'
        );
        return embeddings;
      }

      return undefined;
    } catch (err) {
      const errorInfo = err instanceof Error
        ? { message: err.message }
        : { value: String(err) };
      logger.warn(
        { sessionId, error: errorInfo },
        'Failed to initialize embedding service for chat attachments, skipping'
      );
      return undefined;
    }
  }
}

/**
 * Create a MessageContextBuilder instance.
 *
 * @param fileContextPreparer - File context preparer
 * @param attachmentContentResolver - Attachment content resolver
 * @returns MessageContextBuilder instance
 */
export function createMessageContextBuilder(
  fileContextPreparer: IFileContextPreparer,
  attachmentContentResolver: AttachmentContentResolver
): MessageContextBuilder {
  return new MessageContextBuilder(fileContextPreparer, attachmentContentResolver);
}
