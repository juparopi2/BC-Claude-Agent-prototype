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
import type { LangChainContentBlock, AnthropicAttachmentContentBlock } from '@bc-agent/shared';
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
        chatImageEmbeddings?: ChatImageEmbedding[];
      };
    };
  };
  /** File context result for tracking */
  contextResult: FileContextPreparationResult;
}

/**
 * Build XML annotation describing user @mentions for LLM context.
 * Placed before <documents> so the LLM sees mention intent first.
 */
function buildMentionsAnnotation(mentionScope: MentionScope): string {
  const lines: string[] = ['<user_mentions>'];
  for (const m of mentionScope.mentionedFiles) {
    if (m.isFolder) {
      const descendantCount = mentionScope.scopeFileIds.length;
      lines.push(`<mention type="folder" id="${m.fileId}" name="${m.fileName}" descendant_count="${descendantCount}" />`);
    } else {
      lines.push(`<mention type="file" id="${m.fileId}" name="${m.fileName}" mime_type="${m.mimeType}" />`);
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
  chatImageEmbeddings?: ChatImageEmbedding[]
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
        chatImageEmbeddings: chatImageEmbeddings?.length ? chatImageEmbeddings : undefined,
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
    const contextResult = await this.fileContextPreparer.prepare(userId, prompt, {
      attachments: options?.attachments,
      enableAutoSemanticSearch: options?.enableAutoSemanticSearch,
      scopeFileIds: options?.mentionedFileIds,
    });

    // Step 2: Resolve chat attachments to content blocks
    const anthropicBlocks: AnthropicAttachmentContentBlock[] = [];
    if (options?.chatAttachments?.length) {
      const resolvedAttachments = await this.attachmentContentResolver.resolve(
        userId,
        options.chatAttachments
      );
      for (const resolved of resolvedAttachments) {
        anthropicBlocks.push(resolved.contentBlock);
      }
      logger.debug(
        { sessionId, resolvedCount: resolvedAttachments.length },
        'Resolved chat attachments for message'
      );
    }

    // Step 2b: Resolve @mentioned individual files to content blocks (images, PDFs, text)
    const mentionBlocks: (AnthropicAttachmentContentBlock | { type: 'text'; text: string })[] = [];
    if (contextResult.mentionScope?.mentionedFiles.length && userId) {
      const resolved = await this.resolveMentionContentBlocks(
        userId,
        contextResult.mentionScope.mentionedFiles
      );
      mentionBlocks.push(...resolved);
      logger.debug(
        { sessionId, mentionBlockCount: resolved.length },
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

    // Step 5: Build graph inputs
    const inputs = buildGraphInputs(
      messageContent,
      userId,
      sessionId,
      contextResult,
      options,
      chatImageEmbeddings
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
    mentionedFiles: Array<{ fileId: string; fileName: string; mimeType: string; isFolder: boolean }>
  ): Promise<Array<AnthropicAttachmentContentBlock | { type: 'text'; text: string }>> {
    const { getFileService } = await import('@/services/files/FileService');
    const { getFileUploadService } = await import('@/services/files/FileUploadService');
    const { isImageMimeType } = await import('@bc-agent/shared');

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

    const blocks: Array<AnthropicAttachmentContentBlock | { type: 'text'; text: string }> = [];
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
          // Image block — use SAS URL instead of base64 to avoid checkpoint bloat
          if (file.sizeBytes > MAX_IMAGE_BYTES) {
            logger.warn(
              { fileId: mention.fileId, sizeBytes: file.sizeBytes },
              'Mentioned image too large, skipping'
            );
            continue;
          }
          const sasUrl = uploadService.generateReadSasUrl(file.blobPath);
          blocks.push({
            type: 'image',
            source: {
              type: 'url',
              url: sasUrl,
            },
          } as AnthropicAttachmentContentBlock);
        } else if (file.mimeType === 'application/pdf') {
          // PDF document block — use SAS URL instead of base64 to avoid checkpoint bloat
          if (file.sizeBytes > MAX_PDF_BYTES) {
            logger.warn(
              { fileId: mention.fileId, sizeBytes: file.sizeBytes },
              'Mentioned PDF too large, skipping'
            );
            continue;
          }
          const sasUrl = uploadService.generateReadSasUrl(file.blobPath);
          blocks.push({
            type: 'document',
            source: {
              type: 'url',
              url: sasUrl,
            },
          } as AnthropicAttachmentContentBlock);
        } else if (TEXT_MIME_TYPES.has(file.mimeType)) {
          // Text block
          if (file.sizeBytes > MAX_TEXT_BYTES) {
            logger.warn(
              { fileId: mention.fileId, sizeBytes: file.sizeBytes },
              'Mentioned text file too large, skipping'
            );
            continue;
          }
          const buffer = await uploadService.downloadFromBlob(file.blobPath);
          const content = buffer.toString('utf-8');
          blocks.push({
            type: 'text',
            text: `[File: ${mention.fileName}]\n${content}`,
          });
        } else {
          // Binary files (docx, xlsx, etc.) — skip, already in semantic search context as chunked text
          logger.debug(
            { fileId: mention.fileId, mimeType: file.mimeType },
            'Mentioned binary file skipped (handled via semantic search)'
          );
        }
      } catch (error) {
        const errorInfo = error instanceof Error
          ? { message: error.message, name: error.name }
          : { value: String(error) };
        logger.warn(
          { fileId: mention.fileId, userId, error: errorInfo },
          'Failed to resolve mention content block, skipping'
        );
      }
    }

    return blocks;
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
      const { EmbeddingService } = await import('@/services/embeddings/EmbeddingService');
      const { getFileUploadService } = await import('@/services/files/FileUploadService');

      const embeddingService = EmbeddingService.getInstance();
      const attachmentService = getChatAttachmentService();
      const uploadService = getFileUploadService();

      const embeddings: ChatImageEmbedding[] = [];

      for (const attachmentId of chatAttachmentIds) {
        try {
          // Use getAttachmentRecord to access blob_path (not exposed on ParsedChatAttachment)
          const record = await attachmentService.getAttachmentRecord(userId, attachmentId);
          if (!record || !isImageMimeType(record.mime_type)) continue;

          const buffer = await uploadService.downloadFromBlob(record.blob_path);
          const imageEmbedding = await embeddingService.generateImageEmbedding(
            buffer,
            userId,
            attachmentId,
            { skipTracking: true }
          );
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
