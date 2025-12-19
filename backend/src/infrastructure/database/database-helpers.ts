/**
 * Database Helper Utilities
 *
 * Provides helper functions to simplify SQL parameter binding,
 * especially for UUID parameters which require explicit type specification.
 *
 * These utilities eliminate repetitive boilerplate and provide:
 * - Automatic UUID validation before binding
 * - Case normalization (SQL Server returns uppercase, JS generates lowercase)
 * - Null/undefined handling
 * - Type-safe parameter binding
 *
 * @example
 * // Before (verbose):
 * request
 *   .input('userId', sql.UniqueIdentifier, userId)
 *   .input('sessionId', sql.UniqueIdentifier, sessionId);
 *
 * // After (concise):
 * request
 *   .input(...uuidInput('userId', userId))
 *   .input(...uuidInput('sessionId', sessionId));
 *
 * // Or even more concise:
 * applyUuidInputs(request, { userId, sessionId });
 *
 * @module config/database-helpers
 */

import sql from 'mssql';
import { isValidUUID, normalizeUUID } from '@/shared/utils/uuid';

/**
 * Type definition for SQL parameter tuple
 * Represents the three arguments needed for request.input()
 */
export type SqlParameterTuple = [string, sql.ISqlTypeFactoryWithNoParams | sql.ISqlType, string | null];

/**
 * Helper to add a UUID input parameter to a SQL request.
 *
 * This function:
 * 1. Validates the UUID format (throws on invalid UUID)
 * 2. Normalizes to lowercase for consistency
 * 3. Handles null/undefined gracefully
 * 4. Returns a tuple that can be spread into request.input()
 *
 * @param name - Parameter name (without @ prefix)
 * @param value - UUID string, or null/undefined for NULL in SQL
 * @returns Tuple of [name, sql.UniqueIdentifier, normalizedValue] for spreading
 * @throws Error if value is provided but not a valid UUID format
 *
 * @example
 * ```typescript
 * // Single parameter
 * request.input(...uuidInput('userId', userId));
 *
 * // Multiple parameters
 * request
 *   .input(...uuidInput('userId', userId))
 *   .input(...uuidInput('sessionId', sessionId))
 *   .input(...uuidInput('approvalId', approvalId));
 *
 * // Handles null/undefined
 * request.input(...uuidInput('optionalId', null)); // Binds as SQL NULL
 * ```
 */
export function uuidInput(
  name: string,
  value: string | null | undefined
): SqlParameterTuple {
  // Handle null/undefined - pass through as SQL NULL
  if (!value) {
    return [name, sql.UniqueIdentifier, null];
  }

  // Validate UUID format
  if (!isValidUUID(value)) {
    throw new Error(`Invalid UUID for parameter '${name}': ${value}`);
  }

  // Normalize to lowercase and return
  return [name, sql.UniqueIdentifier, normalizeUUID(value)];
}

/**
 * Helper to add multiple UUID inputs at once.
 *
 * Converts a record of name-value pairs into an array of parameter tuples.
 * Each tuple can be spread into request.input().
 *
 * @param params - Record of parameter names to UUID values
 * @returns Array of tuples, one per parameter
 * @throws Error if any value is provided but not a valid UUID format
 *
 * @example
 * ```typescript
 * // Manual application
 * const params = multiUuidInput({ userId, sessionId, approvalId });
 * params.forEach(([name, type, value]) => request.input(name, type, value));
 *
 * // With destructuring
 * const [userParam, sessionParam] = multiUuidInput({ userId, sessionId });
 * request
 *   .input(...userParam)
 *   .input(...sessionParam);
 * ```
 */
export function multiUuidInput(
  params: Record<string, string | null | undefined>
): SqlParameterTuple[] {
  return Object.entries(params).map(([name, value]) => uuidInput(name, value));
}

/**
 * Apply UUID inputs to a SQL request (fluent interface).
 *
 * This is the most concise way to bind multiple UUID parameters.
 * It applies all parameters to the request and returns the request for chaining.
 *
 * @param request - The mssql.Request instance to bind parameters to
 * @param params - Record of parameter names to UUID values
 * @returns The same request instance for chaining
 * @throws Error if any value is provided but not a valid UUID format
 *
 * @example
 * ```typescript
 * // Concise binding with chaining
 * const result = await applyUuidInputs(request, { userId, sessionId, approvalId })
 *   .query('SELECT * FROM sessions WHERE user_id = @userId AND id = @sessionId');
 *
 * // Mix with other parameter types
 * const result = await applyUuidInputs(request, { userId, sessionId })
 *   .input('limit', sql.Int, 50)
 *   .input('offset', sql.Int, 0)
 *   .query('SELECT * FROM messages WHERE session_id = @sessionId OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY');
 * ```
 */
export function applyUuidInputs(
  request: sql.Request,
  params: Record<string, string | null | undefined>
): sql.Request {
  multiUuidInput(params).forEach(([name, type, value]) => {
    request.input(name, type, value);
  });
  return request;
}

/**
 * Type guard to check if a value is a valid UUID string.
 *
 * This is useful for TypeScript type narrowing in validation logic.
 *
 * @param value - The value to check
 * @returns true if value is a string with valid UUID format
 *
 * @example
 * ```typescript
 * function processId(id: string | undefined) {
 *   if (!isValidUuidString(id)) {
 *     throw new Error('Invalid ID');
 *   }
 *   // TypeScript knows id is a string here
 *   request.input(...uuidInput('id', id));
 * }
 * ```
 */
export function isValidUuidString(value: unknown): value is string {
  return typeof value === 'string' && isValidUUID(value);
}

/**
 * Extract UUID from a request parameter or throw a descriptive error.
 *
 * This is useful for route handlers that need to validate and extract UUIDs
 * from route params or query strings.
 *
 * @param value - The value to extract UUID from (typically req.params.id)
 * @param paramName - Name of the parameter for error messages
 * @returns The validated and normalized UUID string
 * @throws Error with descriptive message if value is missing or invalid
 *
 * @example
 * ```typescript
 * // In an Express route handler
 * router.get('/sessions/:sessionId/messages', async (req, res) => {
 *   try {
 *     const sessionId = extractUuid(req.params.sessionId, 'sessionId');
 *     // sessionId is guaranteed to be a valid, normalized UUID
 *     const result = await applyUuidInputs(request, { sessionId })
 *       .query('SELECT * FROM messages WHERE session_id = @sessionId');
 *   } catch (error) {
 *     res.status(400).json({ error: error.message });
 *   }
 * });
 * ```
 */
export function extractUuid(
  value: unknown,
  paramName: string
): string {
  // Check if value exists
  if (!value || typeof value !== 'string') {
    throw new Error(`Missing or invalid ${paramName}: expected UUID string`);
  }

  // Validate UUID format
  if (!isValidUUID(value)) {
    throw new Error(`Invalid UUID format for ${paramName}: ${value}`);
  }

  // Return normalized UUID
  return normalizeUUID(value);
}

/**
 * Create a SQL parameter object for use with executeQuery helper.
 *
 * This is an alternative to the tuple-based helpers above, useful when you
 * prefer object notation for parameters.
 *
 * @param params - Record of parameter names to UUID values
 * @returns Record ready to pass to executeQuery
 * @throws Error if any value is provided but not a valid UUID format
 *
 * @example
 * ```typescript
 * // With executeQuery helper
 * const result = await executeQuery<Session>(
 *   'SELECT * FROM sessions WHERE id = @sessionId AND user_id = @userId',
 *   createUuidParams({ sessionId, userId })
 * );
 * ```
 */
export function createUuidParams(
  params: Record<string, string | null | undefined>
): Record<string, string | null> {
  const result: Record<string, string | null> = {};

  for (const [name, value] of Object.entries(params)) {
    if (!value) {
      result[name] = null;
    } else if (!isValidUUID(value)) {
      throw new Error(`Invalid UUID for parameter '${name}': ${value}`);
    } else {
      result[name] = normalizeUUID(value);
    }
  }

  return result;
}
