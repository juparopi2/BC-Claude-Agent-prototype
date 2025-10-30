/**
 * Agent Service
 *
 * Provides agent execution capabilities using Claude Agent SDK.
 * Integrates with MCP servers for Business Central operations.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { env } from '@/config';
import { getMCPService } from '../mcp';
import type { AgentEvent, AgentExecutionResult } from '@/types';

/**
 * Agent Service Class
 *
 * Handles agent execution with Claude Agent SDK and MCP integration.
 */
export class AgentService {
  private apiKey: string;

  constructor() {
    this.apiKey = env.ANTHROPIC_API_KEY || '';

    if (!this.apiKey) {
      console.warn('[AgentService] ANTHROPIC_API_KEY not configured');
    }
  }

  /**
   * Execute Query with Agent SDK
   *
   * Runs a query using Claude Agent SDK with automatic MCP tool discovery and calling.
   *
   * @param prompt - User prompt/query
   * @param sessionId - Optional session ID for context
   * @param onEvent - Optional callback for streaming events
   * @returns Promise resolving to execution result
   *
   * @example
   * ```typescript
   * const agentService = new AgentService();
   *
   * const result = await agentService.executeQuery(
   *   'List the first 5 customers from Business Central',
   *   'session-123',
   *   (event) => {
   *     console.log('Event:', event.type);
   *   }
   * );
   *
   * console.log('Response:', result.response);
   * ```
   */
  async executeQuery(
    prompt: string,
    sessionId?: string,
    onEvent?: (event: AgentEvent) => void
  ): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    const toolsUsed: string[] = [];
    let finalResponse = '';
    let finalMessageId = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      // Get MCP configuration
      const mcpService = getMCPService();
      const mcpServers = mcpService.isConfigured()
        ? mcpService.getMCPServersConfig()
        : {};

      // Set API key in environment for SDK
      process.env.ANTHROPIC_API_KEY = this.apiKey;

      // Execute query with Agent SDK
      const result = query({
        prompt,
        options: {
          mcpServers,
          model: env.ANTHROPIC_MODEL,
          includePartialMessages: true,
        },
      });

      // Stream events
      for await (const sdkMessage of result) {
        // Emit event to callback if provided
        if (onEvent) {
          const agentEvent = this.mapSDKMessageToAgentEvent(sdkMessage, sessionId);
          if (agentEvent) {
            onEvent(agentEvent);
          }
        }

        // Extract final response and tokens from result message
        if (sdkMessage.type === 'result') {
          if (sdkMessage.subtype === 'success') {
            finalResponse = sdkMessage.result;
            inputTokens = sdkMessage.usage.input_tokens;
            outputTokens = sdkMessage.usage.output_tokens;
          }
          finalMessageId = sdkMessage.uuid;
        }

        // Track tools used from assistant messages
        if (sdkMessage.type === 'assistant') {
          for (const content of sdkMessage.message.content) {
            if (content.type === 'tool_use' && 'name' in content) {
              const toolName = (content as any).name as string;
              if (!toolsUsed.includes(toolName)) {
                toolsUsed.push(toolName);
              }
            }
          }
        }
      }

      const duration = Date.now() - startTime;

      return {
        sessionId: sessionId || '',
        response: finalResponse,
        messageId: finalMessageId,
        tokenUsage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        toolsUsed,
        durationMs: duration,
        success: true,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      console.error('[AgentService] Query execution failed:', error);

      // Emit error event if callback provided
      if (onEvent) {
        onEvent({
          type: 'error',
          sessionId,
          timestamp: new Date(),
          error: errorMessage,
        });
      }

      return {
        sessionId: sessionId || '',
        response: '',
        messageId: '',
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
        toolsUsed,
        durationMs: duration,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Map SDK Message to Agent Event
   *
   * Converts Agent SDK messages to our internal AgentEvent format.
   *
   * @param sdkMessage - Message from Agent SDK
   * @param sessionId - Session ID
   * @returns Mapped AgentEvent or null if not convertible
   */
  private mapSDKMessageToAgentEvent(
    sdkMessage: any,
    sessionId?: string
  ): AgentEvent | null {
    const timestamp = new Date();

    try {
      switch (sdkMessage.type) {
        case 'system':
          if (sdkMessage.subtype === 'init') {
            return {
              type: 'session_start',
              sessionId: sdkMessage.session_id || sessionId || '',
              userId: '',
              timestamp,
            };
          }
          return null;

        case 'user':
          return {
            type: 'message',
            sessionId: sdkMessage.session_id || sessionId,
            timestamp,
            content: JSON.stringify(sdkMessage.message),
            messageId: sdkMessage.uuid || '',
            role: 'user',
          };

        case 'assistant':
          // Extract text content from assistant message
          const textContent = sdkMessage.message.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n');

          return {
            type: 'message',
            sessionId: sdkMessage.session_id || sessionId,
            timestamp,
            content: textContent,
            messageId: sdkMessage.message.id || sdkMessage.uuid,
            role: 'assistant',
          };

        case 'stream_event':
          // Handle streaming events
          const event = sdkMessage.event;
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            return {
              type: 'message_partial',
              sessionId: sdkMessage.session_id || sessionId,
              timestamp,
              content: event.delta.text,
              messageId: sdkMessage.uuid,
            };
          }
          return null;

        case 'result':
          return {
            type: 'session_end',
            sessionId: sdkMessage.session_id || sessionId || '',
            timestamp,
            reason: sdkMessage.subtype === 'success' ? 'completed' : 'error',
          };

        default:
          return null;
      }
    } catch (error) {
      console.error('[AgentService] Error mapping SDK message:', error);
      return null;
    }
  }

  /**
   * Check if Agent SDK is configured
   *
   * @returns True if ANTHROPIC_API_KEY is set
   */
  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 0);
  }

  /**
   * Get Configuration Status
   *
   * @returns Configuration info
   */
  getConfigStatus(): {
    hasApiKey: boolean;
    mcpConfigured: boolean;
    model: string;
  } {
    const mcpService = getMCPService();

    return {
      hasApiKey: this.isConfigured(),
      mcpConfigured: mcpService.isConfigured(),
      model: env.ANTHROPIC_MODEL,
    };
  }
}

// Singleton instance
let agentServiceInstance: AgentService | null = null;

/**
 * Get Agent Service Singleton Instance
 *
 * @returns The shared AgentService instance
 */
export function getAgentService(): AgentService {
  if (!agentServiceInstance) {
    agentServiceInstance = new AgentService();
  }
  return agentServiceInstance;
}
