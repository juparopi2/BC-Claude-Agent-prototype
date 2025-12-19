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

// Note: Anthropic SDK types (MessageParam, ToolUseBlock, etc.) were removed
// as they were used by executeQueryStreaming which was deprecated in Phase 1.
// The runGraph method uses LangChain for orchestration instead.
import { env } from '@/infrastructure/config';
import type { AgentEvent, BaseAgentEvent, AgentExecutionResult, UsageEvent } from '@/types';
import type { ApprovalManager } from '../approval/ApprovalManager';
import type { TodoManager } from '../todo/TodoManager';
import type { IAnthropicClient } from './IAnthropicClient';
import { AnthropicClient } from './AnthropicClient';
import { randomUUID } from 'crypto';
import { getEventStore } from '../events/EventStore';
import { getMessageQueue } from '../queue/MessageQueue';
import { getTokenUsageService } from '../token-usage/TokenUsageService';
import { getUsageTrackingService } from '../tracking/UsageTrackingService';
import { getMessageEmitter, type IMessageEmitter } from './messages';
import { createChildLogger } from '@/shared/utils/logger';
import type { Logger } from 'pino';
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
import { StreamAdapterFactory } from '@/core/providers/adapters';

// Note: BC Index types (BCEndpoint, BCIndexEntity, BCIndex, etc.) were removed
// as they were used by executeQueryStreaming which was deprecated in Phase 1.
// The MCP tools and BC integration now use types from @bc-agent/shared.

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
  // Note: toolDataAccumulators was used by executeQueryStreaming (removed)
  // runGraph processes tools via toolExecutions at on_chain_end instead

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

      const streamAdapter = StreamAdapterFactory.create('anthropic', sessionId);

      // Event index counter for ordering - ensures events can be sorted even without sequence numbers
      let eventIndex = 0;

      // Wrapper for event emission - adds eventIndex for ordering
      const emitEvent = (event: AgentEvent | null) => {
          if (event && onEvent) {
              // Add eventIndex for frontend sorting (helps with transient events without sequence numbers)
              const eventWithIndex = { ...event, eventIndex: eventIndex++ };
              onEvent(eventWithIndex);
          }
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
      const emittedToolUseIds = new Set<string>(); // Track emitted tool IDs to prevent duplicates
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
      // NOTE: Removed initial thinking event emission to avoid duplicate thinking messages.
      // The final thinking event (with accumulated content) is emitted at the end of runGraph
      // in the "FIX 4: PERSIST THINKING CONTENT" section (lines ~1089-1134).
      // Frontend will receive thinking_chunk events during streaming and a final 'thinking'
      // event with the complete content after graph execution completes.
      if (enableThinking) {
          this.logger.info({ sessionId, thinkingBudget }, '🧠 Extended Thinking enabled - will emit thinking after graph completes');
      }

      // Track final response content and stop reason
      const finalResponseChunks: string[] = [];
      let finalResponse = '';
      let capturedStopReason = 'end_turn'; // Default stop reason

      // FIX 4 & 5: Track thinking content for persistence and thinking_complete signal
      const thinkingChunks: string[] = [];
      let thinkingComplete = false;  // Flag to track if thinking phase has ended

      try {
          for await (const event of eventStream) {
               // Log all events received from LangGraph
               this.logger.debug({
                 eventType: event.event,
                 eventName: event.name,
                 runId: event.run_id
               }, 'DirectAgentService: Received stream event from LangGraph');

               // Process event via adapter
               const normalizedEvent = streamAdapter.processChunk(event);
               // Note: UsageEvent is backend-only and not part of AgentEvent union,
               // but we need to handle it in the same stream processing loop
               let agentEvent: AgentEvent | UsageEvent | null = null;

               if (normalizedEvent) {
                   if (normalizedEvent.type === 'reasoning_delta') {
                       agentEvent = {
                           type: 'thinking_chunk',
                           content: normalizedEvent.reasoning || '',
                           blockIndex: normalizedEvent.metadata.blockIndex,
                           timestamp: normalizedEvent.timestamp.toISOString(),
                           eventId: randomUUID(),
                           persistenceState: 'transient',
                           messageId: normalizedEvent.metadata.messageId
                       } as unknown as AgentEvent;
                   } else if (normalizedEvent.type === 'content_delta') {
                       agentEvent = {
                           type: 'message_chunk',
                           content: normalizedEvent.content || '',
                           citations: normalizedEvent.citation ? [normalizedEvent.citation] : undefined,
                           blockIndex: normalizedEvent.metadata.blockIndex,
                           timestamp: normalizedEvent.timestamp.toISOString(),
                           eventId: randomUUID(),
                           persistenceState: 'transient',
                           messageId: normalizedEvent.metadata.messageId
                       } as unknown as AgentEvent;
                   } else if (normalizedEvent.type === 'tool_call' && normalizedEvent.toolCall) {
                       agentEvent = {
                           type: 'tool_use',
                           toolUseId: normalizedEvent.toolCall.id,
                           toolName: normalizedEvent.toolCall.name,
                           args: normalizedEvent.toolCall.input,
                           timestamp: normalizedEvent.timestamp.toISOString(),
                           eventId: randomUUID(),
                           persistenceState: 'pending' // pending until result
                       } as unknown as AgentEvent;
                   } else if (normalizedEvent.type === 'usage' && normalizedEvent.usage) {
                       // UsageEvent is now part of the union type for agentEvent
                       agentEvent = {
                           type: 'usage',
                           usage: {
                               input_tokens: normalizedEvent.usage.inputTokens,
                               output_tokens: normalizedEvent.usage.outputTokens
                           },
                           timestamp: normalizedEvent.timestamp.toISOString(),
                           eventId: randomUUID(),
                           persistenceState: 'transient'
                       };
                   }
               }

               // Log adapter output
               if (agentEvent) {
                 this.logger.debug({
                   agentEventType: agentEvent.type,
                   hasContent: !!(agentEvent as { content?: string }).content,
                   contentLength: typeof (agentEvent as { content?: string }).content === 'string'
                     ? (agentEvent as { content?: string }).content?.length
                     : undefined
                 }, 'DirectAgentService: stream adapter produced event');
               } else {
                 this.logger.debug({
                   eventType: event.event,
                   eventName: event.name
                 }, 'DirectAgentService: stream adapter returned null');
               }

               // Emit accumulated chunks as a separate message when a NEW model turn starts
               // This prevents concatenation of text from different turns (e.g., before and after tool execution)
               if (event.event === 'on_chat_model_start' && event.name === 'ChatAnthropic' && finalResponseChunks.length > 0) {
                   const accumulatedText = finalResponseChunks.join('');
                   if (accumulatedText.trim()) {
                       // D5 FIX: Generate IDs first, persist FIRST, then create event WITH sequenceNumber
                       const turnEndMessageId = randomUUID();
                       const turnEndEventId = randomUUID();
                       const turnEndTimestamp = new Date().toISOString();

                       try {
                         // 1. Persist FIRST to get sequence_number
                         const turnEndDbEvent = await eventStore.appendEvent(
                             sessionId,
                             'agent_message_sent',
                             {
                                 message_id: turnEndMessageId,
                                 content: accumulatedText,
                                 stop_reason: 'tool_use',
                                 timestamp: turnEndTimestamp,
                                 persistenceState: 'persisted'
                             }
                         );

                         // Validate sequence_number
                         if (turnEndDbEvent.sequence_number === undefined || turnEndDbEvent.sequence_number === null) {
                           throw new Error(
                             `Turn-end event persisted without sequence_number: ${turnEndDbEvent.sequence_number}, turnEndDbEvent: ${turnEndDbEvent}`
                           );
                         }

                         // 2. Enqueue to MessageQueue
                         await messageQueue.addMessagePersistence({
                             sessionId,
                             messageId: turnEndMessageId,
                             role: 'assistant',
                             messageType: 'text',
                             content: accumulatedText,
                             metadata: { stop_reason: 'tool_use' },
                             sequenceNumber: turnEndDbEvent.sequence_number,
                             eventId: turnEndDbEvent.id,
                             stopReason: 'tool_use',
                         });

                         // 3. Create event WITH sequenceNumber and emit
                         const turnEndMessage: AgentEvent = {
                             type: 'message',
                             content: accumulatedText,
                             messageId: turnEndMessageId,
                             role: 'assistant',
                             stopReason: 'tool_use',
                             timestamp: turnEndTimestamp,
                             eventId: turnEndEventId,
                             sequenceNumber: turnEndDbEvent.sequence_number, // D5 FIX: Include sequenceNumber
                             persistenceState: 'persisted'
                         };

                         emitEvent(turnEndMessage);
                         this.logger.info({
                             sessionId,
                             messageId: turnEndMessageId,
                             contentLength: accumulatedText.length,
                             sequenceNumber: turnEndDbEvent.sequence_number
                         }, '📝✅ Emitted turn-end message with sequenceNumber');

                       } catch (persistError) {
                         // D5 FIX: Robust error handling with traceability
                         const errorDetails = {
                           error: persistError,
                           errorName: persistError instanceof Error ? persistError.name : 'Unknown',
                           errorMessage: persistError instanceof Error ? persistError.message : String(persistError),
                           sessionId,
                           messageId: turnEndMessageId,
                           phase: 'turn_end_persistence',
                           contentLength: accumulatedText.length,
                           possibleCauses: this.analyzePersistenceError(persistError)
                         };

                         this.logger.error(errorDetails, '❌ CRITICAL: Failed to persist turn-end message');

                         // Emit error event to frontend (ErrorEvent interface)
                         emitEvent({
                           type: 'error',
                           sessionId,
                           error: `Failed to persist turn-end message: ${errorDetails.errorMessage}`,
                           code: 'PERSISTENCE_FAILED',
                           timestamp: new Date().toISOString(),
                           eventId: randomUUID(),
                           persistenceState: 'failed'
                         });

                         throw persistError;
                       }

                       // Clear chunks for the new turn
                       finalResponseChunks.length = 0;
                   }
               }

               // Process tool executions from agent chain ends (e.g., 'business-central', 'rag-knowledge')
               // These events have toolExecutions in their output that we need to emit
               if (event.event === 'on_chain_end' && event.name !== 'LangGraph' && event.name !== '__end__') {
                   const agentOutput = event.data?.output;

                   // 🔍 DIAGNOSTIC: Log all on_chain_end events to trace tool processing
                   this.logger.info({
                       sessionId,
                       eventName: event.name,
                       hasOutput: !!agentOutput,
                       hasToolExecutions: !!agentOutput?.toolExecutions,
                       toolExecutionsLength: agentOutput?.toolExecutions?.length ?? 0,
                       outputKeys: agentOutput ? Object.keys(agentOutput) : [],
                   }, '🔍 DIAG: on_chain_end from agent (not __end__)');
                   if (agentOutput?.toolExecutions && Array.isArray(agentOutput.toolExecutions) && agentOutput.toolExecutions.length > 0) {
                       this.logger.info({
                           sessionId,
                           agentName: event.name,
                           toolExecutionsCount: agentOutput.toolExecutions.length,
                       }, '🔧 Processing tool executions from agent chain end');

                       for (const exec of agentOutput.toolExecutions) {
                           // ========== FIX: DEDUPLICATE TOOL EVENTS ==========
                           // Skip if we've already emitted events for this tool_use_id
                           // This can happen when multiple agents process the same tool execution
                           if (emittedToolUseIds.has(exec.toolUseId)) {
                               this.logger.debug({
                                   toolUseId: exec.toolUseId,
                                   toolName: exec.toolName,
                                   agentName: event.name,
                               }, '⏭️ SKIP: Duplicate tool event (already emitted)');
                               continue;
                           }
                           emittedToolUseIds.add(exec.toolUseId);

                           // ========== FIX 1: EMIT FIRST, PERSIST ASYNC ==========
                           // Emit events IMMEDIATELY to WebSocket for real-time UI
                           // Persist to DB asynchronously (fire-and-forget with error handling)

                           const toolUseEventId = randomUUID();
                           const toolResultEventId = randomUUID();

                           // 1. EMIT tool_use IMMEDIATELY (pending state)
                           const toolUseEvent = {
                               type: 'tool_use' as const,
                               toolName: exec.toolName,
                               toolUseId: exec.toolUseId,
                               args: exec.args,
                               timestamp: new Date().toISOString(),
                               eventId: toolUseEventId,
                               persistenceState: 'pending' as const,  // Will be persisted async
                           };
                           emitEvent(toolUseEvent);

                           // 2. EMIT tool_result IMMEDIATELY (completed/error state)
                           const toolResultEvent = {
                               type: 'tool_result' as const,
                               toolName: exec.toolName,
                               toolUseId: exec.toolUseId,
                               args: exec.args,
                               result: exec.result,
                               success: exec.success,
                               error: exec.error,
                               timestamp: new Date().toISOString(),
                               eventId: toolResultEventId,
                               persistenceState: 'pending' as const,  // Will be persisted async
                           };
                           emitEvent(toolResultEvent);

                           this.logger.info({
                               toolUseId: exec.toolUseId,
                               toolName: exec.toolName,
                               success: exec.success,
                           }, '⚡ EMIT: Tool use + result emitted immediately (persistence async)');

                           // 3. PERSIST ASYNC (fire-and-forget with error handling)
                           // This doesn't block the stream processing loop
                           (async () => {
                               try {
                                   // Persist tool_use
                                   const toolUseDbEvent = await eventStore.appendEvent(
                                       sessionId,
                                       'tool_use_requested',
                                       { ...toolUseEvent, persistenceState: 'persisted' }
                                   );

                                   await messageQueue.addMessagePersistence({
                                       sessionId,
                                       messageId: exec.toolUseId,
                                       role: 'assistant',
                                       messageType: 'tool_use',
                                       content: '',
                                       metadata: {
                                           tool_name: exec.toolName,
                                           tool_args: exec.args,
                                           tool_use_id: exec.toolUseId,
                                           status: 'pending',
                                       },
                                       sequenceNumber: toolUseDbEvent.sequence_number,
                                       eventId: toolUseDbEvent.id,
                                       toolUseId: exec.toolUseId,
                                   });

                                   // Persist tool_result
                                   const toolResultDbEvent = await eventStore.appendEvent(
                                       sessionId,
                                       'tool_use_completed',
                                       { ...toolResultEvent, persistenceState: 'persisted' }
                                   );

                                   await messageQueue.addMessagePersistence({
                                       sessionId,
                                       messageId: `${exec.toolUseId}_result`,
                                       role: 'assistant',
                                       messageType: 'tool_result',
                                       content: exec.result || '',
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
                                       toolUseSeqNum: toolUseDbEvent.sequence_number,
                                       toolResultSeqNum: toolResultDbEvent.sequence_number,
                                   }, '💾 PERSIST: Tool use + result persisted async');
                               } catch (err) {
                                   this.logger.error({
                                       err,
                                       toolUseId: exec.toolUseId,
                                       toolName: exec.toolName,
                                   }, '❌ PERSIST ERROR: Failed to persist tool events');
                               }
                           })();

                           toolsUsed.push(exec.toolName);
                       }
                   }
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

                   // ========== EMIT ACCUMULATED TEXT BEFORE TOOLS ==========
                   // If we have accumulated text chunks, emit them as an intermediate message
                   // BEFORE the tool events. This helps separate text from tools in the UI.
                   if (output?.toolExecutions?.length > 0 && finalResponseChunks.length > 0) {
                       const intermediateText = finalResponseChunks.join('');
                       if (intermediateText.trim()) {
                           // D5 AUDIT FIX: Persist FIRST, then create event WITH sequenceNumber
                           const intermediateMessageId = randomUUID();
                           const intermediateEventId = randomUUID();
                           const intermediateTimestamp = new Date().toISOString();

                           try {
                             // 1. Persist FIRST to get sequence_number
                             const intermediateDbEvent = await eventStore.appendEvent(
                                 sessionId,
                                 'agent_message_sent',
                                 {
                                     message_id: intermediateMessageId,
                                     content: intermediateText,
                                     stop_reason: 'tool_use',
                                     timestamp: intermediateTimestamp,
                                     persistenceState: 'persisted'
                                 }
                             );

                             // Validate sequence_number
                             if (intermediateDbEvent.sequence_number === undefined || intermediateDbEvent.sequence_number === null) {
                               throw new Error(
                                 `Intermediate message persisted without sequence_number: ${intermediateDbEvent.sequence_number}, intermediateDbEvent: ${intermediateDbEvent}`
                               );
                             }

                             // 2. Enqueue to MessageQueue
                             await messageQueue.addMessagePersistence({
                                 sessionId,
                                 messageId: intermediateMessageId,
                                 role: 'assistant',
                                 messageType: 'text',
                                 content: intermediateText,
                                 metadata: { stop_reason: 'tool_use' },
                                 sequenceNumber: intermediateDbEvent.sequence_number,
                                 eventId: intermediateDbEvent.id,
                                 stopReason: 'tool_use',
                             });

                             // 3. Create event WITH sequenceNumber and emit
                             const intermediateMessageEvent: AgentEvent = {
                                 type: 'message',
                                 content: intermediateText,
                                 messageId: intermediateMessageId,
                                 role: 'assistant',
                                 stopReason: 'tool_use',
                                 timestamp: intermediateTimestamp,
                                 eventId: intermediateEventId,
                                 sequenceNumber: intermediateDbEvent.sequence_number, // D5 AUDIT FIX
                                 persistenceState: 'persisted'
                             };

                             emitEvent(intermediateMessageEvent);
                             this.logger.info({
                                 sessionId,
                                 messageId: intermediateMessageId,
                                 contentLength: intermediateText.length,
                                 sequenceNumber: intermediateDbEvent.sequence_number
                             }, '📝✅ Emitted intermediate text message with sequenceNumber');

                           } catch (persistError) {
                             const errorDetails = {
                               error: persistError,
                               errorName: persistError instanceof Error ? persistError.name : 'Unknown',
                               errorMessage: persistError instanceof Error ? persistError.message : String(persistError),
                               sessionId,
                               messageId: intermediateMessageId,
                               phase: 'intermediate_message_persistence',
                               contentLength: intermediateText.length,
                               possibleCauses: this.analyzePersistenceError(persistError)
                             };

                             this.logger.error(errorDetails, '❌ CRITICAL: Failed to persist intermediate message');

                             // Emit error event to frontend (ErrorEvent interface)
                             emitEvent({
                               type: 'error',
                               sessionId,
                               error: `Failed to persist intermediate message: ${errorDetails.errorMessage}`,
                               code: 'PERSISTENCE_FAILED',
                               timestamp: new Date().toISOString(),
                               eventId: randomUUID(),
                               persistenceState: 'failed'
                             });

                             throw persistError;
                           }

                           // Clear accumulated chunks so they don't appear again in final message
                           finalResponseChunks.length = 0;
                       }
                   }

                   // ========== TOOL EXECUTIONS HANDLED AT AGENT CHAIN END ==========
                   // Tool executions are processed when individual agents complete (event.name !== '__end__')
                   // NOT here at LangGraph final __end__, to avoid duplicate processing.
                   // The toolExecutions state propagates from agents to __end__, but we only process it once.
                   if (output?.toolExecutions && Array.isArray(output.toolExecutions) && output.toolExecutions.length > 0) {
                       this.logger.debug({
                           sessionId,
                           toolExecutionsCount: output.toolExecutions.length,
                       }, '📋 LangGraph __end__ has toolExecutions (already processed at agent chain end)');
                   }
               }

               // ========== FIX 4 & 5: THINKING ACCUMULATION AND TRANSITION ==========
               // Accumulate thinking chunks for persistence
               // TypeScript narrowing: after type check, agentEvent is ThinkingChunkEvent
               if (agentEvent && agentEvent.type === 'thinking_chunk' && agentEvent.content) {
                   thinkingChunks.push(agentEvent.content);
                   this.logger.debug({
                     chunkLength: agentEvent.content.length,
                     totalThinkingChunks: thinkingChunks.length
                   }, '💭 DirectAgentService: Accumulated thinking chunk');
               }

               // Also accumulate message chunks for streaming responses
               // TypeScript narrowing: after type check, agentEvent is MessageChunkEvent
               if (agentEvent && agentEvent.type === 'message_chunk' && agentEvent.content) {
                   // FIX 5: Emit thinking_complete when transitioning from thinking to text
                   if (thinkingChunks.length > 0 && !thinkingComplete) {
                       thinkingComplete = true;
                       const thinkingContent = thinkingChunks.join('');
                       // MessageChunkEvent doesn't have blockIndex, use 0 as default
                       const thinkingBlockIndex = 0;

                       // Emit thinking_complete signal to frontend
                       emitEvent({
                           type: 'thinking_complete',
                           content: thinkingContent,
                           blockIndex: thinkingBlockIndex,
                           timestamp: new Date().toISOString(),
                           eventId: randomUUID(),
                           persistenceState: 'transient' as const,
                       } as AgentEvent);

                       this.logger.info({
                           thinkingLength: thinkingContent.length,
                           blockIndex: thinkingBlockIndex
                       }, '💭✅ Emitted thinking_complete signal');
                   }

                   finalResponseChunks.push(agentEvent.content);
                   this.logger.debug({
                     chunkContent: agentEvent.content,
                     chunkLength: agentEvent.content.length,
                     totalChunks: finalResponseChunks.length
                   }, 'DirectAgentService: Accumulated message chunk');
               }

               if (agentEvent) {
                   // Emit to live socket (exclude usage events if they aren't standard AgentEvents)
                   // FIX: We ENABLE tool_use events from stream adapter to provide real-time tool visibility.
                   // The risk of ID mismatch with on_chain_end events is acceptable vs showing nothing.
                   // Frontend should deduplicate or update based on toolUseId if possible.
                   // Note: UsageEvent is backend-only type, not in AgentEvent union
                   const eventType = agentEvent.type;
                   if (eventType !== 'usage') {
                        // FIX: Mark tool events as 'transient' to prevent ChatMessageHandler from persisting them via fallback.
                        // DirectAgentService handles reliable persistence at on_chain_end.
                        if (eventType === 'tool_use' || eventType === 'tool_result') {
                            (agentEvent as BaseAgentEvent).persistenceState = 'transient';
                        }

                        this.logger.debug({
                          eventType,
                          willEmit: !!onEvent,
                          persistenceState: agentEvent.persistenceState
                        }, 'DirectAgentService: Emitting event to WebSocket');
                        emitEvent(agentEvent);
                   }

                   // Handle Usage Tracking
                   // UsageEvent is now part of the union type, so narrowing works correctly
                   if (agentEvent.type === 'usage') {
                       const usage = agentEvent.usage;
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
                   // NOTE: In orchestrator flow (runGraph), tool_use events from stream adapter are SKIPPED.
                   // We only persist tool_use from toolExecutions at on_chain_end (with consistent IDs).
                   if (agentEvent.type === 'tool_use') {
                       // Skip persistence in orchestrator flow - will be handled by toolExecutions
                       this.logger.debug({ toolUseId: agentEvent.toolUseId, toolName: agentEvent.toolName },
                           '⏭️ Skipping tool_use persistence (will persist from toolExecutions)');
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

        // ========== FIX 4: PERSIST THINKING CONTENT ==========
        // Persist thinking if we accumulated any chunks (before final message)
        if (thinkingChunks.length > 0) {
            const thinkingContent = thinkingChunks.join('');
            const thinkingMessageId = randomUUID();
            const thinkingEventId = randomUUID();
            const thinkingTimestamp = new Date().toISOString();

            try {
              // 1. Persist thinking to EventStore
              const thinkingDbEvent = await eventStore.appendEvent(
                  sessionId,
                  'agent_thinking_block',
                  {
                      message_id: thinkingMessageId,
                      content: thinkingContent,
                      timestamp: thinkingTimestamp,
                      persistenceState: 'persisted'
                  }
              );

              // Validate sequence_number
              if (thinkingDbEvent.sequence_number === undefined || thinkingDbEvent.sequence_number === null) {
                throw new Error(
                  `Thinking event persisted without sequence_number: ${thinkingDbEvent.sequence_number}, thinkingDbEvent: ${thinkingDbEvent}`
                );
              }

              // 2. Enqueue thinking to MessageQueue for messages table persistence
              await messageQueue.addMessagePersistence({
                  sessionId,
                  messageId: thinkingMessageId,
                  role: 'assistant',
                  messageType: 'thinking',
                  content: thinkingContent,
                  metadata: {},
                  sequenceNumber: thinkingDbEvent.sequence_number,
                  eventId: thinkingEventId,
              });

              // 3. Emit persisted thinking event to frontend
              emitEvent({
                  type: 'thinking',
                  content: thinkingContent,
                  messageId: thinkingMessageId,
                  timestamp: thinkingTimestamp,
                  eventId: thinkingEventId,
                  persistenceState: 'persisted' as const,
                  sequenceNumber: thinkingDbEvent.sequence_number,
              } as AgentEvent);

              this.logger.info({
                  sessionId,
                  messageId: thinkingMessageId,
                  thinkingLength: thinkingContent.length,
                  sequenceNumber: thinkingDbEvent.sequence_number
              }, '💭✅ Thinking persisted to EventStore and MessageQueue');

            } catch (persistError) {
              const errorDetails = {
                error: persistError,
                errorName: persistError instanceof Error ? persistError.name : 'Unknown',
                errorMessage: persistError instanceof Error ? persistError.message : String(persistError),
                sessionId,
                messageId: thinkingMessageId,
                phase: 'thinking_persistence',
                contentLength: thinkingContent.length,
                possibleCauses: this.analyzePersistenceError(persistError)
              };

              this.logger.error(errorDetails, '❌ CRITICAL: Failed to persist thinking event');

              // Emit error event to frontend (ErrorEvent interface)
              emitEvent({
                type: 'error',
                sessionId,
                error: `Failed to persist thinking content: ${errorDetails.errorMessage}`,
                code: 'PERSISTENCE_FAILED',
                timestamp: new Date().toISOString(),
                eventId: randomUUID(),
                persistenceState: 'failed'
              });

              // Re-throw to propagate
              throw persistError;
            }
        }

        // ✨ FIXED: Explicitly persist the final message event with robust error handling (D17)
        const finalMessageId = randomUUID();
        const finalEventId = randomUUID();

        try {
          // 1. Persist to EventStore FIRST (using snake_case data properties for EventStore)
          const finalMessageDbEvent = await eventStore.appendEvent(
              sessionId,
              'agent_message_sent',
              {
                  message_id: finalMessageId,
                  content: responseContent,
                  stop_reason: effectiveStopReason,
                  timestamp: new Date().toISOString(),
                  persistenceState: 'persisted'
              }
          );

          // Validate that we got a valid sequence_number
          if (finalMessageDbEvent.sequence_number === undefined || finalMessageDbEvent.sequence_number === null) {
            throw new Error(
              `Event persistence succeeded but sequence_number is invalid: ${finalMessageDbEvent.sequence_number}, finalMessageDbEvent: ${finalMessageDbEvent}`
            );
          }

          // 2. Enqueue to MessageQueue for messages table persistence
          await messageQueue.addMessagePersistence({
              sessionId,
              messageId: finalMessageId,
              role: 'assistant',
              messageType: 'text',
              content: responseContent,
              metadata: {
                  stop_reason: effectiveStopReason,
              },
              sequenceNumber: finalMessageDbEvent.sequence_number,
              eventId: finalMessageDbEvent.id,
              stopReason: effectiveStopReason,
          });

          this.logger.info({
            sessionId,
            messageId: finalMessageId,
            sequenceNumber: finalMessageDbEvent.sequence_number,
            eventId: finalMessageDbEvent.id,
            stopReason: effectiveStopReason
          }, '💾✅ Final message persisted to EventStore and queued to MessageQueue');

          // 3. Emit persisted event with sequence_number to frontend
          emitEvent({
            type: 'message',
            content: responseContent,
            messageId: finalMessageId,
            role: 'assistant',
            stopReason: effectiveStopReason,
            timestamp: new Date().toISOString(),
            eventId: finalEventId,
            sessionId,
            sequenceNumber: finalMessageDbEvent.sequence_number,
            persistenceState: 'persisted'
          } as AgentEvent);

        } catch (persistError) {
          // TRAZABILIDAD COMPLETA para debugging (D17 fix)
          const errorDetails = {
            // Error information
            error: persistError,
            errorName: persistError instanceof Error ? persistError.name : 'Unknown',
            errorMessage: persistError instanceof Error ? persistError.message : String(persistError),
            errorStack: persistError instanceof Error ? persistError.stack : undefined,

            // Operation context
            sessionId,
            messageId: finalMessageId,
            phase: 'final_message_persistence',

            // Message metadata for debugging
            messageMetadata: {
              contentPreview: responseContent?.substring(0, 500),
              contentLength: responseContent?.length,
              stopReason: effectiveStopReason,
              timestamp: new Date().toISOString()
            },

            // Detected possible causes
            possibleCauses: this.analyzePersistenceError(persistError)
          };

          this.logger.error(errorDetails, '❌ CRITICAL: Failed to persist final message event');

          // Emit error event to frontend (ErrorEvent interface)
          emitEvent({
            type: 'error',
            sessionId,
            error: `Failed to persist final message: ${errorDetails.errorMessage}`,
            code: 'PERSISTENCE_FAILED',
            timestamp: new Date().toISOString(),
            eventId: randomUUID(),
            persistenceState: 'failed'
          });

          // Re-throw to propagate to caller
          throw persistError;
        }

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

        // Optional: Persist completion event for audit
        await eventStore.appendEvent(
            sessionId,
            'session_ended',
            {
                reason: completeReason,
                stop_reason: effectiveStopReason,
                timestamp: new Date().toISOString(),
                persistenceState: 'persisted'
            }
        );

        // FIX: Use emitEvent with sessionId for frontend ordering
        emitEvent({
          type: 'complete',
          reason: completeReason as 'success' | 'error' | 'max_turns' | 'user_cancelled',
          timestamp: new Date().toISOString(),
          eventId: randomUUID(),
          sessionId,
          persistenceState: 'transient'
        } as AgentEvent);
      }

      return {
          response: responseContent,
          success: true,
          toolsUsed: toolsUsed,
          sessionId
      };
  }

  /**
   * Analyzes persistence errors to identify root causes for debugging.
   * Returns an array of human-readable cause descriptions.
   *
   * @param error - The error thrown during persistence
   * @returns Array of identified possible causes
   */
  private analyzePersistenceError(error: unknown): string[] {
    const causes: string[] = [];
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (errorMsg.includes('duplicate key') || errorMsg.includes('PRIMARY KEY')) {
      causes.push('DUPLICATE_ID: El ID del mensaje ya existe en la base de datos');
    }
    if (errorMsg.includes('FOREIGN KEY') || errorMsg.includes('FK_')) {
      causes.push('FK_VIOLATION: Referencia a sesión o usuario que no existe');
    }
    if (errorMsg.includes('sequence_number')) {
      causes.push('SEQUENCE_CONFLICT: Conflicto en el número de secuencia (posible race condition D1)');
    }
    if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
      causes.push('DB_TIMEOUT: La base de datos no respondió a tiempo');
    }
    if (errorMsg.includes('Redis') || errorMsg.includes('redis')) {
      causes.push('REDIS_ERROR: Problema con Redis al obtener sequence number');
    }
    if (errorMsg.includes('connection') || errorMsg.includes('ECONNREFUSED')) {
      causes.push('CONNECTION_ERROR: No se pudo conectar a la base de datos');
    }
    if (errorMsg.includes('Database not available')) {
      causes.push('DB_UNAVAILABLE: El servicio de base de datos no está disponible');
    }

    if (causes.length === 0) {
      causes.push('UNKNOWN: Error no categorizado - revisar logs completos');
    }

    return causes;
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

//
