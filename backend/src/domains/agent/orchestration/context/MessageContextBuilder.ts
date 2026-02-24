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
import type { IFileContextPreparer, FileContextPreparationResult } from '@domains/agent/context';
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
  /** KB image IDs for direct vision */
  visionFileIds?: string[];
  /** Enable web search capability — supervisor will be hinted to prefer research-agent */
  enableWebSearch?: boolean;
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
      };
    };
  };
  /** File context result for tracking */
  contextResult: FileContextPreparationResult;
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
  if (langChainBlocks.length > 0) {
    // Use multi-modal format with content array
    const contentBlocks: ContentBlockItem[] = [];

    // Add document/image blocks first
    contentBlocks.push(...langChainBlocks);

    // Add context text if present
    if (contextResult.contextText) {
      contentBlocks.push({ type: 'text', text: contextResult.contextText });
    }

    // Add the user prompt last
    contentBlocks.push({ type: 'text', text: prompt });

    return contentBlocks;
  } else {
    // Use simple string format (original behavior)
    return contextResult.contextText
      ? `${contextResult.contextText}\n\n${prompt}`
      : prompt;
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
 * @returns Graph inputs object
 */
export function buildGraphInputs(
  messageContent: MessageContent,
  userId: string | undefined,
  sessionId: string,
  contextResult: FileContextPreparationResult,
  options?: MessageContextOptions
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

    // Step 2b: Resolve vision files (KB images sent directly to Anthropic)
    if (options?.visionFileIds?.length && userId) {
      const visionBlocks = await this.resolveVisionFiles(userId, options.visionFileIds);
      for (const block of visionBlocks) {
        anthropicBlocks.push(block);
      }
      logger.debug(
        { sessionId, visionCount: visionBlocks.length },
        'Resolved vision files for message'
      );
    }

    // Step 3: Convert to LangChain format
    const langChainBlocks = convertToLangChainFormat(anthropicBlocks);

    // Step 4: Build message content
    const messageContent = buildMessageContent(prompt, contextResult, langChainBlocks);

    // Step 5: Build graph inputs
    const inputs = buildGraphInputs(messageContent, userId, sessionId, contextResult, options);

    return { inputs, contextResult };
  }

  /**
   * Resolve KB image files for direct vision.
   * Downloads from blob storage and converts to base64 image blocks.
   */
  private async resolveVisionFiles(
    userId: string,
    fileIds: string[]
  ): Promise<AnthropicAttachmentContentBlock[]> {
    const { getFileService } = await import('@/services/files/FileService');
    const { getFileUploadService } = await import('@/services/files/FileUploadService');
    const { isImageMimeType } = await import('@bc-agent/shared');

    const blocks: AnthropicAttachmentContentBlock[] = [];
    const fileService = getFileService();
    const uploadService = getFileUploadService();

    for (const fileId of fileIds) {
      try {
        const file = await fileService.getFile(userId, fileId);
        if (!file || !isImageMimeType(file.mimeType)) {
          logger.warn({ fileId, userId }, 'Vision file not found or not an image, skipping');
          continue;
        }

        // Skip oversized files (30MB limit for Anthropic)
        if (file.sizeBytes > 30 * 1024 * 1024) {
          logger.warn({ fileId, sizeBytes: file.sizeBytes }, 'Vision file too large, skipping');
          continue;
        }

        const buffer = await uploadService.downloadFromBlob(file.blobPath);
        const base64Data = buffer.toString('base64');

        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: file.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: base64Data,
          },
        });
      } catch (error) {
        const errorInfo = error instanceof Error
          ? { message: error.message, name: error.name }
          : { value: String(error) };
        logger.warn({ fileId, userId, error: errorInfo }, 'Failed to resolve vision file, skipping');
      }
    }

    return blocks;
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
