/**
 * TestSessionFactory - Creates Test Users and Sessions for Integration Tests
 *
 * Provides utilities for creating test data directly in Azure SQL and Redis
 * for integration testing. All data uses a unique prefix for safe cleanup.
 *
 * Features:
 * - Create test users in database
 * - Create chat sessions
 * - Create Redis session cookies
 * - Automatic cleanup tracking
 *
 * @module __tests__/integration/helpers/TestSessionFactory
 */

import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { executeQuery } from '@/config/database';
import { getRedis } from '@/config/redis';
import {
  TEST_SESSION_SECRET,
  TEST_PREFIX,
  TEST_EMAIL_DOMAIN,
} from './constants';

// Re-export constants for backward compatibility
export { TEST_PREFIX, TEST_EMAIL_DOMAIN, TEST_SESSION_SECRET };

/**
 * Sign a session ID using express-session's signature format
 * Uses HMAC-SHA256 with base64 encoding (minus padding)
 */
function signSessionId(sessionId: string, secret: string): string {
  const signature = crypto
    .createHmac('sha256', secret)
    .update(sessionId)
    .digest('base64')
    .replace(/=+$/, '');
  return signature;
}

/**
 * Test user data
 */
export interface TestUser {
  /** User ID (UUID with prefix) */
  id: string;
  /** User email */
  email: string;
  /** User display name */
  displayName: string;
  /** Microsoft OAuth ID */
  microsoftId: string;
  /** Session cookie for WebSocket authentication */
  sessionCookie: string;
  /** Redis session ID */
  redisSessionId: string;
}

/**
 * Test chat session data
 */
export interface TestChatSession {
  /** Session ID (UUID with prefix) */
  id: string;
  /** Owner user ID */
  userId: string;
  /** Session title */
  title: string;
  /** Creation timestamp */
  createdAt: Date;
}

/**
 * Test Session Factory
 *
 * Creates and tracks test data for integration tests.
 * Call cleanup() after tests to remove all created data.
 */
export class TestSessionFactory {
  private createdUsers: string[] = [];
  private createdSessions: string[] = [];
  private createdRedisKeys: string[] = [];

  /**
   * Generate a unique test ID (valid UUID for UNIQUEIDENTIFIER columns)
   */
  generateTestId(): string {
    return uuidv4();
  }

  /**
   * Generate a test string ID with prefix (for non-UUID columns)
   */
  generateTestStringId(): string {
    return `${TEST_PREFIX}${uuidv4()}`;
  }

  /**
   * Create a test user in the database
   *
   * @param options - Optional overrides
   * @returns Created test user with session cookie
   */
  async createTestUser(options?: {
    prefix?: string;
    email?: string;
    displayName?: string;
  }): Promise<TestUser> {
    const prefix = options?.prefix || '';
    const userId = this.generateTestId();
    const microsoftId = `ms_${TEST_PREFIX}${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const email = options?.email || `${TEST_PREFIX}${prefix}user_${Date.now()}@bcagent.test`;
    const displayName = options?.displayName || `Test User ${prefix}${Date.now()}`;

    // Insert user into database
    // Schema uses full_name not display_name, and has required fields
    await executeQuery(
      `INSERT INTO users (id, microsoft_id, email, full_name, is_active, is_admin, role, created_at, updated_at)
       VALUES (@userId, @microsoftId, @email, @fullName, 1, 0, 'viewer', GETDATE(), GETDATE())`,
      { userId, microsoftId, email, fullName: displayName }
    );

    this.createdUsers.push(userId);

    // Create Redis session for WebSocket authentication
    const { sessionId, cookie } = await this.createSessionCookie(userId, email);

    return {
      id: userId,
      email,
      displayName,
      microsoftId,
      sessionCookie: cookie,
      redisSessionId: sessionId,
    };
  }

  /**
   * Create a chat session in the database
   *
   * @param userId - Owner user ID
   * @param options - Optional overrides
   * @returns Created chat session
   */
  async createChatSession(
    userId: string,
    options?: {
      title?: string;
      sessionId?: string;
    }
  ): Promise<TestChatSession> {
    const sessionId = options?.sessionId || this.generateTestId();
    const title = options?.title || `Test Session ${Date.now()}`;
    const now = new Date();

    // Insert session into database
    await executeQuery(
      `INSERT INTO sessions (id, user_id, title, created_at, updated_at)
       VALUES (@sessionId, @userId, @title, @createdAt, @createdAt)`,
      { sessionId, userId, title, createdAt: now }
    );

    this.createdSessions.push(sessionId);

    return {
      id: sessionId,
      userId,
      title,
      createdAt: now,
    };
  }

  /**
   * Create a Redis session for WebSocket authentication
   *
   * @param userId - User ID to associate with session
   * @param email - User email
   * @returns Session ID and cookie string
   */
  async createSessionCookie(
    userId: string,
    email: string
  ): Promise<{ sessionId: string; cookie: string }> {
    const redis = getRedis();
    if (!redis) {
      throw new Error('Redis not initialized');
    }
    const sessionId = `${TEST_PREFIX}sess_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Session data matching express-session format
    const sessionData = JSON.stringify({
      cookie: {
        originalMaxAge: 86400000, // 24 hours
        expires: new Date(Date.now() + 86400000).toISOString(),
        httpOnly: true,
        secure: false, // Test environment
        sameSite: 'lax',
        path: '/',
      },
      microsoftOAuth: {
        userId,
        email,
        accessToken: `test_access_token_${Date.now()}`,
        refreshToken: `test_refresh_token_${Date.now()}`,
        tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour
      },
    });

    // Store in Redis with session prefix (matches express-session default)
    const redisKey = `sess:${sessionId}`;
    await redis.set(redisKey, sessionData, { EX: 86400 }); // 24 hour expiry

    this.createdRedisKeys.push(redisKey);

    // Format cookie for Socket.IO extraHeaders
    // express-session expects 's:' prefix and a valid HMAC signature
    const signature = signSessionId(sessionId, TEST_SESSION_SECRET);
    const cookie = `connect.sid=s%3A${sessionId}.${signature}`;

    return { sessionId, cookie };
  }

  /**
   * Create an expired session for testing
   *
   * @param userId - User ID
   * @param email - User email
   * @returns Expired session details
   */
  async createExpiredSession(
    userId: string,
    email: string
  ): Promise<{ sessionId: string; cookie: string }> {
    const redis = getRedis();
    if (!redis) {
      throw new Error('Redis not initialized');
    }
    const sessionId = `${TEST_PREFIX}expired_${Date.now()}`;

    // Session data with past expiry
    const sessionData = JSON.stringify({
      cookie: {
        originalMaxAge: 86400000,
        expires: new Date(Date.now() - 86400000).toISOString(), // Already expired
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
      },
      microsoftOAuth: {
        userId,
        email,
        accessToken: 'expired_token',
        refreshToken: 'expired_refresh',
        tokenExpiresAt: new Date(Date.now() - 3600000).toISOString(), // Already expired
      },
    });

    const redisKey = `sess:${sessionId}`;
    await redis.set(redisKey, sessionData, { EX: 1 }); // Very short expiry

    this.createdRedisKeys.push(redisKey);

    const signature = signSessionId(sessionId, TEST_SESSION_SECRET);
    const cookie = `connect.sid=s%3A${sessionId}.${signature}`;

    return { sessionId, cookie };
  }

  /**
   * Create a test approval request
   *
   * @param sessionId - Session ID
   * @param userId - User ID
   * @param options - Approval options
   * @returns Approval ID
   */
  async createTestApproval(
    sessionId: string,
    userId: string,
    options?: {
      toolName?: string;
      args?: Record<string, unknown>;
      status?: 'pending' | 'approved' | 'rejected' | 'expired';
    }
  ): Promise<string> {
    const approvalId = this.generateTestId();
    const toolName = options?.toolName || 'test_tool';
    const args = JSON.stringify(options?.args || { test: true });
    const status = options?.status || 'pending';

    await executeQuery(
      `INSERT INTO approvals (id, session_id, user_id, tool_name, tool_args, status, created_at, expires_at)
       VALUES (@approvalId, @sessionId, @userId, @toolName, @args, @status, GETDATE(), DATEADD(MINUTE, 5, GETDATE()))`,
      { approvalId, sessionId, userId, toolName, args, status }
    );

    return approvalId;
  }

  /**
   * Get a user by ID
   *
   * @param userId - User ID
   * @returns User data or null
   */
  async getUser(userId: string): Promise<{
    id: string;
    email: string;
    displayName: string;
  } | null> {
    const result = await executeQuery<{
      id: string;
      email: string;
      full_name: string;
    }>(
      `SELECT id, email, full_name FROM users WHERE id = @userId`,
      { userId }
    );

    if (result.recordset.length === 0) {
      return null;
    }

    const user = result.recordset[0];
    return user ? {
      id: user.id,
      email: user.email,
      displayName: user.full_name,
    } : null;
  }

  /**
   * Get messages for a session
   *
   * @param sessionId - Session ID
   * @returns Array of messages
   */
  async getSessionMessages(sessionId: string): Promise<Array<{
    id: string;
    role: string;
    content: string;
    sequenceNumber: number | null;
  }>> {
    const result = await executeQuery<{
      id: string;
      role: string;
      content: string;
      sequence_number: number | null;
    }>(
      `SELECT id, role, content, sequence_number
       FROM messages
       WHERE session_id = @sessionId
       ORDER BY COALESCE(sequence_number, 999999), created_at`,
      { sessionId }
    );

    return result.recordset.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      sequenceNumber: m.sequence_number,
    }));
  }

  /**
   * Get pending approvals for a session
   *
   * @param sessionId - Session ID
   * @returns Array of pending approvals
   */
  async getPendingApprovals(sessionId: string): Promise<Array<{
    id: string;
    toolName: string;
    status: string;
  }>> {
    const result = await executeQuery<{
      id: string;
      tool_name: string;
      status: string;
    }>(
      `SELECT id, tool_name, status
       FROM approvals
       WHERE session_id = @sessionId AND status = 'pending'`,
      { sessionId }
    );

    return result.recordset.map(a => ({
      id: a.id,
      toolName: a.tool_name,
      status: a.status,
    }));
  }

  /**
   * Verify test data exists
   *
   * @returns Summary of created test data
   */
  async verifyTestData(): Promise<{
    users: number;
    sessions: number;
    redisKeys: number;
  }> {
    const testEmailPattern = `%${TEST_EMAIL_DOMAIN}`;

    const userResult = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM users WHERE email LIKE @emailPattern`,
      { emailPattern: testEmailPattern }
    );

    const sessionResult = await executeQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM sessions WHERE user_id IN (
        SELECT id FROM users WHERE email LIKE @emailPattern
      )`,
      { emailPattern: testEmailPattern }
    );

    const redis = getRedis();
    if (!redis) {
      throw new Error('Redis not initialized');
    }
    const redisKeys = await redis.keys(`sess:${TEST_PREFIX}*`);

    return {
      users: userResult.recordset[0]?.count || 0,
      sessions: sessionResult.recordset[0]?.count || 0,
      redisKeys: redisKeys.length,
    };
  }

  /**
   * Cleanup all test data created by this factory
   *
   * Should be called in afterEach or afterAll hooks.
   */
  async cleanup(): Promise<void> {
    const redis = getRedis();
    if (!redis) {
      throw new Error('Redis not initialized');
    }

    // Clean up Redis sessions
    for (const key of this.createdRedisKeys) {
      await redis.del(key);
    }

    // Clean up database in correct order (respecting foreign keys)
    for (const sessionId of this.createdSessions) {
      // Delete message_events first
      await executeQuery(
        `DELETE FROM message_events WHERE session_id = @sessionId`,
        { sessionId }
      );

      // Delete messages
      await executeQuery(
        `DELETE FROM messages WHERE session_id = @sessionId`,
        { sessionId }
      );

      // Delete approvals
      await executeQuery(
        `DELETE FROM approvals WHERE session_id = @sessionId`,
        { sessionId }
      );

      // Delete todos
      await executeQuery(
        `DELETE FROM todos WHERE session_id = @sessionId`,
        { sessionId }
      );

      // Delete session
      await executeQuery(
        `DELETE FROM sessions WHERE id = @sessionId`,
        { sessionId }
      );
    }

    // Clean up users (after sessions due to foreign key)
    for (const userId of this.createdUsers) {
      // Delete any remaining sessions for this user
      await executeQuery(
        `DELETE FROM sessions WHERE user_id = @userId`,
        { userId }
      );

      // Delete user
      await executeQuery(
        `DELETE FROM users WHERE id = @userId`,
        { userId }
      );
    }

    // Reset tracking arrays
    this.createdUsers = [];
    this.createdSessions = [];
    this.createdRedisKeys = [];
  }

  /**
   * Get count of tracked resources
   */
  getTrackedCounts(): {
    users: number;
    sessions: number;
    redisKeys: number;
  } {
    return {
      users: this.createdUsers.length,
      sessions: this.createdSessions.length,
      redisKeys: this.createdRedisKeys.length,
    };
  }
}

/**
 * Create a test session factory
 *
 * @returns New TestSessionFactory instance
 */
export function createTestSessionFactory(): TestSessionFactory {
  return new TestSessionFactory();
}
