/**
 * Permission Helpers
 *
 * Reusable permission check functions for different agent types.
 * Eliminates code duplication across agent factories.
 */

import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { ApprovalManager } from '../../approval/ApprovalManager';

/**
 * Create a read-only permission check
 *
 * Only allows tools that start with read-related prefixes.
 *
 * @returns Permission check function
 */
export function createReadOnlyPermissionCheck(): (
  toolName: string,
  input: Record<string, unknown>
) => Promise<PermissionResult> {
  return async (
    toolName: string,
    input: Record<string, unknown>
  ): Promise<PermissionResult> => {
    const readPrefixes = ['bc_get', 'bc_query', 'bc_list', 'bc_search', 'bc_read'];

    const isAllowed = readPrefixes.some((prefix) => toolName.startsWith(prefix));

    if (!isAllowed) {
      return {
        behavior: 'deny',
        message: `This agent can only perform read operations. Tool '${toolName}' is not allowed.`,
        interrupt: true,
      };
    }

    return {
      behavior: 'allow',
      updatedInput: input,
    };
  };
}

/**
 * Create a write permission check with approval
 *
 * Allows read operations without approval, but requires approval for write operations.
 *
 * @param approvalManager - Approval manager instance
 * @param sessionId - Session ID for approval tracking
 * @returns Permission check function
 */
export function createWritePermissionCheck(
  approvalManager: ApprovalManager,
  sessionId: string
): (toolName: string, input: Record<string, unknown>) => Promise<PermissionResult> {
  return async (
    toolName: string,
    input: Record<string, unknown>
  ): Promise<PermissionResult> => {
    const writePrefixes = ['bc_create', 'bc_update', 'bc_delete', 'bc_patch'];

    const isWriteOperation = writePrefixes.some((prefix) => toolName.startsWith(prefix));

    // If it's a write operation, request approval
    if (isWriteOperation) {
      try {
        const approved = await approvalManager.request({
          sessionId,
          toolName,
          toolArgs: input,
        });

        if (!approved) {
          return {
            behavior: 'deny',
            message: `Write operation '${toolName}' was rejected by user`,
            interrupt: true,
          };
        }

        return {
          behavior: 'allow',
          updatedInput: input,
        };
      } catch (error) {
        return {
          behavior: 'deny',
          message: `Approval request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          interrupt: true,
        };
      }
    }

    // Read operations are allowed without approval
    return {
      behavior: 'allow',
      updatedInput: input,
    };
  };
}

/**
 * Check if a tool is a write operation
 *
 * @param toolName - Tool name to check
 * @returns True if tool is a write operation
 */
export function isWriteOperation(toolName: string): boolean {
  const writePrefixes = ['bc_create', 'bc_update', 'bc_delete', 'bc_patch'];
  return writePrefixes.some((prefix) => toolName.startsWith(prefix));
}

/**
 * Check if a tool is a read operation
 *
 * @param toolName - Tool name to check
 * @returns True if tool is a read operation
 */
export function isReadOperation(toolName: string): boolean {
  const readPrefixes = ['bc_get', 'bc_query', 'bc_list', 'bc_search', 'bc_read'];
  return readPrefixes.some((prefix) => toolName.startsWith(prefix));
}
