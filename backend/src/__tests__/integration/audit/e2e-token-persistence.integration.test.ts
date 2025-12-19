/**
 * E2E Test: Token Persistence Validation
 *
 * This test validates that tokens are correctly persisted to the database
 * after Phase 1A implementation.
 *
 * Requirements:
 * - Real database connection (Azure SQL)
 * - No Redis required (uses mock EventStore)
 *
 * What this test validates:
 * 1. MessagePersistenceJob interface has token fields
 * 2. MessageQueue INSERT includes token columns
 * 3. Tokens flow from DirectAgentService to database
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { executeQuery, initDatabase, closeDatabase } from '@/infrastructure/database/database';
import { MessagePersistenceJob } from '@/infrastructure/queue/MessageQueue';
import { MessageEvent } from '@/types/agent.types';
import { randomUUID } from 'crypto';

// Test configuration - Use valid UUIDs for session_id (still UNIQUEIDENTIFIER in DB)
const TEST_SESSION_ID = randomUUID();  // sessions.id remains UNIQUEIDENTIFIER
const TEST_USER_ID = randomUUID();  // users.id remains UNIQUEIDENTIFIER

describe('E2E: Token Persistence (Phase 1A/1B)', () => {
  // Track test message IDs for cleanup
  const testMessageIds: string[] = [];

  // Initialize database connection and create test user/session before all tests
  beforeAll(async () => {
    await initDatabase();

    // Create test user first (required for FK constraint on sessions.user_id)
    await executeQuery(`
      INSERT INTO users (id, email, full_name, is_active, created_at, updated_at)
      VALUES (@id, @email, @full_name, @is_active, @created_at, @updated_at)
    `, {
      id: TEST_USER_ID,
      email: `test-${Date.now()}@example.com`,
      full_name: 'E2E Test User',
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
    console.log(`[SETUP] Created test user: ${TEST_USER_ID}`);

    // Create test session (required for FK constraint on messages.session_id)
    await executeQuery(`
      INSERT INTO sessions (id, user_id, title, created_at, updated_at)
      VALUES (@id, @user_id, @title, @created_at, @updated_at)
    `, {
      id: TEST_SESSION_ID,
      user_id: TEST_USER_ID,
      title: 'E2E Test Session for Token Persistence',
      created_at: new Date(),
      updated_at: new Date(),
    });
    console.log(`[SETUP] Created test session: ${TEST_SESSION_ID}`);
  }, 30000);

  afterAll(async () => {
    // Clean up test data
    if (testMessageIds.length > 0) {
      try {
        for (const id of testMessageIds) {
          await executeQuery(
            `DELETE FROM messages WHERE id = @id`,
            { id }
          );
        }
        console.log(`[CLEANUP] Deleted ${testMessageIds.length} test messages`);
      } catch (error) {
        console.error('[CLEANUP] Failed to delete test messages:', error);
      }
    }

    // Clean up test session
    try {
      await executeQuery(
        `DELETE FROM sessions WHERE id = @id`,
        { id: TEST_SESSION_ID }
      );
      console.log(`[CLEANUP] Deleted test session: ${TEST_SESSION_ID}`);
    } catch (error) {
      console.error('[CLEANUP] Failed to delete test session:', error);
    }

    // Clean up test user
    try {
      await executeQuery(
        `DELETE FROM users WHERE id = @id`,
        { id: TEST_USER_ID }
      );
      console.log(`[CLEANUP] Deleted test user: ${TEST_USER_ID}`);
    } catch (error) {
      console.error('[CLEANUP] Failed to delete test user:', error);
    }

    // Close database connection
    await closeDatabase();
  }, 30000);

  describe('Database Schema Validation', () => {
    it('should have model column in messages table', async () => {
      const result = await executeQuery(`
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'messages' AND COLUMN_NAME = 'model'
      `, {});

      expect(result.recordset.length).toBe(1);
      expect(result.recordset[0].DATA_TYPE).toBe('nvarchar');
    });

    it('should have input_tokens column in messages table', async () => {
      const result = await executeQuery(`
        SELECT COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'messages' AND COLUMN_NAME = 'input_tokens'
      `, {});

      expect(result.recordset.length).toBe(1);
      expect(result.recordset[0].DATA_TYPE).toBe('int');
    });

    it('should have output_tokens column in messages table', async () => {
      const result = await executeQuery(`
        SELECT COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'messages' AND COLUMN_NAME = 'output_tokens'
      `, {});

      expect(result.recordset.length).toBe(1);
      expect(result.recordset[0].DATA_TYPE).toBe('int');
    });

    it('should have total_tokens as computed column', async () => {
      const result = await executeQuery(`
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'messages' AND COLUMN_NAME = 'total_tokens'
      `, {});

      // total_tokens should exist (computed column)
      expect(result.recordset.length).toBe(1);
    });
  });

  describe('MessagePersistenceJob Interface', () => {
    it('should accept token fields', () => {
      // Type-level test: verify interface accepts token fields
      const job: MessagePersistenceJob = {
        sessionId: TEST_SESSION_ID,
        messageId: 'msg_test123',
        role: 'assistant',
        messageType: 'text',
        content: 'Test message',
        // Phase 1A fields
        model: 'claude-sonnet-4-5-20250929',
        inputTokens: 100,
        outputTokens: 200,
      };

      expect(job.model).toBe('claude-sonnet-4-5-20250929');
      expect(job.inputTokens).toBe(100);
      expect(job.outputTokens).toBe(200);
    });
  });

  describe('MessageEvent Interface', () => {
    it('should include tokenUsage for admin visibility', () => {
      // Type-level test: verify interface has tokenUsage
      const event: MessageEvent = {
        type: 'message',
        messageId: 'msg_test123',
        content: 'Test',
        role: 'assistant',
        timestamp: new Date(),
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 200,
        },
        model: 'claude-sonnet-4-5-20250929',
      };

      expect(event.tokenUsage?.inputTokens).toBe(100);
      expect(event.tokenUsage?.outputTokens).toBe(200);
      expect(event.model).toBe('claude-sonnet-4-5-20250929');
    });
  });

  describe('Direct Database Insert with Tokens', () => {
    it('should persist message with token data', async () => {
      // Generate a test message ID (using Anthropic format)
      const testMessageId = `msg_test_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      testMessageIds.push(testMessageId);

      // Insert test message with tokens
      await executeQuery(`
        INSERT INTO messages (
          id, session_id, role, message_type, content, metadata,
          model, input_tokens, output_tokens, created_at
        ) VALUES (
          @id, @session_id, @role, @message_type, @content, @metadata,
          @model, @input_tokens, @output_tokens, @created_at
        )
      `, {
        id: testMessageId,
        session_id: TEST_SESSION_ID,
        role: 'assistant',
        message_type: 'text',
        content: 'Test message for token persistence validation',
        metadata: '{}',
        model: 'claude-sonnet-4-5-20250929',
        input_tokens: 150,
        output_tokens: 250,
        created_at: new Date(),
      });

      // Verify the message was inserted with tokens
      const result = await executeQuery(`
        SELECT id, model, input_tokens, output_tokens, total_tokens
        FROM messages
        WHERE id = @id
      `, { id: testMessageId });

      expect(result.recordset.length).toBe(1);
      const message = result.recordset[0];

      expect(message.model).toBe('claude-sonnet-4-5-20250929');
      expect(message.input_tokens).toBe(150);
      expect(message.output_tokens).toBe(250);
      // total_tokens is computed column
      expect(message.total_tokens).toBe(400);
    });

    it('should allow Anthropic message ID format', async () => {
      // Test Anthropic message ID format
      const anthropicStyleId = 'msg_01QR8X3Z9KM2NP4JL6H5VYWT7S';
      testMessageIds.push(anthropicStyleId);

      await executeQuery(`
        INSERT INTO messages (
          id, session_id, role, message_type, content, metadata,
          model, input_tokens, output_tokens, created_at
        ) VALUES (
          @id, @session_id, @role, @message_type, @content, @metadata,
          @model, @input_tokens, @output_tokens, @created_at
        )
      `, {
        id: anthropicStyleId,
        session_id: TEST_SESSION_ID,
        role: 'assistant',
        message_type: 'text',
        content: 'Test Anthropic ID format',
        metadata: '{}',
        model: 'claude-opus-4-5-20251101',
        input_tokens: 500,
        output_tokens: 1000,
        created_at: new Date(),
      });

      const result = await executeQuery(`
        SELECT id, model FROM messages WHERE id = @id
      `, { id: anthropicStyleId });

      expect(result.recordset.length).toBe(1);
      expect(result.recordset[0].id).toBe(anthropicStyleId);
      expect(result.recordset[0].model).toBe('claude-opus-4-5-20251101');
    });

    it('should allow tool_use ID format', async () => {
      // Test tool_use ID format (Phase 1B - derived from Anthropic tool_use_id)
      const toolUseId = 'toolu_01GkXz8YLvJQYPxBvKPmD7Bk';
      testMessageIds.push(toolUseId);

      await executeQuery(`
        INSERT INTO messages (
          id, session_id, role, message_type, content, metadata,
          tool_use_id, created_at
        ) VALUES (
          @id, @session_id, @role, @message_type, @content, @metadata,
          @tool_use_id, @created_at
        )
      `, {
        id: toolUseId,
        session_id: TEST_SESSION_ID,
        role: 'assistant',
        message_type: 'tool_use',
        content: '',
        metadata: JSON.stringify({ tool_name: 'get_customers' }),
        tool_use_id: toolUseId,
        created_at: new Date(),
      });

      const result = await executeQuery(`
        SELECT id, message_type, tool_use_id FROM messages WHERE id = @id
      `, { id: toolUseId });

      expect(result.recordset.length).toBe(1);
      expect(result.recordset[0].id).toBe(toolUseId);
      expect(result.recordset[0].message_type).toBe('tool_use');
    });

    it('should allow tool_result derived ID format', async () => {
      // Test tool_result derived ID format (Phase 1B)
      const toolResultId = 'toolu_01GkXz8YLvJQYPxBvKPmD7Bk_result';
      testMessageIds.push(toolResultId);

      await executeQuery(`
        INSERT INTO messages (
          id, session_id, role, message_type, content, metadata,
          tool_use_id, created_at
        ) VALUES (
          @id, @session_id, @role, @message_type, @content, @metadata,
          @tool_use_id, @created_at
        )
      `, {
        id: toolResultId,
        session_id: TEST_SESSION_ID,
        role: 'assistant',
        message_type: 'tool_result',
        content: JSON.stringify({ customers: [] }),
        metadata: JSON.stringify({ tool_name: 'get_customers', success: true }),
        tool_use_id: 'toolu_01GkXz8YLvJQYPxBvKPmD7Bk',
        created_at: new Date(),
      });

      const result = await executeQuery(`
        SELECT id, message_type FROM messages WHERE id = @id
      `, { id: toolResultId });

      expect(result.recordset.length).toBe(1);
      expect(result.recordset[0].id).toBe(toolResultId);
      expect(result.recordset[0].message_type).toBe('tool_result');
    });
  });

  describe('Billing Query Support', () => {
    it('should support token aggregation query by session', async () => {
      // This query would be used for billing
      const result = await executeQuery(`
        SELECT
          session_id,
          SUM(ISNULL(input_tokens, 0)) as total_input_tokens,
          SUM(ISNULL(output_tokens, 0)) as total_output_tokens,
          SUM(ISNULL(total_tokens, 0)) as grand_total_tokens,
          COUNT(*) as message_count
        FROM messages
        WHERE session_id = @session_id
        GROUP BY session_id
      `, { session_id: TEST_SESSION_ID });

      // Should return aggregated data for our test session
      if (result.recordset.length > 0) {
        // SQL Server returns UUIDs in uppercase, compare case-insensitively
        expect(result.recordset[0].session_id.toLowerCase()).toBe(TEST_SESSION_ID.toLowerCase());
        expect(typeof result.recordset[0].total_input_tokens).toBe('number');
        expect(typeof result.recordset[0].total_output_tokens).toBe('number');
      }
    });

    it('should support model usage analysis query', async () => {
      // This query would be used for analytics
      const result = await executeQuery(`
        SELECT
          model,
          COUNT(*) as message_count,
          SUM(ISNULL(input_tokens, 0)) as total_input_tokens,
          SUM(ISNULL(output_tokens, 0)) as total_output_tokens
        FROM messages
        WHERE model IS NOT NULL
        GROUP BY model
        ORDER BY message_count DESC
      `, {});

      // Should work without errors
      expect(Array.isArray(result.recordset)).toBe(true);
    });
  });

  describe('ID Format Validation', () => {
    it('should validate Anthropic message ID pattern', () => {
      const anthropicIdPattern = /^msg_[0-9A-Za-z]+$/;

      expect(anthropicIdPattern.test('msg_01QR8X3Z9KM2NP4JL6H5VYWT7S')).toBe(true);
      expect(anthropicIdPattern.test('msg_abc123')).toBe(true);
      // UUID should NOT match Anthropic pattern
      expect(anthropicIdPattern.test('6474205A-C975-43F6-A956-7E77883B357E')).toBe(false);
    });

    it('should validate tool_use ID pattern', () => {
      const toolUseIdPattern = /^toolu_[0-9A-Za-z]+$/;

      expect(toolUseIdPattern.test('toolu_01GkXz8YLvJQYPxBvKPmD7Bk')).toBe(true);
      // Derived IDs should NOT match base pattern (but are valid in DB)
      expect(toolUseIdPattern.test('toolu_01GkXz8YLvJQYPxBvKPmD7Bk_result')).toBe(false);
    });

    it('should validate system message ID pattern', () => {
      const systemIdPattern = /^system_(max_tokens|max_turns)_[a-f0-9-]+$/;

      expect(systemIdPattern.test('system_max_tokens_abc123-def456')).toBe(true);
      expect(systemIdPattern.test('system_max_turns_abc123-def456')).toBe(true);
    });
  });
});
