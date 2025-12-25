/**
 * CleanSlateDB - Database Cleanup for E2E Test Suites
 *
 * Provides TRUNCATE-style cleanup for E2E tests to ensure database isolation.
 * Deletes all test data in FK-safe order (children before parents).
 *
 * SAFETY: Only runs in test environments and only deletes test data
 * (identified by @bcagent.test email domain).
 *
 * @module __tests__/e2e/helpers/CleanSlateDB
 */

import { executeQuery } from '@/infrastructure/database/database';
import { TEST_EMAIL_DOMAIN } from '../../integration/helpers/constants';

/**
 * Drain MessageQueue before cleanup to prevent FK violations
 *
 * BullMQ marks jobs as "completed" before async DB writes finish.
 * We must wait for all pending writes to complete before deleting records.
 */
async function drainMessageQueueForCleanup(): Promise<void> {
  try {
    // Dynamic import to avoid circular dependencies
    const { getMessageQueue, QueueName } = await import('@/infrastructure/queue/MessageQueue');
    const messageQueue = getMessageQueue();

    // Check if queue is ready
    if (!messageQueue.getReadyStatus()) {
      console.log('[CleanSlateDB] MessageQueue not ready, skipping drain');
      return;
    }

    // Get stats to check if there are pending jobs
    const stats = await messageQueue.getQueueStats(QueueName.MESSAGE_PERSISTENCE);

    if (stats.active > 0 || stats.waiting > 0) {
      console.log(`[CleanSlateDB] Waiting for ${stats.active} active + ${stats.waiting} waiting jobs...`);

      // Wait up to 10 seconds for jobs to complete
      const maxWait = 10000;
      const checkInterval = 500;
      let elapsed = 0;

      while (elapsed < maxWait) {
        const currentStats = await messageQueue.getQueueStats(QueueName.MESSAGE_PERSISTENCE);
        if (currentStats.active === 0 && currentStats.waiting === 0) {
          console.log('[CleanSlateDB] All MessageQueue jobs completed');
          break;
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        elapsed += checkInterval;
      }
    }

    // Add settling delay to ensure all DB writes have completed
    // BullMQ marks jobs as "completed" before async DB writes finish
    // Increased to 3000ms to account for Azure SQL latency
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('[CleanSlateDB] MessageQueue drained with 3s settling delay');
  } catch (error) {
    // Graceful degradation - don't fail cleanup if queue isn't available
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('[CleanSlateDB] Could not drain MessageQueue:', errorMessage);
  }
}

/**
 * CleanSlate configuration options
 */
export interface CleanSlateOptions {
  /**
   * Preserve test users between suites (default: true)
   * If true, keeps users table intact but clears all session/message data
   * If false, deletes users and all related data
   */
  preserveTestUsers?: boolean;

  /**
   * Email pattern to identify test data (default: '%@bcagent.test')
   * Only data matching this pattern will be deleted
   */
  testEmailPattern?: string;

  /**
   * Skip specific tables during cleanup
   * Useful for debugging or partial cleanup scenarios
   */
  skipTables?: string[];
}

/**
 * CleanSlate result summary
 */
export interface CleanSlateResult {
  /** Tables that were cleared */
  tablesCleared: string[];

  /** Number of rows deleted per table */
  rowsDeleted: Record<string, number>;

  /** Total time taken (ms) */
  durationMs: number;
}

/**
 * Verification result for clean slate check
 */
export interface CleanSlateVerification {
  /** True if database is clean (no test data remains) */
  clean: boolean;

  /** Number of remaining test records per table */
  remaining: Record<string, number>;
}

/**
 * Table deletion order (respects FK constraints)
 * Delete children before parents to avoid FK violations
 */
const TABLE_DELETION_ORDER = [
  'messages',        // FK: event_id → message_events, session_id → sessions
  'message_events',  // FK: session_id → sessions
  'approvals',       // FK: session_id → sessions
  'todos',           // FK: session_id → sessions
  'usage_events',    // FK: user_id → users, session_id → sessions (dual FK)
  'token_usage',     // FK: user_id → users, session_id → sessions (dual FK)
  'billing_records', // FK: user_id → users (NO CASCADE - preserve financial data)
  'user_feedback',   // FK: user_id → users (NO CASCADE - preserve feedback)
  'session_files',   // FK: session_id → sessions, file_id → files
  'files',           // FK: user_id → users
  'sessions',        // FK: user_id → users
  'users',           // Root table (no FK dependencies)
] as const;

/**
 * Safety check: Ensure we're running in a test environment
 * Throws error if not in test mode
 */
function ensureTestEnvironment(): void {
  const isTest = process.env.NODE_ENV === 'test' || process.env.E2E_TEST === 'true';
  if (!isTest) {
    throw new Error(
      '[CleanSlateDB] SAFETY: Can only run in test environment. ' +
      'Set NODE_ENV=test or E2E_TEST=true.'
    );
  }
}

/**
 * Clean database for E2E test suite
 *
 * Deletes all test data in FK-safe order (children before parents).
 * Only removes data associated with test users (email matching testEmailPattern).
 *
 * SAFETY:
 * - Only runs in test environments (NODE_ENV=test or E2E_TEST=true)
 * - Only deletes data matching test email pattern (default: @bcagent.test)
 * - Uses parameterized queries to prevent SQL injection
 * - Respects FK constraint ordering
 *
 * @param options - Cleanup configuration
 * @returns Cleanup summary with tables cleared and rows deleted
 *
 * @example
 * ```typescript
 * // Before each test suite
 * beforeAll(async () => {
 *   await cleanSlateForSuite({ preserveTestUsers: true });
 * });
 * ```
 */
export async function cleanSlateForSuite(
  options: CleanSlateOptions = {}
): Promise<CleanSlateResult> {
  // Safety check: only run in test environment
  ensureTestEnvironment();

  const startTime = Date.now();
  const {
    preserveTestUsers = true,
    testEmailPattern = `%${TEST_EMAIL_DOMAIN}`,
    skipTables = [],
  } = options;

  const result: CleanSlateResult = {
    tablesCleared: [],
    rowsDeleted: {},
    durationMs: 0,
  };

  console.log(`[CleanSlateDB] Starting cleanup (preserveTestUsers: ${preserveTestUsers})...`);

  // CRITICAL: Drain MessageQueue BEFORE deleting any records
  // This prevents FK violations from async writes still in progress
  await drainMessageQueueForCleanup();

  try {
    // Delete tables in FK-safe order
    for (const table of TABLE_DELETION_ORDER) {
      // Skip table if requested
      if (skipTables.includes(table)) {
        console.log(`[CleanSlateDB] Skipping table: ${table}`);
        continue;
      }

      // Skip users table if preserveTestUsers is true
      if (table === 'users' && preserveTestUsers) {
        console.log(`[CleanSlateDB] Preserving users table (preserveTestUsers=true)`);
        continue;
      }

      // Build DELETE query based on table
      let deleteQuery: string;
      let rowsAffected = 0;

      try {
        switch (table) {
          // Messages: Delete by event_id (references message_events) OR session_id
          case 'messages': {
            // First delete messages with event_id
            const messagesWithEventIdResult = await executeQuery(
              `DELETE FROM messages WHERE event_id IN (
                SELECT me.id FROM message_events me
                JOIN sessions s ON me.session_id = s.id
                JOIN users u ON s.user_id = u.id
                WHERE u.email LIKE @emailPattern
              )`,
              { emailPattern: testEmailPattern }
            );
            rowsAffected = messagesWithEventIdResult.rowsAffected[0] || 0;

            // Then delete messages by session_id (for messages without event_id)
            const messagesBySessionResult = await executeQuery(
              `DELETE FROM messages WHERE session_id IN (
                SELECT s.id FROM sessions s
                JOIN users u ON s.user_id = u.id
                WHERE u.email LIKE @emailPattern
              )`,
              { emailPattern: testEmailPattern }
            );
            rowsAffected += messagesBySessionResult.rowsAffected[0] || 0;
            break;
          }

          // Message events: Delete by session_id
          case 'message_events': {
            // Verify no FK violations will occur before deleting
            const potentialFKViolations = await executeQuery<{ count: number }>(
              `SELECT COUNT(*) as count FROM messages m
               WHERE m.event_id IN (
                 SELECT me.id FROM message_events me
                 JOIN sessions s ON me.session_id = s.id
                 JOIN users u ON s.user_id = u.id
                 WHERE u.email LIKE @emailPattern
               )`,
              { emailPattern: testEmailPattern }
            );

            if (potentialFKViolations.recordset[0]?.count && potentialFKViolations.recordset[0].count > 0) {
              console.warn(
                `[CleanSlateDB] Warning: ${potentialFKViolations.recordset[0].count} messages still reference test event_ids`
              );
              // Force delete any remaining messages with FK references
              await executeQuery(
                `DELETE FROM messages WHERE event_id IN (
                  SELECT me.id FROM message_events me
                  JOIN sessions s ON me.session_id = s.id
                  JOIN users u ON s.user_id = u.id
                  WHERE u.email LIKE @emailPattern
                )`,
                { emailPattern: testEmailPattern }
              );
            }

            deleteQuery = `DELETE FROM message_events WHERE session_id IN (
              SELECT s.id FROM sessions s
              JOIN users u ON s.user_id = u.id
              WHERE u.email LIKE @emailPattern
            )`;
            const queryResult = await executeQuery(deleteQuery, { emailPattern: testEmailPattern });
            rowsAffected = queryResult.rowsAffected[0] || 0;
            break;
          }

          // Approvals, todos: Delete by session owner
          case 'approvals':
          case 'todos': {
            deleteQuery = `DELETE FROM ${table} WHERE session_id IN (
              SELECT s.id FROM sessions s
              JOIN users u ON s.user_id = u.id
              WHERE u.email LIKE @emailPattern
            )`;
            const queryResult = await executeQuery(deleteQuery, { emailPattern: testEmailPattern });
            rowsAffected = queryResult.rowsAffected[0] || 0;
            break;
          }

          // usage_events, token_usage: Dual FK to both sessions AND users
          // Must delete by BOTH session_id AND user_id to catch orphaned records
          case 'usage_events':
          case 'token_usage': {
            // 1. First delete by session_id (captures records with valid session)
            const bySessionResult = await executeQuery(
              `DELETE FROM ${table} WHERE session_id IN (
                SELECT s.id FROM sessions s
                JOIN users u ON s.user_id = u.id
                WHERE u.email LIKE @emailPattern
              )`,
              { emailPattern: testEmailPattern }
            );
            const deletedBySession = bySessionResult.rowsAffected[0] || 0;

            // 2. ALSO delete by user_id directly (captures orphaned records without valid session)
            const byUserResult = await executeQuery(
              `DELETE FROM ${table} WHERE user_id IN (
                SELECT id FROM users WHERE email LIKE @emailPattern
              )`,
              { emailPattern: testEmailPattern }
            );
            const deletedByUser = byUserResult.rowsAffected[0] || 0;

            rowsAffected = deletedBySession + deletedByUser;
            if (deletedByUser > 0) {
              console.log(`[CleanSlateDB] ${table}: ${deletedBySession} by session + ${deletedByUser} orphaned by user`);
            }
            break;
          }

          // billing_records, user_feedback: Direct FK to users only (NO CASCADE)
          case 'billing_records':
          case 'user_feedback': {
            deleteQuery = `DELETE FROM ${table} WHERE user_id IN (
              SELECT id FROM users WHERE email LIKE @emailPattern
            )`;
            const queryResult = await executeQuery(deleteQuery, { emailPattern: testEmailPattern });
            rowsAffected = queryResult.rowsAffected[0] || 0;
            break;
          }

          // Session files: Delete by session owner (compound FK: session_id + file_id)
          case 'session_files': {
            deleteQuery = `DELETE FROM session_files WHERE session_id IN (
              SELECT s.id FROM sessions s
              JOIN users u ON s.user_id = u.id
              WHERE u.email LIKE @emailPattern
            )`;
            const queryResult = await executeQuery(deleteQuery, { emailPattern: testEmailPattern });
            rowsAffected = queryResult.rowsAffected[0] || 0;
            break;
          }

          // Files: Delete by user owner
          case 'files': {
            deleteQuery = `DELETE FROM files WHERE user_id IN (
              SELECT id FROM users WHERE email LIKE @emailPattern
            )`;
            const queryResult = await executeQuery(deleteQuery, { emailPattern: testEmailPattern });
            rowsAffected = queryResult.rowsAffected[0] || 0;
            break;
          }

          // Sessions: Delete by user owner
          case 'sessions': {
            deleteQuery = `DELETE FROM sessions WHERE user_id IN (
              SELECT id FROM users WHERE email LIKE @emailPattern
            )`;
            const queryResult = await executeQuery(deleteQuery, { emailPattern: testEmailPattern });
            rowsAffected = queryResult.rowsAffected[0] || 0;
            break;
          }

          // Users: Delete by email pattern (only if preserveTestUsers=false)
          case 'users': {
            deleteQuery = `DELETE FROM users WHERE email LIKE @emailPattern`;
            const queryResult = await executeQuery(deleteQuery, { emailPattern: testEmailPattern });
            rowsAffected = queryResult.rowsAffected[0] || 0;
            break;
          }

          default: {
            console.warn(`[CleanSlateDB] Unknown table: ${table}`);
            continue;
          }
        }

        // Track results
        result.tablesCleared.push(table);
        result.rowsDeleted[table] = rowsAffected;

        if (rowsAffected > 0) {
          console.log(`[CleanSlateDB] Cleared ${table}: ${rowsAffected} rows`);
        }
      } catch (error) {
        // Handle missing tables gracefully (some may not exist in all environments)
        if (error instanceof Error && error.message.includes('Invalid object name')) {
          console.log(`[CleanSlateDB] Table ${table} does not exist, skipping`);
          continue;
        }
        throw error;
      }
    }

    result.durationMs = Date.now() - startTime;
    console.log(`[CleanSlateDB] Cleanup complete in ${result.durationMs}ms`);
    console.log(`[CleanSlateDB] Summary: ${result.tablesCleared.length} tables cleared, ${Object.values(result.rowsDeleted).reduce((a, b) => a + b, 0)} total rows deleted`);

    return result;
  } catch (error) {
    console.error('[CleanSlateDB] Cleanup failed:', error);
    throw error;
  }
}

/**
 * Verify clean slate was successful
 *
 * Checks all tables for remaining test data.
 * Useful for debugging cleanup issues.
 *
 * @param testEmailPattern - Email pattern to identify test data (default: '%@bcagent.test')
 * @returns Verification result with clean status and remaining counts
 *
 * @example
 * ```typescript
 * // After cleanup
 * const { clean, remaining } = await verifyCleanSlate();
 * if (!clean) {
 *   console.error('Cleanup incomplete:', remaining);
 * }
 * ```
 */
export async function verifyCleanSlate(
  testEmailPattern = `%${TEST_EMAIL_DOMAIN}`
): Promise<CleanSlateVerification> {
  ensureTestEnvironment();

  const remaining: Record<string, number> = {};

  try {
    // Check users
    const usersResult = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM users WHERE email LIKE @emailPattern`,
      { emailPattern: testEmailPattern }
    );
    remaining.users = usersResult.recordset[0]?.count || 0;

    // Check sessions
    const sessionsResult = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM sessions WHERE user_id IN (
        SELECT id FROM users WHERE email LIKE @emailPattern
      )`,
      { emailPattern: testEmailPattern }
    );
    remaining.sessions = sessionsResult.recordset[0]?.count || 0;

    // Check messages
    const messagesResult = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM messages WHERE session_id IN (
        SELECT s.id FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE u.email LIKE @emailPattern
      )`,
      { emailPattern: testEmailPattern }
    );
    remaining.messages = messagesResult.recordset[0]?.count || 0;

    // Check message_events
    const messageEventsResult = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM message_events WHERE session_id IN (
        SELECT s.id FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE u.email LIKE @emailPattern
      )`,
      { emailPattern: testEmailPattern }
    );
    remaining.message_events = messageEventsResult.recordset[0]?.count || 0;

    // Check approvals
    const approvalsResult = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM approvals WHERE session_id IN (
        SELECT s.id FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE u.email LIKE @emailPattern
      )`,
      { emailPattern: testEmailPattern }
    );
    remaining.approvals = approvalsResult.recordset[0]?.count || 0;

    // Check todos
    const todosResult = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM todos WHERE session_id IN (
        SELECT s.id FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE u.email LIKE @emailPattern
      )`,
      { emailPattern: testEmailPattern }
    );
    remaining.todos = todosResult.recordset[0]?.count || 0;

    // Determine if clean (all counts are 0)
    const clean = Object.values(remaining).every(count => count === 0);

    return { clean, remaining };
  } catch (error) {
    console.error('[CleanSlateDB] Verification failed:', error);
    throw error;
  }
}
