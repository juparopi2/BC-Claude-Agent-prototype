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
  ThinkingDelta,
  TextCitation,
  CitationsDelta,
  SignatureDelta,
} from '@anthropic-ai/sdk/resources/messages';
import { env } from '@/config';
import type { AgentEvent, AgentExecutionResult, CompleteEvent, ErrorEvent } from '@/types';
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
import { createChildLogger } from '@/utils/logger';
import type { Logger } from 'pino';
import * as fs from 'fs';
import * as path from 'path';

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
  thinkingBudget?: number;
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

      // Step 1: Get MCP tools and convert to Anthropic format
      const tools = await this.getMCPToolDefinitions();

      // Step 2: Add user message to history
      conversationHistory.push({
        role: 'user',
        content: prompt,
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
      if (onEvent) {
        onEvent({
          type: 'thinking',
          timestamp: new Date(thinkingEvent.timestamp),
          content: 'Analyzing your request...',
          eventId: thinkingEvent.id,
          sequenceNumber: thinkingEvent.sequence_number,
          persistenceState: 'persisted', // ⭐ Mark as already persisted
        });
      }

      // ✅ STEP 3: Add to MessageQueue (reuse sequence from persisted event)
      await messageQueue.addMessagePersistence({
        sessionId,
        messageId: thinkingEvent.id,
        role: 'assistant',
        messageType: 'thinking',
        content: '',
        metadata: {
          content: 'Analyzing your request...',
          started_at: new Date().toISOString(),
        },
        sequenceNumber: thinkingEvent.sequence_number, // ⭐ REUSE sequence
        eventId: thinkingEvent.id,
      });

      this.logger.info('✅ Thinking message queued for persistence', {
        sessionId,
        sequenceNumber: thinkingEvent.sequence_number,
        eventId: thinkingEvent.id,
      });

      // Step 3: Agentic Loop with Streaming
      let continueLoop = true;
      let turnCount = 0;
      const maxTurns = 20; // Safety limit
      let chunkCount = 0;

      while (continueLoop && turnCount < maxTurns) {
        turnCount++;
        chunkCount = 0; // Reset chunk counter per turn

        console.log(`\n========== TURN ${turnCount} (STREAMING) ==========`);

        // ✅ FIX PHASE 3: NO generar batch sequence
        // Chunks serán emitidos SIN sequence (transient)
        // Complete message será persistido PRIMERO con su propio sequence

        // ========== STREAM CLAUDE RESPONSE ==========
        console.log(`📡 [SEQUENCE] Starting turn ${turnCount} | NO batch sequence (chunks transient)`);

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

        // Accumulators for this turn
        let accumulatedText = '';
        const textBlocks: TextBlock[] = [];
        const thinkingBlocks: ThinkingBlock[] = [];
        const toolUses: ToolUseBlock[] = [];
        let stopReason: string | null = null;
        let messageId: string | null = null;

        // Track content blocks by index
        // For text blocks: data is string, citations is Array<TextCitation>
        // For thinking blocks: data is string, signature is string
        // For tool_use blocks: data is { id, name, input, inputJson }
        const contentBlocks: Map<number, {
          type: string;
          data: unknown;
          citations?: TextCitation[];
          signature?: string;  // ⭐ For thinking blocks - signature from signature_delta
        }> = new Map();

        // Process stream events
        for await (const event of stream) {
          switch (event.type) {
            case 'message_start':
              // Message begins - capture ID, model, and initial usage
              messageId = event.message.id;
              modelName = event.message.model;  // NEW: Capture model name
              inputTokens += event.message.usage.input_tokens;
              // ⭐ Capture cache tokens for billing analytics
              if (event.message.usage.cache_creation_input_tokens) {
                cacheCreationInputTokens += event.message.usage.cache_creation_input_tokens;
              }
              if (event.message.usage.cache_read_input_tokens) {
                cacheReadInputTokens += event.message.usage.cache_read_input_tokens;
              }
              // ⭐ Capture service tier (affects pricing)
              if (event.message.usage.service_tier) {
                serviceTier = event.message.usage.service_tier as 'standard' | 'priority' | 'batch';
              }
              console.log(`[STREAM] message_start: id=${messageId}, model=${modelName}, input_tokens=${event.message.usage.input_tokens}, cache_read=${cacheReadInputTokens}, cache_create=${cacheCreationInputTokens}`);
              break;

            case 'content_block_start':
              // New content block starts (text, tool_use, or thinking)
              console.log(`[STREAM] content_block_start: index=${event.index}, type=${event.content_block.type}`);

              if (event.content_block.type === 'text') {
                // Initialize with empty citations array - will be populated by citations_delta events
                contentBlocks.set(event.index, {
                  type: 'text',
                  data: '', // Will accumulate in deltas
                  citations: [], // ⭐ Citations will be added via citations_delta
                });
              } else if (event.content_block.type === 'thinking') {
                // ⭐ Phase 1F: Extended Thinking block starts
                contentBlocks.set(event.index, {
                  type: 'thinking',
                  data: '', // Will accumulate thinking content in deltas
                  signature: '', // ⭐ Will be set by signature_delta
                });

                this.logger.info({
                  sessionId,
                  turnCount,
                  eventIndex: event.index,
                }, '🧠 [THINKING] Extended thinking block started');
              } else if (event.content_block.type === 'tool_use') {
                // ⭐ TRACING POINT 1: SDK proporciona el ID
                let toolUseId = event.content_block.id;

                this.logger.info({
                  sessionId,
                  turnCount,
                  toolName: event.content_block.name,
                  toolUseId,
                  hasId: !!toolUseId,
                  idType: typeof toolUseId,
                  idValue: toolUseId,
                  idLength: toolUseId?.length || 0,
                  eventIndex: event.index,
                }, '🔍 [TRACE 1/8] SDK content_block_start');

                // ⭐ VALIDACIÓN: Asegurar que SDK proporcionó ID válido
                if (!toolUseId || toolUseId === 'undefined' || typeof toolUseId !== 'string' || toolUseId.trim() === '') {
                  // 🚨 FALLBACK: Generar UUID + log crítico
                  toolUseId = `toolu_fallback_${randomUUID()}`;

                  this.logger.error('🚨 SDK NO proporcionó tool use ID - usando fallback', {
                    sessionId,
                    turnCount,
                    toolName: event.content_block.name,
                    originalId: event.content_block.id,
                    originalIdType: typeof event.content_block.id,
                    fallbackId: toolUseId,
                    sdkEventType: event.type,
                    eventIndex: event.index,
                  });
                }

                // ⭐ TRACING POINT 2: Guardando en contentBlocks Map
                this.logger.info({
                  sessionId,
                  turnCount,
                  eventIndex: event.index,
                  toolUseId,
                  toolName: event.content_block.name,
                }, '🔍 [TRACE 2/8] Storing in contentBlocks Map');

                contentBlocks.set(event.index, {
                  type: 'tool_use',
                  data: {
                    id: toolUseId,  // ⭐ Ahora garantizado válido
                    name: event.content_block.name,
                    input: {}, // Will accumulate in deltas
                  },
                });

                // ✅ FIX PHASE 2: Persist tool_use event BEFORE emitting
                const toolUseEvent = await eventStore.appendEvent(
                  sessionId,
                  'tool_use_requested',
                  {
                    tool_use_id: toolUseId,  // ⭐ Use validated ID
                    tool_name: event.content_block.name,
                    tool_args: {}, // Will be updated in content_block_stop
                  }
                );

                this.logger.info('✅ Tool use event appended to EventStore', {
                  sessionId,
                  toolUseId,  // ⭐ Use validated ID
                  toolName: event.content_block.name,
                  eventId: toolUseEvent.id,
                  sequenceNumber: toolUseEvent.sequence_number,
                });

                // ✅ STEP 2: Emit AFTER with data from persisted event
                if (onEvent) {
                  onEvent({
                    type: 'tool_use',
                    toolName: event.content_block.name,
                    toolUseId: toolUseId,  // ⭐ Use validated ID
                    args: {}, // Will be populated in deltas
                    timestamp: new Date(toolUseEvent.timestamp),
                    eventId: toolUseEvent.id,
                    sequenceNumber: toolUseEvent.sequence_number,
                    persistenceState: 'persisted',
                  });
                }

                // ✅ STEP 3: Add to MessageQueue (reuse sequence from persisted event)
                // ⭐ PHASE 1B: Use Anthropic tool_use_id directly as message ID
                // This maintains correlation with Anthropic's IDs and eliminates UUID generation
                await messageQueue.addMessagePersistence({
                  sessionId,
                  messageId: toolUseId,  // ⭐ PHASE 1B: Use Anthropic tool_use_id (format: toolu_...)
                  role: 'assistant',
                  messageType: 'tool_use',
                  content: '',
                  metadata: {
                    tool_name: event.content_block.name,
                    tool_args: {},
                    tool_use_id: toolUseId,
                    status: 'pending',
                  },
                  sequenceNumber: toolUseEvent.sequence_number,
                  eventId: toolUseEvent.id,
                  toolUseId: toolUseId,
                });

                this.logger.info('✅ Tool use message queued for persistence', {
                  sessionId,
                  toolUseId,  // ⭐ Use validated ID
                  sequenceNumber: toolUseEvent.sequence_number,
                  eventId: toolUseEvent.id,
                });
              }
              break;

            case 'content_block_delta':
              // Incremental content arrives
              const block = contentBlocks.get(event.index);

              if (!block) {
                console.warn(`[STREAM] content_block_delta for unknown index ${event.index}`);
                break;
              }

              if (event.delta.type === 'text_delta') {
                // Text chunk arrived
                const chunk = event.delta.text;
                block.data = (block.data as string) + chunk;
                accumulatedText += chunk;

                // ✅ FIX PHASE 3: EMIT CHUNK IMMEDIATELY WITHOUT sequence (transient)
                if (onEvent && chunk) {
                  chunkCount++;

                  console.log(`📦 [SEQUENCE] chunk (transient) | NO sequence, chunk=${chunkCount}`);

                  this.logger.debug('📦 [SEQUENCE] Emitting message_chunk (transient)', {
                    sessionId,
                    turnCount,
                    chunkIndex: chunkCount,
                    chunkLength: chunk.length,
                    timestamp: new Date().toISOString(),
                  });

                  onEvent({
                    type: 'message_chunk',
                    content: chunk,
                    timestamp: new Date(),
                    // ✅ NO sequenceNumber (chunks son transient)
                    eventId: randomUUID(), // ⭐ Unique eventId per chunk
                    persistenceState: 'transient', // ⭐ Marca como transient
                  });
                }

                console.log(`[STREAM] text_delta: index=${event.index}, chunk_len=${chunk.length}`);
              } else if (event.delta.type === 'thinking_delta') {
                // ⭐ Phase 1F: Extended Thinking chunk arrived (using native SDK type)
                const thinkingDelta = event.delta as ThinkingDelta;
                const thinkingChunk = thinkingDelta.thinking;

                if (block.type === 'thinking') {
                  block.data = (block.data as string) + thinkingChunk;

                  // Emit thinking_chunk event (transient, for real-time display)
                  if (onEvent && thinkingChunk) {
                    this.logger.debug('🧠 [THINKING] Emitting thinking_chunk (transient)', {
                      sessionId,
                      turnCount,
                      chunkLength: thinkingChunk.length,
                    });

                    onEvent({
                      type: 'thinking_chunk',
                      content: thinkingChunk,
                      blockIndex: event.index,
                      timestamp: new Date(),
                      eventId: randomUUID(),
                      persistenceState: 'transient', // Thinking chunks are transient
                    });
                  }

                  console.log(`[STREAM] thinking_delta: index=${event.index}, chunk_len=${thinkingChunk.length}`);
                }
              } else if (event.delta.type === 'input_json_delta') {
                // Tool input chunk (JSON partial) - accumulate the JSON string
                const partialJson = event.delta.partial_json;
                const toolBlock = block.data as { id: string; name: string; input: Record<string, unknown>; inputJson?: string };

                // Accumulate JSON string (will parse when complete)
                toolBlock.inputJson = (toolBlock.inputJson || '') + partialJson;

                // Try to parse accumulated JSON (may be incomplete)
                try {
                  toolBlock.input = JSON.parse(toolBlock.inputJson);
                  console.log(`[STREAM] input_json_delta: index=${event.index}, parsed_input=${JSON.stringify(toolBlock.input)}`);
                } catch {
                  // JSON incomplete, will parse on next delta or at content_block_stop
                  console.log(`[STREAM] input_json_delta: index=${event.index}, json_len=${partialJson.length} (incomplete)`);
                }
              } else if (event.delta.type === 'citations_delta') {
                // ⭐ Citations delta - accumulate citations for text blocks
                const citationsDelta = event.delta as CitationsDelta;
                const citation = citationsDelta.citation;

                if (block.type === 'text' && block.citations) {
                  block.citations.push(citation);

                  this.logger.info({
                    sessionId,
                    turnCount,
                    eventIndex: event.index,
                    citationType: citation.type,
                    citedText: citation.cited_text?.substring(0, 50) + (citation.cited_text?.length > 50 ? '...' : ''),
                    totalCitations: block.citations.length,
                  }, '📚 [CITATIONS] Citation received');

                  console.log(`[STREAM] citations_delta: index=${event.index}, type=${citation.type}, total_citations=${block.citations.length}`);
                }
              } else if (event.delta.type === 'signature_delta') {
                // ⭐ Signature for thinking blocks (required for conversation history)
                const signatureDelta = event.delta as SignatureDelta;
                const signature = signatureDelta.signature;

                if (block.type === 'thinking') {
                  block.signature = signature;

                  this.logger.debug({
                    sessionId,
                    turnCount,
                    eventIndex: event.index,
                    signatureLength: signature.length,
                  }, '🧠 [THINKING] Signature received for thinking block');

                  console.log(`[STREAM] signature_delta: index=${event.index}, sig_len=${signature.length}`);
                }
              }
              break;

            case 'content_block_stop':
              // Content block completed
              const completedBlock = contentBlocks.get(event.index);

              if (!completedBlock) {
                console.warn(`[STREAM] content_block_stop for unknown index ${event.index}`);
                break;
              }

              if (completedBlock.type === 'text') {
                const finalText = completedBlock.data as string;
                const citations = completedBlock.citations || [];

                if (finalText.trim()) {
                  textBlocks.push({
                    type: 'text',
                    text: finalText,
                    citations: citations, // ⭐ Use accumulated citations from citations_delta events
                  });

                  // Log citations if present
                  if (citations.length > 0) {
                    this.logger.info({
                      sessionId,
                      turnCount,
                      eventIndex: event.index,
                      textLength: finalText.length,
                      citationsCount: citations.length,
                      citationTypes: citations.map(c => c.type),
                    }, '📚 [CITATIONS] Text block completed with citations');
                  }
                }
                console.log(`[STREAM] content_block_stop (text): index=${event.index}, text_len=${finalText.length}, citations=${citations.length}`);
              } else if (completedBlock.type === 'thinking') {
                // ⭐ Phase 1F: Extended Thinking block completed
                const finalThinkingContent = completedBlock.data as string;
                const signature = completedBlock.signature || '';

                // Estimate thinking tokens (approximately 4 characters per token)
                // Note: This is an estimate - actual tokens are counted as output_tokens by Anthropic
                const estimatedThinkingTokens = Math.ceil(finalThinkingContent.length / 4);
                thinkingTokens += estimatedThinkingTokens;

                // ⭐ Push to thinkingBlocks for conversation history
                // Anthropic requires thinking blocks to be included in subsequent assistant messages
                if (finalThinkingContent.trim() && signature) {
                  thinkingBlocks.push({
                    type: 'thinking',
                    thinking: finalThinkingContent,
                    signature: signature,
                  });

                  this.logger.info({
                    sessionId,
                    turnCount,
                    eventIndex: event.index,
                    thinkingContentLength: finalThinkingContent.length,
                    hasSignature: !!signature,
                    estimatedThinkingTokens,
                    totalThinkingTokens: thinkingTokens,
                  }, '🧠 [THINKING] Block completed and added to history');
                } else {
                  this.logger.warn({
                    sessionId,
                    turnCount,
                    eventIndex: event.index,
                    hasContent: !!finalThinkingContent.trim(),
                    hasSignature: !!signature,
                  }, '🧠 [THINKING] Block completed but NOT added to history (missing content or signature)');
                }

                console.log(`[STREAM] content_block_stop (thinking): index=${event.index}, content_len=${finalThinkingContent.length}, has_sig=${!!signature}, estimated_tokens=${estimatedThinkingTokens}`);
              } else if (completedBlock.type === 'tool_use') {
                const toolData = completedBlock.data as { id: string; name: string; input: Record<string, unknown> };

                // ⭐ TRACING POINT 3: Recuperando toolUseId del Map antes de push
                let validatedToolUseId = toolData.id;

                this.logger.info({
                  sessionId,
                  turnCount,
                  eventIndex: event.index,
                  toolUseId: validatedToolUseId,
                  toolName: toolData.name,
                  hasId: !!validatedToolUseId,
                  idType: typeof validatedToolUseId,
                  idValue: validatedToolUseId,
                  idLength: validatedToolUseId?.length || 0,
                }, '🔍 [TRACE 3/8] Retrieved from contentBlocks Map (content_block_stop)');

                // ⭐ VALIDACIÓN: Asegurar que el ID sigue siendo válido antes del push
                if (!validatedToolUseId || validatedToolUseId === 'undefined' || typeof validatedToolUseId !== 'string' || validatedToolUseId.trim() === '') {
                  // 🚨 FALLBACK: ID se corrompió entre content_block_start y content_block_stop
                  validatedToolUseId = `toolu_fallback_${randomUUID()}`;

                  this.logger.error('🚨 Tool use ID se corrompió antes de push - usando fallback', {
                    sessionId,
                    turnCount,
                    toolName: toolData.name,
                    originalId: toolData.id,
                    originalIdType: typeof toolData.id,
                    fallbackId: validatedToolUseId,
                    eventIndex: event.index,
                  });
                }

                // ⭐ TRACING POINT 4: Pushing to toolUses array con ID validado
                this.logger.info({
                  sessionId,
                  turnCount,
                  eventIndex: event.index,
                  toolUseId: validatedToolUseId,
                  toolName: toolData.name,
                  inputKeys: Object.keys(toolData.input),
                }, '🔍 [TRACE 4/8] Pushing to toolUses array');

                toolUses.push({
                  type: 'tool_use',
                  id: validatedToolUseId,  // ⭐ Use validated ID
                  name: toolData.name,
                  input: toolData.input,
                });
                console.log(`[STREAM] content_block_stop (tool_use): index=${event.index}, tool=${toolData.name}, id=${validatedToolUseId}`);
              }
              break;

            case 'message_delta':
              // Final token usage and stop_reason
              if (event.delta.stop_reason) {
                stopReason = event.delta.stop_reason;
                console.log(`[STREAM] message_delta: stop_reason=${stopReason}`);
              }
              if (event.usage) {
                outputTokens += event.usage.output_tokens;
                console.log(`[STREAM] message_delta: output_tokens=${event.usage.output_tokens}`);
              }
              break;

            case 'message_stop':
              // Message completed
              console.log(`[STREAM] message_stop`);
              break;

            default:
              console.log(`[STREAM] Unknown event type: ${(event as MessageStreamEvent).type}`);
          }
        }

        console.log(`[STREAM] Stream completed: stop_reason=${stopReason}, thinking_blocks=${thinkingBlocks.length}, text_blocks=${textBlocks.length}, tool_uses=${toolUses.length}`);

        // ========== TOKEN TRACKING LOGGING (Phase 1A + 1F) ==========
        console.log('[TOKEN TRACKING]', {
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
        });

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
        }

        // ========== EMIT COMPLETE MESSAGE ==========
        // ✅ FIX PHASE 3: Persist complete message FIRST, then emit
        if (accumulatedText.trim() && onEvent && sessionId) {
          // ✅ STEP 1: Persistir PRIMERO
          const completeMessageEvent = await eventStore.appendEvent(
            sessionId,
            'agent_message_sent',
            {
              content: accumulatedText,
              stop_reason: stopReason,
            }
          );

          console.log(`✅ [SEQUENCE] complete message | seq=${completeMessageEvent.sequence_number}, chunks=${chunkCount}`);

          this.logger.info('✅ Complete message event appended to EventStore', {
            sessionId,
            eventId: completeMessageEvent.id,
            sequenceNumber: completeMessageEvent.sequence_number,
            stopReason,
          });

          // ⭐ PHASE 1B: Assert messageId is always captured from Anthropic SDK
          // Anthropic SDK always emits message_start event with message.id
          // If messageId is null here, it indicates a critical SDK issue
          if (!messageId) {
            throw new Error(
              '[PHASE 1B] Message ID not captured from Anthropic SDK. ' +
              'This should never happen - message_start event must fire before message completion.'
            );
          }

          // ✅ STEP 2: Emitir DESPUÉS con datos del evento persistido
          // ⭐ PHASE 1A: Include token usage and model for admin visibility
          onEvent({
            type: 'message',
            messageId: messageId,  // ⭐ PHASE 1B: Use Anthropic ID directly (no UUID fallback)
            content: accumulatedText,
            role: 'assistant',
            stopReason: (stopReason as 'end_turn' | 'tool_use' | 'max_tokens') || undefined,
            timestamp: new Date(completeMessageEvent.timestamp),
            eventId: completeMessageEvent.id,
            sequenceNumber: completeMessageEvent.sequence_number,
            persistenceState: 'persisted',
            // ⭐ PHASE 1A + 1F: Token usage and model for billing/admin visibility
            tokenUsage: {
              inputTokens,
              outputTokens,
              thinkingTokens: thinkingTokens > 0 ? thinkingTokens : undefined,  // ⭐ PHASE 1F
            },
            model: modelName,
          });

          // ✅ STEP 3: Agregar a MessageQueue (reusa sequence)
          const messageType = stopReason === 'tool_use' ? 'thinking' : 'text';

          // ⭐ Collect all citations from text blocks
          const allCitations = textBlocks.flatMap(block => block.citations || []);

          await messageQueue.addMessagePersistence({
            sessionId,
            messageId: messageId,  // ⭐ PHASE 1B: Use Anthropic message ID directly
            role: 'assistant',
            messageType,
            content: accumulatedText,
            metadata: {
              stop_reason: stopReason,
              // ⭐ Citations for compliance/auditing
              citations: allCitations.length > 0 ? allCitations : undefined,
              citations_count: allCitations.length > 0 ? allCitations.length : undefined,
            },
            sequenceNumber: completeMessageEvent.sequence_number, // ⭐ REUSA sequence
            eventId: completeMessageEvent.id,
            stopReason: stopReason || null,
            // ⭐ PHASE 1A: Token tracking - persist to database
            // Note: thinkingTokens removed from DB persistence (Option A - 2025-11-24)
            // Thinking tokens are only shown in real-time WebSocket events
            model: modelName,
            inputTokens,
            outputTokens,
          });

          // Log if citations were persisted
          if (allCitations.length > 0) {
            this.logger.info({
              sessionId,
              messageId,
              citationsCount: allCitations.length,
              citationTypes: [...new Set(allCitations.map(c => c.type))],
            }, '📚 [CITATIONS] Persisted with message');
          }

          this.logger.info('✅ Complete message queued for persistence', {
            sessionId,
            sequenceNumber: completeMessageEvent.sequence_number,
            eventId: completeMessageEvent.id,
          });

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

          // Delay to allow DB saves to complete
          await new Promise(resolve => setTimeout(resolve, 600));

          for (const toolUse of toolUses) {
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
            try {
              const result = await this.executeMCPTool(toolUse.name, toolUse.input);

              // ⭐ TRACING POINT 6: Después de tool execution, antes de appendEvent
              this.logger.info({
                sessionId,
                turnCount,
                toolName: toolUse.name,
                toolUseId: validatedToolExecutionId,
                resultType: typeof result,
                resultPreview: typeof result === 'string' ? result.substring(0, 100) : JSON.stringify(result).substring(0, 100),
                success: true,
              }, '🔍 [TRACE 6/8] Tool executed, before appendEvent');

              // ✅ FIX PHASE 2: Persist tool_result event BEFORE emitting
              const toolResultEvent = await eventStore.appendEvent(
                sessionId,
                'tool_use_completed',
                {
                  tool_use_id: validatedToolExecutionId,  // ⭐ Use validated ID
                  tool_name: toolUse.name,
                  tool_result: result,
                  success: true,
                  error_message: null,
                }
              );

              this.logger.info('✅ Tool result event appended to EventStore', {
                sessionId,
                toolUseId: validatedToolExecutionId,  // ⭐ Use validated ID
                toolName: toolUse.name,
                success: true,
                eventId: toolResultEvent.id,
                sequenceNumber: toolResultEvent.sequence_number,
              });

              // ✅ STEP 2: Emit AFTER with data from persisted event
              if (onEvent) {
                onEvent({
                  type: 'tool_result',
                  toolName: toolUse.name,
                  toolUseId: validatedToolExecutionId,  // ⭐ Use validated ID
                  args: toolUse.input as Record<string, unknown>,
                  result: result,
                  success: true,
                  timestamp: new Date(toolResultEvent.timestamp),
                  eventId: toolResultEvent.id,
                  sequenceNumber: toolResultEvent.sequence_number,
                  persistenceState: 'persisted',
                });
              }

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

              // ✅ FIX PHASE 2: Persist tool_result event BEFORE emitting (ERROR case)
              const errorMessage = error instanceof Error ? error.message : String(error);
              const toolResultEvent = await eventStore.appendEvent(
                sessionId,
                'tool_use_completed',
                {
                  tool_use_id: validatedToolExecutionId,  // ⭐ Use validated ID
                  tool_name: toolUse.name,
                  tool_result: null,
                  success: false,
                  error_message: errorMessage,
                }
              );

              this.logger.error('❌ Tool result event (error) appended to EventStore', {
                sessionId,
                toolUseId: validatedToolExecutionId,  // ⭐ Use validated ID
                toolName: toolUse.name,
                success: false,
                error: errorMessage,
                eventId: toolResultEvent.id,
                sequenceNumber: toolResultEvent.sequence_number,
              });

              // ✅ STEP 2: Emit AFTER with data from persisted event
              if (onEvent) {
                onEvent({
                  type: 'tool_result',
                  toolName: toolUse.name,
                  toolUseId: validatedToolExecutionId,  // ⭐ Use validated ID
                  args: toolUse.input as Record<string, unknown>,
                  result: null,
                  success: false,
                  error: errorMessage,
                  timestamp: new Date(toolResultEvent.timestamp),
                  eventId: toolResultEvent.id,
                  sequenceNumber: toolResultEvent.sequence_number,
                  persistenceState: 'persisted',
                });
              }

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

          if (onEvent) {
            // ⭐ PHASE 1B: Use event ID as message ID for system-generated messages
            onEvent({
              type: 'message',
              messageId: `system_max_tokens_${warningEvent.id}`,  // ⭐ PHASE 1B: Derived from event ID
              content: '[Response truncated - reached max tokens]',
              role: 'assistant',
              timestamp: new Date(warningEvent.timestamp),
              eventId: warningEvent.id,
              sequenceNumber: warningEvent.sequence_number,
              persistenceState: 'persisted',
            });
            accumulatedResponses.push('[Response truncated - reached max tokens]');
          }
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

          if (onEvent) {
            onEvent({
              type: 'message',
              messageId: messageId || `system_stop_sequence_${stopSeqEvent.id}`,
              content: accumulatedText || '[Stopped at custom sequence]',
              role: 'assistant',
              stopReason: 'stop_sequence',
              timestamp: new Date(stopSeqEvent.timestamp),
              eventId: stopSeqEvent.id,
              sequenceNumber: stopSeqEvent.sequence_number,
              persistenceState: 'persisted',
            });
          }
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

          if (onEvent) {
            // Emit specific turn_paused event for frontend handling
            onEvent({
              type: 'turn_paused',
              messageId: messageId || `system_pause_turn_${pauseEvent.id}`,
              content: accumulatedText,
              reason: 'Long-running turn was paused by Claude. The conversation can be continued.',
              timestamp: new Date(pauseEvent.timestamp),
              eventId: pauseEvent.id,
              sequenceNumber: pauseEvent.sequence_number,
              persistenceState: 'persisted',
            });
          }
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

          if (onEvent) {
            // Emit specific content_refused event for frontend handling
            onEvent({
              type: 'content_refused',
              messageId: messageId || `system_refusal_${refusalEvent.id}`,
              content: accumulatedText,
              reason: 'Claude declined to generate this content due to usage policies.',
              timestamp: new Date(refusalEvent.timestamp),
              eventId: refusalEvent.id,
              sequenceNumber: refusalEvent.sequence_number,
              persistenceState: 'persisted',
            });
          }
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

        if (onEvent) {
          // ⭐ PHASE 1B: Use event ID as message ID for system-generated messages
          onEvent({
            type: 'message',
            messageId: `system_max_turns_${maxTurnsEvent.id}`,  // ⭐ PHASE 1B: Derived from event ID
            content: '[Execution stopped - reached maximum turns]',
            role: 'assistant',
            timestamp: new Date(maxTurnsEvent.timestamp),
            eventId: maxTurnsEvent.id,
            sequenceNumber: maxTurnsEvent.sequence_number,
            persistenceState: 'persisted',
          });
          accumulatedResponses.push('[Execution stopped - reached maximum turns]');
        }
      }

      const duration = Date.now() - startTime;

      // ✅ FIX PHASE 4: Send completion event (transient - not persisted)
      if (onEvent) {
        onEvent({
          type: 'complete',
          reason: 'success',
          timestamp: new Date(),
          eventId: randomUUID(),
          persistenceState: 'transient', // ⭐ System event, not persisted
        } as CompleteEvent);
      }

      return {
        success: true,
        response: accumulatedResponses.join('\n\n'),
        toolsUsed,
        duration,
        inputTokens,
        outputTokens,
      };

    } catch (error) {
      const duration = Date.now() - startTime;

      console.error(`[DirectAgentService] Streaming query execution failed:`, error);

      // ✅ FIX PHASE 4: Send error event (transient - not persisted)
      if (onEvent && sessionId) {
        onEvent({
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
          eventId: randomUUID(),
          persistenceState: 'transient', // ⭐ System event, not persisted
        } as ErrorEvent);
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        response: '',
        toolsUsed,
        duration,
        inputTokens,
        outputTokens,
      };
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
   * Implements MCP tool logic directly (bypassing SDK MCP server)
   */
  private async executeMCPTool(toolName: string, input: unknown): Promise<unknown> {
    console.log(`[DirectAgentService] Executing MCP tool: ${toolName}`);

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

Always use tools to provide accurate, up-to-date information from Business Central.`;
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
