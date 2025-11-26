/**
 * TestDataCleanup - Utilities for Cleaning Test Data
 *
 * Provides safe cleanup utilities for integration tests.
 * Only removes data with the test prefix to avoid affecting production data.
 *
 * @module __tests__/integration/helpers/TestDataCleanup
 */

import { executeQuery } from '@/config/database';
import { getRedis } from '@/config/redis';
import { TEST_PREFIX, TEST_EMAIL_DOMAIN } from './TestSessionFactory';

/**
 * Cleanup result summary
 */
export interface CleanupResult {
  /** Number of users deleted */
  usersDeleted: number;
  /** Number of sessions deleted */
  sessionsDeleted: number;
  /** Number of messages deleted */
  messagesDeleted: number;
  /** Number of message events deleted */
  messageEventsDeleted: number;
  /** Number of approvals deleted */
  approvalsDeleted: number;
  /** Number of todos deleted */
  todosDeleted: number;
  /** Number of Redis keys deleted */
  redisKeysDeleted: number;
  /** Total time taken (ms) */
  durationMs: number;
}

/**
 * Clean all test data from database and Redis
 *
 * Only removes data with the TEST_PREFIX to ensure safety.
 * Deletes in correct order to respect foreign key constraints.
 *
 * @param prefix - Optional custom prefix (defaults to TEST_PREFIX)
 * @returns Cleanup summary
 */
export async function cleanupAllTestData(prefix?: string): Promise<CleanupResult> {
  const cleanupPrefix = prefix || TEST_PREFIX;
  const startTime = Date.now();

  const result: CleanupResult = {
    usersDeleted: 0,
    sessionsDeleted: 0,
    messagesDeleted: 0,
    messageEventsDeleted: 0,
    approvalsDeleted: 0,
    todosDeleted: 0,
    redisKeysDeleted: 0,
    durationMs: 0,
  };

  try {
    // Identify test users by email domain (since IDs are valid UUIDs)
    const testEmailPattern = `%${TEST_EMAIL_DOMAIN}`;

    // 1. Delete message_events for sessions owned by test users
    const messageEventsResult = await executeQuery(
      `DELETE FROM message_events WHERE session_id IN (
        SELECT s.id FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE u.email LIKE @emailPattern
      )`,
      { emailPattern: testEmailPattern }
    );
    result.messageEventsDeleted = messageEventsResult.rowsAffected[0] || 0;

    // 2. Delete messages for sessions owned by test users
    const messagesResult = await executeQuery(
      `DELETE FROM messages WHERE session_id IN (
        SELECT s.id FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE u.email LIKE @emailPattern
      )`,
      { emailPattern: testEmailPattern }
    );
    result.messagesDeleted = messagesResult.rowsAffected[0] || 0;

    // 3. Delete approvals for sessions owned by test users
    const approvalsResult = await executeQuery(
      `DELETE FROM approvals WHERE session_id IN (
        SELECT s.id FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE u.email LIKE @emailPattern
      )`,
      { emailPattern: testEmailPattern }
    );
    result.approvalsDeleted = approvalsResult.rowsAffected[0] || 0;

    // 4. Delete todos for sessions owned by test users
    const todosResult = await executeQuery(
      `DELETE FROM todos WHERE session_id IN (
        SELECT s.id FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE u.email LIKE @emailPattern
      )`,
      { emailPattern: testEmailPattern }
    );
    result.todosDeleted = todosResult.rowsAffected[0] || 0;

    // 5. Delete sessions owned by test users
    const sessionsResult = await executeQuery(
      `DELETE FROM sessions WHERE user_id IN (
        SELECT id FROM users WHERE email LIKE @emailPattern
      )`,
      { emailPattern: testEmailPattern }
    );
    result.sessionsDeleted = sessionsResult.rowsAffected[0] || 0;

    // 6. Delete test users (identified by email domain)
    const usersResult = await executeQuery(
      `DELETE FROM users WHERE email LIKE @emailPattern`,
      { emailPattern: testEmailPattern }
    );
    result.usersDeleted = usersResult.rowsAffected[0] || 0;

    // 7. Clean Redis test keys
    const redis = getRedis();
    if (!redis) {
      throw new Error('Redis not initialized');
    }
    const testSessionKeys = await redis.keys(`sess:${cleanupPrefix}*`);
    const testDataKeys = await redis.keys(`test:*`);
    const allTestKeys = [...testSessionKeys, ...testDataKeys];

    if (allTestKeys.length > 0) {
      await redis.del(allTestKeys);
      result.redisKeysDeleted = allTestKeys.length;
    }

  } catch (error) {
    console.error('Error during test data cleanup:', error);
    throw error;
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

/**
 * Clean test data for a specific session
 *
 * @param sessionId - Session ID to clean
 * @returns Number of records deleted
 */
export async function cleanupSession(sessionId: string): Promise<{
  messages: number;
  messageEvents: number;
  approvals: number;
  todos: number;
  session: boolean;
}> {
  // Delete in correct order
  const messageEventsResult = await executeQuery(
    `DELETE FROM message_events WHERE session_id = @sessionId`,
    { sessionId }
  );

  const messagesResult = await executeQuery(
    `DELETE FROM messages WHERE session_id = @sessionId`,
    { sessionId }
  );

  const approvalsResult = await executeQuery(
    `DELETE FROM approvals WHERE session_id = @sessionId`,
    { sessionId }
  );

  const todosResult = await executeQuery(
    `DELETE FROM todos WHERE session_id = @sessionId`,
    { sessionId }
  );

  const sessionResult = await executeQuery(
    `DELETE FROM sessions WHERE id = @sessionId`,
    { sessionId }
  );

  return {
    messages: messagesResult.rowsAffected[0] || 0,
    messageEvents: messageEventsResult.rowsAffected[0] || 0,
    approvals: approvalsResult.rowsAffected[0] || 0,
    todos: todosResult.rowsAffected[0] || 0,
    session: (sessionResult.rowsAffected[0] || 0) > 0,
  };
}

/**
 * Clean test data for a specific user
 *
 * @param userId - User ID to clean
 * @returns Summary of deleted records
 */
export async function cleanupUser(userId: string): Promise<{
  sessions: number;
  user: boolean;
}> {
  // Get all sessions for this user
  const sessionsResult = await executeQuery<{ id: string }>(
    `SELECT id FROM sessions WHERE user_id = @userId`,
    { userId }
  );

  // Clean each session
  let sessionsDeleted = 0;
  for (const row of sessionsResult.recordset) {
    await cleanupSession(row.id);
    sessionsDeleted++;
  }

  // Delete the user
  const userResult = await executeQuery(
    `DELETE FROM users WHERE id = @userId`,
    { userId }
  );

  return {
    sessions: sessionsDeleted,
    user: (userResult.rowsAffected[0] || 0) > 0,
  };
}

/**
 * Clean Redis test keys only
 *
 * @param pattern - Key pattern to match (defaults to test keys)
 * @returns Number of keys deleted
 */
export async function cleanupRedisTestKeys(pattern?: string): Promise<number> {
  const redis = getRedis();
  if (!redis) {
    throw new Error('Redis not initialized');
  }
  const keyPattern = pattern || `sess:${TEST_PREFIX}*`;

  const keys = await redis.keys(keyPattern);
  if (keys.length === 0) {
    return 0;
  }

  await redis.del(keys);
  return keys.length;
}

/**
 * Verify no test data remains
 *
 * Useful for ensuring cleanup was successful.
 *
 * @param prefix - Optional custom prefix
 * @returns True if no test data exists
 */
export async function verifyNoTestData(_prefix?: string): Promise<{
  clean: boolean;
  remaining: {
    users: number;
    sessions: number;
    messages: number;
    redisKeys: number;
  };
}> {
  const testEmailPattern = `%${TEST_EMAIL_DOMAIN}`;

  const usersResult = await executeQuery<{ count: number }>(
    `SELECT COUNT(*) as count FROM users WHERE email LIKE @emailPattern`,
    { emailPattern: testEmailPattern }
  );

  const sessionsResult = await executeQuery<{ count: number }>(
    `SELECT COUNT(*) as count FROM sessions WHERE user_id IN (
      SELECT id FROM users WHERE email LIKE @emailPattern
    )`,
    { emailPattern: testEmailPattern }
  );

  const messagesResult = await executeQuery<{ count: number }>(
    `SELECT COUNT(*) as count FROM messages WHERE session_id IN (
      SELECT s.id FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE u.email LIKE @emailPattern
    )`,
    { emailPattern: testEmailPattern }
  );

  const redis = getRedis();
  if (!redis) {
    throw new Error('Redis not initialized');
  }
  const redisKeys = await redis.keys(`sess:${TEST_PREFIX}*`);

  const remaining = {
    users: usersResult.recordset[0]?.count || 0,
    sessions: sessionsResult.recordset[0]?.count || 0,
    messages: messagesResult.recordset[0]?.count || 0,
    redisKeys: redisKeys.length,
  };

  const clean = remaining.users === 0 &&
    remaining.sessions === 0 &&
    remaining.messages === 0 &&
    remaining.redisKeys === 0;

  return { clean, remaining };
}

/**
 * Safe cleanup wrapper that logs results
 *
 * @param prefix - Optional custom prefix
 */
export async function safeCleanup(prefix?: string): Promise<void> {
  try {
    const result = await cleanupAllTestData(prefix);
    console.log(`\n🧹 Test data cleanup complete in ${result.durationMs}ms:`);
    console.log(`   Users: ${result.usersDeleted}`);
    console.log(`   Sessions: ${result.sessionsDeleted}`);
    console.log(`   Messages: ${result.messagesDeleted}`);
    console.log(`   Redis keys: ${result.redisKeysDeleted}\n`);
  } catch (error) {
    console.error('❌ Test data cleanup failed:', error);
    throw error;
  }
}
