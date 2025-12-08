/**
 * Usage Examples for Database Helper Utilities
 *
 * This file demonstrates how to use the UUID helper functions
 * in various SQL query scenarios.
 *
 * @module config/database-helpers.example
 */

import sql from 'mssql';
import { getPool } from './database';
import {
  uuidInput,
  multiUuidInput,
  applyUuidInputs,
  extractUuid,
  createUuidParams,
} from './database-helpers';

/**
 * EXAMPLE 1: Before/After Comparison
 * Shows the improvement in code conciseness
 */

// ❌ BEFORE: Verbose repetitive code
async function getUserSessionsBefore(userId: string) {
  const pool = await getPool();
  const request = pool.request();

  request.input('userId', sql.UniqueIdentifier, userId);

  return await request.query('SELECT * FROM sessions WHERE user_id = @userId');
}

// ✅ AFTER: Concise with helper
async function getUserSessionsAfter(userId: string) {
  const pool = await getPool();
  const request = pool.request();

  request.input(...uuidInput('userId', userId));

  return await request.query('SELECT * FROM sessions WHERE user_id = @userId');
}

/**
 * EXAMPLE 2: Multiple UUID Parameters
 * Common pattern: queries with multiple UUID filters
 */

// ❌ BEFORE: Very verbose
async function getSessionMessagesBefore(userId: string, sessionId: string, limit: number) {
  const pool = await getPool();
  const request = pool.request();

  request.input('userId', sql.UniqueIdentifier, userId);
  request.input('sessionId', sql.UniqueIdentifier, sessionId);
  request.input('limit', sql.Int, limit);

  return await request.query(`
    SELECT m.* FROM messages m
    JOIN sessions s ON m.session_id = s.id
    WHERE s.user_id = @userId AND m.session_id = @sessionId
    ORDER BY m.created_at DESC
    OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY
  `);
}

// ✅ AFTER: Much cleaner with applyUuidInputs
async function getSessionMessagesAfter(userId: string, sessionId: string, limit: number) {
  const pool = await getPool();
  const request = pool.request();

  applyUuidInputs(request, { userId, sessionId })
    .input('limit', sql.Int, limit);

  return await request.query(`
    SELECT m.* FROM messages m
    JOIN sessions s ON m.session_id = s.id
    WHERE s.user_id = @userId AND m.session_id = @sessionId
    ORDER BY m.created_at DESC
    OFFSET 0 ROWS FETCH NEXT @limit ROWS ONLY
  `);
}

/**
 * EXAMPLE 3: Optional Parameters
 * Handling null/undefined values gracefully
 */

async function searchApprovals(
  userId: string,
  sessionId?: string,
  approvalId?: string
) {
  const pool = await getPool();
  const request = pool.request();

  // applyUuidInputs handles null/undefined automatically
  applyUuidInputs(request, { userId, sessionId, approvalId });

  // Build dynamic WHERE clause
  let whereClause = 'user_id = @userId';
  if (sessionId) whereClause += ' AND session_id = @sessionId';
  if (approvalId) whereClause += ' AND id = @approvalId';

  return await request.query(`SELECT * FROM approvals WHERE ${whereClause}`);
}

/**
 * EXAMPLE 4: Express Route Handler
 * Extracting and validating UUIDs from request params
 */

import { Request, Response } from 'express';

async function getSessionMessagesRoute(req: Request, res: Response) {
  try {
    // Extract and validate UUIDs from route params
    const sessionId = extractUuid(req.params.sessionId, 'sessionId');
    const userId = req.userId; // Assume from auth middleware

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const pool = await getPool();
    const request = pool.request();

    // Apply UUID inputs
    const result = await applyUuidInputs(request, { userId, sessionId })
      .query(`
        SELECT m.* FROM messages m
        JOIN sessions s ON m.session_id = s.id
        WHERE s.user_id = @userId AND m.session_id = @sessionId
        ORDER BY m.sequence_number ASC
      `);

    res.json({ messages: result.recordset });
  } catch (error) {
    // extractUuid throws descriptive errors for invalid UUIDs
    if (error instanceof Error && error.message.includes('Invalid UUID')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * EXAMPLE 5: Transaction with Multiple Queries
 * Using helpers in complex multi-step operations
 */

async function createSessionWithFirstMessage(
  userId: string,
  title: string,
  message: string
) {
  const pool = await getPool();
  const transaction = pool.transaction();

  try {
    await transaction.begin();

    // Generate IDs
    const sessionId = crypto.randomUUID();
    const messageId = crypto.randomUUID();

    // Insert session
    const sessionRequest = transaction.request();
    applyUuidInputs(sessionRequest, { sessionId, userId })
      .input('title', sql.NVarChar, title);

    await sessionRequest.query(`
      INSERT INTO sessions (id, user_id, title, is_active, created_at, updated_at)
      VALUES (@sessionId, @userId, @title, 1, GETUTCDATE(), GETUTCDATE())
    `);

    // Insert message
    const messageRequest = transaction.request();
    applyUuidInputs(messageRequest, { messageId, sessionId })
      .input('role', sql.NVarChar, 'user')
      .input('content', sql.NVarChar, message);

    await messageRequest.query(`
      INSERT INTO messages (id, session_id, role, message_type, content, created_at)
      VALUES (@messageId, @sessionId, @role, 'standard', @content, GETUTCDATE())
    `);

    await transaction.commit();
    return { sessionId, messageId };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

/**
 * EXAMPLE 6: Using createUuidParams for Prepared Statements
 * Alternative approach when you prefer object notation
 */

async function getUserByIdAlternative(userId: string) {
  const pool = await getPool();

  // createUuidParams validates and normalizes UUIDs
  const params = createUuidParams({ userId });

  // Use with executeQuery helper (if you have one)
  // const result = await executeQuery('SELECT * FROM users WHERE id = @userId', params);

  // Or manually:
  const request = pool.request();
  request.input('userId', sql.UniqueIdentifier, params.userId);
  return await request.query('SELECT * FROM users WHERE id = @userId');
}

/**
 * EXAMPLE 7: Type-Safe Parameter Validation
 * Using isValidUuidString for type narrowing
 */

import { isValidUuidString } from './database-helpers';

function processUserRequest(possibleUserId: unknown) {
  // Type guard narrows type to string
  if (!isValidUuidString(possibleUserId)) {
    throw new Error('Invalid user ID format');
  }

  // TypeScript knows possibleUserId is a string here
  return getUserSessionsAfter(possibleUserId);
}

/**
 * EXAMPLE 8: Batch Operations
 * Processing multiple UUIDs efficiently
 */

async function deleteMultipleSessions(userId: string, sessionIds: string[]) {
  const pool = await getPool();

  // Validate all session IDs first
  const validatedIds = sessionIds.map((id, index) =>
    extractUuid(id, `sessionIds[${index}]`)
  );

  // Build parameterized query
  const request = pool.request();
  request.input(...uuidInput('userId', userId));

  // Add each session ID as a parameter
  validatedIds.forEach((id, index) => {
    request.input(...uuidInput(`sessionId${index}`, id));
  });

  // Build IN clause
  const inClause = validatedIds
    .map((_, index) => `@sessionId${index}`)
    .join(', ');

  return await request.query(`
    DELETE FROM sessions
    WHERE user_id = @userId AND id IN (${inClause})
  `);
}

/**
 * EXAMPLE 9: Error Handling
 * Proper error handling with descriptive messages
 */

async function updateSessionTitle(sessionId: string, userId: string, title: string) {
  try {
    // extractUuid validates and throws descriptive errors
    const validSessionId = extractUuid(sessionId, 'sessionId');
    const validUserId = extractUuid(userId, 'userId');

    const pool = await getPool();
    const request = pool.request();

    const result = await applyUuidInputs(request, {
      sessionId: validSessionId,
      userId: validUserId,
    })
      .input('title', sql.NVarChar, title)
      .query(`
        UPDATE sessions
        SET title = @title, updated_at = GETUTCDATE()
        WHERE id = @sessionId AND user_id = @userId
      `);

    return result.rowsAffected[0] ?? 0 > 0;
  } catch (error) {
    if (error instanceof Error) {
      // Error messages are descriptive:
      // "Invalid UUID format for sessionId: abc123"
      console.error('Update failed:', error.message);
    }
    throw error;
  }
}

/**
 * EXAMPLE 10: Integration with executeQuery Helper
 * If you're using a custom executeQuery wrapper
 */

// Assuming you have this helper (common pattern):
async function executeQuery<T = any>(
  queryText: string,
  params?: Record<string, unknown>
): Promise<sql.IResult<T>> {
  const pool = await getPool();
  const request = pool.request();

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      // Detect UUID strings and use helper
      if (typeof value === 'string' && isValidUuidString(value)) {
        request.input(...uuidInput(key, value));
      } else if (typeof value === 'number') {
        request.input(key, sql.Int, value);
      } else if (typeof value === 'string') {
        request.input(key, sql.NVarChar, value);
      }
      // ... handle other types
    }
  }

  return await request.query(queryText);
}

// Usage becomes very clean:
async function getUserSessions(userId: string) {
  return executeQuery('SELECT * FROM sessions WHERE user_id = @userId', { userId });
}

/**
 * KEY BENEFITS SUMMARY:
 *
 * 1. **Conciseness**: Reduce boilerplate from 3 lines to 1
 * 2. **Type Safety**: Explicit sql.UniqueIdentifier type
 * 3. **Validation**: Automatic UUID format validation
 * 4. **Normalization**: Consistent lowercase UUIDs
 * 5. **Null Handling**: Graceful handling of optional parameters
 * 6. **Error Messages**: Descriptive validation errors
 * 7. **Maintainability**: Single source of truth for UUID binding
 * 8. **Testability**: Easy to mock and test
 *
 * WHEN TO USE EACH HELPER:
 *
 * - `uuidInput()`: Single UUID parameter
 * - `multiUuidInput()`: Multiple UUIDs, manual application
 * - `applyUuidInputs()`: Multiple UUIDs, automatic application (most common)
 * - `extractUuid()`: Route handlers, parameter validation
 * - `createUuidParams()`: Object-based parameter building
 * - `isValidUuidString()`: Type guards, conditional logic
 */
