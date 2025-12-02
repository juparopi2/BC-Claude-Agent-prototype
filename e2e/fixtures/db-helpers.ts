/**
 * E2E Database Helpers
 *
 * Functions to seed and clean test data in the database.
 * These helpers use the same database configuration as the backend.
 *
 * @module e2e/fixtures/db-helpers
 */

// Load environment variables FIRST
import '../setup/loadEnv';

import sql from 'mssql';
import {
  TEST_USER,
  TEST_ADMIN_USER,
  TEST_SESSIONS,
  TEST_MESSAGES,
  TEST_APPROVALS,
  MOCK_BC_TOKENS,
} from './test-data';

/**
 * Database configuration for E2E tests
 *
 * Uses environment variables from backend/.env
 */
function getDbConfig(): sql.config {
  // Load from environment or use defaults
  const server = process.env.DATABASE_SERVER;
  const database = process.env.DATABASE_NAME;
  const user = process.env.DATABASE_USER;
  const password = process.env.DATABASE_PASSWORD;

  if (!server || !database || !user || !password) {
    throw new Error(
      'Database configuration missing. Ensure DATABASE_SERVER, DATABASE_NAME, DATABASE_USER, and DATABASE_PASSWORD are set.'
    );
  }

  return {
    server,
    database,
    user,
    password,
    options: {
      encrypt: true,
      trustServerCertificate: process.env.NODE_ENV !== 'production',
      enableArithAbort: true,
    },
    pool: {
      max: 5,
      min: 1,
      idleTimeoutMillis: 30000,
    },
    connectionTimeout: 30000,
    requestTimeout: 30000,
  };
}

let pool: sql.ConnectionPool | null = null;

/**
 * Get or create database connection pool
 */
async function getPool(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) {
    return pool;
  }

  const config = getDbConfig();
  pool = await sql.connect(config);
  console.log('✅ E2E Database connected');
  return pool;
}

/**
 * Close database connection
 */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
    console.log('✅ E2E Database connection closed');
  }
}

/**
 * Clean all E2E test data from database
 *
 * Removes all data created by E2E tests (identified by e2e prefix in IDs).
 * Order matters due to foreign key constraints.
 */
export async function cleanTestData(): Promise<void> {
  const db = await getPool();

  console.log('🧹 Cleaning E2E test data...');

  // Delete in reverse order of dependencies
  const cleanupQueries = [
    // 1. Delete performance_metrics for test sessions
    `DELETE FROM performance_metrics WHERE session_id LIKE 'e2e%'`,

    // 2. Delete audit_log for test users/sessions
    `DELETE FROM audit_log WHERE user_id LIKE 'e2e%' OR session_id LIKE 'e2e%'`,

    // 3. Delete session_files for test sessions
    `DELETE FROM session_files WHERE session_id LIKE 'e2e%'`,

    // 4. Delete agent_executions for test sessions
    `DELETE FROM agent_executions WHERE session_id LIKE 'e2e%'`,

    // 5. Delete todos for test sessions
    `DELETE FROM todos WHERE session_id LIKE 'e2e%'`,

    // 6. Delete checkpoints for test sessions
    `DELETE FROM checkpoints WHERE session_id LIKE 'e2e%'`,

    // 7. Delete approvals for test sessions
    `DELETE FROM approvals WHERE session_id LIKE 'e2e%' OR id LIKE 'e2e%'`,

    // 8. Delete messages for test sessions (includes msg_e2e_* IDs)
    `DELETE FROM messages WHERE session_id LIKE 'e2e%' OR id LIKE 'msg_e2e%'`,

    // 9. Delete message_events for test sessions
    `DELETE FROM message_events WHERE session_id LIKE 'e2e%'`,

    // 10. Delete tool_permissions for test users
    `DELETE FROM tool_permissions WHERE user_id LIKE 'e2e%'`,

    // 11. Delete sessions for test users
    `DELETE FROM sessions WHERE id LIKE 'e2e%' OR user_id LIKE 'e2e%'`,

    // 12. Delete test users last
    `DELETE FROM users WHERE id LIKE 'e2e%' OR email LIKE '%@bcagent.test'`,
  ];

  for (const query of cleanupQueries) {
    try {
      const result = await db.request().query(query);
      if (result.rowsAffected[0] > 0) {
        console.log(`   Deleted ${result.rowsAffected[0]} rows: ${query.substring(0, 50)}...`);
      }
    } catch (error) {
      // Log but don't fail - some tables might not exist or have no matching data
      console.warn(`   Warning executing: ${query.substring(0, 50)}...`, error instanceof Error ? error.message : error);
    }
  }

  console.log('✅ E2E test data cleaned');
}

/**
 * Seed test users
 */
async function seedUsers(): Promise<void> {
  const db = await getPool();

  const users = [TEST_USER, TEST_ADMIN_USER];

  for (const user of users) {
    await db.request()
      .input('id', sql.UniqueIdentifier, user.id)
      .input('email', sql.NVarChar, user.email)
      .input('full_name', sql.NVarChar, user.fullName)
      .input('role', sql.NVarChar, user.role)
      .input('is_admin', sql.Bit, user.isAdmin)
      .input('is_active', sql.Bit, user.isActive)
      .input('microsoft_id', sql.NVarChar, user.microsoftId)
      .input('microsoft_email', sql.NVarChar, user.microsoftEmail)
      .input('microsoft_tenant_id', sql.NVarChar, user.microsoftTenantId)
      .input('bc_access_token_encrypted', sql.NVarChar, MOCK_BC_TOKENS.accessToken)
      .input('bc_refresh_token_encrypted', sql.NVarChar, MOCK_BC_TOKENS.refreshToken)
      .input('bc_token_expires_at', sql.DateTime2, MOCK_BC_TOKENS.expiresAt)
      .query(`
        INSERT INTO users (
          id, email, full_name, role, is_admin, is_active,
          microsoft_id, microsoft_email, microsoft_tenant_id,
          bc_access_token_encrypted, bc_refresh_token_encrypted, bc_token_expires_at
        ) VALUES (
          @id, @email, @full_name, @role, @is_admin, @is_active,
          @microsoft_id, @microsoft_email, @microsoft_tenant_id,
          @bc_access_token_encrypted, @bc_refresh_token_encrypted, @bc_token_expires_at
        )
      `);

    console.log(`   Created user: ${user.email}`);
  }
}

/**
 * Seed test sessions
 */
async function seedSessions(): Promise<void> {
  const db = await getPool();

  const sessions = Object.values(TEST_SESSIONS);

  for (const session of sessions) {
    await db.request()
      .input('id', sql.UniqueIdentifier, session.id)
      .input('user_id', sql.UniqueIdentifier, session.userId)
      .input('title', sql.NVarChar, session.title)
      .input('is_active', sql.Bit, session.isActive)
      .query(`
        INSERT INTO sessions (id, user_id, title, is_active)
        VALUES (@id, @user_id, @title, @is_active)
      `);

    console.log(`   Created session: ${session.title}`);
  }
}

/**
 * Seed test messages
 */
async function seedMessages(): Promise<void> {
  const db = await getPool();

  // Flatten all message arrays
  const allMessages = [
    ...TEST_MESSAGES.history,
    ...TEST_MESSAGES.toolUse,
  ];

  for (const msg of allMessages) {
    await db.request()
      .input('id', sql.NVarChar(255), msg.id)
      .input('session_id', sql.UniqueIdentifier, msg.sessionId)
      .input('role', sql.NVarChar, msg.role)
      .input('message_type', sql.NVarChar, msg.messageType)
      .input('content', sql.NVarChar(sql.MAX), msg.content)
      .input('metadata', sql.NVarChar(sql.MAX), msg.metadata)
      .input('sequence_number', sql.Int, msg.sequenceNumber)
      .input('tool_use_id', sql.NVarChar, 'toolUseId' in msg ? msg.toolUseId : null)
      .input('model', sql.NVarChar, 'model' in msg ? msg.model : null)
      .input('input_tokens', sql.Int, 'inputTokens' in msg ? msg.inputTokens : null)
      .input('output_tokens', sql.Int, 'outputTokens' in msg ? msg.outputTokens : null)
      .input('stop_reason', sql.NVarChar, 'stopReason' in msg ? msg.stopReason : null)
      .query(`
        INSERT INTO messages (
          id, session_id, role, message_type, content, metadata,
          sequence_number, tool_use_id, model, input_tokens, output_tokens, stop_reason
        ) VALUES (
          @id, @session_id, @role, @message_type, @content, @metadata,
          @sequence_number, @tool_use_id, @model, @input_tokens, @output_tokens, @stop_reason
        )
      `);
  }

  console.log(`   Created ${allMessages.length} messages`);
}

/**
 * Seed test approvals
 */
async function seedApprovals(): Promise<void> {
  const db = await getPool();

  const approvals = Object.values(TEST_APPROVALS);

  for (const approval of approvals) {
    // Calculate expires_at for pending approvals (5 minutes from now)
    const expiresAt = approval.status === 'pending'
      ? new Date(Date.now() + 5 * 60 * 1000)
      : null;

    // Calculate decided_at for resolved approvals
    const decidedAt = approval.status !== 'pending'
      ? new Date()
      : null;

    await db.request()
      .input('id', sql.UniqueIdentifier, approval.id)
      .input('session_id', sql.UniqueIdentifier, approval.sessionId)
      .input('tool_name', sql.NVarChar, approval.toolName)
      .input('tool_args', sql.NVarChar(sql.MAX), approval.toolArgs)
      .input('action_type', sql.NVarChar, approval.actionType)
      .input('action_description', sql.NVarChar(sql.MAX), approval.actionDescription)
      .input('status', sql.NVarChar, approval.status)
      .input('priority', sql.NVarChar, approval.priority)
      .input('expires_at', sql.DateTime2, expiresAt)
      .input('decided_by_user_id', sql.UniqueIdentifier, 'decidedByUserId' in approval ? approval.decidedByUserId : null)
      .input('decided_at', sql.DateTime2, decidedAt)
      .input('rejection_reason', sql.NVarChar(sql.MAX), 'rejectionReason' in approval ? approval.rejectionReason : null)
      .query(`
        INSERT INTO approvals (
          id, session_id, tool_name, tool_args, action_type, action_description,
          status, priority, expires_at, decided_by_user_id, decided_at, rejection_reason
        ) VALUES (
          @id, @session_id, @tool_name, @tool_args, @action_type, @action_description,
          @status, @priority, @expires_at, @decided_by_user_id, @decided_at, @rejection_reason
        )
      `);

    console.log(`   Created approval: ${approval.actionDescription} (${approval.status})`);
  }
}

/**
 * Seed all test data
 *
 * Creates users, sessions, messages, and approvals in the correct order.
 */
export async function seedTestData(): Promise<void> {
  console.log('🌱 Seeding E2E test data...');

  try {
    // Clean existing data first
    await cleanTestData();

    // Seed in dependency order
    await seedUsers();
    await seedSessions();
    await seedMessages();
    await seedApprovals();

    console.log('✅ E2E test data seeded successfully');
  } catch (error) {
    console.error('❌ Failed to seed E2E test data:', error);
    throw error;
  }
}

/**
 * Verify test data exists
 *
 * Quick check that critical test data is in place.
 */
export async function verifyTestData(): Promise<boolean> {
  const db = await getPool();

  try {
    // Check test user exists
    const userResult = await db.request()
      .input('email', sql.NVarChar, TEST_USER.email)
      .query('SELECT COUNT(*) as count FROM users WHERE email = @email');

    if (userResult.recordset[0].count === 0) {
      console.warn('⚠️ Test user not found');
      return false;
    }

    // Check test sessions exist
    const sessionResult = await db.request()
      .input('userId', sql.UniqueIdentifier, TEST_USER.id)
      .query('SELECT COUNT(*) as count FROM sessions WHERE user_id = @userId');

    if (sessionResult.recordset[0].count === 0) {
      console.warn('⚠️ Test sessions not found');
      return false;
    }

    console.log('✅ E2E test data verified');
    return true;
  } catch (error) {
    console.error('❌ Failed to verify E2E test data:', error);
    return false;
  }
}

/**
 * Get test user by email
 *
 * Utility to fetch test user from database (for assertions).
 */
export async function getTestUser(email: string = TEST_USER.email): Promise<Record<string, unknown> | null> {
  const db = await getPool();

  const result = await db.request()
    .input('email', sql.NVarChar, email)
    .query('SELECT * FROM users WHERE email = @email');

  return result.recordset[0] || null;
}

/**
 * Get test session messages
 *
 * Utility to fetch messages for a session (for assertions).
 */
export async function getSessionMessages(sessionId: string): Promise<Record<string, unknown>[]> {
  const db = await getPool();

  const result = await db.request()
    .input('sessionId', sql.UniqueIdentifier, sessionId)
    .query(`
      SELECT * FROM messages
      WHERE session_id = @sessionId
      ORDER BY sequence_number ASC
    `);

  return result.recordset;
}

/**
 * Get pending approvals for session
 */
export async function getPendingApprovals(sessionId: string): Promise<Record<string, unknown>[]> {
  const db = await getPool();

  const result = await db.request()
    .input('sessionId', sql.UniqueIdentifier, sessionId)
    .query(`
      SELECT * FROM approvals
      WHERE session_id = @sessionId AND status = 'pending'
      ORDER BY created_at DESC
    `);

  return result.recordset;
}

/**
 * Create a test session dynamically
 *
 * For tests that need a fresh session not in fixtures.
 */
export async function createTestSession(
  userId: string = TEST_USER.id,
  title: string = 'Dynamic E2E Session'
): Promise<string> {
  const db = await getPool();

  // Generate a unique ID with e2e prefix
  const sessionId = `e2e1${Date.now().toString(16).padStart(4, '0').slice(-4)}-${Math.random().toString(16).slice(2, 6)}-0000-0000-${Math.random().toString(16).slice(2, 14)}`;

  await db.request()
    .input('id', sql.UniqueIdentifier, sessionId)
    .input('user_id', sql.UniqueIdentifier, userId)
    .input('title', sql.NVarChar, title)
    .input('is_active', sql.Bit, true)
    .query(`
      INSERT INTO sessions (id, user_id, title, is_active)
      VALUES (@id, @user_id, @title, @is_active)
    `);

  return sessionId;
}

/**
 * Delete a specific session (for cleanup)
 */
export async function deleteTestSession(sessionId: string): Promise<void> {
  const db = await getPool();

  // Delete in correct order due to FK constraints
  await db.request()
    .input('sessionId', sql.UniqueIdentifier, sessionId)
    .query('DELETE FROM approvals WHERE session_id = @sessionId');

  await db.request()
    .input('sessionId', sql.UniqueIdentifier, sessionId)
    .query('DELETE FROM messages WHERE session_id = @sessionId');

  await db.request()
    .input('sessionId', sql.UniqueIdentifier, sessionId)
    .query('DELETE FROM message_events WHERE session_id = @sessionId');

  await db.request()
    .input('sessionId', sql.UniqueIdentifier, sessionId)
    .query('DELETE FROM sessions WHERE id = @sessionId');
}
