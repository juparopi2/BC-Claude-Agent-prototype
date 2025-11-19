/**
 * Message Helpers - Persistence for thinking and tool use messages
 *
 * These functions persist agent thinking blocks and tool use events to the database
 * for complete audit trail and recovery after page reloads.
 *
 * @module utils/messageHelpers
 */

import { executeQuery } from '../config/database';
import { randomUUID } from 'crypto';

/**
 * Save thinking message to database
 *
 * @param sessionId - Session ID
 * @param content - Thinking content
 * @returns Message ID
 */
export async function saveThinkingMessage(
  sessionId: string,
  content: string
): Promise<string> {
  const id = randomUUID();

  await executeQuery(`
    INSERT INTO messages (id, session_id, role, message_type, content, metadata, created_at)
    VALUES (@id, @sessionId, 'assistant', 'thinking', '', @metadata, GETUTCDATE())
  `, {
    id,
    sessionId,
    metadata: JSON.stringify({
      content: content || '',
      started_at: new Date().toISOString()
    })
  });

  return id;
}

/**
 * Save tool use message to database
 *
 * @param sessionId - Session ID
 * @param toolName - Tool name (e.g., "mcp__erptools__search_entity_operations")
 * @param toolArgs - Tool arguments
 * @returns Tool use ID (for later updating with result)
 */
export async function saveToolUseMessage(
  sessionId: string,
  toolName: string,
  toolArgs: Record<string, unknown>
): Promise<string> {
  const toolUseId = randomUUID();  // Use proper GUID for SQL Server UNIQUEIDENTIFIER column

  await executeQuery(`
    INSERT INTO messages (id, session_id, role, message_type, content, metadata, created_at)
    VALUES (@id, @sessionId, 'assistant', 'tool_use', '', @metadata, GETUTCDATE())
  `, {
    id: toolUseId,
    sessionId,
    metadata: JSON.stringify({
      tool_name: toolName,
      tool_args: toolArgs,
      tool_use_id: toolUseId,
      status: 'pending'
    })
  });

  return toolUseId;
}

/**
 * Update tool use message with result
 *
 * @param sessionId - Session ID
 * @param toolUseId - Tool use ID
 * @param toolName - Tool name
 * @param toolArgs - Tool arguments (preserved from original call)
 * @param result - Tool result
 * @param success - Whether the tool executed successfully
 * @param error - Error message (if failed)
 */
export async function updateToolResultMessage(
  sessionId: string,
  toolUseId: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  result: unknown,
  success: boolean,
  error?: string
): Promise<void> {
  const updateResult = await executeQuery(`
    UPDATE messages
    SET metadata = @metadata
    WHERE id = @toolUseId AND session_id = @sessionId
  `, {
    sessionId,
    toolUseId,
    metadata: JSON.stringify({
      tool_name: toolName,
      tool_args: toolArgs, // Preserve original args
      tool_result: result,
      tool_use_id: toolUseId,
      status: success ? 'success' : 'error',
      success: success,
      error_message: error || null
    })
  });

  // Check how many rows were affected - log error only if update fails
  const rowsAffected = updateResult.rowsAffected?.[0] || 0;
  if (rowsAffected === 0) {
    console.error(`[messageHelpers] Tool message update failed: id '${toolUseId}' not found in database`);
  }
}
