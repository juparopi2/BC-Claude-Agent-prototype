/**
 * @module domains/agent/tools/normalizeToolArgs
 *
 * Centralized helper to normalize tool arguments.
 * Handles the case where tool args arrive as JSON strings instead of objects.
 *
 * This is the single point of truth for tool args normalization,
 * agnostic to agent and provider implementations.
 */

import { createChildLogger } from '@/shared/utils/logger';

const logger = createChildLogger({ service: 'normalizeToolArgs' });

/**
 * Normalize tool arguments to ensure they are always a Record<string, unknown>.
 *
 * Handles cases where LangChain/providers may return args as a JSON string
 * instead of an object (double-serialization bug).
 *
 * @param args - Tool arguments (may be object or JSON string)
 * @param toolName - Tool name for logging context
 * @returns Normalized Record<string, unknown>
 */
export function normalizeToolArgs(
  args: unknown,
  toolName?: string
): Record<string, unknown> {
  // Already a valid object - return as-is
  if (args !== null && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }

  // String that looks like JSON object - try to parse
  if (typeof args === 'string') {
    const trimmed = args.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          logger.debug(
            { toolName, originalType: 'string' },
            'Normalized tool args from JSON string to object'
          );
          return parsed as Record<string, unknown>;
        }
      } catch (error) {
        logger.warn(
          { toolName, argsPreview: trimmed.substring(0, 100), error },
          'Failed to parse tool args JSON string'
        );
      }
    }
  }

  // Null, undefined, or invalid - return empty object
  if (args !== undefined && args !== null) {
    logger.warn(
      { toolName, argsType: typeof args },
      'Tool args had unexpected type, returning empty object'
    );
  }

  return {};
}
