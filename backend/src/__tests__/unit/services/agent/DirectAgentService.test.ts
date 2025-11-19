/**
 * Unit Tests - DirectAgentService
 *
 * Tests for the DirectAgentService which implements a manual agentic loop
 * using @anthropic-ai/sdk directly (workaround for Agent SDK ProcessTransport bug).
 *
 * @module __tests__/unit/services/agent/DirectAgentService
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { DirectAgentService } from '@/services/agent/DirectAgentService';
import type { IAnthropicClient, ChatCompletionResponse } from '@/services/agent/IAnthropicClient';
import type { ApprovalManager } from '@/services/approval/ApprovalManager';
import type { AgentEvent } from '@/types/agent.types';
import * as fs from 'fs';
import * as path from 'path';

// Mock dependencies
vi.mock('fs');
vi.mock('path');

describe('DirectAgentService', () => {
  let mockClient: IAnthropicClient;
  let mockApprovalManager: ApprovalManager;
  let service: DirectAgentService;
  let mockOnEvent: Mock<(event: AgentEvent) => void>;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock Anthropic client
    mockClient = {
      createChatCompletion: vi.fn(),
    };

    // Mock approval manager
    mockApprovalManager = {
      request: vi.fn(),
    } as unknown as ApprovalManager;

    // Mock event callback
    mockOnEvent = vi.fn();

    // Mock file system for MCP tools
    vi.mocked(path.join).mockReturnValue('/mock/path/bc_index.json');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      entities: [
        {
          name: 'customer',
          displayName: 'Customer',
          description: 'Customer entity',
          operations: ['list', 'get', 'create'],
          endpoints: []
        }
      ],
      operationIndex: {}
    }));

    // Create service with mocked client
    service = new DirectAgentService(mockApprovalManager, undefined, mockClient);
  });

  describe('executeQuery', () => {
    it('should execute simple query without tools', async () => {
      // Arrange
      const prompt = 'Hello, what can you help me with?';
      const mockResponse: ChatCompletionResponse = {
        id: 'msg-test-123',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'I can help you with Business Central queries and operations.'
          }
        ],
        model: 'claude-sonnet-4',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 100,
          output_tokens: 50
        }
      };

      vi.mocked(mockClient.createChatCompletion).mockResolvedValueOnce(mockResponse);

      // Act
      const result = await service.executeQuery(prompt, 'session-123', mockOnEvent);

      // Assert
      expect(result.success).toBe(true);
      expect(result.response).toContain('I can help you with Business Central');
      expect(result.toolsUsed).toHaveLength(0);
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);

      // Verify events emitted
      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'thinking' })
      );
      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message',
          content: 'I can help you with Business Central queries and operations.',
          role: 'assistant',
          stopReason: 'end_turn'
        })
      );
      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'complete', reason: 'success' })
      );
    });

    it('should execute query with tool use (list_all_entities)', async () => {
      // Arrange
      const prompt = 'List all Business Central entities';

      // First response: Claude wants to use tool
      const toolUseResponse: ChatCompletionResponse = {
        id: 'msg-tool-req',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-use-123',
            name: 'list_all_entities',
            input: {}
          }
        ],
        model: 'claude-sonnet-4',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 120, output_tokens: 30 }
      };

      // Second response: Claude processes tool result
      const finalResponse: ChatCompletionResponse = {
        id: 'msg-final',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'I found 1 Business Central entity: Customer'
          }
        ],
        model: 'claude-sonnet-4',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 200, output_tokens: 40 }
      };

      vi.mocked(mockClient.createChatCompletion)
        .mockResolvedValueOnce(toolUseResponse)
        .mockResolvedValueOnce(finalResponse);

      // Act
      const result = await service.executeQuery(prompt, 'session-tool', mockOnEvent);

      // Assert
      expect(result.success).toBe(true);
      expect(result.toolsUsed).toEqual(['list_all_entities']);
      expect(result.inputTokens).toBe(320); // 120 + 200
      expect(result.outputTokens).toBe(70); // 30 + 40

      // Verify tool_use event emitted
      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_use',
          toolName: 'list_all_entities',
          toolUseId: 'tool-use-123',
          args: {}
        })
      );

      // Verify tool_result event emitted
      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_result',
          toolName: 'list_all_entities',
          toolUseId: 'tool-use-123',
          success: true
        })
      );
    });

    it('should enforce max turns limit (20 turns)', async () => {
      // Arrange
      const prompt = 'Keep using tools forever';

      // Mock response that always returns tool_use (infinite loop)
      const infiniteToolUseResponse: ChatCompletionResponse = {
        id: 'msg-infinite',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-infinite',
            name: 'list_all_entities',
            input: {}
          }
        ],
        model: 'claude-sonnet-4',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 20 }
      };

      // Return tool_use response 21 times (should stop at 20)
      vi.mocked(mockClient.createChatCompletion)
        .mockResolvedValue(infiniteToolUseResponse);

      // Act
      const result = await service.executeQuery(prompt, 'session-max-turns', mockOnEvent);

      // Assert
      expect(result.success).toBe(true);
      expect(mockClient.createChatCompletion).toHaveBeenCalledTimes(20); // Max turns enforced

      // Verify max turns message emitted
      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message',
          content: '[Execution stopped - reached maximum turns]'
        })
      );
    }, 15000); // Increase timeout to 15 seconds (20 turns × 600ms delay = 12 seconds)

    it('should handle write operation approval (approved)', async () => {
      // Arrange
      const prompt = 'Create a new customer';

      const toolUseResponse: ChatCompletionResponse = {
        id: 'msg-write',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-write-123',
            name: 'create_customer', // Write operation
            input: { name: 'Test Customer' }
          }
        ],
        model: 'claude-sonnet-4',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 30 }
      };

      const finalResponse: ChatCompletionResponse = {
        id: 'msg-approved',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Customer created successfully'
          }
        ],
        model: 'claude-sonnet-4',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 150, output_tokens: 20 }
      };

      vi.mocked(mockClient.createChatCompletion)
        .mockResolvedValueOnce(toolUseResponse)
        .mockResolvedValueOnce(finalResponse);

      // Mock approval granted
      vi.mocked(mockApprovalManager.request).mockResolvedValueOnce(true);

      // Act
      const result = await service.executeQuery(prompt, 'session-approval', mockOnEvent);

      // Assert
      expect(result.success).toBe(true);
      expect(mockApprovalManager.request).toHaveBeenCalledOnce();
      expect(mockApprovalManager.request).toHaveBeenCalledWith({
        sessionId: 'session-approval',
        toolName: 'create_customer',
        toolArgs: { name: 'Test Customer' }
      });
    });

    it('should handle write operation denial (denied)', async () => {
      // Arrange
      const prompt = 'Delete all customers';

      const toolUseResponse: ChatCompletionResponse = {
        id: 'msg-delete',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-delete-123',
            name: 'delete_customers', // Write operation
            input: { confirm: true }
          }
        ],
        model: 'claude-sonnet-4',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 30 }
      };

      const finalResponse: ChatCompletionResponse = {
        id: 'msg-denied',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Operation was cancelled by user'
          }
        ],
        model: 'claude-sonnet-4',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 150, output_tokens: 20 }
      };

      vi.mocked(mockClient.createChatCompletion)
        .mockResolvedValueOnce(toolUseResponse)
        .mockResolvedValueOnce(finalResponse);

      // Mock approval denied
      vi.mocked(mockApprovalManager.request).mockResolvedValueOnce(false);

      // Act
      const result = await service.executeQuery(prompt, 'session-denied', mockOnEvent);

      // Assert
      expect(result.success).toBe(true);
      expect(mockApprovalManager.request).toHaveBeenCalledOnce();
      expect(mockApprovalManager.request).toHaveBeenCalledWith({
        sessionId: 'session-denied',
        toolName: 'delete_customers',
        toolArgs: { confirm: true }
      });

      // Verify tool_use event was emitted (before denial)
      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_use',
          toolName: 'delete_customers',
          toolUseId: 'tool-delete-123'
        })
      );

      // Verify that NO tool_result event was emitted (tool never executed due to denial)
      const toolResultCalls = mockOnEvent.mock.calls.filter(
        call => call[0].type === 'tool_result'
      );
      expect(toolResultCalls).toHaveLength(0);
    });

    it('should handle tool execution error', async () => {
      // Arrange
      const prompt = 'Use an unknown tool';

      const toolUseResponse: ChatCompletionResponse = {
        id: 'msg-tool-error',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-error-123',
            name: 'unknown_tool_that_does_not_exist', // This will trigger error
            input: { test: 'data' }
          }
        ],
        model: 'claude-sonnet-4',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 30 }
      };

      const finalResponse: ChatCompletionResponse = {
        id: 'msg-recovered',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'I apologize, that tool is not available'
          }
        ],
        model: 'claude-sonnet-4',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 150, output_tokens: 20 }
      };

      vi.mocked(mockClient.createChatCompletion)
        .mockResolvedValueOnce(toolUseResponse)
        .mockResolvedValueOnce(finalResponse);

      // Act
      const result = await service.executeQuery(prompt, 'session-error', mockOnEvent);

      // Assert
      expect(result.success).toBe(true); // Service recovers from tool error
      expect(result.toolsUsed).toContain('unknown_tool_that_does_not_exist');

      // Verify tool_result event with error was emitted
      const toolResultCalls = mockOnEvent.mock.calls.filter(
        call => call[0].type === 'tool_result'
      );
      expect(toolResultCalls).toHaveLength(1);
      expect(toolResultCalls[0][0]).toMatchObject({
        type: 'tool_result',
        toolName: 'unknown_tool_that_does_not_exist',
        toolUseId: 'tool-error-123',
        success: false,
        error: 'Unknown tool: unknown_tool_that_does_not_exist'
      });
    });

    it('should handle max_tokens stop reason', async () => {
      // Arrange
      const prompt = 'Generate a very long response';

      const maxTokensResponse: ChatCompletionResponse = {
        id: 'msg-max-tokens',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'This is a very long response that got truncated...'
          }
        ],
        model: 'claude-sonnet-4',
        stop_reason: 'max_tokens',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 4096 }
      };

      vi.mocked(mockClient.createChatCompletion).mockResolvedValueOnce(maxTokensResponse);

      // Act
      const result = await service.executeQuery(prompt, 'session-max-tokens', mockOnEvent);

      // Assert
      expect(result.success).toBe(true);
      expect(result.outputTokens).toBe(4096);

      // Verify truncation message emitted
      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message',
          content: '[Response truncated - reached max tokens]'
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      // Arrange
      const prompt = 'This will fail';
      const apiError = new Error('API rate limit exceeded');

      vi.mocked(mockClient.createChatCompletion).mockRejectedValueOnce(apiError);

      // Act
      const result = await service.executeQuery(prompt, 'session-api-error', mockOnEvent);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('API rate limit exceeded');
      expect(result.response).toBe('');

      // Verify error event emitted
      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          error: 'API rate limit exceeded'
        })
      );
    });

    it('should emit all event types correctly', async () => {
      // Arrange
      const prompt = 'Complete workflow test';

      const response: ChatCompletionResponse = {
        id: 'msg-events',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Test response'
          }
        ],
        model: 'claude-sonnet-4',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 20 }
      };

      vi.mocked(mockClient.createChatCompletion).mockResolvedValueOnce(response);

      // Act
      await service.executeQuery(prompt, 'session-events', mockOnEvent);

      // Assert - Verify event sequence
      const eventCalls = mockOnEvent.mock.calls.map(call => call[0].type);
      expect(eventCalls).toEqual(['thinking', 'message', 'complete']);

      // Verify thinking event structure
      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'thinking',
          timestamp: expect.any(Date)
        })
      );

      // Verify message event structure
      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message',
          messageId: expect.any(String),
          content: 'Test response',
          role: 'assistant',
          stopReason: 'end_turn',
          timestamp: expect.any(Date)
        })
      );

      // Verify complete event structure
      expect(mockOnEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'complete',
          reason: 'success',
          timestamp: expect.any(Date)
        })
      );
    });
  });

  describe('isWriteOperation (private method behavior)', () => {
    it('should require approval for write operations via tool name detection', async () => {
      // Arrange - Test write operation detection via tool name patterns
      const writeTools = ['create_customer', 'update_item', 'delete_record', 'post_invoice'];

      for (const toolName of writeTools) {
        const toolUseResponse: ChatCompletionResponse = {
          id: 'msg-write-test',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tool-write-test',
              name: toolName,
              input: {}
            }
          ],
          model: 'claude-sonnet-4',
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 20 }
        };

        const finalResponse: ChatCompletionResponse = {
          id: 'msg-final',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Done' }],
          model: 'claude-sonnet-4',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 120, output_tokens: 10 }
        };

        vi.mocked(mockClient.createChatCompletion)
          .mockResolvedValueOnce(toolUseResponse)
          .mockResolvedValueOnce(finalResponse);

        vi.mocked(mockApprovalManager.request).mockResolvedValueOnce(true);

        // Act
        await service.executeQuery('Test write', 'session-write', mockOnEvent);

        // Assert - Approval should be requested
        expect(mockApprovalManager.request).toHaveBeenCalled();

        // Reset for next iteration
        vi.clearAllMocks();
      }
    });

    it('should not require approval for read operations', async () => {
      // Arrange - Test read operation (no approval needed)
      const toolUseResponse: ChatCompletionResponse = {
        id: 'msg-read',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-read-test',
            name: 'list_all_entities', // Read operation
            input: {}
          }
        ],
        model: 'claude-sonnet-4',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 20 }
      };

      const finalResponse: ChatCompletionResponse = {
        id: 'msg-final',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Entities listed' }],
        model: 'claude-sonnet-4',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 150, output_tokens: 10 }
      };

      vi.mocked(mockClient.createChatCompletion)
        .mockResolvedValueOnce(toolUseResponse)
        .mockResolvedValueOnce(finalResponse);

      // Act
      await service.executeQuery('List entities', 'session-read', mockOnEvent);

      // Assert - Approval should NOT be requested
      expect(mockApprovalManager.request).not.toHaveBeenCalled();
    });
  });
});
