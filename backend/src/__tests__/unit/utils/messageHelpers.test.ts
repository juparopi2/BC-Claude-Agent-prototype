/**
 * Unit Tests - Message Helpers
 *
 * Tests for thinking and tool use message persistence functions.
 * Tests added for commit fff955d: message type support for persistent agent messages.
 *
 * @module __tests__/unit/utils/messageHelpers
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { saveThinkingMessage, saveToolUseMessage, updateToolResultMessage } from '@/utils/messageHelpers';
import { executeQuery } from '@/config/database';
import { randomUUID } from 'crypto';

// Mock dependencies
vi.mock('@/config/database', () => ({
  executeQuery: vi.fn()
}));

vi.mock('crypto', () => ({
  randomUUID: vi.fn()
}));

describe('messageHelpers', () => {
  let mockExecuteQuery: Mock;
  let mockRandomUUID: Mock;

  beforeEach(() => {
    mockExecuteQuery = executeQuery as Mock;
    mockRandomUUID = randomUUID as Mock;
    vi.clearAllMocks();
  });

  describe('saveThinkingMessage', () => {
    it('should save thinking message with generated UUID', async () => {
      // Arrange
      const sessionId = 'test-session-123';
      const content = 'Let me break down this problem...';
      const mockUUID = 'thinking-msg-uuid-456';

      mockRandomUUID.mockReturnValueOnce(mockUUID);
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      const result = await saveThinkingMessage(sessionId, content);

      // Assert
      expect(result).toBe(mockUUID);
      expect(mockRandomUUID).toHaveBeenCalledOnce();
      expect(mockExecuteQuery).toHaveBeenCalledOnce();

      // Verify SQL query structure
      const callArgs = mockExecuteQuery.mock.calls[0];
      expect(callArgs[0]).toContain('INSERT INTO messages');
      expect(callArgs[0]).toContain("'thinking'");

      // Verify parameters
      expect(callArgs[1]).toEqual({
        id: mockUUID,
        sessionId,
        metadata: expect.stringContaining(content)
      });
    });

    it('should handle empty thinking content', async () => {
      // Arrange
      const sessionId = 'test-session-empty';
      const content = '';
      const mockUUID = 'thinking-empty-uuid';

      mockRandomUUID.mockReturnValueOnce(mockUUID);
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      const result = await saveThinkingMessage(sessionId, content);

      // Assert
      expect(result).toBe(mockUUID);
      expect(mockExecuteQuery).toHaveBeenCalledOnce();

      // Verify metadata contains empty string
      const callArgs = mockExecuteQuery.mock.calls[0];
      const metadata = JSON.parse(callArgs[1].metadata);
      expect(metadata.content).toBe('');
      expect(metadata.started_at).toBeDefined();
    });

    it('should include started_at timestamp in metadata', async () => {
      // Arrange
      const sessionId = 'test-session-timestamp';
      const content = 'Thinking...';
      const mockUUID = 'thinking-timestamp-uuid';
      const beforeTimestamp = new Date();

      mockRandomUUID.mockReturnValueOnce(mockUUID);
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      await saveThinkingMessage(sessionId, content);

      // Assert
      const callArgs = mockExecuteQuery.mock.calls[0];
      const metadata = JSON.parse(callArgs[1].metadata);

      expect(metadata.started_at).toBeDefined();
      const timestamp = new Date(metadata.started_at);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeTimestamp.getTime());
    });

    it('should handle database error gracefully', async () => {
      // Arrange
      const sessionId = 'test-session-error';
      const content = 'Thinking...';
      const mockUUID = 'thinking-error-uuid';
      const dbError = new Error('Database connection lost');

      mockRandomUUID.mockReturnValueOnce(mockUUID);
      mockExecuteQuery.mockRejectedValueOnce(dbError);

      // Act & Assert
      await expect(saveThinkingMessage(sessionId, content)).rejects.toThrow('Database connection lost');
    });
  });

  describe('saveToolUseMessage', () => {
    it('should save tool use message with pending status', async () => {
      // Arrange
      const sessionId = 'test-session-tool';
      const toolName = 'mcp__erptools__search_entity_operations';
      const toolArgs = { entity: 'customer', operation: 'GET' };
      const mockUUID = 'tool-use-uuid-789';

      mockRandomUUID.mockReturnValueOnce(mockUUID);
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      const result = await saveToolUseMessage(sessionId, toolName, toolArgs);

      // Assert
      expect(result).toBe(mockUUID);
      expect(mockRandomUUID).toHaveBeenCalledOnce();
      expect(mockExecuteQuery).toHaveBeenCalledOnce();

      // Verify SQL query structure
      const callArgs = mockExecuteQuery.mock.calls[0];
      expect(callArgs[0]).toContain('INSERT INTO messages');
      expect(callArgs[0]).toContain("'tool_use'");

      // Verify parameters and metadata
      const metadata = JSON.parse(callArgs[1].metadata);
      expect(metadata).toEqual({
        tool_name: toolName,
        tool_args: toolArgs,
        tool_use_id: mockUUID,
        status: 'pending'
      });
    });

    it('should handle empty tool arguments', async () => {
      // Arrange
      const sessionId = 'test-session-empty-args';
      const toolName = 'mcp__erptools__list_all_entities';
      const toolArgs = {};
      const mockUUID = 'tool-empty-args-uuid';

      mockRandomUUID.mockReturnValueOnce(mockUUID);
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      const result = await saveToolUseMessage(sessionId, toolName, toolArgs);

      // Assert
      expect(result).toBe(mockUUID);

      const callArgs = mockExecuteQuery.mock.calls[0];
      const metadata = JSON.parse(callArgs[1].metadata);
      expect(metadata.tool_args).toEqual({});
    });

    it('should handle complex nested tool arguments', async () => {
      // Arrange
      const sessionId = 'test-session-complex-args';
      const toolName = 'mcp__erptools__batch_create';
      const toolArgs = {
        entity: 'customer',
        records: [
          { name: 'Customer 1', email: 'c1@example.com' },
          { name: 'Customer 2', email: 'c2@example.com' }
        ],
        options: {
          validateOnly: false,
          continueOnError: true
        }
      };
      const mockUUID = 'tool-complex-uuid';

      mockRandomUUID.mockReturnValueOnce(mockUUID);
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      const result = await saveToolUseMessage(sessionId, toolName, toolArgs);

      // Assert
      expect(result).toBe(mockUUID);

      const callArgs = mockExecuteQuery.mock.calls[0];
      const metadata = JSON.parse(callArgs[1].metadata);
      expect(metadata.tool_args).toEqual(toolArgs);
      expect(metadata.tool_args.records).toHaveLength(2);
    });

    it('should preserve tool_use_id in metadata', async () => {
      // Arrange
      const sessionId = 'test-session-preserve-id';
      const toolName = 'mcp__erptools__get_entity_details';
      const toolArgs = { entity: 'item' };
      const mockUUID = 'tool-preserve-id-uuid';

      mockRandomUUID.mockReturnValueOnce(mockUUID);
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      const result = await saveToolUseMessage(sessionId, toolName, toolArgs);

      // Assert
      const callArgs = mockExecuteQuery.mock.calls[0];
      const metadata = JSON.parse(callArgs[1].metadata);
      expect(metadata.tool_use_id).toBe(mockUUID);
      expect(metadata.tool_use_id).toBe(result);
    });
  });

  describe('updateToolResultMessage', () => {
    it('should update tool use message with success result', async () => {
      // Arrange
      const sessionId = 'test-session-update-success';
      const toolUseId = 'tool-use-success-uuid';
      const toolName = 'mcp__erptools__search_entity_operations';
      const toolArgs = { entity: 'customer', operation: 'POST' };
      const result = { operations: ['create', 'update'], count: 2 };

      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      // Act
      await updateToolResultMessage(sessionId, toolUseId, toolName, toolArgs, result, true);

      // Assert
      expect(mockExecuteQuery).toHaveBeenCalledOnce();

      const callArgs = mockExecuteQuery.mock.calls[0];
      expect(callArgs[0]).toContain('UPDATE messages');
      expect(callArgs[0]).toContain('WHERE id = @toolUseId');

      const metadata = JSON.parse(callArgs[1].metadata);
      expect(metadata).toEqual({
        tool_name: toolName,
        tool_args: toolArgs,
        tool_result: result,
        tool_use_id: toolUseId,
        status: 'success',
        success: true,
        error_message: null
      });
    });

    it('should update tool use message with error result', async () => {
      // Arrange
      const sessionId = 'test-session-update-error';
      const toolUseId = 'tool-use-error-uuid';
      const toolName = 'mcp__erptools__get_entity_details';
      const toolArgs = { entity: 'NonExistentEntity' };
      const result = null;
      const error = 'Entity "NonExistentEntity" not found in index';

      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      // Act
      await updateToolResultMessage(sessionId, toolUseId, toolName, toolArgs, result, false, error);

      // Assert
      const callArgs = mockExecuteQuery.mock.calls[0];
      const metadata = JSON.parse(callArgs[1].metadata);

      expect(metadata.status).toBe('error');
      expect(metadata.success).toBe(false);
      expect(metadata.error_message).toBe(error);
      expect(metadata.tool_result).toBeNull();
    });

    it('should preserve original tool args in update', async () => {
      // Arrange
      const sessionId = 'test-session-preserve-args';
      const toolUseId = 'tool-use-preserve-uuid';
      const toolName = 'mcp__erptools__batch_create';
      const toolArgs = {
        entity: 'item',
        records: [{ name: 'Item 1' }, { name: 'Item 2' }]
      };
      const result = { created: 2, failed: 0 };

      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      // Act
      await updateToolResultMessage(sessionId, toolUseId, toolName, toolArgs, result, true);

      // Assert
      const callArgs = mockExecuteQuery.mock.calls[0];
      const metadata = JSON.parse(callArgs[1].metadata);

      expect(metadata.tool_args).toEqual(toolArgs);
      expect(metadata.tool_args.records).toHaveLength(2);
    });

    it('should handle error without error message', async () => {
      // Arrange
      const sessionId = 'test-session-no-error-msg';
      const toolUseId = 'tool-use-no-error-uuid';
      const toolName = 'mcp__erptools__get_operation_details';
      const toolArgs = { entity: 'customer', operation: 'POST' };
      const result = null;

      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      // Act
      await updateToolResultMessage(sessionId, toolUseId, toolName, toolArgs, result, false);

      // Assert
      const callArgs = mockExecuteQuery.mock.calls[0];
      const metadata = JSON.parse(callArgs[1].metadata);

      expect(metadata.status).toBe('error');
      expect(metadata.error_message).toBeNull();
    });

    it('should handle database update failure', async () => {
      // Arrange
      const sessionId = 'test-session-update-fail';
      const toolUseId = 'tool-use-fail-uuid';
      const toolName = 'mcp__erptools__list_all_entities';
      const toolArgs = {};
      const result = { entities: [] };
      const dbError = new Error('UPDATE failed: connection timeout');

      mockExecuteQuery.mockRejectedValueOnce(dbError);

      // Act & Assert
      await expect(
        updateToolResultMessage(sessionId, toolUseId, toolName, toolArgs, result, true)
      ).rejects.toThrow('UPDATE failed: connection timeout');
    });
  });

  describe('edge cases', () => {
    it('should handle special characters in thinking content', async () => {
      // Arrange
      const sessionId = 'test-session-special-chars';
      const content = 'Thinking: "quotes", \'apostrophes\', <tags>, {json}, [arrays]';
      const mockUUID = 'thinking-special-uuid';

      mockRandomUUID.mockReturnValueOnce(mockUUID);
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      await saveThinkingMessage(sessionId, content);

      // Assert
      const callArgs = mockExecuteQuery.mock.calls[0];
      const metadata = JSON.parse(callArgs[1].metadata);
      expect(metadata.content).toBe(content);
    });

    it('should handle tool result with circular references gracefully', async () => {
      // Arrange
      const sessionId = 'test-session-circular';
      const toolUseId = 'tool-circular-uuid';
      const toolName = 'mcp__erptools__test_tool';
      const toolArgs = { test: 'value' };

      // Create object with circular reference
      const circularResult: { self?: unknown } = {};
      circularResult.self = circularResult;

      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      // Act & Assert
      // JSON.stringify will throw on circular structures
      await expect(
        updateToolResultMessage(sessionId, toolUseId, toolName, toolArgs, circularResult, true)
      ).rejects.toThrow();
    });
  });
});
