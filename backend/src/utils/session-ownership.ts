/**
 * Session Ownership Validation Utilities
 *
 * Provides multi-tenant safety by validating that users can only
 * access sessions they own. This module is designed to be used
 * across the entire application for consistent ownership validation.
 *
 * Security: These utilities prevent cross-tenant data access by ensuring
 * every operation on session-scoped resources validates ownership first.
 *
 * @module utils/session-ownership
 */

import { timingSafeEqual } from 'crypto';
import { executeQuery } from '@config/database';
import { createChildLogger } from '@/utils/logger';

const logger = createChildLogger({ module: 'session-ownership' });

/**
 * Session ownership validation result
 */
export interface SessionOwnershipResult {
  /** Whether the user owns the session */
  isOwner: boolean;
  /** Error code if validation failed */
  error?: 'SESSION_NOT_FOUND' | 'NOT_OWNER' | 'DATABASE_ERROR' | 'INVALID_INPUT';
  /** Session's actual owner ID (for debugging, not exposed to clients) */
  actualOwner?: string;
}

/**
 * Database row type for session ownership query
 */
interface SessionOwnerRow {
  user_id: string;
}

/**
 * Validate that a user owns a session
 *
 * This is the core multi-tenant validation function. Use this before
 * performing any operation on session-scoped resources.
 *
 * @param sessionId - Session ID to validate
 * @param userId - User ID claiming ownership
 * @returns Promise<SessionOwnershipResult> - Validation result
 *
 * @example
 * ```typescript
 * const result = await validateSessionOwnership(sessionId, req.userId);
 * if (!result.isOwner) {
 *   res.status(403).json({ error: 'Forbidden', message: 'Access denied' });
 *   return;
 * }
 * // Proceed with operation...
 * ```
 */
export async function validateSessionOwnership(
  sessionId: string,
  userId: string
): Promise<SessionOwnershipResult> {
  // Input validation
  if (!sessionId || !userId) {
    logger.warn('Invalid input for session ownership validation', {
      hasSessionId: !!sessionId,
      hasUserId: !!userId,
    });
    return {
      isOwner: false,
      error: 'INVALID_INPUT',
    };
  }

  try {
    const result = await executeQuery<SessionOwnerRow>(
      `SELECT user_id FROM sessions WHERE id = @sessionId`,
      { sessionId }
    );

    // Session not found
    if (!result.recordset || result.recordset.length === 0) {
      logger.debug('Session not found during ownership validation', { sessionId });
      return {
        isOwner: false,
        error: 'SESSION_NOT_FOUND',
      };
    }

    const sessionOwner = result.recordset[0];

    // Additional safety check (TypeScript noUncheckedIndexedAccess)
    if (!sessionOwner) {
      logger.debug('Session not found during ownership validation (empty row)', { sessionId });
      return {
        isOwner: false,
        error: 'SESSION_NOT_FOUND',
      };
    }

    // Validate ownership using timing-safe comparison
    if (!timingSafeCompare(sessionOwner.user_id, userId)) {
      logger.warn('Session ownership validation failed - user does not own session', {
        sessionId,
        requestingUserId: userId,
        // Don't log actual owner for security, but include for debugging if needed
        ownershipMismatch: true,
      });
      return {
        isOwner: false,
        error: 'NOT_OWNER',
        actualOwner: sessionOwner.user_id, // For internal debugging only
      };
    }

    logger.debug('Session ownership validated successfully', { sessionId, userId });
    return {
      isOwner: true,
    };
  } catch (error) {
    logger.error('Database error during session ownership validation', {
      error: error instanceof Error ? error.message : String(error),
      sessionId,
      userId,
    });
    return {
      isOwner: false,
      error: 'DATABASE_ERROR',
    };
  }
}

/**
 * Require session ownership or throw
 *
 * Convenience function that throws an error if ownership validation fails.
 * Use this in services where you want to fail fast on ownership issues.
 *
 * @param sessionId - Session ID to validate
 * @param userId - User ID claiming ownership
 * @throws Error if validation fails
 *
 * @example
 * ```typescript
 * // In a service method
 * await requireSessionOwnership(sessionId, userId);
 * // If we reach here, user owns the session
 * ```
 */
export async function requireSessionOwnership(
  sessionId: string,
  userId: string
): Promise<void> {
  const result = await validateSessionOwnership(sessionId, userId);

  if (!result.isOwner) {
    const message = result.error === 'SESSION_NOT_FOUND'
      ? `Session ${sessionId} not found`
      : result.error === 'NOT_OWNER'
        ? 'Unauthorized: Session does not belong to user'
        : result.error === 'INVALID_INPUT'
          ? 'Invalid session ID or user ID'
          : 'Failed to validate session ownership';

    throw new Error(message);
  }
}

/**
 * Express middleware factory for session ownership validation
 *
 * Creates middleware that validates ownership of a session specified
 * in request params before allowing the request to proceed.
 *
 * @param sessionIdParam - Name of the route parameter containing session ID (default: 'sessionId')
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * // In routes
 * router.get(
 *   '/sessions/:sessionId/data',
 *   authenticateMicrosoft,
 *   requireSessionOwnershipMiddleware('sessionId'),
 *   async (req, res) => {
 *     // User is verified owner of sessionId
 *   }
 * );
 * ```
 */
export function requireSessionOwnershipMiddleware(sessionIdParam: string = 'sessionId') {
  return async (
    req: { params: Record<string, string>; userId?: string },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void
  ): Promise<void> => {
    const sessionId = req.params[sessionIdParam];
    const userId = req.userId;

    if (!userId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'User not authenticated',
      });
      return;
    }

    if (!sessionId) {
      res.status(400).json({
        error: 'Bad Request',
        message: `Missing ${sessionIdParam} parameter`,
      });
      return;
    }

    const result = await validateSessionOwnership(sessionId, userId);

    if (!result.isOwner) {
      if (result.error === 'SESSION_NOT_FOUND') {
        res.status(404).json({
          error: 'Not Found',
          message: 'Session not found',
        });
        return;
      }

      // Log unauthorized access attempt for security audit
      logger.warn('Unauthorized session access attempt blocked', {
        sessionId,
        attemptedByUserId: userId,
        error: result.error,
      });

      res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have access to this session',
      });
      return;
    }

    next();
  };
}

/**
 * Validate user ID matches authenticated user
 *
 * Use this to ensure a requested userId matches the authenticated user.
 * Prevents users from accessing other users' data directly.
 *
 * Security: Uses timing-safe comparison to prevent timing attacks.
 * An attacker cannot infer the correct user ID by measuring response times.
 *
 * @param requestedUserId - User ID from request params
 * @param authenticatedUserId - User ID from session/token
 * @returns boolean - true if IDs match
 *
 * @example
 * ```typescript
 * if (!validateUserIdMatch(req.params.userId, req.userId)) {
 *   res.status(403).json({ error: 'Forbidden' });
 *   return;
 * }
 * ```
 */
export function validateUserIdMatch(
  requestedUserId: string,
  authenticatedUserId: string | undefined
): boolean {
  if (!authenticatedUserId || !requestedUserId) {
    return false;
  }
  return timingSafeCompare(requestedUserId, authenticatedUserId);
}

/**
 * Timing-safe string comparison
 *
 * Compares two strings in constant time to prevent timing attacks.
 * Uses crypto.timingSafeEqual under the hood with proper buffer handling.
 *
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns boolean - true if strings are equal
 *
 * @internal
 */
export function timingSafeCompare(a: string, b: string): boolean {
  // If lengths differ, we still need to do a constant-time comparison
  // to avoid leaking length information
  const aBuffer = Buffer.from(a, 'utf8');
  const bBuffer = Buffer.from(b, 'utf8');

  // For different lengths, pad the shorter one to match
  // This ensures constant-time comparison regardless of length
  if (aBuffer.length !== bBuffer.length) {
    // Create buffers of equal length for comparison
    const maxLength = Math.max(aBuffer.length, bBuffer.length);
    const paddedA = Buffer.alloc(maxLength, 0);
    const paddedB = Buffer.alloc(maxLength, 0);
    aBuffer.copy(paddedA);
    bBuffer.copy(paddedB);

    // Compare padded buffers (will always be false due to different content)
    // but we do it to avoid timing leaks
    timingSafeEqual(paddedA, paddedB);
    return false;
  }

  return timingSafeEqual(aBuffer, bBuffer);
}
