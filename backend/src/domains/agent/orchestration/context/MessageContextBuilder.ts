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

import { HumanMessage } from '@langchain/core/messages';
import type { LangChainContentBlock, AnthropicAttachmentContentBlock } from '@bc-agent/shared';
import type { IFileContextPreparer, FileContextPreparationResult } from '@domains/agent/context';
import type { AttachmentContentResolver } from '@/domains/chat-attachments';
import { convertToLangChainFormat } from '@shared/providers/utils/content-format';
import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'MessageContextBuilder' });

/**
 * Content block type for message building.
 */
type ContentBlock = string | { type: 'text'; text: string } | LangChainContentBlock;

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
): ContentBlock | ContentBlock[] {
  if (langChainBlocks.length > 0) {
    // Use multi-modal format with content array
    const contentBlocks: ContentBlock[] = [];

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
  messageContent: ContentBlock | ContentBlock[],
  userId: string | undefined,
  sessionId: string,
  contextResult: FileContextPreparationResult,
  options?: MessageContextOptions
): MessageContextBuildResult['inputs'] {
  return {
    messages: [
      typeof messageContent === 'string'
        ? new HumanMessage(messageContent)
        : new HumanMessage({ content: messageContent }),
    ],
    activeAgent: 'orchestrator',
    context: {
      userId,
      sessionId,
      fileContext: contextResult,
      options: {
        enableThinking: options?.enableThinking ?? false,
        thinkingBudget: options?.thinkingBudget ?? 10000,
        targetAgentId: options?.targetAgentId,
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

    // Step 3: Convert to LangChain format
    const langChainBlocks = convertToLangChainFormat(anthropicBlocks);

    // Step 4: Build message content
    const messageContent = buildMessageContent(prompt, contextResult, langChainBlocks);

    // Step 5: Build graph inputs
    const inputs = buildGraphInputs(messageContent, userId, sessionId, contextResult, options);

    return { inputs, contextResult };
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
