/**
 * Direct Agent Service - Temporary Workaround for Agent SDK ProcessTransport Bug
 *
 * STATUS: ProcessTransport bug was fixed in Agent SDK v0.1.30+, but we continue using
 * this workaround with vendored MCP tools for reliability and full control.
 *
 * This service uses @anthropic-ai/sdk directly instead of Agent SDK query().
 * It implements manual tool calling loop (agentic loop) with native streaming.
 *
 * Why this approach:
 * - Agent SDK v0.1.29 had a critical ProcessTransport bug (fixed in v0.1.30+)
 * - Vendored MCP tools eliminate external dependencies (115 BC entity files)
 * - Direct API calling provides full control over streaming and tool execution
 * - Proven reliability in production (80-90% better perceived latency)
 *
 * Future Migration: When ready to migrate back to Agent SDK:
 * - See docs/backend/architecture-deep-dive.md for migration guide
 * - This implementation is SDK-compliant (same event types, stop_reason format)
 *
 * Architecture:
 * 1. Load vendored MCP tools from mcp-server/data/ (115 JSON files)
 * 2. Convert MCP tools to Anthropic tool definitions
 * 3. Call Claude API with tools parameter (native streaming)
 * 4. Manually execute tool calls when Claude requests them
 * 5. Send results back to Claude
 * 6. Repeat until Claude is done (agentic loop)
 */

import type {
  MessageParam,
  ToolUseBlock,
  MessageStreamEvent,
  TextBlock,
  ThinkingBlock,
  TextCitation,
} from '@anthropic-ai/sdk/resources/messages';
import { env } from '@/config';
import type { AgentEvent, AgentExecutionResult, UsageEvent } from '@/types';
import type { ApprovalManager } from '../approval/ApprovalManager';
import type { TodoManager } from '../todo/TodoManager';
import type { IAnthropicClient, SystemPromptBlock } from './IAnthropicClient';
import type { Tool } from '@anthropic-ai/sdk/resources/messages';  // ⭐ Use native SDK type
import { AnthropicClient } from './AnthropicClient';
import { randomUUID } from 'crypto';
import { getEventStore } from '../events/EventStore';
import { getMessageService } from '../messages/MessageService';
import { getMessageQueue } from '../queue/MessageQueue';
import { getTokenUsageService } from '../token-usage/TokenUsageService';
import { getUsageTrackingService } from '../tracking/UsageTrackingService';
import { getMessageOrderingService, getMessageEmitter, type IMessageEmitter } from './messages';
import { StreamProcessor } from './messages/StreamProcessor';
import { createChildLogger } from '@/utils/logger';
import type { Logger } from 'pino';
import * as fs from 'fs';
import * as path from 'path';
import { getFileService } from '../files/FileService';
import { getContextRetrievalService } from '../files/context/ContextRetrievalService';
import { getFileContextPromptBuilder } from '../files/context/PromptBuilder';
import { getCitationParser } from '../files/citations/CitationParser';
import { getMessageFileAttachmentService } from '../files/MessageFileAttachmentService';
import { getSemanticSearchService } from '@/services/search/semantic';
import type { FileContextResult, ParsedFile } from '@/types';
import { orchestratorGraph } from '@/modules/agents/orchestrator/graph';
import { HumanMessage } from '@langchain/core/messages';
import { StreamAdapter } from '@/core/langchain/StreamAdapter';

/**
 * Type Definitions for BC Index and MCP Tools
 */

interface BCEndpoint {
  id: string;
  method: string;
  path?: string;
  summary: string;
  operationType: string;
  riskLevel: string;
  requiresHumanApproval?: boolean;
  requiredFields?: string[];
  optionalFields?: string[];
}

interface BCRelationship {
  entity: string;
  type?: string;
}

interface BCIndexEntity {
  entity: string;
  displayName: string;
  description: string;
  operations: string[];
  endpoints: BCEndpoint[];
  relationships?: BCRelationship[];
  commonWorkflows?: BCWorkflow[];
}

interface BCWorkflow {
  name: string;
  description?: string;
  steps: Array<{ operation_id: string; label?: string }>;
}

interface BCIndex {
  entities: BCIndexEntity[];
  operationIndex: Record<string, string>;
}

interface ToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

interface WorkflowValidationResult {
  step_number: number;
  operation_id: string;
  entity: string;
  entity_display_name?: string;
  valid: boolean;
  risk_level: string;
  requires_approval: boolean;
  operation_type?: string;
  issues?: string[];
  dependencies?: string[];
}

/**
 * Valid operation types in BC entities
 * Matches the operations defined in bc_index.json
 */
const VALID_OPERATION_TYPES = ['list', 'get', 'create', 'update', 'delete'] as const;
type ValidOperationType = typeof VALID_OPERATION_TYPES[number];

/**
 * Sanitizes and validates entity name input
 *
 * Security measures:
 * 1. Converts to lowercase for case-insensitive matching
 * 2. Prevents path traversal attacks (../, ..\, etc.)
 * 3. Only allows alphanumeric characters and safe punctuation
 * 4. Limits length to prevent DoS
 *
 * @param entityName - Raw entity name from user input
 * @returns Sanitized entity name or throws error if invalid
 */
function sanitizeEntityName(entityName: unknown): string {
  if (typeof entityName !== 'string') {
    throw new Error('Entity name must be a string');
  }

  const name = entityName.trim().toLowerCase();

  if (name.length === 0) {
    throw new Error('Entity name cannot be empty');
  }

  if (name.length > 100) {
    throw new Error('Entity name too long (max 100 characters)');
  }

  // Check for path traversal attempts
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error('Invalid entity name: path traversal not allowed');
  }

  // Only allow alphanumeric, underscore, and hyphen
  // This matches BC entity naming conventions
  if (!/^[a-z][a-z0-9_-]*$/i.test(name)) {
    throw new Error('Invalid entity name: only alphanumeric characters, underscores, and hyphens allowed');
  }

  return name;
}

/**
 * Sanitizes keyword input for search operations
 *
 * Security measures:
 * 1. Removes potentially dangerous characters
 * 2. Limits length to prevent DoS
 * 3. Trims whitespace
 *
 * @param keyword - Raw keyword from user input
 * @returns Sanitized keyword
 */
function sanitizeKeyword(keyword: unknown): string {
  if (typeof keyword !== 'string') {
    return '';
  }

  let sanitized = keyword.trim();

  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200);
  }

  // Remove characters that could be problematic in string matching
  // Keep alphanumeric, spaces, and common punctuation
  sanitized = sanitized.replace(/[^\w\s\-_.,']/g, '');

  return sanitized.toLowerCase();
}

/**
 * Validates operation type against allowed values
 *
 * @param operationType - Operation type to validate
 * @returns true if valid, false otherwise
 */
function isValidOperationType(operationType: unknown): operationType is ValidOperationType {
  return typeof operationType === 'string' &&
    VALID_OPERATION_TYPES.includes(operationType as ValidOperationType);
}

/**
 * Sanitizes operation_id input
 *
 * @param operationId - Raw operation ID from user input
 * @returns Sanitized operation ID or throws error if invalid
 */
function sanitizeOperationId(operationId: unknown): string {
  if (typeof operationId !== 'string') {
    throw new Error('Operation ID must be a string');
  }

  const id = operationId.trim();

  if (id.length === 0) {
    throw new Error('Operation ID cannot be empty');
  }

  if (id.length > 100) {
    throw new Error('Operation ID too long (max 100 characters)');
  }

  // Operation IDs follow camelCase convention (e.g., "postCustomer", "listSalesInvoices")
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(id)) {
    throw new Error('Invalid operation ID format');
  }

  return id;
}

/**
 * Options for executeQueryStreaming (Phase 1F: Extended Thinking)
 */
export interface ExecuteStreamingOptions {
  /**
   * Enable Extended Thinking mode
   * When enabled, Claude will show its internal reasoning process
   * @default false (uses env.ENABLE_EXTENDED_THINKING as fallback)
   */
  enableThinking?: boolean;
  /**
   * Budget tokens for extended thinking (minimum 1024)
   * Must be less than max_tokens
   * @default 10000
   */
  /**
   * Budget tokens for extended thinking (minimum 1024)
   * Must be less than max_tokens
   * @default 10000
   */
  thinkingBudget?: number;
  /**
   * List of file IDs to attach to the message context
   * @default undefined
   */
  attachments?: string[];
  /**
   * Enable automatic semantic file search when no attachments provided.
   * Set to true to use "Use My Context" feature that searches user's files.
   * @default false
   */
  enableAutoSemanticSearch?: boolean;
  /**
   * Semantic search relevance threshold (0.0 to 1.0)
   * @default 0.7
   */
  semanticThreshold?: number;
  /**
   * Maximum files from semantic search
   * @default 3
   */
  maxSemanticFiles?: number;
}

/**
 * Direct Agent Service
 *
 * Bypasses the buggy Agent SDK by using Anthropic API directly.
 */
export class DirectAgentService {
  private client: IAnthropicClient;
  private approvalManager?: ApprovalManager;
  private mcpDataPath: string;
  private logger: Logger;
  private emitter: IMessageEmitter;
  private toolDataAccumulators: Map<number, {
    name: string;
    id: string;
    args: string;
    sequenceNumber?: number;
  }> = new Map();

  constructor(
    approvalManager?: ApprovalManager,
    _todoManager?: TodoManager,
    client?: IAnthropicClient
  ) {
    // Use dependency injection for testability
    // If no client provided, create real AnthropicClient
    this.client = client || new AnthropicClient({
      apiKey: env.ANTHROPIC_API_KEY || '',
    });
    this.approvalManager = approvalManager;

    // Setup MCP data path
    const mcpServerDir = path.join(process.cwd(), 'mcp-server');
    this.mcpDataPath = path.join(mcpServerDir, 'data', 'v1.0');

    // Initialize child logger with service context
    this.logger = createChildLogger({ service: 'DirectAgentService' });

    // Initialize message emitter
    this.emitter = getMessageEmitter();
  }

  /**
   * Process a stream using StreamProcessor and emit WebSocket events
   *
   * This method integrates StreamProcessor (pure stream processing) with
   * MessageEmitter (WebSocket emission) to avoid duplicating stream processing logic.
   *
   * @param stream - Anthropic MessageStreamEvent async iterable
   * @param sessionId - Session ID for logging and emission
   * @param turnCount - Turn number for logging
   * @returns Object containing processed blocks, token usage, and metadata
   * @private
   */
  private async processStreamWithProcessor(
    stream: AsyncIterable<MessageStreamEvent>,
    sessionId: string,
    turnCount: number
  ): Promise<{
    messageId: string | null;
    model: string | null;
    stopReason: string | null;
    textBlocks: TextBlock[];
    thinkingBlocks: ThinkingBlock[];
    toolUses: ToolUseBlock[];
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    contentBlocks: Map<number, {
      type: string;
      data: unknown;
      citations?: TextCitation[];
      signature?: string;
    }>;
  }> {
    // Initialize StreamProcessor
    const processor = new StreamProcessor({ sessionId, turnCount });

    // Tracking variables for backward compatibility
    let chunkCount = 0;
    const contentBlocks: Map<number, {
      type: string;
      data: unknown;
      citations?: TextCitation[];
      signature?: string;
    }> = new Map();

    // Process the stream and translate StreamEvents to MessageEmitter calls
    for await (const event of processor.processStream(stream)) {
      switch (event.type) {
        case 'message_start':
          // Log message start (already logged by StreamProcessor)
          this.logger.debug({
            messageId: event.messageId,
            model: event.model,
            inputTokens: event.inputTokens,
            cacheRead: event.cacheTokens?.read || 0,
            cacheCreate: event.cacheTokens?.creation || 0,
          }, 'Stream message start');
          break;

        case 'text_chunk':
          // Emit message chunk (transient, no sequence number)
          chunkCount++;
          this.logger.debug({
            sessionId,
            turnCount,
            chunkIndex: chunkCount,
          }, 'Sequence chunk transient - no sequence');

          this.logger.debug({
            sessionId,
            turnCount,
            chunkIndex: chunkCount,
            chunkLength: event.chunk.length,
            timestamp: new Date().toISOString(),
          }, 'Emitting message_chunk (transient)');

          this.emitter.emitMessageChunk(event.chunk, event.index, sessionId);
          this.logger.debug({
            index: event.index,
            chunkLength: event.chunk.length,
          }, 'Stream text_delta');
          break;

        case 'thinking_chunk':
          // Emit thinking chunk (transient)
          this.logger.debug({
            sessionId,
            turnCount,
            chunkLength: event.chunk.length,
          }, 'Emitting thinking_chunk (transient)');

          this.emitter.emitThinkingChunk(event.chunk, event.index, sessionId);
          this.logger.debug({
            index: event.index,
            chunkLength: event.chunk.length,
          }, 'Stream thinking_delta');
          break;

        case 'tool_start':
          // Emit tool use pending (transient)
          this.logger.info({
            sessionId,
            turnCount,
            toolName: event.toolName,
            toolUseId: event.toolId,
            hasId: !!event.toolId,
            idType: typeof event.toolId,
            idValue: event.toolId,
            idLength: event.toolId?.length || 0,
            eventIndex: event.index,
          }, '🔍 [TRACE 1/8] SDK content_block_start');

          this.emitter.emitToolUsePending({
            toolName: event.toolName,
            toolUseId: event.toolId,
            blockIndex: event.index,
          });

          // Initialize tool data accumulator for batch persistence
          this.toolDataAccumulators.set(event.index, {
            name: event.toolName,
            id: event.toolId,
            args: '', // Will be accumulated via tool_input_chunk events
            sequenceNumber: -1,
          });

          this.logger.info('✅ Tool data accumulator initialized (pending persistence)', {
            sessionId,
            toolUseId: event.toolId,
            toolName: event.toolName,
            eventIndex: event.index,
          });

          this.logger.debug({
            index: event.index,
            type: 'tool_use',
          }, 'Stream content_block_start');
          break;

        case 'tool_input_chunk':
          // Accumulate tool args in toolDataAccumulators
          const toolData = this.toolDataAccumulators.get(event.index);
          if (toolData) {
            toolData.args += event.partialJson;
            this.logger.debug({
              sessionId,
              turnCount,
              eventIndex: event.index,
              partialJsonLength: event.partialJson.length,
              accumulatedLength: toolData.args.length,
            }, '🔧 [TOOL_ARGS] Accumulating input_json_delta');
          }
          break;

        case 'block_complete':
          // Block completed - track in contentBlocks for batch persistence
          const completedBlock = event.block;

          if (completedBlock.content.type === 'text') {
            contentBlocks.set(completedBlock.anthropicIndex, {
              type: 'text',
              data: completedBlock.content.text,
              citations: completedBlock.content.citations,
            });
            this.logger.debug({
              index: completedBlock.anthropicIndex,
              textLength: completedBlock.content.text.length,
              citationsCount: completedBlock.content.citations.length,
            }, 'Stream content_block_stop (text)');
          } else if (completedBlock.content.type === 'thinking') {
            contentBlocks.set(completedBlock.anthropicIndex, {
              type: 'thinking',
              data: completedBlock.content.thinking,
              signature: completedBlock.content.signature,
            });
            this.logger.debug({
              index: completedBlock.anthropicIndex,
              contentLength: completedBlock.content.thinking.length,
              hasSignature: !!completedBlock.content.signature,
            }, 'Stream content_block_stop (thinking)');
          } else if (completedBlock.content.type === 'tool_use') {
            contentBlocks.set(completedBlock.anthropicIndex, {
              type: 'tool_use',
              data: {
                id: completedBlock.content.id,
                name: completedBlock.content.name,
                input: completedBlock.content.input,
              },
            });
            this.logger.debug({
              index: completedBlock.anthropicIndex,
              toolName: completedBlock.content.name,
              toolId: completedBlock.content.id,
            }, 'Stream content_block_stop (tool_use)');
          }
          break;

        case 'message_delta':
          this.logger.debug({
            stopReason: event.stopReason,
            outputTokens: event.outputTokens,
          }, 'Stream message_delta');
          break;

        case 'message_stop':
          this.logger.debug('Stream message_stop');
          break;
      }
    }

    // Get final turn result from processor
    const turnResult = processor.getTurnResult();

    // Convert blocks to Anthropic format for backward compatibility
    const textBlocks: TextBlock[] = [];
    const thinkingBlocks: ThinkingBlock[] = [];
    const toolUses: ToolUseBlock[] = [];

    for (const block of turnResult.blocks) {
      if (block.content.type === 'text') {
        textBlocks.push({
          type: 'text',
          text: block.content.text,
          citations: block.content.citations,
        });
      } else if (block.content.type === 'thinking') {
        thinkingBlocks.push({
          type: 'thinking',
          thinking: block.content.thinking,
          signature: block.content.signature,
        });
      } else if (block.content.type === 'tool_use') {
        toolUses.push({
          type: 'tool_use',
          id: block.content.id,
          name: block.content.name,
          input: block.content.input,
        });
      }
    }

    this.logger.debug({
      stopReason: turnResult.stopReason,
      thinkingBlocksCount: thinkingBlocks.length,
      textBlocksCount: textBlocks.length,
      toolUsesCount: toolUses.length,
    }, 'Stream completed');

    return {
      messageId: turnResult.messageId,
      model: turnResult.model,
      stopReason: turnResult.stopReason,
      textBlocks,
      thinkingBlocks,
      toolUses,
      inputTokens: turnResult.usage.inputTokens,
      outputTokens: turnResult.usage.outputTokens,
      cacheCreationInputTokens: turnResult.usage.cacheCreationInputTokens || 0,
      cacheReadInputTokens: turnResult.usage.cacheReadInputTokens || 0,
      contentBlocks,
    };
  }

  /**
   * Execute Query with Direct API Calling
   *
   * Implements manual agentic loop:
   * 1. Send user prompt to Claude with available tools
   * 2. If Claude wants to use a tool, execute it
   * 3. Send tool result back to Claude
   * 4. Repeat until Claude provides final answer
   */

  /**
   * Execute Query with Native Streaming
   *
   * Implements agentic loop with streaming:
   * 1. Stream response from Claude incrementally (text chunks arrive in real-time)
   * 2. Emit message_chunk events as text arrives (for live UI updates)
   * 3. Accumulate complete messages for tools/history
   * 4. Execute tools when stop_reason='tool_use'
   * 5. Repeat until Claude provides final answer (stop_reason='end_turn')
   *
   * Benefits over non-streaming:
   * - 80-90% better perceived latency (Time to First Token < 1s vs 5-10s)
   * - Real-time feedback to user ("typing" effect)
   * - Better UX (user sees progress immediately)
   * - Cancellable (can interrupt mid-generation)
   *
   * @param options.enableThinking - Enable Extended Thinking (Phase 1F)
   * @param options.thinkingBudget - Budget tokens for extended thinking (default: 10000)
   */
  async executeQueryStreaming(
    prompt: string,
    sessionId?: string,
    onEvent?: (event: AgentEvent) => void,
    userId?: string,
    options?: ExecuteStreamingOptions
  ): Promise<AgentExecutionResult> {
    // DIAGNOSTIC LOGGING - Entry point
    this.logger.info({
      sessionId,
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 50),
      hasApiKey: !!env.ANTHROPIC_API_KEY,
      apiKeyLength: env.ANTHROPIC_API_KEY?.length || 0,
      hasOnEvent: !!onEvent,
    }, '🚀 DirectAgentService.executeQueryStreaming CALLED');

    // Validate API key
    if (!env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY.trim() === '') {
      const error = new Error('ANTHROPIC_API_KEY is missing or empty - cannot execute agent');
      this.logger.error({ error: error.message }, '❌ API Key validation failed');
      throw error;
    }

    const startTime = Date.now();
    const conversationHistory: MessageParam[] = [];
    const toolsUsed: string[] = [];
    const accumulatedResponses: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let thinkingTokens = 0; // ⭐ PHASE 1F: Track Extended Thinking tokens
    let modelName: string | undefined; // NEW: Track Claude model name
    // ⭐ Cache token tracking for billing analytics
    let cacheCreationInputTokens = 0;
    let cacheReadInputTokens = 0;
    let serviceTier: 'standard' | 'priority' | 'batch' | undefined;

    try {
      // Validate sessionId is provided (required for event tracking and sequence numbers)
      if (!sessionId) {
        throw new Error('sessionId is required for executeQueryStreaming');
      }

      // Set event callback for MessageEmitter
      if (onEvent) {
        // Cast AgentEvent callback to EmittableEvent callback - they are structurally compatible
        this.emitter.setEventCallback(onEvent as (event: import('./messages').EmittableEvent) => void);
      }

      // Validate attachments and prepare file context (Phase 5 - Chat Integration)
      const validatedFiles: ParsedFile[] = [];
      let fileContext: FileContextResult = {
        documentContext: '',
        systemInstructions: '',
        images: [],
        fileMap: new Map<string, string>(),
      };

      if (options?.attachments && options.attachments.length > 0) {
        if (!userId) {
          throw new Error('UserId required for attachment validation');
        }
        this.logger.info({ userId, count: options.attachments.length }, 'Validating attachments');

        const fileService = getFileService();
        for (const fileId of options.attachments) {
          // Validate ownership and existence
          const file = await fileService.getFile(userId, fileId);
          if (!file) {
            this.logger.warn({ userId, fileId }, 'Invalid attachment or access denied');
            throw new Error(`Access denied or file not found: ${fileId}`);
          }
          validatedFiles.push(file);
        }
        this.logger.info('✅ Attachments validated successfully');

        // Prepare file context for injection into prompt
        fileContext = await this.prepareFileContext(userId, validatedFiles, prompt);
        this.logger.info({
          fileCount: validatedFiles.length,
          hasDocContext: fileContext.documentContext.length > 0,
          hasImages: fileContext.images.length > 0,
        }, '✅ File context prepared');
      } else if (options?.enableAutoSemanticSearch === true && userId) {
        // ========== SEMANTIC SEARCH (Phase 2 - Auto Context) ==========
        // When enableAutoSemanticSearch is TRUE and no manual attachments, search for relevant files
        try {
          const semanticSearchService = getSemanticSearchService();
          const searchResults = await semanticSearchService.searchRelevantFiles({
            userId,
            query: prompt,
            threshold: options?.semanticThreshold,
            maxFiles: options?.maxSemanticFiles ?? 3,
          });

          if (searchResults.results.length > 0) {
            this.logger.info({
              userId,
              queryPreview: prompt.substring(0, 50),
              matchedFiles: searchResults.results.length,
              topScore: searchResults.results[0]?.relevanceScore,
            }, '🔍 Semantic search found relevant files');

            // Convert search results to ParsedFile format for prepareFileContext
            const fileService = getFileService();
            for (const result of searchResults.results) {
              const file = await fileService.getFile(userId, result.fileId);
              if (file) {
                validatedFiles.push(file);
              }
            }

            if (validatedFiles.length > 0) {
              // Prepare file context with semantically matched files
              fileContext = await this.prepareFileContext(userId, validatedFiles, prompt);
              this.logger.info({
                fileCount: validatedFiles.length,
                hasDocContext: fileContext.documentContext.length > 0,
                source: 'semantic_search',
              }, '✅ Semantic file context prepared');
            }
          } else {
            this.logger.debug({
              userId,
              queryPreview: prompt.substring(0, 50),
              threshold: options?.semanticThreshold ?? 0.7,
            }, 'No semantically relevant files found');
          }
        } catch (error) {
          // Don't fail the request if semantic search fails - just log and continue
          this.logger.warn({
            error,
            userId,
            queryPreview: prompt.substring(0, 50)
          }, 'Semantic search failed, continuing without file context');
        }
      }

      // Step 1: Get MCP tools and convert to Anthropic format
      const tools = await this.getMCPToolDefinitions();

      // Step 2: Add user message to history (with document context if available)
      const userMessageContent = fileContext.documentContext
        ? `${fileContext.documentContext}\n\n${prompt}`
        : prompt;
      conversationHistory.push({
        role: 'user',
        content: userMessageContent,
      });

      // ⭐ Phase 4: Send thinking event ONCE per user message (NOT per turn)
      // This event is emitted OUTSIDE the agentic loop to ensure it's sent only once
      // ✅ FIX: Persist BEFORE emitting to ensure sequence consistency
      const eventStore = getEventStore();
      const messageQueue = getMessageQueue();

      const thinkingEvent = await eventStore.appendEvent(
        sessionId,
        'agent_thinking_started',
        {
          content: 'Analyzing your request...',
          started_at: new Date().toISOString(),
        }
      );
      // ⭐ Redis INCR executed ONCE, event persisted in message_events

      this.logger.info('✅ Thinking event appended to EventStore', {
        sessionId,
        eventId: thinkingEvent.id,
        sequenceNumber: thinkingEvent.sequence_number,
      });

      // ✅ STEP 2: Emit AFTER with data from persisted event
      this.emitter.emitThinking({
        content: 'Analyzing your request...',
        eventId: thinkingEvent.id,
        sequenceNumber: thinkingEvent.sequence_number,
        sessionId,
      });


      // Step 3: Agentic Loop with Streaming
      let continueLoop = true;
      let turnCount = 0;
      const maxTurns = 20; // Safety limit
      let lastMessageId: string | null = null; // Track messageId for file usage recording

      while (continueLoop && turnCount < maxTurns) {
        turnCount++;
        this.logger.debug({ turnCount }, 'Turn starting (streaming)');

        // ✅ FIX PHASE 3: NO generar batch sequence
        // Chunks serán emitidos SIN sequence (transient)
        // Complete message será persistido PRIMERO con su propio sequence

        // ========== STREAM CLAUDE RESPONSE ==========
        this.logger.debug({
          turnCount,
          sessionId,
        }, 'Starting turn - no batch sequence (chunks transient)');

        this.logger.info('📡 [SEQUENCE] Starting stream for turn', {
          sessionId,
          turnCount,
          timestamp: new Date().toISOString(),
        });

        let stream;
        try {
          // ⭐ Phase 1F: Build thinking config from options or env
          const enableThinking = options?.enableThinking ?? (env.ENABLE_EXTENDED_THINKING === true);
          const thinkingBudget = options?.thinkingBudget ?? 10000;

          // Determine max_tokens - must be greater than thinkingBudget when thinking is enabled
          const maxTokens = enableThinking
            ? Math.max(16000, thinkingBudget + 4096)  // Ensure enough room for response
            : 4096;

          stream = this.client.createChatCompletionStream({
            model: env.ANTHROPIC_MODEL,
            max_tokens: maxTokens,
            messages: conversationHistory,
            tools: tools,
            system: this.getSystemPromptWithCaching(),
            // ⭐ Phase 1F: Extended Thinking configuration
            thinking: enableThinking
              ? { type: 'enabled' as const, budget_tokens: thinkingBudget }
              : undefined,
          });

          this.logger.info({
            sessionId,
            turnCount,
            enableThinking,
            thinkingBudget: enableThinking ? thinkingBudget : undefined,
            maxTokens,
          }, '✅ Stream created successfully');
        } catch (streamError) {
          this.logger.error({
            sessionId,
            turnCount,
            error: streamError instanceof Error ? streamError.message : String(streamError),
            errorType: streamError instanceof Error ? streamError.constructor.name : typeof streamError,
            errorCode: (streamError as Error & { code?: string })?.code,
            errorSyscall: (streamError as Error & { syscall?: string })?.syscall,
            stack: streamError instanceof Error ? streamError.stack : undefined,
          }, '❌ Stream creation failed');
          throw streamError;
        }

        // ========== USE STREAMPROCESSOR TO HANDLE STREAM EVENTS ==========
        // Process stream using StreamProcessor (eliminates duplicated switch-case logic)
        const streamResult = await this.processStreamWithProcessor(stream, sessionId, turnCount);

        // Extract results from StreamProcessor
        const textBlocks = streamResult.textBlocks;
        const thinkingBlocks = streamResult.thinkingBlocks;
        const toolUses = streamResult.toolUses;
        const stopReason = streamResult.stopReason;
        const messageId = streamResult.messageId;
        const contentBlocks = streamResult.contentBlocks;

        // Reconstruct accumulatedText from textBlocks for backward compatibility
        const accumulatedText = textBlocks.map(block => block.text).join('');

        // Estimate thinking tokens from thinkingBlocks (approximately 4 characters per token)
        const estimatedThinkingTokens = thinkingBlocks.reduce((sum, block) => {
          return sum + Math.ceil(block.thinking.length / 4);
        }, 0);
        thinkingTokens += estimatedThinkingTokens;

        // Update token tracking from stream result
        inputTokens += streamResult.inputTokens;
        outputTokens += streamResult.outputTokens;
        cacheCreationInputTokens += streamResult.cacheCreationInputTokens;
        cacheReadInputTokens += streamResult.cacheReadInputTokens;
        if (streamResult.model) {
          modelName = streamResult.model;
        }
        if (messageId) {
          lastMessageId = messageId; // Track for file usage recording
        }

        // ========== OLD DUPLICATED CODE REMOVED (lines 786-1247) ==========
        // The entire switch(event.type) block has been replaced with StreamProcessor
        // This eliminates ~460 lines of duplicated stream processing logic

        // (Old duplicated switch-case code removed - now using StreamProcessor)

        // ========== NEW FIX: BATCH PERSISTENCE IN CORRECT ORDER ==========
        // ⭐ Only persist if stream completed successfully (has stop_reason)
        if (stopReason && sessionId) {
          // Sort content blocks by index to get correct logical order
          const sortedBlocks = Array.from(contentBlocks.entries())
            .sort(([indexA], [indexB]) => indexA - indexB);

          this.logger.info({
            sessionId,
            turnCount,
            totalBlocks: sortedBlocks.length,
            blockTypes: sortedBlocks.map(([idx, block]) => `${idx}:${block.type}`),
          }, '🔄 [BATCH_PERSIST] Starting batch persistence in index order');

          // Persist each block in index order
          for (const [blockIndex, block] of sortedBlocks) {
            if (block.type === 'text') {
              const textContent = block.data as string;
              if (textContent.trim()) {
                // Persist text block
                const textEvent = await eventStore.appendEvent(
                  sessionId,
                  'agent_message_sent',
                  {
                    content: textContent,
                    block_index: blockIndex,
                    stop_reason: stopReason,
                  }
                );

                // Collect citations for this text block
                const citations = block.citations || [];

                await messageQueue.addMessagePersistence({
                  sessionId,
                  messageId: messageId || `text_${textEvent.id}`,
                  role: 'assistant',
                  messageType: 'text',
                  content: textContent,
                  metadata: {
                    stop_reason: stopReason,
                    block_index: blockIndex,
                    citations: citations.length > 0 ? citations : undefined,
                    citations_count: citations.length > 0 ? citations.length : undefined,
                  },
                  sequenceNumber: textEvent.sequence_number,
                  eventId: textEvent.id,
                  stopReason: stopReason || null,
                  model: modelName,
                  inputTokens,
                  outputTokens,
                });

                this.logger.info({
                  sessionId,
                  blockIndex,
                  sequenceNumber: textEvent.sequence_number,
                  contentLength: textContent.length,
                }, '✅ [BATCH_PERSIST] Text block persisted');

                // Emit WebSocket event with persistence confirmation
                this.emitter.emitMessage({
                  messageId: messageId || `text_${textEvent.id}`,
                  content: textContent,
                  role: 'assistant',
                  stopReason: (stopReason as 'end_turn' | 'tool_use' | 'max_tokens') || undefined,
                  eventId: textEvent.id,
                  sequenceNumber: textEvent.sequence_number,
                  tokenUsage: {
                    inputTokens,
                    outputTokens,
                    cacheCreationInputTokens: cacheCreationInputTokens > 0 ? cacheCreationInputTokens : undefined,
                    cacheReadInputTokens: cacheReadInputTokens > 0 ? cacheReadInputTokens : undefined,
                  },
                  model: modelName,
                  sessionId,
                });
              }
            } else if (block.type === 'tool_use') {
              const toolData = block.data as { id: string; name: string; input: Record<string, unknown> };
              const accumulatorData = this.toolDataAccumulators.get(blockIndex);

              if (accumulatorData) {
                // Parse args from accumulator
                let parsedArgs = {};
                try {
                  if (accumulatorData.args) {
                    parsedArgs = JSON.parse(accumulatorData.args);
                  }
                } catch (e) {
                  this.logger.warn({
                    sessionId,
                    blockIndex,
                    toolUseId: toolData.id,
                    error: e instanceof Error ? e.message : String(e),
                  }, '⚠️ [BATCH_PERSIST] Failed to parse tool args');
                }

                // Persist tool_use block
                const toolEvent = await eventStore.appendEvent(
                  sessionId,
                  'tool_use_requested',
                  {
                    tool_use_id: toolData.id,
                    tool_name: toolData.name,
                    tool_args: parsedArgs,
                    block_index: blockIndex,
                  }
                );

                await messageQueue.addMessagePersistence({
                  sessionId,
                  messageId: toolData.id,
                  role: 'assistant',
                  messageType: 'tool_use',
                  content: '',
                  metadata: {
                    tool_name: toolData.name,
                    tool_args: parsedArgs,
                    tool_use_id: toolData.id,
                    status: 'pending',
                    block_index: blockIndex,
                  },
                  sequenceNumber: toolEvent.sequence_number,
                  eventId: toolEvent.id,
                  toolUseId: toolData.id,
                });

                this.logger.info({
                  sessionId,
                  blockIndex,
                  sequenceNumber: toolEvent.sequence_number,
                  toolName: toolData.name,
                  toolUseId: toolData.id,
                }, '✅ [BATCH_PERSIST] Tool use block persisted');

                // Emit WebSocket event with persistence confirmation
                this.emitter.emitToolUse({
                  toolName: toolData.name,
                  toolUseId: toolData.id,
                  args: parsedArgs,
                  blockIndex: blockIndex,
                  eventId: toolEvent.id,
                  sequenceNumber: toolEvent.sequence_number,
                  sessionId,
                });

                // Clean up accumulator
                this.toolDataAccumulators.delete(blockIndex);
              }
            }
          }

          this.logger.info({
            sessionId,
            turnCount,
            blocksPersisted: sortedBlocks.length,
          }, '🎉 [BATCH_PERSIST] Batch persistence completed successfully');
        }

        // ========== TOKEN TRACKING LOGGING (Phase 1A + 1F) ==========
        this.logger.debug({
          messageId,        // Anthropic ID (e.g., "msg_01ABC...")
          model: modelName, // Model name (e.g., "claude-sonnet-4-5-20250929")
          inputTokens,
          outputTokens,
          thinkingTokens,   // ⭐ PHASE 1F: Extended Thinking tokens (estimated)
          totalTokens: inputTokens + outputTokens,
          cacheCreationInputTokens,
          cacheReadInputTokens,
          serviceTier,
          sessionId,
          turnCount,
        }, 'Token tracking');

        // ========== TOKEN USAGE PERSISTENCE (Billing Analytics) ==========
        // Record token usage for billing analytics (non-blocking)
        if (messageId && modelName && userId) {
          const tokenUsageService = getTokenUsageService();
          const thinkingWasEnabled = options?.enableThinking ?? (env.ENABLE_EXTENDED_THINKING === true);
          const thinkingBudgetUsed = options?.thinkingBudget ?? 10000;
          // Fire-and-forget - don't block the main flow
          tokenUsageService.recordUsage({
            userId,
            sessionId,
            messageId,
            model: modelName,
            inputTokens,
            outputTokens,
            cacheCreationInputTokens: cacheCreationInputTokens > 0 ? cacheCreationInputTokens : undefined,
            cacheReadInputTokens: cacheReadInputTokens > 0 ? cacheReadInputTokens : undefined,
            thinkingEnabled: thinkingWasEnabled,
            thinkingBudget: thinkingWasEnabled ? thinkingBudgetUsed : undefined,
            serviceTier,
          }).catch((error) => {
            // Log error but don't fail the request
            this.logger.warn('Failed to record token usage', { error, messageId });
          });

          // ========== USAGE TRACKING INTEGRATION (Phase 1.5) ==========
          // Track Claude API usage in usage tracking system (fire-and-forget)
          const usageTrackingService = getUsageTrackingService();
          const apiCallEndTime = Date.now();
          const apiCallDuration = apiCallEndTime - startTime;

          usageTrackingService.trackClaudeUsage(
            userId,
            sessionId,
            inputTokens,
            outputTokens,
            modelName,
            {
              cache_write_tokens: cacheCreationInputTokens > 0 ? cacheCreationInputTokens : undefined,
              cache_read_tokens: cacheReadInputTokens > 0 ? cacheReadInputTokens : undefined,
              durationMs: apiCallDuration,
              stopReason: stopReason || undefined,
              thinking_enabled: thinkingWasEnabled,
              thinking_budget: thinkingWasEnabled ? thinkingBudgetUsed : undefined,
              service_tier: serviceTier,
              turn_count: turnCount,
            }
          ).catch((err) => {
            this.logger.warn({ err, userId, sessionId }, 'Failed to track Claude usage');
          });
        }

        // ========== NEW FIX: Accumulate text in contentBlocks, persist later ==========
        // Store text content in contentBlocks for batch persistence in message_delta
        if (accumulatedText.trim()) {
          // Find text block index (assuming index 0 for now, could be multiple text blocks)
          const textBlockIndices = Array.from(contentBlocks.entries())
            .filter(([_, block]) => block.type === 'text')
            .map(([index, _]) => index);

          this.logger.info({
            sessionId,
            turnCount,
            textBlockIndices,
            textLength: accumulatedText.length,
          }, '📝 [TEXT] Text content accumulated (pending persistence)');

          // ⭐ Accumulate in accumulatedResponses for return value
          accumulatedResponses.push(accumulatedText);
        }

        // ========== ADD TO CONVERSATION HISTORY ==========
        // Build content array for history
        // ⭐ CRITICAL: Anthropic requires thinking blocks FIRST in assistant messages
        // When extended thinking is enabled, subsequent API calls expect:
        // [thinking_blocks..., text_blocks..., tool_uses...]
        const contentArray: Array<ThinkingBlock | TextBlock | ToolUseBlock> = [
          ...thinkingBlocks,  // ⭐ Thinking blocks MUST come first
          ...textBlocks,
          ...toolUses,
        ];

        this.logger.debug({
          sessionId,
          turnCount,
          thinkingBlocksCount: thinkingBlocks.length,
          textBlocksCount: textBlocks.length,
          toolUsesCount: toolUses.length,
          totalBlocks: contentArray.length,
        }, '📝 [HISTORY] Adding assistant message to conversation history');

        conversationHistory.push({
          role: 'assistant',
          content: contentArray,
        });

        // ========== CHECK STOP REASON ==========
        if (stopReason === 'end_turn') {
          // Claude is done
          continueLoop = false;
        } else if (stopReason === 'tool_use' && toolUses.length > 0) {
          // Claude wants to use tools

          // Execute all tool calls
          const toolResults: ToolResult[] = [];

          // ⭐ FIX: Pre-reserve sequences BEFORE tool execution to guarantee ordering
          // This ensures tool results appear in the correct order regardless of execution time
          const orderingService = getMessageOrderingService();
          const reservedSequences = await orderingService.reserveSequenceBatch(
            sessionId,
            toolUses.length
          );

          this.logger.info({
            sessionId,
            turnCount,
            toolCount: toolUses.length,
            reservedSequences: reservedSequences.sequences,
          }, '🔢 [ORDERING] Pre-reserved sequences for tool results');

          // Delay to allow DB saves to complete (increased from 600ms to 1000ms for better reliability)
          // This ensures MessageQueue worker has enough time to persist messages before frontend queries
          await new Promise(resolve => setTimeout(resolve, 1000));

          for (let toolIndex = 0; toolIndex < toolUses.length; toolIndex++) {
            const toolUse = toolUses[toolIndex];
            if (!toolUse) {
                 this.logger.error({ toolIndex, totalParams: toolUses.length }, '❌ Missing tool use at index');
                 continue;
            }
            
            const preAssignedSequence = reservedSequences.sequences[toolIndex];
            if (!preAssignedSequence) {
                 throw new Error(`Missing pre-assigned sequence for tool index ${toolIndex}`);
            }

            toolsUsed.push(toolUse.name);

            // ⭐ TRACING POINT 5: Inicio del tool execution loop
            let validatedToolExecutionId = toolUse.id;

            this.logger.info({
              sessionId,
              turnCount,
              toolName: toolUse.name,
              toolUseId: validatedToolExecutionId,
              hasId: !!validatedToolExecutionId,
              idType: typeof validatedToolExecutionId,
              idValue: validatedToolExecutionId,
              idLength: validatedToolExecutionId?.length || 0,
              toolInput: toolUse.input,
            }, '🔍 [TRACE 5/8] Tool execution loop start');

            // ⭐ VALIDACIÓN: Asegurar que el ID sigue válido en el loop
            if (!validatedToolExecutionId || validatedToolExecutionId === 'undefined' || typeof validatedToolExecutionId !== 'string' || validatedToolExecutionId.trim() === '') {
              // 🚨 FALLBACK: ID se corrompió entre push y loop iteration
              validatedToolExecutionId = `toolu_fallback_${randomUUID()}`;

              this.logger.error('🚨 Tool use ID se corrompió en execution loop - usando fallback', {
                sessionId,
                turnCount,
                toolName: toolUse.name,
                originalId: toolUse.id,
                originalIdType: typeof toolUse.id,
                fallbackId: validatedToolExecutionId,
              });

              // Update toolUse.id para el resto del loop
              toolUse.id = validatedToolExecutionId;
            }

            // Check if tool needs approval
            const needsApproval = this.isWriteOperation(toolUse.name);

            if (needsApproval && this.approvalManager) {
              const approved = await this.approvalManager.request({
                sessionId: sessionId || 'unknown',
                toolName: toolUse.name,
                toolArgs: toolUse.input as Record<string, unknown>,
              });

              if (!approved) {
                toolResults.push({
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: 'Operation cancelled by user - approval denied',
                  is_error: true,
                });
                continue;
              }
            }

            // Execute the tool
            // ========== TOOL EXECUTION TIMING (Phase 1.5) ==========
            const toolStartTime = Date.now();
            try {
              const result = await this.executeMCPTool(toolUse.name, toolUse.input);
              const toolEndTime = Date.now();
              const toolDuration = toolEndTime - toolStartTime;

              // ⭐ TRACING POINT 6: Después de tool execution, antes de appendEvent
              this.logger.info({
                sessionId,
                turnCount,
                toolName: toolUse.name,
                toolUseId: validatedToolExecutionId,
                resultType: typeof result,
                resultPreview: typeof result === 'string' ? result.substring(0, 100) : JSON.stringify(result).substring(0, 100),
                success: true,
                preAssignedSequence,
                toolIndex,
                toolDuration,
              }, '🔍 [TRACE 6/8] Tool executed, before appendEvent');

              // ========== USAGE TRACKING - TOOL EXECUTION (Phase 1.5) ==========
              // Track tool execution in usage tracking system (fire-and-forget)
              if (userId) {
                const usageTrackingService = getUsageTrackingService();
                usageTrackingService.trackToolExecution(
                  userId,
                  sessionId,
                  toolUse.name,
                  toolDuration,
                  {
                    success: true,
                    result_size: result ? JSON.stringify(result).length : 0,
                    tool_use_id: validatedToolExecutionId,
                    turn_count: turnCount,
                    tool_index: toolIndex,
                  }
                ).catch((err) => {
                  this.logger.warn({ err, userId, sessionId, toolName: toolUse.name }, 'Failed to track tool execution');
                });
              }

              // ⭐ FIX: Use pre-assigned sequence for correct ordering
              const toolResultEvent = await eventStore.appendEventWithSequence(
                sessionId,
                'tool_use_completed',
                {
                  tool_use_id: validatedToolExecutionId,  // ⭐ Use validated ID
                  tool_name: toolUse.name,
                  tool_result: result,
                  success: true,
                  error_message: null,
                },
                preAssignedSequence  // ⭐ Use pre-assigned sequence!
              );

              this.logger.info({
                sessionId,
                toolUseId: validatedToolExecutionId,
                toolName: toolUse.name,
                sequenceNumber: preAssignedSequence,
                toolIndex,
              }, '🔢 [ORDERING] Tool result using pre-assigned sequence');

              this.logger.info('✅ Tool result event appended to EventStore', {
                sessionId,
                toolUseId: validatedToolExecutionId,  // ⭐ Use validated ID
                toolName: toolUse.name,
                success: true,
                eventId: toolResultEvent.id,
                sequenceNumber: toolResultEvent.sequence_number,
              });

              // ✅ STEP 2: Emit AFTER with data from persisted event
              this.emitter.emitToolResult({
                toolName: toolUse.name,
                toolUseId: validatedToolExecutionId,  // ⭐ Use validated ID
                args: toolUse.input as Record<string, unknown>,
                result: result,
                success: true,
                eventId: toolResultEvent.id,
                sequenceNumber: toolResultEvent.sequence_number,
                sessionId,
              });

              // ✅ STEP 3: Update messages table (NO generate new sequence)
              if (userId) {
                // ⭐ TRACING POINT 7: Antes de updateToolResult
                this.logger.info({
                  sessionId,
                  turnCount,
                  userId,
                  toolUseId: validatedToolExecutionId,
                  toolName: toolUse.name,
                  hasToolUseId: !!validatedToolExecutionId,
                  toolUseIdType: typeof validatedToolExecutionId,
                  toolUseIdValue: validatedToolExecutionId,
                  toolUseIdLength: validatedToolExecutionId?.length || 0,
                  eventIdFromStore: toolResultEvent.id,
                  sequenceNumber: toolResultEvent.sequence_number,
                }, '🔍 [TRACE 7/8] Before MessageService.updateToolResult');

                const messageService = getMessageService();
                await messageService.updateToolResult(
                  sessionId,
                  userId,
                  validatedToolExecutionId,  // ⭐ Use validated ID
                  toolUse.name,
                  toolUse.input as Record<string, unknown>,
                  result,
                  true, // success
                  undefined
                );

                // ⭐ TRACING POINT 8: Después de updateToolResult (SUCCESS path)
                this.logger.info({
                  sessionId,
                  turnCount,
                  userId,
                  toolUseId: validatedToolExecutionId,
                  toolName: toolUse.name,
                  updateSuccess: true,
                }, '🔍 [TRACE 8/8] After MessageService.updateToolResult - SUCCESS');

                // ✅ FIX: Persist tool_result message (Issue #5 - Missing sequences)
                // ⭐ PHASE 1B: Use derived ID from tool_use_id to maintain Anthropic correlation
                await messageQueue.addMessagePersistence({
                  sessionId,
                  messageId: `${validatedToolExecutionId}_result`,  // ⭐ PHASE 1B: Derived from Anthropic tool_use_id
                  role: 'assistant',
                  messageType: 'tool_result',
                  content: typeof result === 'string' ? result : JSON.stringify(result),
                  metadata: {
                    tool_name: toolUse.name,
                    tool_args: toolUse.input,
                    tool_result: result,
                    tool_use_id: validatedToolExecutionId,
                    status: 'success',
                    success: true,
                  },
                  sequenceNumber: toolResultEvent.sequence_number,
                  eventId: toolResultEvent.id,
                  toolUseId: validatedToolExecutionId,
                });

                this.logger.info('✅ Tool result message queued for persistence', {
                  sessionId,
                  toolUseId: validatedToolExecutionId,
                  sequenceNumber: toolResultEvent.sequence_number,
                  eventId: toolResultEvent.id,
                });
              }

              toolResults.push({
                type: 'tool_result',
                tool_use_id: validatedToolExecutionId,  // ⭐ Use validated ID
                content: typeof result === 'string' ? result : JSON.stringify(result),
              });
            } catch (error) {
              console.error(`[DirectAgentService] Tool execution failed:`, error);

              // Calculate tool duration for error case
              const toolEndTime = Date.now();
              const toolDuration = toolEndTime - toolStartTime;

              // ⭐ FIX: Use pre-assigned sequence even for errors!
              const errorMessage = error instanceof Error ? error.message : String(error);

              // ========== USAGE TRACKING - TOOL EXECUTION ERROR (Phase 1.5) ==========
              // Track failed tool execution in usage tracking system (fire-and-forget)
              if (userId) {
                const usageTrackingService = getUsageTrackingService();
                usageTrackingService.trackToolExecution(
                  userId,
                  sessionId,
                  toolUse.name,
                  toolDuration,
                  {
                    success: false,
                    error_message: errorMessage,
                    tool_use_id: validatedToolExecutionId,
                    turn_count: turnCount,
                    tool_index: toolIndex,
                  }
                ).catch((err) => {
                  this.logger.warn({ err, userId, sessionId, toolName: toolUse.name }, 'Failed to track tool execution error');
                });
              }
              const toolResultEvent = await eventStore.appendEventWithSequence(
                sessionId,
                'tool_use_completed',
                {
                  tool_use_id: validatedToolExecutionId,  // ⭐ Use validated ID
                  tool_name: toolUse.name,
                  tool_result: null,
                  success: false,
                  error_message: errorMessage,
                },
                preAssignedSequence  // ⭐ Use pre-assigned sequence even for errors!
              );

              this.logger.error('❌ Tool result event (error) appended to EventStore', {
                sessionId,
                toolUseId: validatedToolExecutionId,  // ⭐ Use validated ID
                toolName: toolUse.name,
                success: false,
                error: errorMessage,
                eventId: toolResultEvent.id,
                sequenceNumber: preAssignedSequence,
                toolIndex,
              });

              this.logger.info({
                sessionId,
                toolUseId: validatedToolExecutionId,
                toolName: toolUse.name,
                sequenceNumber: preAssignedSequence,
                toolIndex,
                error: errorMessage,
              }, '🔢 [ORDERING] Tool error using pre-assigned sequence');

              // ✅ STEP 2: Emit AFTER with data from persisted event
              this.emitter.emitToolResult({
                toolName: toolUse.name,
                toolUseId: validatedToolExecutionId,  // ⭐ Use validated ID
                args: toolUse.input as Record<string, unknown>,
                result: null,
                success: false,
                error: errorMessage,
                eventId: toolResultEvent.id,
                sequenceNumber: toolResultEvent.sequence_number,
                sessionId,
              });

              // ✅ STEP 3: Update messages table (NO generate new sequence)
              if (userId) {
                const messageService = getMessageService();
                await messageService.updateToolResult(
                  sessionId,
                  userId,
                  validatedToolExecutionId,  // ⭐ Use validated ID
                  toolUse.name,
                  toolUse.input as Record<string, unknown>,
                  null,
                  false, // success = false
                  errorMessage
                );

                // ⭐ TRACING POINT 8: Después de updateToolResult (ERROR path)
                this.logger.error({
                  sessionId,
                  turnCount,
                  userId,
                  toolUseId: validatedToolExecutionId,
                  toolName: toolUse.name,
                  updateSuccess: true,
                  error: errorMessage,
                }, '🔍 [TRACE 8/8] After MessageService.updateToolResult - ERROR');

                // ✅ FIX: Persist tool_result message (Issue #5 - Missing sequences - ERROR case)
                // ⭐ PHASE 1B: Use derived ID from tool_use_id to maintain Anthropic correlation
                await messageQueue.addMessagePersistence({
                  sessionId,
                  messageId: `${validatedToolExecutionId}_error`,  // ⭐ PHASE 1B: Derived from Anthropic tool_use_id
                  role: 'assistant',
                  messageType: 'error',
                  content: `Error executing ${toolUse.name}: ${errorMessage}`,
                  metadata: {
                    tool_name: toolUse.name,
                    tool_args: toolUse.input,
                    tool_result: null,
                    tool_use_id: validatedToolExecutionId,
                    status: 'error',
                    success: false,
                    error_message: errorMessage,
                  },
                  sequenceNumber: toolResultEvent.sequence_number,
                  eventId: toolResultEvent.id,
                  toolUseId: validatedToolExecutionId,
                });

                this.logger.error('❌ Tool result message (error) queued for persistence', {
                  sessionId,
                  toolUseId: validatedToolExecutionId,
                  sequenceNumber: toolResultEvent.sequence_number,
                  eventId: toolResultEvent.id,
                  error: errorMessage,
                });
              }

              toolResults.push({
                type: 'tool_result',
                tool_use_id: validatedToolExecutionId,  // ⭐ Use validated ID
                content: `Error: ${error instanceof Error ? error.message : String(error)}`,
                is_error: true,
              });
            }
          }

          // Add tool results to conversation
          conversationHistory.push({
            role: 'user',
            content: toolResults,
          });

          // Continue loop
        } else if (stopReason === 'max_tokens') {
          // ✅ FIX PHASE 4: Persist warning message FIRST
          const warningEvent = await eventStore.appendEvent(
            sessionId,
            'agent_message_sent',
            {
              content: '[Response truncated - reached max tokens]',
              stop_reason: 'max_tokens',
            }
          );

          // ⭐ PHASE 1B: Use event ID as message ID for system-generated messages
          this.emitter.emitMessage({
            messageId: `system_max_tokens_${warningEvent.id}`,  // ⭐ PHASE 1B: Derived from event ID
            content: '[Response truncated - reached max tokens]',
            role: 'assistant',
            eventId: warningEvent.id,
            sequenceNumber: warningEvent.sequence_number,
            metadata: {
              type: 'max_tokens_warning',
            },
            sessionId,
          });
          accumulatedResponses.push('[Response truncated - reached max tokens]');
          continueLoop = false;
        } else if (stopReason === 'stop_sequence') {
          // ⭐ SDK 0.71: Custom stop sequence was hit
          this.logger.info({
            sessionId,
            turnCount,
            stopReason,
          }, '🛑 [STOP_SEQUENCE] Custom stop sequence reached');

          const stopSeqEvent = await eventStore.appendEvent(
            sessionId,
            'agent_message_sent',
            {
              content: accumulatedText || '[Stopped at custom sequence]',
              stop_reason: 'stop_sequence',
            }
          );

          this.emitter.emitMessage({
            messageId: messageId || `system_stop_sequence_${stopSeqEvent.id}`,
            content: accumulatedText || '[Stopped at custom sequence]',
            role: 'assistant',
            stopReason: 'stop_sequence',
            eventId: stopSeqEvent.id,
            sequenceNumber: stopSeqEvent.sequence_number,
            sessionId,
            metadata: {
              type: 'stop_sequence',
            },
          });
          continueLoop = false;
        } else if (stopReason === 'pause_turn') {
          // ⭐ SDK 0.71: Long agentic turn was paused
          this.logger.warn({
            sessionId,
            turnCount,
            stopReason,
            accumulatedTextLength: accumulatedText.length,
          }, '⏸️ [PAUSE_TURN] Agentic turn paused by Claude');

          const pauseEvent = await eventStore.appendEvent(
            sessionId,
            'agent_message_sent',
            {
              content: accumulatedText || '[Turn paused]',
              stop_reason: 'pause_turn',
            }
          );

          // Emit specific turn_paused event for frontend handling
          this.emitter.emitTurnPaused({
            reason: 'Long-running turn was paused by Claude. The conversation can be continued.',
            turnCount: turnCount,
            eventId: pauseEvent.id,
            sequenceNumber: pauseEvent.sequence_number,
            sessionId,
          });
          continueLoop = false;
        } else if (stopReason === 'refusal') {
          // ⭐ SDK 0.71: Claude refused to generate content due to policy
          this.logger.warn({
            sessionId,
            turnCount,
            stopReason,
            accumulatedTextLength: accumulatedText.length,
          }, '🚫 [REFUSAL] Content refused due to policy violation');

          const refusalEvent = await eventStore.appendEvent(
            sessionId,
            'agent_message_sent',
            {
              content: accumulatedText || '[Content refused due to policy]',
              stop_reason: 'refusal',
            }
          );

          // Emit specific content_refused event for frontend handling
          this.emitter.emitContentRefused({
            reason: 'Claude declined to generate this content due to usage policies.',
            eventId: refusalEvent.id,
            sequenceNumber: refusalEvent.sequence_number,
            sessionId,
          });
          continueLoop = false;
        } else {
          // Unknown stop reason - log and terminate safely
          this.logger.warn({
            sessionId,
            turnCount,
            stopReason,
          }, '⚠️ [UNKNOWN_STOP_REASON] Unhandled stop reason, terminating loop');
          continueLoop = false;
        }
      }

      if (turnCount >= maxTurns) {
        // ✅ FIX PHASE 4: Persist warning message FIRST
        const maxTurnsEvent = await eventStore.appendEvent(
          sessionId,
          'agent_message_sent',
          {
            content: '[Execution stopped - reached maximum turns]',
            stop_reason: 'max_turns',
          }
        );

        // ⭐ PHASE 1B: Use event ID as message ID for system-generated messages
        this.emitter.emitMessage({
          messageId: `system_max_turns_${maxTurnsEvent.id}`,  // ⭐ PHASE 1B: Derived from event ID
          content: '[Execution stopped - reached maximum turns]',
          role: 'assistant',
          eventId: maxTurnsEvent.id,
          sequenceNumber: maxTurnsEvent.sequence_number,
          metadata: {
            type: 'max_turns_warning',
          },
          sessionId,
        });
        accumulatedResponses.push('[Execution stopped - reached maximum turns]');
      }

      const duration = Date.now() - startTime;
      const finalResponse = accumulatedResponses.join('\n\n');

      // Phase 5: Record file usage (fire-and-forget)
      if (options?.attachments && options.attachments.length > 0 && lastMessageId) {
        this.recordFileUsage(lastMessageId, finalResponse, fileContext.fileMap, options.attachments)
          .catch((err) => this.logger.warn({ err, lastMessageId }, 'Failed to record file usage'));
      }

      // Build citedFiles from fileContext.fileMap for frontend citation support
      const citedFiles = fileContext.fileMap.size > 0
        ? Array.from(fileContext.fileMap.entries()).map(([fileName, fileId]) => ({
            fileName,
            fileId,
          }))
        : undefined;

      // ✅ FIX PHASE 4: Send completion event (transient - not persisted)
      this.emitter.emitComplete('end_turn', {
        inputTokens,
        outputTokens,
        cacheCreationInputTokens: cacheCreationInputTokens > 0 ? cacheCreationInputTokens : undefined,
        cacheReadInputTokens: cacheReadInputTokens > 0 ? cacheReadInputTokens : undefined,
      }, sessionId, citedFiles);

      return {
        success: true,
        response: finalResponse,
        toolsUsed,
        duration,
        inputTokens,
        outputTokens,
      };

    } catch (error) {
      const duration = Date.now() - startTime;

      console.error(`[DirectAgentService] Streaming query execution failed:`, error);

      // ✅ FIX PHASE 4: Send error event (transient - not persisted)
      this.emitter.emitError(
        error instanceof Error ? error.message : String(error),
        'EXECUTION_ERROR',
        sessionId
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        response: '',
        toolsUsed,
        duration,
        inputTokens,
        outputTokens,
      };
    } finally {
      // Always clear the event callback when done
      this.emitter.clearEventCallback();
    }
  }

  /**
   * Get MCP Tool Definitions
   *
   * Converts SDK MCP server tools to Anthropic tool format
   */
  /**
   * Get MCP Tool Definitions
   *
   * Returns tool definitions from centralized tool-definitions.ts file.
   * This allows for easier maintenance and testing of tool schemas.
   *
   * @returns Array of Claude tool definitions
   */
  private async getMCPToolDefinitions(): Promise<Tool[]> {
    const { getMCPToolDefinitions } = await import('./tool-definitions');
    return getMCPToolDefinitions();
  }

  /**
   * Execute MCP Tool
   *
   * @deprecated Replaced by src/modules/agents/business-central/tools.ts
   * Implements MCP tool logic directly (bypassing SDK MCP server)
   */
  private async executeMCPTool(toolName: string, input: unknown): Promise<unknown> {
    this.logger.debug({ toolName }, 'Executing MCP tool');

    const args = input as Record<string, unknown>;

    switch (toolName) {
      case 'list_all_entities': {
        return this.toolListAllEntities(args);
      }

      case 'search_entity_operations': {
        return this.toolSearchEntityOperations(args);
      }

      case 'get_entity_details': {
        return this.toolGetEntityDetails(args);
      }

      case 'get_entity_relationships': {
        return this.toolGetEntityRelationships(args);
      }

      case 'validate_workflow_structure': {
        return this.toolValidateWorkflowStructure(args);
      }

      case 'build_knowledge_base_workflow': {
        return this.toolBuildKnowledgeBaseWorkflow(args);
      }

      case 'get_endpoint_documentation': {
        return this.toolGetEndpointDocumentation(args);
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  /**
   * Tool Implementation: list_all_entities
   * @deprecated
   */
  private async toolListAllEntities(args: Record<string, unknown>): Promise<string> {
    const indexPath = path.join(this.mcpDataPath, 'bc_index.json');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`Master index not found at ${indexPath}`);
    }

    const content = fs.readFileSync(indexPath, 'utf8');
    const index = JSON.parse(content);

    let entities = index.entities;

    // Validate and filter by operations if provided
    if (args.filter_by_operations && Array.isArray(args.filter_by_operations)) {
      // Validate each operation type
      const validOperations = (args.filter_by_operations as unknown[])
        .filter(isValidOperationType);

      if (validOperations.length > 0) {
        entities = entities.filter((entity: BCIndexEntity) => {
          return validOperations.every(op => entity.operations.includes(op));
        });
      }
    }

    const allOperationTypes = new Set<string>();
    index.entities.forEach((entity: BCIndexEntity) => {
      entity.operations.forEach((op: string) => allOperationTypes.add(op));
    });

    const result = {
      total_entities: entities.length,
      entities: entities,
      available_operation_types: Array.from(allOperationTypes).sort(),
    };

    return JSON.stringify(result, null, 2);
  }

  /**
   * Tool Implementation: search_entity_operations
   * @deprecated
   */
  private async toolSearchEntityOperations(args: Record<string, unknown>): Promise<string> {
    const indexPath = path.join(this.mcpDataPath, 'bc_index.json');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`Master index not found at ${indexPath}`);
    }

    const content = fs.readFileSync(indexPath, 'utf8');
    const index = JSON.parse(content);

    // Sanitize keyword input to prevent injection and handle special characters
    const keyword = sanitizeKeyword(args.keyword);
    const filterByRisk = args.filter_by_risk as string | undefined;
    // Validate operation type filter
    const filterByOperationType = isValidOperationType(args.filter_by_operation_type)
      ? args.filter_by_operation_type
      : undefined;

    const results: Array<{
      entity: string;
      displayName: string;
      description: string;
      matching_operations: Array<{
        operation_id: string;
        method: string;
        summary: string;
        operation_type: string;
        risk_level: string;
      }>;
    }> = [];

    // Search through entities
    for (const entitySummary of index.entities) {
      const matches =
        entitySummary.name.toLowerCase().includes(keyword) ||
        entitySummary.displayName.toLowerCase().includes(keyword) ||
        (entitySummary.description && entitySummary.description.toLowerCase().includes(keyword));

      if (!matches) continue;

      // Load entity details
      const entityPath = path.join(this.mcpDataPath, 'entities', `${entitySummary.name}.json`);
      if (!fs.existsSync(entityPath)) continue;

      const entityContent = fs.readFileSync(entityPath, 'utf8');
      const entity = JSON.parse(entityContent);

      let matchingOps = entity.endpoints || [];

      // Apply filters
      if (filterByRisk) {
        matchingOps = matchingOps.filter((ep: BCEndpoint) => ep.riskLevel === filterByRisk);
      }
      if (filterByOperationType) {
        matchingOps = matchingOps.filter((ep: BCEndpoint) => ep.operationType === filterByOperationType);
      }

      if (matchingOps.length > 0) {
        results.push({
          entity: entity.entity,
          displayName: entity.displayName,
          description: entity.description,
          matching_operations: matchingOps.map((ep: BCEndpoint) => ({
            operation_id: ep.id,
            method: ep.method,
            summary: ep.summary,
            operation_type: ep.operationType,
            risk_level: ep.riskLevel,
          })),
        });
      }
    }

    const result = {
      total_matches: results.length,
      keyword: keyword,
      filters: {
        risk_level: filterByRisk || 'none',
        operation_type: filterByOperationType || 'none',
      },
      results: results,
    };

    return JSON.stringify(result, null, 2);
  }

  /**
   * Tool Implementation: get_entity_details
   *
   * Security: Uses sanitizeEntityName to prevent path traversal and normalize case
   */
  private async toolGetEntityDetails(args: Record<string, unknown>): Promise<string> {
    // Sanitize entity name: lowercase, path traversal protection, valid characters only
    const entityName = sanitizeEntityName(args.entity_name);
    const entityPath = path.join(this.mcpDataPath, 'entities', `${entityName}.json`);

    if (!fs.existsSync(entityPath)) {
      throw new Error(`Entity '${entityName}' not found`);
    }

    const content = fs.readFileSync(entityPath, 'utf8');
    return content;
  }

  /**
   * Tool Implementation: get_entity_relationships
   *
   * Security: Uses sanitizeEntityName to prevent path traversal and normalize case
   */
  private async toolGetEntityRelationships(args: Record<string, unknown>): Promise<string> {
    // Sanitize entity name: lowercase, path traversal protection, valid characters only
    const entityName = sanitizeEntityName(args.entity_name);
    const entityPath = path.join(this.mcpDataPath, 'entities', `${entityName}.json`);

    if (!fs.existsSync(entityPath)) {
      throw new Error(`Entity '${entityName}' not found`);
    }

    const content = fs.readFileSync(entityPath, 'utf8');
    const entity = JSON.parse(content);

    const result = {
      entity: entity.entity,
      displayName: entity.displayName,
      description: entity.description,
      relationships: entity.relationships || [],
      common_workflows: entity.commonWorkflows || [],
      relationship_summary: {
        total_relationships: (entity.relationships || []).length,
        total_workflows: (entity.commonWorkflows || []).length,
        related_entities: (entity.relationships || []).map((r: BCRelationship) => r.entity),
      },
    };

    return JSON.stringify(result, null, 2);
  }

  /**
   * Tool Implementation: validate_workflow_structure
   *
   * Security: Validates and sanitizes operation_ids before processing
   */
  private async toolValidateWorkflowStructure(args: Record<string, unknown>): Promise<string> {
    const workflow = args.workflow as Array<{ operation_id: string; label?: string }>;

    if (!workflow || !Array.isArray(workflow)) {
      throw new Error('workflow parameter must be an array of steps');
    }

    const indexPath = path.join(this.mcpDataPath, 'bc_index.json');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`Master index not found at ${indexPath}`);
    }

    const indexContent = fs.readFileSync(indexPath, 'utf8');
    const index = JSON.parse(indexContent) as BCIndex;

    const validationResults: WorkflowValidationResult[] = [];
    let hasErrors = false;
    let stepNumber = 0;

    for (const step of workflow) {
      stepNumber++;
      const issues: string[] = [];
      const dependencies: string[] = [];

      // Sanitize operation_id to prevent injection
      let sanitizedOperationId: string;
      try {
        sanitizedOperationId = sanitizeOperationId(step.operation_id);
      } catch {
        hasErrors = true;
        validationResults.push({
          step_number: stepNumber,
          operation_id: String(step.operation_id || 'invalid'),
          entity: 'unknown',
          valid: false,
          risk_level: 'HIGH',
          requires_approval: true,
          issues: ['Invalid operation ID format'],
        });
        continue;
      }

      // Find entity for this operation_id
      const entityName = index.operationIndex[sanitizedOperationId];

      if (!entityName) {
        hasErrors = true;
        validationResults.push({
          step_number: stepNumber,
          operation_id: sanitizedOperationId,
          entity: 'unknown',
          valid: false,
          risk_level: 'HIGH',
          requires_approval: true,
          issues: [`Operation ID "${sanitizedOperationId}" not found in index`],
        });
        continue;
      }

      // Load entity details
      const entityPath = path.join(this.mcpDataPath, 'entities', `${entityName}.json`);
      if (!fs.existsSync(entityPath)) {
        hasErrors = true;
        validationResults.push({
          step_number: stepNumber,
          operation_id: sanitizedOperationId,
          entity: entityName,
          valid: false,
          risk_level: 'HIGH',
          requires_approval: true,
          issues: [`Entity file not found for "${entityName}"`],
        });
        continue;
      }

      const entityContent = fs.readFileSync(entityPath, 'utf8');
      const entity = JSON.parse(entityContent) as BCIndexEntity;

      // Find endpoint using sanitized operation ID
      const endpoint = entity.endpoints.find((ep: BCEndpoint) => ep.id === sanitizedOperationId);

      if (!endpoint) {
        hasErrors = true;
        validationResults.push({
          step_number: stepNumber,
          operation_id: sanitizedOperationId,
          entity: entityName,
          valid: false,
          risk_level: 'HIGH',
          requires_approval: true,
          issues: [`Operation "${sanitizedOperationId}" not found in entity "${entityName}"`],
        });
        continue;
      }

      // Check for dependencies (fields ending in Id)
      if (endpoint.requiredFields) {
        const foreignKeys = endpoint.requiredFields.filter((field: string) =>
          field.endsWith('Id') && field !== 'id'
        );
        if (foreignKeys.length > 0) {
          dependencies.push(...foreignKeys.map((fk: string) => `Required field: ${fk}`));
        }
      }

      const valid = issues.length === 0;
      if (!valid) {
        hasErrors = true;
      }

      validationResults.push({
        step_number: stepNumber,
        operation_id: sanitizedOperationId,
        entity: entityName,
        entity_display_name: entity.displayName,
        valid,
        risk_level: endpoint.riskLevel,
        requires_approval: endpoint.requiresHumanApproval ?? false,
        operation_type: endpoint.operationType,
        issues: issues.length > 0 ? issues : undefined,
        dependencies: dependencies.length > 0 ? dependencies : undefined,
      });
    }

    const result = {
      workflow_valid: !hasErrors,
      total_steps: workflow.length,
      validation_results: validationResults,
      summary: {
        total_valid: validationResults.filter(r => r.valid).length,
        total_invalid: validationResults.filter(r => !r.valid).length,
        total_high_risk: validationResults.filter(r => r.risk_level === 'HIGH').length,
        total_requiring_approval: validationResults.filter(r => r.requires_approval).length,
      },
    };

    return JSON.stringify(result, null, 2);
  }

  /**
   * Tool Implementation: build_knowledge_base_workflow
   *
   * Security: Validates and sanitizes operation_ids before processing
   */
  private async toolBuildKnowledgeBaseWorkflow(args: Record<string, unknown>): Promise<string> {
    const workflowName = args.workflow_name as string;
    const workflowDescription = args.workflow_description as string | undefined;
    const steps = args.steps as Array<{ operation_id: string; label?: string }>;

    if (!workflowName || !steps || !Array.isArray(steps)) {
      throw new Error('workflow_name and steps are required');
    }

    const indexPath = path.join(this.mcpDataPath, 'bc_index.json');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`Master index not found at ${indexPath}`);
    }

    const indexContent = fs.readFileSync(indexPath, 'utf8');
    const index = JSON.parse(indexContent);

    const enrichedSteps: Record<string, unknown>[] = [];
    let stepNumber = 0;

    for (const step of steps) {
      stepNumber++;

      // Sanitize operation_id to prevent injection
      const sanitizedOperationId = sanitizeOperationId(step.operation_id);
      const entityName = index.operationIndex[sanitizedOperationId];

      if (!entityName) {
        throw new Error(`Operation ID "${sanitizedOperationId}" not found`);
      }

      const entityPath = path.join(this.mcpDataPath, 'entities', `${entityName}.json`);
      const entityContent = fs.readFileSync(entityPath, 'utf8');
      const entity = JSON.parse(entityContent);

      const endpoint = entity.endpoints.find((ep: Record<string, unknown>) => ep.id === sanitizedOperationId);

      if (!endpoint) {
        throw new Error(`Operation "${sanitizedOperationId}" not found in entity "${entityName}"`);
      }

      // Find alternatives (same operation type, different endpoint)
      const alternatives = entity.endpoints
        .filter((ep: Record<string, unknown>) =>
          ep.operationType === endpoint.operationType && ep.id !== endpoint.id
        )
        .map((ep: Record<string, unknown>) => ({
          operation_id: ep.id,
          summary: ep.summary,
          risk_level: ep.riskLevel,
        }));

      // Define expected outcomes
      const outcomes = [
        {
          type: 'success',
          status: endpoint.successStatus,
          description: `${endpoint.operationType} operation completed successfully`,
        },
        { type: 'error', status: 400, description: 'Bad request - invalid input data' },
        { type: 'error', status: 401, description: 'Unauthorized - authentication required' },
        { type: 'error', status: 404, description: 'Not found - resource does not exist' },
      ];

      if (endpoint.operationType === 'create') {
        outcomes.push({
          type: 'error',
          status: 409,
          description: 'Conflict - resource already exists',
        });
      }

      enrichedSteps.push({
        step_number: stepNumber,
        operation_id: sanitizedOperationId,
        label: step.label || endpoint.summary,
        entity: entityName,
        entity_display_name: entity.displayName,
        method: endpoint.method,
        path: endpoint.path,
        operation_type: endpoint.operationType,
        risk_level: endpoint.riskLevel,
        requires_approval: endpoint.requiresHumanApproval,
        required_fields: endpoint.requiredFields || [],
        optional_fields: endpoint.optionalFields || [],
        selectable_fields: endpoint.selectableFields || [],
        expandable_relations: endpoint.expandableRelations || [],
        path_parameters: endpoint.pathParams || [],
        query_parameters: endpoint.queryParams || [],
        alternatives: alternatives.length > 0 ? alternatives : undefined,
        expected_outcomes: outcomes,
      });
    }

    const result = {
      workflow_name: workflowName,
      workflow_description: workflowDescription,
      total_steps: steps.length,
      created_at: new Date().toISOString(),
      enriched_steps: enrichedSteps,
      risk_summary: {
        high_risk_steps: enrichedSteps.filter((s: Record<string, unknown>) => s.risk_level === 'HIGH').length,
        requires_approval_count: enrichedSteps.filter((s: Record<string, unknown>) => s.requires_approval).length,
      },
    };

    return JSON.stringify(result, null, 2);
  }

  /**
   * Tool Implementation: get_endpoint_documentation
   *
   * Security: Validates and sanitizes operation_id before processing
   */
  private async toolGetEndpointDocumentation(args: Record<string, unknown>): Promise<string> {
    // Sanitize operation_id to prevent injection
    const sanitizedOperationId = sanitizeOperationId(args.operation_id);

    const indexPath = path.join(this.mcpDataPath, 'bc_index.json');
    if (!fs.existsSync(indexPath)) {
      throw new Error(`Master index not found at ${indexPath}`);
    }

    const indexContent = fs.readFileSync(indexPath, 'utf8');
    const index = JSON.parse(indexContent);

    const entityName = index.operationIndex[sanitizedOperationId];

    if (!entityName) {
      throw new Error(`Operation ID "${sanitizedOperationId}" not found`);
    }

    const entityPath = path.join(this.mcpDataPath, 'entities', `${entityName}.json`);
    const entityContent = fs.readFileSync(entityPath, 'utf8');
    const entity = JSON.parse(entityContent);

    const endpoint = entity.endpoints.find((ep: Record<string, unknown>) => ep.id === sanitizedOperationId);

    if (!endpoint) {
      throw new Error(`Operation "${sanitizedOperationId}" not found in entity "${entityName}"`);
    }

    const result = {
      operation_id: endpoint.id,
      entity: entityName,
      entity_display_name: entity.displayName,
      method: endpoint.method,
      path: endpoint.path,
      summary: endpoint.summary,
      operation_type: endpoint.operationType,
      risk_level: endpoint.riskLevel,
      requires_auth: endpoint.requiresAuth,
      requires_approval: endpoint.requiresHumanApproval,
      destructive: endpoint.destructive,
      warning_message: endpoint.warningMessage,
      path_parameters: endpoint.pathParams || [],
      query_parameters: endpoint.queryParams || [],
      headers: endpoint.headers || [],
      required_fields: endpoint.requiredFields || [],
      optional_fields: endpoint.optionalFields || [],
      selectable_fields: endpoint.selectableFields || [],
      expandable_relations: endpoint.expandableRelations || [],
      success_status: endpoint.successStatus,
      error_codes: endpoint.errorCodes || [],
      request_body_schema: endpoint.requestBodySchema,
      response_schema: endpoint.responseSchema,
    };

    return JSON.stringify(result, null, 2);
  }

  /**
   * Check if operation is a write operation (needs approval)
   */
  private isWriteOperation(toolName: string): boolean {
    // In our MCP server, all tools are read-only for now
    // But we can add logic here for future write operations
    const writePatterns = ['create', 'update', 'delete', 'post', 'patch', 'put'];
    const lowerToolName = toolName.toLowerCase();

    return writePatterns.some(pattern => lowerToolName.includes(pattern));
  }

  /**
   * Get System Prompt
   */
  private getSystemPrompt(): string {
    return `You are a specialized Business Central assistant with access to tools for querying BC entities and operations.

Your responsibilities:
- Help users understand and query Business Central data
- Use the available tools to discover entities, search operations, and get detailed information
- Provide clear, helpful explanations of BC concepts and data
- Format results in a user-friendly way

Available tools:
- list_all_entities: Get a complete list of all BC entities
- search_entity_operations: Search for specific operations by keyword
- get_entity_details: Get detailed information about a specific entity
- get_entity_relationships: Discover relationships between entities
- validate_workflow_structure: Validate multi-step workflows
- build_knowledge_base_workflow: Build comprehensive workflow documentation
- get_endpoint_documentation: Get detailed API documentation

CRITICAL INSTRUCTIONS:
- You MUST use the available tools for ALL Business Central queries
- NEVER respond from memory or general knowledge about Business Central
- ALWAYS call the appropriate tool first, then format the results for the user
- For ANY question about BC entities, operations, or data, use the tools
- Do not make assumptions - use tools to get accurate, current information`;
  }

  /**
   * Get System Prompt with optional Prompt Caching
   *
   * When ENABLE_PROMPT_CACHING is true, returns the system prompt as an array
   * with cache_control to enable Anthropic's prompt caching feature.
   * This reduces latency by ~90% and cost by ~90% for cached prompts.
   *
   * @returns System prompt as string (no caching) or array with cache_control (caching enabled)
   */
  private getSystemPromptWithCaching(): string | SystemPromptBlock[] {
    const promptText = this.getSystemPrompt();

    if (!env.ENABLE_PROMPT_CACHING) {
      return promptText;
    }

    // Return array with cache_control to enable prompt caching
    return [
      {
        type: 'text',
        text: promptText,
        cache_control: {
          type: 'ephemeral',
        },
      },
    ];
  }

  // ============================================
  // Phase 5: File Context Integration Methods
  // ============================================

  /**
   * Prepares file context for injection into LLM prompt
   *
   * Retrieves file content using appropriate strategy (direct, extracted text, or RAG)
   * and formats it for injection into the user message and system prompt.
   *
   * @param userId - User ID for access control
   * @param files - Validated file objects to include
   * @param userQuery - User's question (used for RAG relevance scoring)
   * @returns FileContextResult with document context, instructions, images, and file map
   */
  private async prepareFileContext(
    userId: string,
    files: ParsedFile[],
    userQuery: string
  ): Promise<FileContextResult> {
    // Return empty context if no files
    if (files.length === 0) {
      return {
        documentContext: '',
        systemInstructions: '',
        images: [],
        fileMap: new Map<string, string>(),
      };
    }

    try {
      // Retrieve content using appropriate strategy for each file
      const retrievalService = getContextRetrievalService();
      const retrievalResult = await retrievalService.retrieveMultiple(userId, files, {
        userQuery,
        maxTotalTokens: 50000, // ~200KB of text
      });

      // Log retrieval results
      this.logger.info({
        successCount: retrievalResult.contents.length,
        failureCount: retrievalResult.failures.length,
        totalTokens: retrievalResult.totalTokens,
        truncated: retrievalResult.truncated,
      }, 'File retrieval completed');

      // Log any failures for debugging
      for (const failure of retrievalResult.failures) {
        this.logger.warn({
          fileId: failure.fileId,
          fileName: failure.fileName,
          reason: failure.reason,
        }, 'File retrieval failed');
      }

      // Build document context and instructions
      const promptBuilder = getFileContextPromptBuilder();
      const documentContext = promptBuilder.buildDocumentContext(retrievalResult.contents);
      const fileNames = retrievalResult.contents.map(c => c.fileName);
      const systemInstructions = promptBuilder.buildSystemInstructions(fileNames);
      const images = promptBuilder.getImageContents(retrievalResult.contents);

      // Build file map for citation parsing (fileName -> fileId)
      const fileMap = new Map<string, string>();
      for (const file of files) {
        fileMap.set(file.name, file.id);
      }

      return {
        documentContext,
        systemInstructions,
        images,
        fileMap,
      };
    } catch (error) {
      this.logger.error({ error, userId, fileCount: files.length }, 'Failed to prepare file context');
      // Return empty context on error - don't fail the entire request
      return {
        documentContext: '',
        systemInstructions: '',
        images: [],
        fileMap: new Map<string, string>(),
      };
    }
  }

  /**
   * Records file usage after a message is completed
   *
   * Parses citations from the response text and records:
   * - Direct attachments (files the user attached)
   * - Citation attachments (files Claude referenced in response)
   *
   * This is a fire-and-forget operation - errors are logged but don't fail the response.
   *
   * @param messageId - ID of the assistant message
   * @param responseText - Claude's response text
   * @param fileMap - Map of fileName -> fileId for citation parsing
   * @param attachmentIds - IDs of files the user attached
   */
  private async recordFileUsage(
    messageId: string,
    responseText: string,
    fileMap: Map<string, string>,
    attachmentIds: string[]
  ): Promise<void> {
    try {
      const attachmentService = getMessageFileAttachmentService();

      // Record direct attachments (user explicitly attached these)
      if (attachmentIds.length > 0) {
        await attachmentService.recordAttachments(messageId, attachmentIds, 'direct');
        this.logger.debug({ messageId, count: attachmentIds.length }, 'Recorded direct attachments');
      }

      // Parse citations from response
      const citationParser = getCitationParser();
      const citationResult = citationParser.parseCitations(responseText, fileMap);

      // Record citation attachments (excluding files already in direct)
      if (citationResult.matchedFileIds.length > 0) {
        // Filter out files that are already recorded as direct attachments
        const citationOnlyIds = citationResult.matchedFileIds.filter(
          (id) => !attachmentIds.includes(id)
        );

        if (citationOnlyIds.length > 0) {
          await attachmentService.recordAttachments(messageId, citationOnlyIds, 'citation');
          this.logger.debug({ messageId, count: citationOnlyIds.length }, 'Recorded citation attachments');
        }
      }

      this.logger.info({
        messageId,
        directCount: attachmentIds.length,
        citationCount: citationResult.matchedFileIds.length,
        totalCitations: citationResult.citations.length,
      }, 'File usage recorded');
    } catch (error) {
      // Fire-and-forget - log but don't propagate
      this.logger.warn({ error, messageId }, 'Failed to record file usage');
    }
  }

  /**
   * Execute Agent with LangGraph Orchestrator
   * Supports Extended Thinking, File Attachments, and Semantic Search
   *
   * @param prompt - User input
   * @param sessionId - Session ID
   * @param onEvent - Event callback for streaming
   * @param userId - User ID (optional for backwards compatibility)
   * @param options - Execution options (thinking, attachments, semantic search)
   */
  async runGraph(
      prompt: string,
      sessionId: string,
      onEvent?: (event: AgentEvent) => void,
      userId?: string,
      options?: ExecuteStreamingOptions
  ): Promise<AgentExecutionResult> {
      this.logger.info({ sessionId, userId }, '🚀 Running LangGraph Orchestrator');

      // Validate userId for file operations
      if ((options?.attachments?.length || options?.enableAutoSemanticSearch) && !userId) {
        throw new Error('UserId required for file attachments or semantic search');
      }

      const streamAdapter = new StreamAdapter(sessionId);

      // Wrapper for event emission
      const emitEvent = (event: AgentEvent | null) => {
          if (event && onEvent) onEvent(event);
      };

      // ========== FILE CONTEXT PREPARATION ==========
      // Validate attachments and prepare file context
      const validatedFiles: ParsedFile[] = [];
      let fileContext: FileContextResult = {
        documentContext: '',
        systemInstructions: '',
        images: [],
        fileMap: new Map<string, string>(),
      };

      if (options?.attachments && options.attachments.length > 0 && userId) {
        // Manual attachments provided
        this.logger.info({ userId, count: options.attachments.length }, 'Validating attachments for graph');

        const fileService = getFileService();
        for (const fileId of options.attachments) {
          // Validate ownership and existence
          const file = await fileService.getFile(userId, fileId);
          if (!file) {
            this.logger.warn({ userId, fileId }, 'Invalid attachment or access denied');
            throw new Error(`Access denied or file not found: ${fileId}`);
          }
          validatedFiles.push(file);
        }
        this.logger.info('✅ Graph attachments validated successfully');

        // Prepare file context for injection into prompt
        fileContext = await this.prepareFileContext(userId, validatedFiles, prompt);
        this.logger.info({
          fileCount: validatedFiles.length,
          hasDocContext: fileContext.documentContext.length > 0,
          hasImages: fileContext.images.length > 0,
        }, '✅ File context prepared for graph');
      } else if (options?.enableAutoSemanticSearch === true && userId) {
        // ========== SEMANTIC SEARCH (Auto Context) ==========
        // When enableAutoSemanticSearch is TRUE and no manual attachments, search for relevant files
        try {
          const semanticSearchService = getSemanticSearchService();
          const searchResults = await semanticSearchService.searchRelevantFiles({
            userId,
            query: prompt,
            threshold: options?.semanticThreshold,
            maxFiles: options?.maxSemanticFiles ?? 3,
          });

          if (searchResults.results.length > 0) {
            this.logger.info({
              userId,
              queryPreview: prompt.substring(0, 50),
              matchedFiles: searchResults.results.length,
              topScore: searchResults.results[0]?.relevanceScore,
            }, '🔍 Semantic search found relevant files for graph');

            // Convert search results to ParsedFile format for prepareFileContext
            const fileService = getFileService();
            for (const result of searchResults.results) {
              const file = await fileService.getFile(userId, result.fileId);
              if (file) {
                validatedFiles.push(file);
              }
            }

            if (validatedFiles.length > 0) {
              // Prepare file context with semantically matched files
              fileContext = await this.prepareFileContext(userId, validatedFiles, prompt);
              this.logger.info({
                fileCount: validatedFiles.length,
                hasDocContext: fileContext.documentContext.length > 0,
                source: 'semantic_search',
              }, '✅ Semantic file context prepared for graph');
            }
          } else {
            this.logger.debug({
              userId,
              queryPreview: prompt.substring(0, 50),
              threshold: options?.semanticThreshold ?? 0.7,
            }, 'No semantically relevant files found for graph');
          }
        } catch (error) {
          // Don't fail the request if semantic search fails - just log and continue
          this.logger.warn({
            error,
            userId,
            queryPreview: prompt.substring(0, 50)
          }, 'Semantic search failed for graph, continuing without file context');
        }
      }

      // ========== EXTENDED THINKING ==========
      // Extract thinking options
      const enableThinking = options?.enableThinking ?? false;
      const thinkingBudget = options?.thinkingBudget ?? 10000;

      // Enhanced prompt with file context if available
      const enhancedPrompt = fileContext.documentContext
        ? `${fileContext.documentContext}\n\n${prompt}`
        : prompt;

      // Build graph inputs with context
      const inputs = {
          messages: [new HumanMessage(enhancedPrompt)],
          activeAgent: "orchestrator",
          sessionId: sessionId,
          context: {
            userId,
            fileContext,
            options: {
              enableThinking,
              thinkingBudget,
              attachments: options?.attachments,
              enableAutoSemanticSearch: options?.enableAutoSemanticSearch,
              validatedFiles: validatedFiles.length > 0 ? validatedFiles.map(f => ({ id: f.id, name: f.name })) : undefined,
            }
          }
      };

      this.logger.info({
        sessionId,
        userId,
        enableThinking,
        thinkingBudget: enableThinking ? thinkingBudget : undefined,
        hasFileContext: fileContext.documentContext.length > 0,
        fileCount: validatedFiles.length,
        semanticSearch: options?.enableAutoSemanticSearch,
      }, '✅ Graph inputs prepared with enhanced context');

      // Stream the graph execution with granular events
      this.logger.info({
        sessionId,
        recursionLimit: 50,
        hasEnhancedPrompt: fileContext.documentContext.length > 0,
        inputMessageCount: inputs.messages.length
      }, 'Starting LangGraph stream execution');

      const eventStream = await orchestratorGraph.streamEvents(inputs, {
          version: 'v2',
          recursionLimit: 50
      });

      const toolsUsed: string[] = [];
      const eventStore = getEventStore(); // Get singleton
      const messageQueue = getMessageQueue(); // Get MessageQueue singleton for persistence to messages table

      // Initial persistence for user message (use enhanced prompt for persistence)
      await eventStore.appendEvent(
          sessionId,
          'user_message_sent',
          {
              content: prompt, // Store original prompt, not enhanced
              timestamp: new Date().toISOString(),
              persistenceState: 'persisted'
          }
      );

      // ========== EXTENDED THINKING INITIAL EVENT ==========
      // Emit initial thinking event ONCE per user message (similar to executeQueryStreaming)
      // This signals to the frontend that Claude is processing with extended thinking enabled
      if (enableThinking && onEvent) {
          const thinkingStartEvent = await eventStore.appendEvent(
              sessionId,
              'agent_thinking_started',
              {
                  content: 'Analyzing your request...',
                  started_at: new Date().toISOString(),
                  thinking_budget: thinkingBudget,
              }
          );

          onEvent({
              type: 'thinking',
              content: 'Analyzing your request...',
              eventId: thinkingStartEvent.id,
              sequenceNumber: thinkingStartEvent.sequence_number,
              timestamp: new Date(),
              persistenceState: 'persisted',
          } as AgentEvent);

          this.logger.info({ sessionId, thinkingBudget }, '🧠 Extended Thinking enabled - initial thinking event emitted');
      }

      // Track final response content and stop reason
      const finalResponseChunks: string[] = [];
      let finalResponse = '';
      let capturedStopReason = 'end_turn'; // Default stop reason

      try {
          for await (const event of eventStream) {
               // [DEBUG-AGENT] Log ALL LangGraph events for debugging tool_use visibility
               console.log('[DEBUG-AGENT] RAW LangGraph event:', {
                   event: event.event,
                   name: event.name,
                   runId: event.run_id,
                   dataKeys: Object.keys(event.data || {}),
                   dataPreview: JSON.stringify(event.data).substring(0, 300)
               });

               // Log all events received from LangGraph
               this.logger.debug({
                 eventType: event.event,
                 eventName: event.name,
                 runId: event.run_id
               }, 'DirectAgentService: Received stream event from LangGraph');

               // Process event via adapter
               const agentEvent = streamAdapter.processChunk(event);

               // Log adapter output
               if (agentEvent) {
                 this.logger.debug({
                   agentEventType: agentEvent.type,
                   hasContent: !!(agentEvent as { content?: string }).content,
                   contentLength: typeof (agentEvent as { content?: string }).content === 'string'
                     ? (agentEvent as { content?: string }).content?.length
                     : undefined
                 }, 'DirectAgentService: StreamAdapter produced event');
               } else {
                 this.logger.debug({
                   eventType: event.event,
                   eventName: event.name
                 }, 'DirectAgentService: StreamAdapter returned null');
               }

               // Capture final state from on_chain_end event
               if (event.event === 'on_chain_end' && event.name === '__end__') {
                   const output = event.data?.output;
                   if (output?.messages && Array.isArray(output.messages) && output.messages.length > 0) {
                       const lastMessage = output.messages[output.messages.length - 1];
                       // Extract content from AIMessage
                       if (lastMessage && typeof lastMessage.content === 'string') {
                           finalResponse = lastMessage.content;
                       } else if (lastMessage?.content) {
                           finalResponse = String(lastMessage.content);
                       }

                       // Extract stop_reason from response_metadata (LangChain format)
                       const responseMetadata = lastMessage?.response_metadata as Record<string, unknown> | undefined;
                       if (responseMetadata?.stop_reason) {
                           capturedStopReason = String(responseMetadata.stop_reason);
                       }

                       this.logger.debug({
                         hasFinalResponse: !!finalResponse,
                         finalResponseLength: finalResponse.length,
                         messageCount: output.messages.length,
                         stopReason: capturedStopReason
                       }, 'DirectAgentService: Captured final response from chain end');
                   }

                   // ========== PROCESS TOOL EXECUTIONS FROM AGENTS ==========
                   // Agents track tool executions in their ReAct loops and return them in state.
                   // We need to emit and persist tool_result events for each execution.
                   if (output?.toolExecutions && Array.isArray(output.toolExecutions) && output.toolExecutions.length > 0) {
                       this.logger.info({
                           sessionId,
                           toolExecutionsCount: output.toolExecutions.length,
                       }, '🔧 Processing tool executions from agent state');

                       for (const exec of output.toolExecutions) {
                           // Create tool_result event
                           const toolResultAgentEvent = {
                               type: 'tool_result' as const,
                               toolName: exec.toolName,
                               toolUseId: exec.toolUseId,
                               args: exec.args,
                               result: exec.result,
                               success: exec.success,
                               error: exec.error,
                               timestamp: new Date(),
                               eventId: randomUUID(),
                               persistenceState: 'persisted' as const,
                           };

                           this.logger.debug({
                               toolUseId: exec.toolUseId,
                               toolName: exec.toolName,
                               success: exec.success,
                           }, '🔧 Emitting tool_result event from agent execution');

                           // 1. Persist to EventStore (audit log)
                           const toolResultDbEvent = await eventStore.appendEvent(
                               sessionId,
                               'tool_use_completed',
                               {
                                   ...toolResultAgentEvent,
                                   persistenceState: 'persisted'
                               }
                           );

                           // 2. Enqueue to MessageQueue for messages table persistence
                           await messageQueue.addMessagePersistence({
                               sessionId,
                               messageId: `${exec.toolUseId}_result`,
                               role: 'assistant',
                               messageType: 'tool_result',
                               content: exec.result,
                               metadata: {
                                   tool_name: exec.toolName,
                                   tool_use_id: exec.toolUseId,
                                   success: exec.success,
                                   error_message: exec.error,
                               },
                               sequenceNumber: toolResultDbEvent.sequence_number,
                               eventId: toolResultDbEvent.id,
                               toolUseId: exec.toolUseId,
                           });

                           this.logger.info({
                               toolUseId: exec.toolUseId,
                               toolName: exec.toolName,
                               success: exec.success,
                               sequenceNumber: toolResultDbEvent.sequence_number,
                           }, '💾 Tool result persisted from agent execution');

                           // 3. Emit to socket for live UI update
                           emitEvent(toolResultAgentEvent);

                           // Track tools used
                           toolsUsed.push(exec.toolName);
                       }
                   }
               }

               // Also accumulate message chunks for streaming responses
               if (agentEvent && agentEvent.type === 'message_chunk' && agentEvent.content) {
                   finalResponseChunks.push(agentEvent.content);
                   this.logger.debug({
                     chunkContent: agentEvent.content,
                     chunkLength: agentEvent.content.length,
                     totalChunks: finalResponseChunks.length
                   }, 'DirectAgentService: Accumulated message chunk');
               }

               if (agentEvent) {
                   // Emit to live socket (exclude usage events if they aren't standard AgentEvents)
                   if (agentEvent.type !== 'usage') {
                       this.logger.debug({
                         eventType: agentEvent.type,
                         willEmit: !!onEvent
                       }, 'DirectAgentService: Emitting event to WebSocket');
                       emitEvent(agentEvent);
                   }

                   // Handle Usage Tracking
                   if (agentEvent.type === 'usage') {
                       const usage = (agentEvent as unknown as UsageEvent).usage;
                       const inputTokens = usage.input_tokens || 0;
                       const outputTokens = usage.output_tokens || 0;

                       // 1. Track via UsageTrackingService (analytics)
                       const trackingService = getUsageTrackingService();
                       await trackingService.trackClaudeUsage(
                           userId || 'unknown',
                           sessionId,
                           inputTokens,
                           outputTokens,
                           'claude-3-5-sonnet', // Default for now, ideally extracted from metadata
                           {
                               source: 'langgraph',
                               enableThinking,
                               thinkingBudget: enableThinking ? thinkingBudget : undefined,
                               fileCount: validatedFiles.length,
                           }
                       );

                       // 2. Record via TokenUsageService (billing analytics)
                       if (userId) {
                           const tokenUsageService = getTokenUsageService();
                           tokenUsageService.recordUsage({
                               userId,
                               sessionId,
                               messageId: `graph_${sessionId}_${Date.now()}`,
                               model: 'claude-3-5-sonnet', // TODO: Extract from response metadata
                               inputTokens,
                               outputTokens,
                               thinkingEnabled: enableThinking,
                               thinkingBudget: enableThinking ? thinkingBudget : undefined,
                           }).catch((error) => {
                               this.logger.warn({ error, sessionId }, 'Failed to record token usage via TokenUsageService');
                           });
                       }

                       this.logger.debug({ usage, inputTokens, outputTokens }, '💰 Usage tracked via both services');
                       continue; // Don't persist 'usage' event to eventStore as it is not a standard event type
                   }

                   // Persist to database (Audit/History)
                   if (agentEvent.persistenceState === 'transient') {
                       // Transient events (like tokens) aren't historically persisted individually usually,
                       // but MessageChunks might be aggregated.
                       // For now, let's persist tool usage and significant events.
                   }

                   // ========== TOOL_USE PERSISTENCE ==========
                   if (agentEvent.type === 'tool_use') {
                       // 1. Persist to EventStore (audit log)
                       const toolUseEvent = await eventStore.appendEvent(
                           sessionId,
                           'tool_use_requested',
                           {
                               ...agentEvent,
                               persistenceState: 'persisted'
                           }
                       );

                       // 2. Enqueue to MessageQueue for messages table persistence
                       await messageQueue.addMessagePersistence({
                           sessionId,
                           messageId: agentEvent.toolUseId,
                           role: 'assistant',
                           messageType: 'tool_use',
                           content: '', // Tool use content is in metadata
                           metadata: {
                               tool_name: agentEvent.toolName,
                               tool_args: agentEvent.args,
                               tool_use_id: agentEvent.toolUseId,
                               status: 'pending',
                           },
                           sequenceNumber: toolUseEvent.sequence_number,
                           eventId: toolUseEvent.id,
                           toolUseId: agentEvent.toolUseId,
                       });
                       this.logger.debug({ toolUseId: agentEvent.toolUseId, toolName: agentEvent.toolName },
                           '💾 Tool use persisted to EventStore and queued to MessageQueue');

                       // Track tools used
                       toolsUsed.push(agentEvent.toolName);
                   }

                   // ========== TOOL_RESULT PERSISTENCE ==========
                   if (agentEvent.type === 'tool_result') {
                       // 1. Persist to EventStore (audit log)
                       const toolResultEvent = await eventStore.appendEvent(
                           sessionId,
                           'tool_use_completed',
                           {
                               ...agentEvent,
                               persistenceState: 'persisted'
                           }
                       );

                       // 2. Enqueue to MessageQueue for messages table persistence
                       await messageQueue.addMessagePersistence({
                           sessionId,
                           messageId: `${agentEvent.toolUseId}_result`,
                           role: 'assistant',
                           messageType: 'tool_result',
                           content: typeof agentEvent.result === 'string'
                               ? agentEvent.result
                               : JSON.stringify(agentEvent.result),
                           metadata: {
                               tool_name: agentEvent.toolName,
                               tool_use_id: agentEvent.toolUseId,
                               success: agentEvent.success,
                               error_message: agentEvent.error,
                           },
                           sequenceNumber: toolResultEvent.sequence_number,
                           eventId: toolResultEvent.id,
                           toolUseId: agentEvent.toolUseId,
                       });
                       this.logger.debug({ toolUseId: agentEvent.toolUseId, success: agentEvent.success },
                           '💾 Tool result persisted to EventStore and queued to MessageQueue');
                   }

                   // ========== ERROR PERSISTENCE ==========
                   if (agentEvent.type === 'error') {
                       await eventStore.appendEvent(
                           sessionId,
                           'error_occurred',
                           {
                               ...agentEvent,
                               persistenceState: 'persisted'
                           }
                       );
                   }
               }
          }
      } catch (streamError) {
          // Log comprehensive error details before propagating
          this.logger.error({
              error: streamError instanceof Error ? streamError.message : String(streamError),
              stack: streamError instanceof Error ? streamError.stack : undefined,
              errorType: streamError?.constructor?.name || typeof streamError,
              sessionId,
              userId,
              additionalProps: streamError instanceof Error ? Object.keys(streamError).filter(k => k !== 'message' && k !== 'stack') : undefined
          }, 'DirectAgentService: Error during graph stream processing');
          throw streamError; // Re-throw to propagate to ChatMessageHandler
      }

      // Use final response from graph state, or fallback to accumulated chunks
      const responseContent = finalResponse || finalResponseChunks.join('') || 'No response generated';

      this.logger.info({
        sessionId,
        responseLength: responseContent.length,
        toolsUsed,
        enableThinking,
        fileCount: validatedFiles.length,
      }, '✅ Graph execution complete');

      // ========== EMIT TERMINAL EVENTS ==========
      // The frontend expects 'message' and 'complete' events to finalize the response
      // These were previously emitted by executeQueryStreaming via this.emitter
      if (onEvent) {
        // Use captured stop_reason from graph execution
        const effectiveStopReason = capturedStopReason as 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'pause_turn' | 'refusal';

        // ✨ FIXED: Explicitly persist the final message event
        const finalMessageEvent: AgentEvent = {
          type: 'message',
          content: responseContent,
          messageId: randomUUID(),
          role: 'assistant',
          stopReason: effectiveStopReason,
          timestamp: new Date(),
          eventId: randomUUID(),
          persistenceState: 'persisted'
        };

        // 1. Persist to EventStore FIRST (using snake_case data properties for EventStore)
        const finalMessageDbEvent = await eventStore.appendEvent(
            sessionId,
            'agent_message_sent',
            {
                message_id: finalMessageEvent.messageId,
                content: finalMessageEvent.content,
                stop_reason: effectiveStopReason,
                timestamp: finalMessageEvent.timestamp,
                persistenceState: 'persisted'
            }
        );

        // 2. Enqueue to MessageQueue for messages table persistence
        await messageQueue.addMessagePersistence({
            sessionId,
            messageId: finalMessageEvent.messageId,
            role: 'assistant',
            messageType: 'text',
            content: finalMessageEvent.content,
            metadata: {
                stop_reason: effectiveStopReason,
            },
            sequenceNumber: finalMessageDbEvent.sequence_number,
            eventId: finalMessageDbEvent.id,
            stopReason: effectiveStopReason,
        });
        this.logger.info({ sessionId, messageId: finalMessageEvent.messageId, stopReason: effectiveStopReason },
            '💾 Final message persisted to EventStore and queued to MessageQueue');

        // Then emit to frontend (using camelCase AgentEvent)
        onEvent(finalMessageEvent);

        // ========== HANDLE SPECIAL STOP REASONS ==========
        // Emit warnings for non-standard completion scenarios
        if (effectiveStopReason === 'max_tokens') {
            this.logger.warn({ sessionId }, '⚠️ Response truncated due to max_tokens');
            // The frontend should display a warning to the user
        } else if (effectiveStopReason === 'pause_turn') {
            this.logger.info({ sessionId }, '⏸️ Turn paused (extended thinking long turn)');
        } else if (effectiveStopReason === 'refusal') {
            this.logger.warn({ sessionId }, '🚫 Content refused by model');
        }

        // Emit complete event to signal end of execution
        const completeReason = effectiveStopReason === 'max_tokens' ? 'max_turns' :
                               effectiveStopReason === 'refusal' ? 'error' : 'success';
        const completeEvent: AgentEvent = {
          type: 'complete',
          reason: completeReason as 'success' | 'error' | 'max_turns' | 'user_cancelled',
          timestamp: new Date(),
          eventId: randomUUID(),
          persistenceState: 'transient'
        };

        // Optional: Persist completion event for audit
        await eventStore.appendEvent(
            sessionId,
            'session_ended',
            {
                reason: completeReason,
                stop_reason: effectiveStopReason,
                timestamp: completeEvent.timestamp,
                persistenceState: 'persisted'
            }
        );

        onEvent(completeEvent);
      }

      return {
          response: responseContent,
          success: true,
          toolsUsed: toolsUsed,
          sessionId
      };
  }
}

// Export singleton getter
let directAgentServiceInstance: DirectAgentService | null = null;

export function getDirectAgentService(
  approvalManager?: ApprovalManager,
  todoManager?: TodoManager,
  client?: IAnthropicClient
): DirectAgentService {
  if (!directAgentServiceInstance) {
    directAgentServiceInstance = new DirectAgentService(approvalManager, todoManager, client);
  }
  return directAgentServiceInstance;
}

/**
 * Reset DirectAgentService singleton for testing
 * Allows injecting FakeAnthropicClient via getDirectAgentService()
 * @internal Only for integration tests - DO NOT use in production
 */
export function __resetDirectAgentService(): void {
  directAgentServiceInstance = null;
}

/**
 * Exported for testing purposes only
 * These functions are used internally by MCP tool implementations
 */
export const __testExports = {
  sanitizeEntityName,
  sanitizeKeyword,
  isValidOperationType,
  sanitizeOperationId,
  VALID_OPERATION_TYPES,
};
//
