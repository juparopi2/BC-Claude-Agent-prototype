/**
 * Tool Executor Service
 *
 * Handles tool execution, approval flows, sequence ordering, and result persistence.
 * Extracted from DirectAgentService to improve testability and modularity.
 *
 * Key Responsibilities:
 * - Execute multiple tools in sequence
 * - Pre-reserve sequences for correct ordering
 * - Handle approval flow for write operations
 * - Track tool execution metrics
 * - Persist tool results to EventStore and MessageQueue
 * - Emit tool results via WebSocket
 *
 * @module services/agent/execution/ToolExecutor
 */

import { getEventStore } from '@/services/events/EventStore';
import { getMessageOrderingService, getMessageEmitter } from '@/services/agent/messages';
import { getUsageTrackingService } from '@/services/tracking/UsageTrackingService';
import { getMessageService } from '@/services/messages/MessageService';
import { getMessageQueue } from '@/services/queue/MessageQueue';
import type { ApprovalManager } from '@/services/approval/ApprovalManager';
import type { ToolResultEvent } from '@bc-agent/shared';
import { createChildLogger } from '@/utils/logger';
import type { Logger } from 'pino';

/**
 * Tool use input structure (matches Anthropic API)
 */
export interface ToolUseInput {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Tool result structure (matches Anthropic API)
 */
export interface ToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * Options for tool executor
 */
export interface ToolExecutorOptions {
  sessionId: string;
  userId: string;
  turnCount: number;
  approvalManager?: ApprovalManager;
  onToolResult?: (result: ToolResultEvent) => void;
}

/**
 * Result of tool execution
 */
export interface ToolExecutionResult {
  toolResults: ToolResult[];
  toolsUsed: string[];
  success: boolean;
}

/**
 * Tool implementation callback type
 */
export type ToolImplementation = (name: string, input: unknown) => Promise<unknown>;

/**
 * Default tool implementation that returns mock data
 * Used for testing when no implementation is provided
 */
const defaultToolImplementation: ToolImplementation = async (name: string, input: unknown) => {
  return {
    success: true,
    message: `Mock execution of ${name}`,
    input,
  };
};

/**
 * Tool Executor Service
 *
 * Handles tool execution with approval flows, sequence ordering, and persistence.
 */
export class ToolExecutor {
  private logger: Logger;
  private toolImplementation: ToolImplementation;

  /**
   * Create a new ToolExecutor
   *
   * @param toolImplementation - Optional tool implementation callback. Defaults to mock implementation.
   */
  constructor(toolImplementation?: ToolImplementation) {
    this.logger = createChildLogger({ service: 'ToolExecutor' });
    this.toolImplementation = toolImplementation || defaultToolImplementation;
  }

  /**
   * Check if operation is a write operation (needs approval)
   *
   * @param toolName - Name of the tool to check
   * @returns True if tool is a write operation
   */
  isWriteOperation(toolName: string): boolean {
    const writePatterns = ['create', 'update', 'delete', 'post', 'patch', 'put'];
    const lowerToolName = toolName.toLowerCase();
    return writePatterns.some(pattern => lowerToolName.includes(pattern));
  }

  /**
   * Execute multiple tools in sequence
   *
   * Key features:
   * - Pre-reserves sequences BEFORE execution for correct ordering
   * - Handles approval flow for write operations
   * - Tracks execution metrics
   * - Persists results to EventStore and MessageQueue
   * - Emits results via WebSocket
   * - Handles errors gracefully (catch and continue)
   *
   * @param toolUses - Array of tool uses to execute
   * @param options - Execution options including session context
   * @returns Execution result with tool results and metadata
   */
  async executeTools(
    toolUses: ToolUseInput[],
    options: ToolExecutorOptions
  ): Promise<ToolExecutionResult> {
    const { sessionId, userId, turnCount, approvalManager, onToolResult } = options;

    // Handle empty tool list
    if (toolUses.length === 0) {
      return {
        toolResults: [],
        toolsUsed: [],
        success: true,
      };
    }

    const toolResults: ToolResult[] = [];
    const toolsUsed: string[] = [];

    // Pre-reserve sequences BEFORE tool execution to guarantee ordering
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
    }, 'Pre-reserved sequences for tool results');

    // Get service instances
    const eventStore = getEventStore();
    const messageEmitter = getMessageEmitter();
    const usageTrackingService = getUsageTrackingService();
    const messageService = getMessageService();
    const messageQueue = getMessageQueue();

    // Execute each tool in sequence
    for (let toolIndex = 0; toolIndex < toolUses.length; toolIndex++) {
      const toolUse = toolUses[toolIndex];
      if (!toolUse) {
        this.logger.error({ toolIndex, totalTools: toolUses.length }, 'Missing tool use at index');
        continue;
      }

      const preAssignedSequence = reservedSequences.sequences[toolIndex];
      if (!preAssignedSequence) {
        throw new Error(`Missing pre-assigned sequence for tool index ${toolIndex}`);
      }

      toolsUsed.push(toolUse.name);

      this.logger.info({
        sessionId,
        turnCount,
        toolName: toolUse.name,
        toolUseId: toolUse.id,
        toolIndex,
        preAssignedSequence,
      }, 'Executing tool');

      // Check if tool needs approval
      const needsApproval = this.isWriteOperation(toolUse.name);

      if (needsApproval && approvalManager) {
        try {
          const approved = await approvalManager.request({
            sessionId: sessionId || 'unknown',
            toolName: toolUse.name,
            toolArgs: toolUse.input as Record<string, unknown>,
          });

          if (!approved) {
            // User denied approval - create denial result
            const denialResult: ToolResult = {
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: 'Operation cancelled by user - approval denied',
              is_error: true,
            };
            toolResults.push(denialResult);
            continue; // Skip to next tool
          }
        } catch (error) {
          // Approval request failed (e.g., timeout)
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error({
            sessionId,
            toolName: toolUse.name,
            error: errorMessage,
          }, 'Approval request failed');

          const errorResult: ToolResult = {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: `Error during approval: ${errorMessage}`,
            is_error: true,
          };
          toolResults.push(errorResult);
          continue; // Skip to next tool
        }
      }

      // Execute the tool
      const toolStartTime = Date.now();
      try {
        const result = await this.toolImplementation(toolUse.name, toolUse.input);
        const toolEndTime = Date.now();
        const toolDuration = toolEndTime - toolStartTime;

        this.logger.info({
          sessionId,
          turnCount,
          toolName: toolUse.name,
          toolUseId: toolUse.id,
          success: true,
          preAssignedSequence,
          toolIndex,
          toolDuration,
        }, 'Tool executed successfully');

        // Track tool execution (fire-and-forget)
        usageTrackingService.trackToolExecution(
          userId,
          sessionId,
          toolUse.name,
          toolDuration,
          {
            success: true,
            result_size: result ? JSON.stringify(result).length : 0,
            tool_use_id: toolUse.id,
            turn_count: turnCount,
            tool_index: toolIndex,
          }
        ).catch((err) => {
          this.logger.warn({ err, userId, sessionId, toolName: toolUse.name }, 'Failed to track tool execution');
        });

        // Persist to EventStore with pre-assigned sequence
        const toolResultEvent = await eventStore.appendEventWithSequence(
          sessionId,
          'tool_use_completed',
          {
            tool_use_id: toolUse.id,
            tool_name: toolUse.name,
            tool_result: result,
            success: true,
            error_message: null,
          },
          preAssignedSequence
        );

        this.logger.info({
          sessionId,
          toolUseId: toolUse.id,
          toolName: toolUse.name,
          sequenceNumber: preAssignedSequence,
          eventId: toolResultEvent.id,
        }, 'Tool result persisted to EventStore');

        // Emit tool result via WebSocket
        messageEmitter.emitToolResult({
          toolName: toolUse.name,
          toolUseId: toolUse.id,
          args: toolUse.input as Record<string, unknown>,
          result: result,
          success: true,
          eventId: toolResultEvent.id,
          sequenceNumber: toolResultEvent.sequence_number,
          sessionId,
        });

        // Update messages table
        await messageService.updateToolResult(
          sessionId,
          userId,
          toolUse.id,
          toolUse.name,
          toolUse.input,
          result,
          true, // success
          undefined
        );

        // Queue tool result message for persistence
        await messageQueue.addMessagePersistence({
          sessionId,
          messageId: `${toolUse.id}_result`,
          role: 'assistant',
          messageType: 'tool_result',
          content: typeof result === 'string' ? result : JSON.stringify(result),
          metadata: {
            tool_name: toolUse.name,
            tool_args: toolUse.input,
            tool_result: result,
            tool_use_id: toolUse.id,
            status: 'success',
            success: true,
          },
          sequenceNumber: toolResultEvent.sequence_number,
          eventId: toolResultEvent.id,
          toolUseId: toolUse.id,
        });

        // Call onToolResult callback if provided
        if (onToolResult) {
          onToolResult({
            type: 'tool_result',
            toolName: toolUse.name,
            toolUseId: toolUse.id,
            args: toolUse.input as Record<string, unknown>,
            result: result,
            success: true,
            sessionId,
            timestamp: new Date(),
            eventId: toolResultEvent.id,
            sequenceNumber: toolResultEvent.sequence_number,
            persistenceState: 'persisted',
          });
        }

        // Add to results
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });

      } catch (error) {
        // Tool execution failed
        const toolEndTime = Date.now();
        const toolDuration = toolEndTime - toolStartTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        this.logger.error({
          sessionId,
          toolName: toolUse.name,
          toolUseId: toolUse.id,
          error: errorMessage,
          toolDuration,
        }, 'Tool execution failed');

        // Track failed tool execution (fire-and-forget)
        usageTrackingService.trackToolExecution(
          userId,
          sessionId,
          toolUse.name,
          toolDuration,
          {
            success: false,
            error_message: errorMessage,
            tool_use_id: toolUse.id,
            turn_count: turnCount,
            tool_index: toolIndex,
          }
        ).catch((err) => {
          this.logger.warn({ err, userId, sessionId, toolName: toolUse.name }, 'Failed to track tool execution error');
        });

        // Persist error to EventStore with pre-assigned sequence
        const toolResultEvent = await eventStore.appendEventWithSequence(
          sessionId,
          'tool_use_completed',
          {
            tool_use_id: toolUse.id,
            tool_name: toolUse.name,
            tool_result: null,
            success: false,
            error_message: errorMessage,
          },
          preAssignedSequence
        );

        this.logger.error({
          sessionId,
          toolUseId: toolUse.id,
          toolName: toolUse.name,
          sequenceNumber: preAssignedSequence,
          eventId: toolResultEvent.id,
          error: errorMessage,
        }, 'Tool error persisted to EventStore');

        // Emit error result via WebSocket
        messageEmitter.emitToolResult({
          toolName: toolUse.name,
          toolUseId: toolUse.id,
          args: toolUse.input as Record<string, unknown>,
          result: null,
          success: false,
          error: errorMessage,
          eventId: toolResultEvent.id,
          sequenceNumber: toolResultEvent.sequence_number,
          sessionId,
        });

        // Update messages table with error
        await messageService.updateToolResult(
          sessionId,
          userId,
          toolUse.id,
          toolUse.name,
          toolUse.input,
          null,
          false, // success = false
          errorMessage
        );

        // Queue error message for persistence
        await messageQueue.addMessagePersistence({
          sessionId,
          messageId: `${toolUse.id}_error`,
          role: 'assistant',
          messageType: 'error',
          content: `Error executing ${toolUse.name}: ${errorMessage}`,
          metadata: {
            tool_name: toolUse.name,
            tool_args: toolUse.input,
            tool_result: null,
            tool_use_id: toolUse.id,
            status: 'error',
            success: false,
            error_message: errorMessage,
          },
          sequenceNumber: toolResultEvent.sequence_number,
          eventId: toolResultEvent.id,
          toolUseId: toolUse.id,
        });

        // Call onToolResult callback if provided
        if (onToolResult) {
          onToolResult({
            type: 'tool_result',
            toolName: toolUse.name,
            toolUseId: toolUse.id,
            args: toolUse.input as Record<string, unknown>,
            result: null,
            success: false,
            error: errorMessage,
            sessionId,
            timestamp: new Date(),
            eventId: toolResultEvent.id,
            sequenceNumber: toolResultEvent.sequence_number,
            persistenceState: 'persisted',
          });
        }

        // Add error result
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Error: ${errorMessage}`,
          is_error: true,
        });
      }
    }

    return {
      toolResults,
      toolsUsed,
      success: true,
    };
  }
}
