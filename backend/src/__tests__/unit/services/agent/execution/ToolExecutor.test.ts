/**
 * Unit Tests - ToolExecutor Service (TDD)
 *
 * Tests for the ToolExecutor service which handles tool execution,
 * approval flows, sequence ordering, and result persistence.
 *
 * This is written BEFORE implementation (TDD approach) to define
 * the expected behavior and interfaces.
 *
 * Key Responsibilities:
 * - Execute multiple tools in sequence
 * - Pre-reserve sequences for correct ordering
 * - Handle approval flow for write operations
 * - Track tool execution metrics
 * - Persist tool results to EventStore and MessageQueue
 * - Emit tool results via WebSocket
 *
 * @module __tests__/unit/services/agent/execution/ToolExecutor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolExecutor } from '@/services/agent/execution/ToolExecutor';
import type { ApprovalManager } from '@/services/approval/ApprovalManager';
import type { ToolResultEvent } from '@bc-agent/shared';

// ===== HOISTED MOCKS =====

// Mock EventStore
const mockAppendEventWithSequence = vi.fn();
const mockEventStore = {
  appendEventWithSequence: mockAppendEventWithSequence,
  appendEvent: vi.fn(),
  getNextSequenceNumber: vi.fn(),
  getEvents: vi.fn(),
};

vi.mock('@/services/events/EventStore', () => ({
  getEventStore: vi.fn(() => mockEventStore),
}));

// Mock MessageOrderingService
const mockReserveSequenceBatch = vi.fn();
const mockMessageOrderingService = {
  reserveSequenceBatch: mockReserveSequenceBatch,
  getNextSequence: vi.fn(),
};

vi.mock('@/services/agent/messages', () => ({
  getMessageOrderingService: vi.fn(() => mockMessageOrderingService),
  getMessageEmitter: vi.fn(() => ({
    emitToolResult: vi.fn(),
  })),
}));

// Mock UsageTrackingService
const mockTrackToolExecution = vi.fn();
const mockUsageTrackingService = {
  trackToolExecution: mockTrackToolExecution,
  trackClaudeUsage: vi.fn(),
};

vi.mock('@/services/tracking/UsageTrackingService', () => ({
  getUsageTrackingService: vi.fn(() => mockUsageTrackingService),
}));

// Mock MessageService
const mockUpdateToolResult = vi.fn();
const mockMessageService = {
  updateToolResult: mockUpdateToolResult,
};

vi.mock('@/services/messages/MessageService', () => ({
  getMessageService: vi.fn(() => mockMessageService),
}));

// Mock MessageQueue
const mockAddMessagePersistence = vi.fn();
const mockMessageQueue = {
  addMessagePersistence: mockAddMessagePersistence,
};

vi.mock('@/services/queue/MessageQueue', () => ({
  getMessageQueue: vi.fn(() => mockMessageQueue),
}));

// ===== TYPE DEFINITIONS FOR TESTING =====

/**
 * Tool use input structure (matches Anthropic API)
 */
interface ToolUseInput {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Tool result structure (matches Anthropic API)
 */
interface ToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * Options for tool executor
 */
interface ToolExecutorOptions {
  sessionId: string;
  userId: string;
  turnCount: number;
  approvalManager?: ApprovalManager;
  onToolResult?: (result: ToolResultEvent) => void;
}

/**
 * Result of tool execution
 */
interface ToolExecutionResult {
  toolResults: ToolResult[];
  toolsUsed: string[];
  success: boolean;
}

/**
 * Interface that ToolExecutor should implement
 */
interface IToolExecutor {
  executeTools(toolUses: ToolUseInput[], options: ToolExecutorOptions): Promise<ToolExecutionResult>;
  isWriteOperation(toolName: string): boolean;
}

// ===== TEST SUITE =====

describe('ToolExecutor', () => {
  let toolExecutor: IToolExecutor;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Setup default mock behaviors
    mockReserveSequenceBatch.mockImplementation((sessionId: string, count: number) => {
      const sequences: number[] = [];
      for (let i = 0; i < count; i++) {
        sequences.push(1000 + i);
      }
      return Promise.resolve({
        sessionId,
        startSequence: 1000,
        sequences,
        reservedAt: new Date(),
      });
    });

    mockAppendEventWithSequence.mockImplementation((sessionId, eventType, data, sequence) => {
      return Promise.resolve({
        id: `event-${Math.random().toString(36).substring(7)}`,
        session_id: sessionId,
        event_type: eventType,
        sequence_number: sequence,
        timestamp: new Date(),
        data,
        processed: false,
      });
    });

    mockUpdateToolResult.mockResolvedValue(undefined);
    mockAddMessagePersistence.mockResolvedValue(undefined);
    mockTrackToolExecution.mockResolvedValue(undefined);

    // Create ToolExecutor instance
    toolExecutor = new ToolExecutor();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===== 1. isWriteOperation tests =====

  describe('isWriteOperation', () => {
    it('should return true for create operations', () => {
      expect(toolExecutor.isWriteOperation('create_customer')).toBe(true);
      expect(toolExecutor.isWriteOperation('CreateCustomer')).toBe(true);
      expect(toolExecutor.isWriteOperation('CREATE_CUSTOMER')).toBe(true);
    });

    it('should return true for update operations', () => {
      expect(toolExecutor.isWriteOperation('update_customer')).toBe(true);
      expect(toolExecutor.isWriteOperation('UpdateCustomer')).toBe(true);
      expect(toolExecutor.isWriteOperation('UPDATE_CUSTOMER')).toBe(true);
    });

    it('should return true for delete operations', () => {
      expect(toolExecutor.isWriteOperation('delete_customer')).toBe(true);
      expect(toolExecutor.isWriteOperation('DeleteCustomer')).toBe(true);
      expect(toolExecutor.isWriteOperation('DELETE_CUSTOMER')).toBe(true);
    });

    it('should return true for post operations', () => {
      expect(toolExecutor.isWriteOperation('post_invoice')).toBe(true);
      expect(toolExecutor.isWriteOperation('PostInvoice')).toBe(true);
      expect(toolExecutor.isWriteOperation('POST_INVOICE')).toBe(true);
    });

    it('should return true for patch operations', () => {
      expect(toolExecutor.isWriteOperation('patch_customer')).toBe(true);
      expect(toolExecutor.isWriteOperation('PatchCustomer')).toBe(true);
      expect(toolExecutor.isWriteOperation('PATCH_CUSTOMER')).toBe(true);
    });

    it('should return true for put operations', () => {
      expect(toolExecutor.isWriteOperation('put_customer')).toBe(true);
      expect(toolExecutor.isWriteOperation('PutCustomer')).toBe(true);
      expect(toolExecutor.isWriteOperation('PUT_CUSTOMER')).toBe(true);
    });

    it('should return false for list operations', () => {
      expect(toolExecutor.isWriteOperation('list_customers')).toBe(false);
      expect(toolExecutor.isWriteOperation('ListCustomers')).toBe(false);
      expect(toolExecutor.isWriteOperation('LIST_CUSTOMERS')).toBe(false);
    });

    it('should return false for get operations', () => {
      expect(toolExecutor.isWriteOperation('get_customer')).toBe(false);
      expect(toolExecutor.isWriteOperation('GetCustomer')).toBe(false);
      expect(toolExecutor.isWriteOperation('GET_CUSTOMER')).toBe(false);
    });

    it('should return false for search operations', () => {
      expect(toolExecutor.isWriteOperation('search_customers')).toBe(false);
      expect(toolExecutor.isWriteOperation('SearchCustomers')).toBe(false);
      expect(toolExecutor.isWriteOperation('SEARCH_CUSTOMERS')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(toolExecutor.isWriteOperation('cReAtE_customer')).toBe(true);
      expect(toolExecutor.isWriteOperation('uPdAtE_customer')).toBe(true);
      expect(toolExecutor.isWriteOperation('lIsT_customers')).toBe(false);
    });

    it('should match patterns anywhere in the tool name', () => {
      expect(toolExecutor.isWriteOperation('customer_create_v2')).toBe(true);
      expect(toolExecutor.isWriteOperation('entity_update_batch')).toBe(true);
      expect(toolExecutor.isWriteOperation('customer_list_all')).toBe(false);
    });
  });

  // ===== 2. executeTools tests =====

  describe('executeTools', () => {
    const mockOptions: ToolExecutorOptions = {
      sessionId: 'session-123',
      userId: 'user-456',
      turnCount: 1,
    };

    it('should execute all tools in sequence', async () => {
      const toolUses: ToolUseInput[] = [
        {
          id: 'toolu_001',
          name: 'list_customers',
          input: { limit: 10 },
        },
        {
          id: 'toolu_002',
          name: 'get_customer',
          input: { id: '123' },
        },
      ];

      const result = await toolExecutor.executeTools(toolUses, mockOptions);

      expect(result.success).toBe(true);
      expect(result.toolsUsed).toEqual(['list_customers', 'get_customer']);
      expect(result.toolResults).toHaveLength(2);
      expect(result.toolResults[0]?.tool_use_id).toBe('toolu_001');
      expect(result.toolResults[1]?.tool_use_id).toBe('toolu_002');
    });

    it('should reserve sequences BEFORE execution for ordering', async () => {
      const toolUses: ToolUseInput[] = [
        { id: 'toolu_001', name: 'list_customers', input: {} },
        { id: 'toolu_002', name: 'get_customer', input: {} },
      ];

      await toolExecutor.executeTools(toolUses, mockOptions);

      // Verify sequence batch was reserved at the start
      expect(mockReserveSequenceBatch).toHaveBeenCalledTimes(1);
      expect(mockReserveSequenceBatch).toHaveBeenCalledWith('session-123', 2);

      // Verify reserved sequences were used (1000, 1001 from our mock)
      expect(mockAppendEventWithSequence).toHaveBeenCalledTimes(2);
      expect(mockAppendEventWithSequence).toHaveBeenNthCalledWith(
        1,
        'session-123',
        'tool_use_completed',
        expect.objectContaining({ tool_use_id: 'toolu_001' }),
        1000
      );
      expect(mockAppendEventWithSequence).toHaveBeenNthCalledWith(
        2,
        'session-123',
        'tool_use_completed',
        expect.objectContaining({ tool_use_id: 'toolu_002' }),
        1001
      );
    });

    it('should call onToolResult callback for each result', async () => {
      const onToolResult = vi.fn();
      const toolUses: ToolUseInput[] = [
        { id: 'toolu_001', name: 'list_customers', input: {} },
      ];

      await toolExecutor.executeTools(toolUses, {
        ...mockOptions,
        onToolResult,
      });

      expect(onToolResult).toHaveBeenCalledTimes(1);
      expect(onToolResult).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_result',
          toolUseId: 'toolu_001',
          toolName: 'list_customers',
        })
      );
    });

    it('should return all tool results in order', async () => {
      const toolUses: ToolUseInput[] = [
        { id: 'toolu_001', name: 'tool_a', input: {} },
        { id: 'toolu_002', name: 'tool_b', input: {} },
        { id: 'toolu_003', name: 'tool_c', input: {} },
      ];

      const result = await toolExecutor.executeTools(toolUses, mockOptions);

      expect(result.toolResults).toHaveLength(3);
      expect(result.toolResults[0]?.tool_use_id).toBe('toolu_001');
      expect(result.toolResults[1]?.tool_use_id).toBe('toolu_002');
      expect(result.toolResults[2]?.tool_use_id).toBe('toolu_003');
    });

    it('should handle tool execution errors gracefully', async () => {
      // Mock tool execution to throw error
      const toolUses: ToolUseInput[] = [
        { id: 'toolu_001', name: 'list_customers', input: {} },
      ];

      // Make appendEventWithSequence throw error to simulate tool execution failure
      mockAppendEventWithSequence.mockRejectedValueOnce(new Error('Tool execution failed'));

      const result = await toolExecutor.executeTools(toolUses, mockOptions);

      // Should still return a result with error
      expect(result.success).toBe(true); // Overall execution succeeded
      expect(result.toolResults).toHaveLength(1);
      expect(result.toolResults[0]?.is_error).toBe(true);
      expect(result.toolResults[0]?.content).toContain('Error');
    });

    it('should track tool execution metrics', async () => {
      const toolUses: ToolUseInput[] = [
        { id: 'toolu_001', name: 'list_customers', input: {} },
      ];

      await toolExecutor.executeTools(toolUses, mockOptions);

      expect(mockTrackToolExecution).toHaveBeenCalledTimes(1);
      expect(mockTrackToolExecution).toHaveBeenCalledWith(
        'user-456',
        'session-123',
        'list_customers',
        expect.any(Number), // duration in ms
        expect.objectContaining({
          success: true,
          tool_use_id: 'toolu_001',
          turn_count: 1,
          tool_index: 0,
        })
      );
    });

    it('should update messages table for each tool result', async () => {
      const toolUses: ToolUseInput[] = [
        { id: 'toolu_001', name: 'list_customers', input: { limit: 10 } },
      ];

      await toolExecutor.executeTools(toolUses, mockOptions);

      expect(mockUpdateToolResult).toHaveBeenCalledTimes(1);
      expect(mockUpdateToolResult).toHaveBeenCalledWith(
        'session-123',
        'user-456',
        'toolu_001',
        'list_customers',
        { limit: 10 },
        expect.anything(), // result
        true, // success
        undefined // no error
      );
    });

    it('should queue tool result for persistence', async () => {
      const toolUses: ToolUseInput[] = [
        { id: 'toolu_001', name: 'list_customers', input: {} },
      ];

      await toolExecutor.executeTools(toolUses, mockOptions);

      expect(mockAddMessagePersistence).toHaveBeenCalledTimes(1);
      expect(mockAddMessagePersistence).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-123',
          messageId: 'toolu_001_result',
          role: 'assistant',
          messageType: 'tool_result',
          sequenceNumber: 1000,
          toolUseId: 'toolu_001',
        })
      );
    });

    it('should handle empty tool list', async () => {
      const toolUses: ToolUseInput[] = [];

      const result = await toolExecutor.executeTools(toolUses, mockOptions);

      expect(result.success).toBe(true);
      expect(result.toolResults).toHaveLength(0);
      expect(result.toolsUsed).toHaveLength(0);
      expect(mockReserveSequenceBatch).not.toHaveBeenCalled();
    });
  });

  // ===== 3. Approval flow tests =====

  describe('approval flow', () => {
    const mockOptions: ToolExecutorOptions = {
      sessionId: 'session-123',
      userId: 'user-456',
      turnCount: 1,
    };

    it('should request approval for write operations', async () => {
      const mockApprovalManager = {
        request: vi.fn().mockResolvedValue(true),
      } as unknown as ApprovalManager;

      const toolUses: ToolUseInput[] = [
        {
          id: 'toolu_001',
          name: 'create_customer',
          input: { name: 'John Doe' },
        },
      ];

      await toolExecutor.executeTools(toolUses, {
        ...mockOptions,
        approvalManager: mockApprovalManager,
      });

      expect(mockApprovalManager.request).toHaveBeenCalledTimes(1);
      expect(mockApprovalManager.request).toHaveBeenCalledWith({
        sessionId: 'session-123',
        toolName: 'create_customer',
        toolArgs: { name: 'John Doe' },
      });
    });

    it('should NOT request approval for read operations', async () => {
      const mockApprovalManager = {
        request: vi.fn().mockResolvedValue(true),
      } as unknown as ApprovalManager;

      const toolUses: ToolUseInput[] = [
        {
          id: 'toolu_001',
          name: 'list_customers',
          input: { limit: 10 },
        },
      ];

      await toolExecutor.executeTools(toolUses, {
        ...mockOptions,
        approvalManager: mockApprovalManager,
      });

      expect(mockApprovalManager.request).not.toHaveBeenCalled();
    });

    it('should return denial result when approval rejected', async () => {
      const mockApprovalManager = {
        request: vi.fn().mockResolvedValue(false), // User denied approval
      } as unknown as ApprovalManager;

      const toolUses: ToolUseInput[] = [
        {
          id: 'toolu_001',
          name: 'delete_customer',
          input: { id: '123' },
        },
      ];

      const result = await toolExecutor.executeTools(toolUses, {
        ...mockOptions,
        approvalManager: mockApprovalManager,
      });

      expect(result.toolResults).toHaveLength(1);
      expect(result.toolResults[0]?.is_error).toBe(true);
      expect(result.toolResults[0]?.content).toContain('approval denied');
      expect(result.toolResults[0]?.content).toContain('cancelled by user');
    });

    it('should continue execution when approval granted', async () => {
      const mockApprovalManager = {
        request: vi.fn().mockResolvedValue(true), // User approved
      } as unknown as ApprovalManager;

      const toolUses: ToolUseInput[] = [
        {
          id: 'toolu_001',
          name: 'update_customer',
          input: { id: '123', name: 'Jane Doe' },
        },
      ];

      const result = await toolExecutor.executeTools(toolUses, {
        ...mockOptions,
        approvalManager: mockApprovalManager,
      });

      // Should execute normally (not be an error)
      expect(result.toolResults[0]?.is_error).toBeFalsy();
      expect(mockAppendEventWithSequence).toHaveBeenCalled();
    });

    it('should skip approval if approvalManager is not provided', async () => {
      const toolUses: ToolUseInput[] = [
        {
          id: 'toolu_001',
          name: 'create_customer', // Write operation
          input: { name: 'John Doe' },
        },
      ];

      const result = await toolExecutor.executeTools(toolUses, mockOptions);

      // Should execute without approval check
      expect(result.toolResults[0]?.is_error).toBeFalsy();
      expect(mockAppendEventWithSequence).toHaveBeenCalled();
    });

    it('should handle mixed read and write operations', async () => {
      const mockApprovalManager = {
        request: vi.fn().mockResolvedValue(true),
      } as unknown as ApprovalManager;

      const toolUses: ToolUseInput[] = [
        { id: 'toolu_001', name: 'list_customers', input: {} }, // Read
        { id: 'toolu_002', name: 'create_customer', input: { name: 'John' } }, // Write
        { id: 'toolu_003', name: 'get_customer', input: { id: '123' } }, // Read
        { id: 'toolu_004', name: 'update_customer', input: { id: '123' } }, // Write
      ];

      await toolExecutor.executeTools(toolUses, {
        ...mockOptions,
        approvalManager: mockApprovalManager,
      });

      // Should only request approval for write operations (2 times)
      expect(mockApprovalManager.request).toHaveBeenCalledTimes(2);
    });
  });

  // ===== 4. Sequence ordering tests =====

  describe('sequence ordering', () => {
    const mockOptions: ToolExecutorOptions = {
      sessionId: 'session-123',
      userId: 'user-456',
      turnCount: 1,
    };

    it('should use pre-assigned sequence for each tool result', async () => {
      const toolUses: ToolUseInput[] = [
        { id: 'toolu_001', name: 'tool_a', input: {} },
        { id: 'toolu_002', name: 'tool_b', input: {} },
        { id: 'toolu_003', name: 'tool_c', input: {} },
      ];

      await toolExecutor.executeTools(toolUses, mockOptions);

      // Verify sequences are pre-reserved
      expect(mockReserveSequenceBatch).toHaveBeenCalledWith('session-123', 3);

      // Verify each tool uses its pre-assigned sequence (1000, 1001, 1002)
      expect(mockAppendEventWithSequence).toHaveBeenNthCalledWith(
        1,
        'session-123',
        'tool_use_completed',
        expect.anything(),
        1000
      );
      expect(mockAppendEventWithSequence).toHaveBeenNthCalledWith(
        2,
        'session-123',
        'tool_use_completed',
        expect.anything(),
        1001
      );
      expect(mockAppendEventWithSequence).toHaveBeenNthCalledWith(
        3,
        'session-123',
        'tool_use_completed',
        expect.anything(),
        1002
      );
    });

    it('should maintain correct order even with varying execution times', async () => {
      // Mock slow and fast tool executions
      mockAppendEventWithSequence
        .mockImplementationOnce(async (sessionId, eventType, data, sequence) => {
          // First tool is slow (100ms)
          await new Promise(resolve => setTimeout(resolve, 100));
          return {
            id: 'event-1',
            session_id: sessionId,
            event_type: eventType,
            sequence_number: sequence,
            timestamp: new Date(),
            data,
            processed: false,
          };
        })
        .mockImplementationOnce(async (sessionId, eventType, data, sequence) => {
          // Second tool is fast (10ms)
          await new Promise(resolve => setTimeout(resolve, 10));
          return {
            id: 'event-2',
            session_id: sessionId,
            event_type: eventType,
            sequence_number: sequence,
            timestamp: new Date(),
            data,
            processed: false,
          };
        });

      const toolUses: ToolUseInput[] = [
        { id: 'toolu_slow', name: 'slow_tool', input: {} },
        { id: 'toolu_fast', name: 'fast_tool', input: {} },
      ];

      const result = await toolExecutor.executeTools(toolUses, mockOptions);

      // Results should maintain order (slow first, fast second)
      expect(result.toolResults[0]?.tool_use_id).toBe('toolu_slow');
      expect(result.toolResults[1]?.tool_use_id).toBe('toolu_fast');

      // Sequences should be in order (1000, 1001) regardless of execution time
      expect(mockAppendEventWithSequence).toHaveBeenNthCalledWith(
        1,
        'session-123',
        'tool_use_completed',
        expect.objectContaining({ tool_use_id: 'toolu_slow' }),
        1000
      );
      expect(mockAppendEventWithSequence).toHaveBeenNthCalledWith(
        2,
        'session-123',
        'tool_use_completed',
        expect.objectContaining({ tool_use_id: 'toolu_fast' }),
        1001
      );
    });

    it('should use pre-assigned sequence even for errors', async () => {
      // Mock first tool succeeds, second fails
      mockAppendEventWithSequence
        .mockResolvedValueOnce({
          id: 'event-1',
          session_id: 'session-123',
          event_type: 'tool_use_completed',
          sequence_number: 1000,
          timestamp: new Date(),
          data: {},
          processed: false,
        })
        .mockRejectedValueOnce(new Error('Tool execution failed'));

      // Need to reset to success for error path
      mockAppendEventWithSequence.mockResolvedValueOnce({
        id: 'event-2',
        session_id: 'session-123',
        event_type: 'tool_use_completed',
        sequence_number: 1001,
        timestamp: new Date(),
        data: {},
        processed: false,
      });

      const toolUses: ToolUseInput[] = [
        { id: 'toolu_001', name: 'tool_a', input: {} },
        { id: 'toolu_002', name: 'tool_b', input: {} },
      ];

      await toolExecutor.executeTools(toolUses, mockOptions);

      // Error should use its pre-assigned sequence (1001)
      expect(mockAppendEventWithSequence).toHaveBeenCalledWith(
        'session-123',
        'tool_use_completed',
        expect.objectContaining({
          success: false,
          tool_use_id: 'toolu_002',
        }),
        1001
      );
    });

    it('should track sequence numbers in persistence queue', async () => {
      const toolUses: ToolUseInput[] = [
        { id: 'toolu_001', name: 'tool_a', input: {} },
        { id: 'toolu_002', name: 'tool_b', input: {} },
      ];

      await toolExecutor.executeTools(toolUses, mockOptions);

      // Verify MessageQueue receives correct sequence numbers
      expect(mockAddMessagePersistence).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          sequenceNumber: 1000,
          toolUseId: 'toolu_001',
        })
      );
      expect(mockAddMessagePersistence).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          sequenceNumber: 1001,
          toolUseId: 'toolu_002',
        })
      );
    });
  });

  // ===== 5. Edge cases and error handling =====

  describe('edge cases and error handling', () => {
    const mockOptions: ToolExecutorOptions = {
      sessionId: 'session-123',
      userId: 'user-456',
      turnCount: 1,
    };

    it('should handle missing tool use ID gracefully', async () => {
      const toolUses: ToolUseInput[] = [
        {
          id: '', // Empty ID
          name: 'list_customers',
          input: {},
        },
      ];

      const result = await toolExecutor.executeTools(toolUses, mockOptions);

      // Should still execute and return result
      expect(result.success).toBe(true);
      expect(result.toolResults).toHaveLength(1);
    });

    it('should handle EventStore failure gracefully', async () => {
      mockAppendEventWithSequence.mockRejectedValueOnce(new Error('EventStore unavailable'));

      const toolUses: ToolUseInput[] = [
        { id: 'toolu_001', name: 'list_customers', input: {} },
      ];

      const result = await toolExecutor.executeTools(toolUses, mockOptions);

      // Should return error result but not throw
      expect(result.success).toBe(true);
      expect(result.toolResults[0]?.is_error).toBe(true);
    });

    it('should handle MessageQueue failure gracefully', async () => {
      mockAddMessagePersistence.mockRejectedValueOnce(new Error('Queue unavailable'));

      const toolUses: ToolUseInput[] = [
        { id: 'toolu_001', name: 'list_customers', input: {} },
      ];

      // Should not throw error
      await expect(toolExecutor.executeTools(toolUses, mockOptions)).resolves.not.toThrow();
    });

    it('should handle UsageTracking failure gracefully', async () => {
      mockTrackToolExecution.mockRejectedValueOnce(new Error('Tracking unavailable'));

      const toolUses: ToolUseInput[] = [
        { id: 'toolu_001', name: 'list_customers', input: {} },
      ];

      // Should not throw error
      await expect(toolExecutor.executeTools(toolUses, mockOptions)).resolves.not.toThrow();
    });

    it('should handle approval timeout gracefully', async () => {
      const mockApprovalManager = {
        request: vi.fn().mockRejectedValue(new Error('Approval timeout')),
      } as unknown as ApprovalManager;

      const toolUses: ToolUseInput[] = [
        { id: 'toolu_001', name: 'create_customer', input: {} },
      ];

      const result = await toolExecutor.executeTools(toolUses, {
        ...mockOptions,
        approvalManager: mockApprovalManager,
      });

      // Should return error result
      expect(result.toolResults[0]?.is_error).toBe(true);
      expect(result.toolResults[0]?.content).toContain('Error');
    });

    it('should handle large batch of tools', async () => {
      const toolUses: ToolUseInput[] = Array.from({ length: 100 }, (_, i) => ({
        id: `toolu_${i}`,
        name: `tool_${i}`,
        input: {},
      }));

      const result = await toolExecutor.executeTools(toolUses, mockOptions);

      expect(result.success).toBe(true);
      expect(result.toolResults).toHaveLength(100);
      expect(result.toolsUsed).toHaveLength(100);
    });

    it('should handle tools with complex input', async () => {
      const toolUses: ToolUseInput[] = [
        {
          id: 'toolu_001',
          name: 'complex_tool',
          input: {
            nested: {
              deep: {
                value: 'test',
              },
            },
            array: [1, 2, 3],
            boolean: true,
            number: 42,
          },
        },
      ];

      await toolExecutor.executeTools(toolUses, mockOptions);

      // Verify updateToolResult was called with the complex input preserved
      expect(mockUpdateToolResult).toHaveBeenCalledTimes(1);
      const callArgs = mockUpdateToolResult.mock.calls[0];
      expect(callArgs?.[0]).toBe('session-123');
      expect(callArgs?.[1]).toBe('user-456');
      expect(callArgs?.[2]).toBe('toolu_001');
      expect(callArgs?.[3]).toBe('complex_tool');
      // Verify the input (5th arg) preserves complex nested structure
      const inputArg = callArgs?.[4] as Record<string, unknown>;
      expect(inputArg).toHaveProperty('nested.deep.value', 'test');
      expect(inputArg).toHaveProperty('array', [1, 2, 3]);
      expect(inputArg).toHaveProperty('boolean', true);
      expect(inputArg).toHaveProperty('number', 42);
    });
  });
});
