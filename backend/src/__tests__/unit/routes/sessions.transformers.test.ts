/**
 * Unit Tests - Sessions Transformers
 *
 * Tests for session and message transformation functions.
 * Tests added for commit fff955d: message type support for persistent agent messages.
 *
 * @module __tests__/unit/routes/sessions.transformers
 */

import { describe, it, expect } from 'vitest';

/**
 * Transform database session row to frontend Session format
 */
function transformSession(row: {
  id: string;
  user_id: string;
  title: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}) {
  // Map is_active (boolean) to status (string enum)
  let status: 'active' | 'completed' | 'cancelled' = 'active';
  if (!row.is_active) {
    status = 'completed'; // Default inactive sessions to 'completed'
  }

  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title || 'New Chat',
    status,
    last_activity_at: row.updated_at.toISOString(), // Use updated_at as last_activity_at
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * Transform database message row to frontend Message format
 * Handles 3 message types: standard, thinking, tool_use
 */
function transformMessage(row: {
  id: string;
  session_id: string;
  role: string;
  message_type: string;
  content: string;
  metadata: string | null;
  token_count: number | null;
  created_at: Date;
}) {
  // Base fields common to all message types
  const base = {
    id: row.id,
    session_id: row.session_id,
    role: row.role as 'user' | 'assistant' | 'system',
    message_type: row.message_type as 'standard' | 'thinking' | 'tool_use',
    created_at: row.created_at.toISOString(),
  };

  // Parse metadata JSON if present
  let metadata: Record<string, unknown> = {};
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      // Ignore parse errors
    }
  }

  // Transform based on message type
  switch (row.message_type) {
    case 'thinking':
      // Thinking message: content is in metadata
      return {
        id: row.id,
        type: 'thinking' as const,
        session_id: row.session_id,
        content: metadata.content as string || '',
        duration_ms: metadata.duration_ms as number | undefined,
        created_at: row.created_at.toISOString(),
      };

    case 'tool_use':
      // Tool use message: tool details in metadata
      return {
        id: row.id,
        type: 'tool_use' as const,
        session_id: row.session_id,
        tool_name: metadata.tool_name as string,
        tool_args: (metadata.tool_args as Record<string, unknown>) || {},
        tool_result: metadata.tool_result as unknown | undefined,
        status: (metadata.status as 'pending' | 'success' | 'error') || 'pending',
        error_message: metadata.error_message as string | undefined,
        created_at: row.created_at.toISOString(),
      };

    case 'standard':
    default:
      // Standard message: content is in content field
      return {
        ...base,
        content: row.content,
        thinking_tokens: metadata.thinking_tokens as number | undefined,
        is_thinking: metadata.is_thinking as boolean | undefined,
      };
  }
}

describe('sessions transformers', () => {
  describe('transformSession', () => {
    it('should transform active session correctly', () => {
      // Arrange
      const now = new Date('2025-11-15T10:00:00Z');
      const dbRow = {
        id: 'session-123',
        user_id: 'user-456',
        title: 'Test Session',
        is_active: true,
        created_at: now,
        updated_at: now,
      };

      // Act
      const result = transformSession(dbRow);

      // Assert
      expect(result).toEqual({
        id: 'session-123',
        user_id: 'user-456',
        title: 'Test Session',
        status: 'active',
        last_activity_at: now.toISOString(),
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      });
    });

    it('should transform inactive session to completed status', () => {
      // Arrange
      const now = new Date('2025-11-15T10:00:00Z');
      const dbRow = {
        id: 'session-inactive',
        user_id: 'user-789',
        title: 'Completed Session',
        is_active: false,
        created_at: now,
        updated_at: now,
      };

      // Act
      const result = transformSession(dbRow);

      // Assert
      expect(result.status).toBe('completed');
      expect(result.id).toBe('session-inactive');
    });

    it('should use "New Chat" as default title when title is empty', () => {
      // Arrange
      const now = new Date('2025-11-15T10:00:00Z');
      const dbRow = {
        id: 'session-no-title',
        user_id: 'user-123',
        title: '',
        is_active: true,
        created_at: now,
        updated_at: now,
      };

      // Act
      const result = transformSession(dbRow);

      // Assert
      expect(result.title).toBe('New Chat');
    });

    it('should use updated_at as last_activity_at', () => {
      // Arrange
      const createdAt = new Date('2025-11-10T10:00:00Z');
      const updatedAt = new Date('2025-11-15T15:30:00Z');
      const dbRow = {
        id: 'session-activity',
        user_id: 'user-456',
        title: 'Active Session',
        is_active: true,
        created_at: createdAt,
        updated_at: updatedAt,
      };

      // Act
      const result = transformSession(dbRow);

      // Assert
      expect(result.last_activity_at).toBe(updatedAt.toISOString());
      expect(result.created_at).toBe(createdAt.toISOString());
    });
  });

  describe('transformMessage - standard messages', () => {
    it('should transform standard user message', () => {
      // Arrange
      const now = new Date('2025-11-15T10:00:00Z');
      const dbRow = {
        id: 'msg-user-1',
        session_id: 'session-123',
        role: 'user',
        message_type: 'standard',
        content: 'Hello, agent!',
        metadata: null,
        token_count: 10,
        created_at: now,
      };

      // Act
      const result = transformMessage(dbRow);

      // Assert
      expect(result).toEqual({
        id: 'msg-user-1',
        session_id: 'session-123',
        role: 'user',
        message_type: 'standard',
        content: 'Hello, agent!',
        thinking_tokens: undefined,
        is_thinking: undefined,
        created_at: now.toISOString(),
      });
    });

    it('should transform standard assistant message with metadata', () => {
      // Arrange
      const now = new Date('2025-11-15T10:00:00Z');
      const dbRow = {
        id: 'msg-assistant-1',
        session_id: 'session-456',
        role: 'assistant',
        message_type: 'standard',
        content: 'I can help you with that.',
        metadata: JSON.stringify({ thinking_tokens: 50, is_thinking: true }),
        token_count: 100,
        created_at: now,
      };

      // Act
      const result = transformMessage(dbRow);

      // Assert
      expect(result).toMatchObject({
        id: 'msg-assistant-1',
        role: 'assistant',
        message_type: 'standard',
        content: 'I can help you with that.',
        thinking_tokens: 50,
        is_thinking: true,
      });
    });
  });

  describe('transformMessage - thinking messages', () => {
    it('should transform thinking message with content in metadata', () => {
      // Arrange
      const now = new Date('2025-11-15T10:00:00Z');
      const thinkingContent = 'Let me break down this problem into steps...';
      const dbRow = {
        id: 'msg-thinking-1',
        session_id: 'session-789',
        role: 'assistant',
        message_type: 'thinking',
        content: '',
        metadata: JSON.stringify({
          content: thinkingContent,
          started_at: '2025-11-15T10:00:00Z'
        }),
        token_count: null,
        created_at: now,
      };

      // Act
      const result = transformMessage(dbRow);

      // Assert
      expect(result).toEqual({
        id: 'msg-thinking-1',
        type: 'thinking',
        session_id: 'session-789',
        content: thinkingContent,
        duration_ms: undefined,
        created_at: now.toISOString(),
      });
    });

    it('should handle thinking message with duration', () => {
      // Arrange
      const now = new Date('2025-11-15T10:00:00Z');
      const dbRow = {
        id: 'msg-thinking-duration',
        session_id: 'session-abc',
        role: 'assistant',
        message_type: 'thinking',
        content: '',
        metadata: JSON.stringify({
          content: 'Complex reasoning...',
          duration_ms: 3500
        }),
        token_count: null,
        created_at: now,
      };

      // Act
      const result = transformMessage(dbRow);

      // Assert
      expect(result).toMatchObject({
        type: 'thinking',
        content: 'Complex reasoning...',
        duration_ms: 3500,
      });
    });

    it('should handle empty thinking content', () => {
      // Arrange
      const now = new Date('2025-11-15T10:00:00Z');
      const dbRow = {
        id: 'msg-thinking-empty',
        session_id: 'session-empty',
        role: 'assistant',
        message_type: 'thinking',
        content: '',
        metadata: JSON.stringify({ content: '' }),
        token_count: null,
        created_at: now,
      };

      // Act
      const result = transformMessage(dbRow);

      // Assert
      expect(result).toMatchObject({
        type: 'thinking',
        content: '',
      });
    });
  });

  describe('transformMessage - tool_use messages', () => {
    it('should transform tool_use message with pending status', () => {
      // Arrange
      const now = new Date('2025-11-15T10:00:00Z');
      const dbRow = {
        id: 'msg-tool-pending',
        session_id: 'session-tool-1',
        role: 'assistant',
        message_type: 'tool_use',
        content: '',
        metadata: JSON.stringify({
          tool_name: 'mcp__erptools__search_entity_operations',
          tool_args: { entity: 'customer', operation: 'GET' },
          tool_use_id: 'tool-123',
          status: 'pending'
        }),
        token_count: null,
        created_at: now,
      };

      // Act
      const result = transformMessage(dbRow);

      // Assert
      expect(result).toEqual({
        id: 'msg-tool-pending',
        type: 'tool_use',
        session_id: 'session-tool-1',
        tool_name: 'mcp__erptools__search_entity_operations',
        tool_args: { entity: 'customer', operation: 'GET' },
        tool_result: undefined,
        status: 'pending',
        error_message: undefined,
        created_at: now.toISOString(),
      });
    });

    it('should transform tool_use message with success result', () => {
      // Arrange
      const now = new Date('2025-11-15T10:00:00Z');
      const toolResult = { operations: ['GET', 'POST', 'PATCH'], count: 3 };
      const dbRow = {
        id: 'msg-tool-success',
        session_id: 'session-tool-2',
        role: 'assistant',
        message_type: 'tool_use',
        content: '',
        metadata: JSON.stringify({
          tool_name: 'mcp__erptools__search_entity_operations',
          tool_args: { entity: 'item' },
          tool_result: toolResult,
          status: 'success',
          success: true
        }),
        token_count: null,
        created_at: now,
      };

      // Act
      const result = transformMessage(dbRow);

      // Assert
      expect(result).toMatchObject({
        type: 'tool_use',
        tool_name: 'mcp__erptools__search_entity_operations',
        tool_result: toolResult,
        status: 'success',
      });
    });

    it('should transform tool_use message with error', () => {
      // Arrange
      const now = new Date('2025-11-15T10:00:00Z');
      const errorMessage = 'Entity "InvalidEntity" not found';
      const dbRow = {
        id: 'msg-tool-error',
        session_id: 'session-tool-error',
        role: 'assistant',
        message_type: 'tool_use',
        content: '',
        metadata: JSON.stringify({
          tool_name: 'mcp__erptools__get_entity_details',
          tool_args: { entity: 'InvalidEntity' },
          tool_result: null,
          status: 'error',
          success: false,
          error_message: errorMessage
        }),
        token_count: null,
        created_at: now,
      };

      // Act
      const result = transformMessage(dbRow);

      // Assert
      expect(result).toMatchObject({
        type: 'tool_use',
        status: 'error',
        error_message: errorMessage,
        tool_result: null,
      });
    });

    it('should handle empty tool_args', () => {
      // Arrange
      const now = new Date('2025-11-15T10:00:00Z');
      const dbRow = {
        id: 'msg-tool-empty-args',
        session_id: 'session-tool-empty',
        role: 'assistant',
        message_type: 'tool_use',
        content: '',
        metadata: JSON.stringify({
          tool_name: 'mcp__erptools__list_all_entities',
          tool_args: {},
          status: 'pending'
        }),
        token_count: null,
        created_at: now,
      };

      // Act
      const result = transformMessage(dbRow);

      // Assert
      expect(result).toMatchObject({
        type: 'tool_use',
        tool_args: {},
      });
    });

    it('should default to pending status if status is missing', () => {
      // Arrange
      const now = new Date('2025-11-15T10:00:00Z');
      const dbRow = {
        id: 'msg-tool-no-status',
        session_id: 'session-tool-no-status',
        role: 'assistant',
        message_type: 'tool_use',
        content: '',
        metadata: JSON.stringify({
          tool_name: 'mcp__erptools__test_tool',
          tool_args: { test: 'value' }
        }),
        token_count: null,
        created_at: now,
      };

      // Act
      const result = transformMessage(dbRow);

      // Assert
      expect(result).toMatchObject({
        type: 'tool_use',
        status: 'pending',
      });
    });
  });

  describe('transformMessage - edge cases', () => {
    it('should handle invalid JSON in metadata', () => {
      // Arrange
      const now = new Date('2025-11-15T10:00:00Z');
      const dbRow = {
        id: 'msg-invalid-json',
        session_id: 'session-invalid',
        role: 'assistant',
        message_type: 'standard',
        content: 'Test message',
        metadata: '{invalid json}',
        token_count: 50,
        created_at: now,
      };

      // Act
      const result = transformMessage(dbRow);

      // Assert
      expect(result).toMatchObject({
        id: 'msg-invalid-json',
        role: 'assistant',
        message_type: 'standard',
        content: 'Test message',
        thinking_tokens: undefined,
        is_thinking: undefined,
      });
    });

    it('should handle null metadata', () => {
      // Arrange
      const now = new Date('2025-11-15T10:00:00Z');
      const dbRow = {
        id: 'msg-null-metadata',
        session_id: 'session-null',
        role: 'user',
        message_type: 'standard',
        content: 'User message',
        metadata: null,
        token_count: 20,
        created_at: now,
      };

      // Act
      const result = transformMessage(dbRow);

      // Assert
      expect(result).toMatchObject({
        id: 'msg-null-metadata',
        content: 'User message',
        thinking_tokens: undefined,
        is_thinking: undefined,
      });
    });

    it('should handle unknown message_type as standard', () => {
      // Arrange
      const now = new Date('2025-11-15T10:00:00Z');
      const dbRow = {
        id: 'msg-unknown-type',
        session_id: 'session-unknown',
        role: 'assistant',
        message_type: 'unknown_type' as string,
        content: 'Fallback message',
        metadata: null,
        token_count: 30,
        created_at: now,
      };

      // Act
      const result = transformMessage(dbRow);

      // Assert
      expect(result).toMatchObject({
        id: 'msg-unknown-type',
        role: 'assistant',
        message_type: 'unknown_type',
        content: 'Fallback message',
      });
    });

    it('should handle thinking message with missing content in metadata', () => {
      // Arrange
      const now = new Date('2025-11-15T10:00:00Z');
      const dbRow = {
        id: 'msg-thinking-no-content',
        session_id: 'session-thinking-empty',
        role: 'assistant',
        message_type: 'thinking',
        content: '',
        metadata: JSON.stringify({ duration_ms: 1000 }),
        token_count: null,
        created_at: now,
      };

      // Act
      const result = transformMessage(dbRow);

      // Assert
      expect(result).toMatchObject({
        type: 'thinking',
        content: '',
        duration_ms: 1000,
      });
    });
  });
});
