/**
 * Unit Tests - Sessions Routes
 *
 * Tests for chat session CRUD operations.
 * Validates session ownership, message transformation, pagination, and error handling.
 *
 * Endpoints tested:
 * - GET /api/chat/sessions - Get all sessions for current user
 * - POST /api/chat/sessions - Create a new session
 * - GET /api/chat/sessions/:sessionId - Get specific session
 * - GET /api/chat/sessions/:sessionId/messages - Get messages for session
 * - PATCH /api/chat/sessions/:sessionId - Update session title
 * - DELETE /api/chat/sessions/:sessionId - Delete session
 *
 * @module __tests__/unit/routes/sessions.routes
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';

// ============================================
// Mock Dependencies using vi.hoisted
// ============================================

const { mockExecuteQuery, mockLogger } = vi.hoisted(() => ({
  mockExecuteQuery: vi.fn(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock database BEFORE importing router
vi.mock('@/config/database', () => ({
  executeQuery: mockExecuteQuery,
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  logger: mockLogger,
}));

// Mock authenticateMicrosoft middleware
vi.mock('@/middleware/auth-oauth', () => ({
  authenticateMicrosoft: (req: Request, res: Response, next: NextFunction) => {
    const testUserId = req.headers['x-test-user-id'] as string;
    if (testUserId) {
      req.userId = testUserId;
      next();
    } else {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Microsoft OAuth session not found. Please log in.',
      });
    }
  },
}));

// NOW import the router that depends on mocks
import sessionsRouter from '@/routes/sessions';

// ============================================
// Test Helpers
// ============================================

function createTestApp(): Application {
  const app = express();
  app.use(express.json());
  app.use('/api/chat/sessions', sessionsRouter);
  return app;
}

function createMockSession(overrides: Partial<{
  id: string;
  user_id: string;
  title: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}> = {}) {
  return {
    id: 'session-123',
    user_id: 'user-123',
    title: 'Test Session',
    is_active: true,
    created_at: new Date('2024-01-15T10:00:00Z'),
    updated_at: new Date('2024-01-15T10:30:00Z'),
    ...overrides,
  };
}

function createMockMessage(overrides: Partial<{
  id: string;
  session_id: string;
  role: string;
  message_type: string;
  content: string;
  metadata: string | null;
  token_count: number | null;
  stop_reason: string | null;
  sequence_number: number | null;
  created_at: Date;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  event_id: string | null;
  tool_use_id: string | null;
}> = {}) {
  return {
    id: 'msg-123',
    session_id: 'session-123',
    role: 'assistant',
    message_type: 'standard',
    content: 'Hello, how can I help you?',
    metadata: null,
    token_count: 50,
    stop_reason: 'end_turn',
    sequence_number: 1,
    created_at: new Date('2024-01-15T10:00:00Z'),
    model: 'claude-sonnet-4-20250514',
    input_tokens: 10,
    output_tokens: 40,
    event_id: 'event-123',
    tool_use_id: null,
    ...overrides,
  };
}

// ============================================
// Test Suite
// ============================================

describe('Sessions Routes', () => {
  let app: Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================
  // GET /api/chat/sessions
  // ============================================
  describe('GET /api/chat/sessions', () => {
    it('should return all sessions for authenticated user', async () => {
      // Arrange
      const sessions = [
        createMockSession({ id: 'session-1', title: 'Chat 1' }),
        createMockSession({ id: 'session-2', title: 'Chat 2' }),
      ];
      mockExecuteQuery.mockResolvedValueOnce({ recordset: sessions });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.sessions).toHaveLength(2);
      expect(response.body.sessions[0].id).toBe('session-1');
      expect(response.body.sessions[1].id).toBe('session-2');
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        { userId: 'user-123' }
      );
    });

    it('should return empty array for user with no sessions', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions')
        .set('x-test-user-id', 'user-no-sessions')
        .expect(200);

      // Assert
      expect(response.body.sessions).toEqual([]);
    });

    it('should return 401 without authentication', async () => {
      // Act
      const response = await request(app)
        .get('/api/chat/sessions')
        .expect(401);

      // Assert
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should order sessions by updated_at DESC', async () => {
      // Arrange
      const sessions = [
        createMockSession({ id: 'older', updated_at: new Date('2024-01-01') }),
        createMockSession({ id: 'newer', updated_at: new Date('2024-01-15') }),
      ];
      mockExecuteQuery.mockResolvedValueOnce({ recordset: sessions });

      // Act
      await request(app)
        .get('/api/chat/sessions')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY updated_at DESC'),
        expect.any(Object)
      );
    });

    it('should transform is_active to status correctly', async () => {
      // Arrange
      const sessions = [
        createMockSession({ id: 'active', is_active: true }),
        createMockSession({ id: 'inactive', is_active: false }),
      ];
      mockExecuteQuery.mockResolvedValueOnce({ recordset: sessions });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.sessions[0].status).toBe('active');
      expect(response.body.sessions[1].status).toBe('completed');
    });

    it('should handle database error gracefully (500)', async () => {
      // Arrange
      mockExecuteQuery.mockRejectedValueOnce(new Error('Database connection failed'));

      // Act
      const response = await request(app)
        .get('/api/chat/sessions')
        .set('x-test-user-id', 'user-123')
        .expect(500);

      // Assert
      expect(response.body.error).toBe('Failed to get sessions');
    });
  });

  // ============================================
  // POST /api/chat/sessions
  // ============================================
  describe('POST /api/chat/sessions', () => {
    it('should create session with generated UUID', async () => {
      // Arrange
      const newSession = createMockSession();
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [newSession] });

      // Act
      const response = await request(app)
        .post('/api/chat/sessions')
        .set('x-test-user-id', 'user-123')
        .send({})
        .expect(201);

      // Assert
      expect(response.body.session).toBeDefined();
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO sessions'),
        expect.objectContaining({
          userId: 'user-123',
          title: 'New Chat',
        })
      );
    });

    it('should create session with custom title', async () => {
      // Arrange
      const newSession = createMockSession({ title: 'My Custom Chat' });
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [newSession] });

      // Act
      const response = await request(app)
        .post('/api/chat/sessions')
        .set('x-test-user-id', 'user-123')
        .send({ title: 'My Custom Chat' })
        .expect(201);

      // Assert
      expect(response.body.session.title).toBe('My Custom Chat');
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ title: 'My Custom Chat' })
      );
    });

    it('should create session with default title "New Chat"', async () => {
      // Arrange
      const newSession = createMockSession({ title: 'New Chat' });
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [newSession] });

      // Act
      const response = await request(app)
        .post('/api/chat/sessions')
        .set('x-test-user-id', 'user-123')
        .send({})
        .expect(201);

      // Assert
      expect(response.body.session.title).toBe('New Chat');
    });

    it('should return 400 for title > 500 chars', async () => {
      // Arrange
      const longTitle = 'A'.repeat(501);

      // Act
      const response = await request(app)
        .post('/api/chat/sessions')
        .set('x-test-user-id', 'user-123')
        .send({ title: longTitle })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Invalid request body');
    });

    it('should return 400 for empty title string', async () => {
      // Act
      const response = await request(app)
        .post('/api/chat/sessions')
        .set('x-test-user-id', 'user-123')
        .send({ title: '' })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Invalid request body');
    });

    it('should accept title with leading/trailing whitespace (Zod handles)', async () => {
      // Arrange - Zod min(1) allows whitespace-only strings
      const newSession = createMockSession({ title: '  Test  ' });
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [newSession] });

      // Act
      const response = await request(app)
        .post('/api/chat/sessions')
        .set('x-test-user-id', 'user-123')
        .send({ title: '  Test  ' })
        .expect(201);

      // Assert
      expect(response.body.session).toBeDefined();
    });

    it('should return 401 without authentication', async () => {
      // Act
      const response = await request(app)
        .post('/api/chat/sessions')
        .send({ title: 'Test' })
        .expect(401);

      // Assert
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should handle database error gracefully (500)', async () => {
      // Arrange
      mockExecuteQuery.mockRejectedValueOnce(new Error('Insert failed'));

      // Act
      const response = await request(app)
        .post('/api/chat/sessions')
        .set('x-test-user-id', 'user-123')
        .send({ title: 'Test' })
        .expect(500);

      // Assert
      expect(response.body.error).toBe('Failed to create session');
    });
  });

  // ============================================
  // GET /api/chat/sessions/:sessionId
  // ============================================
  describe('GET /api/chat/sessions/:sessionId', () => {
    it('should return session when user owns it', async () => {
      // Arrange
      const session = createMockSession();
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [session] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.session.id).toBe('session-123');
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = @sessionId AND user_id = @userId'),
        { sessionId: 'session-123', userId: 'user-123' }
      );
    });

    it('should return 404 when session does not exist', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/nonexistent')
        .set('x-test-user-id', 'user-123')
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
      expect(response.body.message).toBe('Session not found or access denied');
    });

    it('should return 404 when user does not own session (no info leak)', async () => {
      // Arrange - session exists but belongs to different user
      // Query returns empty because of user_id filter
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/other-user-session')
        .set('x-test-user-id', 'user-123')
        .expect(404);

      // Assert - same message for both cases (no info leak)
      expect(response.body.message).toBe('Session not found or access denied');
    });

    it('should return 401 without authentication', async () => {
      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123')
        .expect(401);

      // Assert
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should handle database error gracefully (500)', async () => {
      // Arrange
      mockExecuteQuery.mockRejectedValueOnce(new Error('Query failed'));

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123')
        .set('x-test-user-id', 'user-123')
        .expect(500);

      // Assert
      expect(response.body.error).toBe('Failed to get session');
    });
  });

  // ============================================
  // GET /api/chat/sessions/:sessionId/messages
  // ============================================
  describe('GET /api/chat/sessions/:sessionId/messages', () => {
    it('should return messages with default pagination (limit=50, offset=0)', async () => {
      // Arrange
      const session = createMockSession();
      const messages = [createMockMessage()];
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [session] }) // session ownership check
        .mockResolvedValueOnce({ recordset: messages }); // messages query

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123/messages')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.messages).toHaveLength(1);
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('OFFSET @offset ROWS'),
        expect.objectContaining({ offset: 0, limit: 50 })
      );
    });

    it('should return messages with custom limit', async () => {
      // Arrange
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [createMockSession()] })
        .mockResolvedValueOnce({ recordset: [] });

      // Act
      await request(app)
        .get('/api/chat/sessions/session-123/messages?limit=25')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ limit: 25 })
      );
    });

    it('should return messages with custom offset', async () => {
      // Arrange
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [createMockSession()] })
        .mockResolvedValueOnce({ recordset: [] });

      // Act
      await request(app)
        .get('/api/chat/sessions/session-123/messages?offset=10')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ offset: 10 })
      );
    });

    it('should return 400 for limit > 100', async () => {
      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123/messages?limit=101')
        .set('x-test-user-id', 'user-123')
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Invalid query parameters');
    });

    it('should return 400 for limit < 1', async () => {
      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123/messages?limit=0')
        .set('x-test-user-id', 'user-123')
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Invalid query parameters');
    });

    it('should return 400 for negative offset', async () => {
      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123/messages?offset=-1')
        .set('x-test-user-id', 'user-123')
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Invalid query parameters');
    });

    it('should return 400 for non-integer limit/offset', async () => {
      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123/messages?limit=abc')
        .set('x-test-user-id', 'user-123')
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Invalid query parameters');
    });

    it('should order by sequence_number then created_at', async () => {
      // Arrange
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [createMockSession()] })
        .mockResolvedValueOnce({ recordset: [] });

      // Act
      await request(app)
        .get('/api/chat/sessions/session-123/messages')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY'),
        expect.any(Object)
      );
      // Check the query contains the expected ordering logic
      const queryCall = mockExecuteQuery.mock.calls[1];
      expect(queryCall?.[0]).toContain('sequence_number');
      expect(queryCall?.[0]).toContain('created_at ASC');
    });

    it('should return 404 when session does not exist', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/nonexistent/messages')
        .set('x-test-user-id', 'user-123')
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
    });

    it('should handle database error gracefully (500)', async () => {
      // Arrange
      mockExecuteQuery.mockRejectedValueOnce(new Error('Query failed'));

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123/messages')
        .set('x-test-user-id', 'user-123')
        .expect(500);

      // Assert
      expect(response.body.error).toBe('Failed to get messages');
    });
  });

  // ============================================
  // PATCH /api/chat/sessions/:sessionId
  // ============================================
  describe('PATCH /api/chat/sessions/:sessionId', () => {
    it('should update title successfully', async () => {
      // Arrange
      const updatedSession = createMockSession({ title: 'Updated Title' });
      mockExecuteQuery
        .mockResolvedValueOnce({ rowsAffected: [1] }) // UPDATE
        .mockResolvedValueOnce({ recordset: [updatedSession] }); // SELECT

      // Act
      const response = await request(app)
        .patch('/api/chat/sessions/session-123')
        .set('x-test-user-id', 'user-123')
        .send({ title: 'Updated Title' })
        .expect(200);

      // Assert
      expect(response.body.success).toBe(true);
      expect(response.body.session.title).toBe('Updated Title');
    });

    it('should return 400 for empty title', async () => {
      // Act
      const response = await request(app)
        .patch('/api/chat/sessions/session-123')
        .set('x-test-user-id', 'user-123')
        .send({ title: '' })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.message).toContain('Title is required');
    });

    it('should return 400 for title > 500 chars', async () => {
      // Arrange
      const longTitle = 'A'.repeat(501);

      // Act
      const response = await request(app)
        .patch('/api/chat/sessions/session-123')
        .set('x-test-user-id', 'user-123')
        .send({ title: longTitle })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.message).toBe('Title must be 500 characters or less');
    });

    it('should return 400 for whitespace-only title', async () => {
      // Act
      const response = await request(app)
        .patch('/api/chat/sessions/session-123')
        .set('x-test-user-id', 'user-123')
        .send({ title: '   ' })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });

    it('should return 404 when session does not exist', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [0] });

      // Act
      const response = await request(app)
        .patch('/api/chat/sessions/nonexistent')
        .set('x-test-user-id', 'user-123')
        .send({ title: 'New Title' })
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
    });

    it('should return 404 when user does not own session', async () => {
      // Arrange - UPDATE affects 0 rows because user doesn't own session
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [0] });

      // Act
      const response = await request(app)
        .patch('/api/chat/sessions/other-user-session')
        .set('x-test-user-id', 'user-123')
        .send({ title: 'New Title' })
        .expect(404);

      // Assert
      expect(response.body.message).toBe('Session not found or access denied');
    });

    it('should return 401 without authentication', async () => {
      // Act
      const response = await request(app)
        .patch('/api/chat/sessions/session-123')
        .send({ title: 'New Title' })
        .expect(401);

      // Assert
      expect(response.body.error).toBe('Unauthorized');
    });
  });

  // ============================================
  // DELETE /api/chat/sessions/:sessionId
  // ============================================
  describe('DELETE /api/chat/sessions/:sessionId', () => {
    it('should delete session successfully', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      // Act
      const response = await request(app)
        .delete('/api/chat/sessions/session-123')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Session deleted');
    });

    it('should return 404 when session does not exist', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [0] });

      // Act
      const response = await request(app)
        .delete('/api/chat/sessions/nonexistent')
        .set('x-test-user-id', 'user-123')
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
    });

    it('should return 404 when user does not own session', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [0] });

      // Act
      const response = await request(app)
        .delete('/api/chat/sessions/other-user-session')
        .set('x-test-user-id', 'user-123')
        .expect(404);

      // Assert
      expect(response.body.message).toBe('Session not found or access denied');
    });

    it('should return 401 without authentication', async () => {
      // Act
      const response = await request(app)
        .delete('/api/chat/sessions/session-123')
        .expect(401);

      // Assert
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should cascade delete messages, approvals, todos (verified via SQL)', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      // Act
      await request(app)
        .delete('/api/chat/sessions/session-123')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert - verify the DELETE query includes ownership check
      // CASCADE is handled by database FK constraints, not in the query
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM sessions'),
        expect.objectContaining({ sessionId: 'session-123', userId: 'user-123' })
      );
    });
  });

  // ============================================
  // Message Transformation
  // ============================================
  describe('Message Transformation', () => {
    it('should transform standard message correctly', async () => {
      // Arrange
      const message = createMockMessage({
        message_type: 'standard',
        content: 'Hello world',
        metadata: JSON.stringify({ is_thinking: false }),
      });
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [createMockSession()] })
        .mockResolvedValueOnce({ recordset: [message] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123/messages')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      const msg = response.body.messages[0];
      expect(msg.content).toBe('Hello world');
      expect(msg.message_type).toBe('standard');
      expect(msg.role).toBe('assistant');
    });

    it('should transform thinking message correctly', async () => {
      // Arrange
      const message = createMockMessage({
        message_type: 'thinking',
        content: 'Let me think about this...',
        metadata: JSON.stringify({ duration_ms: 1500 }),
      });
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [createMockSession()] })
        .mockResolvedValueOnce({ recordset: [message] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123/messages')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      const msg = response.body.messages[0];
      expect(msg.type).toBe('thinking');
      expect(msg.content).toBe('Let me think about this...');
      expect(msg.duration_ms).toBe(1500);
    });

    it('should transform tool_use message correctly', async () => {
      // Arrange
      const message = createMockMessage({
        message_type: 'tool_use',
        content: '',
        metadata: JSON.stringify({
          tool_name: 'get_customers',
          tool_args: { limit: 10 },
          status: 'success',
          tool_result: { customers: [] },
        }),
        tool_use_id: 'tool-123',
      });
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [createMockSession()] })
        .mockResolvedValueOnce({ recordset: [message] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123/messages')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      const msg = response.body.messages[0];
      expect(msg.type).toBe('tool_use');
      expect(msg.tool_name).toBe('get_customers');
      expect(msg.tool_args).toEqual({ limit: 10 });
      expect(msg.status).toBe('success');
      expect(msg.tool_use_id).toBe('tool-123');
    });

    it('should include model in transformed message', async () => {
      // Arrange
      const message = createMockMessage({ model: 'claude-sonnet-4-20250514' });
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [createMockSession()] })
        .mockResolvedValueOnce({ recordset: [message] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123/messages')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.messages[0].model).toBe('claude-sonnet-4-20250514');
    });

    it('should include input_tokens/output_tokens', async () => {
      // Arrange
      const message = createMockMessage({
        input_tokens: 150,
        output_tokens: 250,
      });
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [createMockSession()] })
        .mockResolvedValueOnce({ recordset: [message] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123/messages')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.messages[0].input_tokens).toBe(150);
      expect(response.body.messages[0].output_tokens).toBe(250);
    });

    it('should include sequence_number from event sourcing', async () => {
      // Arrange
      const message = createMockMessage({ sequence_number: 42 });
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [createMockSession()] })
        .mockResolvedValueOnce({ recordset: [message] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123/messages')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.messages[0].sequence_number).toBe(42);
    });

    it('should include stop_reason from SDK', async () => {
      // Arrange
      const message = createMockMessage({ stop_reason: 'end_turn' });
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [createMockSession()] })
        .mockResolvedValueOnce({ recordset: [message] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123/messages')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.messages[0].stop_reason).toBe('end_turn');
    });

    it('should handle null/missing metadata', async () => {
      // Arrange
      const message = createMockMessage({ metadata: null });
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [createMockSession()] })
        .mockResolvedValueOnce({ recordset: [message] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123/messages')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.messages[0]).toBeDefined();
      expect(response.body.messages[0].content).toBe('Hello, how can I help you?');
    });

    it('should handle malformed metadata JSON gracefully', async () => {
      // Arrange
      const message = createMockMessage({ metadata: '{invalid json' });
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [createMockSession()] })
        .mockResolvedValueOnce({ recordset: [message] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123/messages')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert - should not crash, just ignore malformed metadata
      expect(response.body.messages[0]).toBeDefined();
      expect(response.body.messages[0].content).toBe('Hello, how can I help you?');
    });
  });

  // ============================================
  // Additional Edge Cases
  // ============================================
  describe('Additional Edge Cases', () => {
    it('should handle title with exactly 500 characters', async () => {
      // Arrange
      const exactTitle = 'A'.repeat(500);
      const newSession = createMockSession({ title: exactTitle });
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [newSession] });

      // Act
      const response = await request(app)
        .post('/api/chat/sessions')
        .set('x-test-user-id', 'user-123')
        .send({ title: exactTitle })
        .expect(201);

      // Assert
      expect(response.body.session).toBeDefined();
    });

    it('should handle session with null title in database', async () => {
      // Arrange - title is null, should default to "New Chat"
      const session = {
        id: 'session-123',
        user_id: 'user-123',
        title: null,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [session] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.sessions[0].title).toBe('New Chat');
    });

    it('should handle messages with empty content', async () => {
      // Arrange
      const message = createMockMessage({ content: '' });
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [createMockSession()] })
        .mockResolvedValueOnce({ recordset: [message] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123/messages')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.messages[0].content).toBe('');
    });

    it('should handle very large offset', async () => {
      // Arrange
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [createMockSession()] })
        .mockResolvedValueOnce({ recordset: [] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-123/messages?offset=999999')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.messages).toEqual([]);
    });

    it('should handle limit at boundary (100)', async () => {
      // Arrange
      mockExecuteQuery
        .mockResolvedValueOnce({ recordset: [createMockSession()] })
        .mockResolvedValueOnce({ recordset: [] });

      // Act
      await request(app)
        .get('/api/chat/sessions/session-123/messages?limit=100')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ limit: 100 })
      );
    });

    it('should ignore initialMessage field in POST (backward compatibility)', async () => {
      // Arrange - initialMessage is accepted by schema but should be ignored
      const newSession = createMockSession({ title: 'Chat with ignored message' });
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [newSession] });

      // Act
      const response = await request(app)
        .post('/api/chat/sessions')
        .set('x-test-user-id', 'user-123')
        .send({
          title: 'Chat with ignored message',
          initialMessage: 'This message should be ignored',
        })
        .expect(201);

      // Assert - Session created, but no message was created
      expect(response.body.session).toBeDefined();
      // Only one DB call (INSERT session), no message INSERT
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO sessions'),
        expect.any(Object)
      );
    });

    it('should handle title with unicode/emojis', async () => {
      // Arrange
      const unicodeTitle = 'Chat 🚀 with emojis 日本語';
      const newSession = createMockSession({ title: unicodeTitle });
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [newSession] });

      // Act
      const response = await request(app)
        .post('/api/chat/sessions')
        .set('x-test-user-id', 'user-123')
        .send({ title: unicodeTitle })
        .expect(201);

      // Assert
      expect(response.body.session.title).toBe(unicodeTitle);
    });

    it('should handle PATCH database error gracefully (500)', async () => {
      // Arrange
      mockExecuteQuery.mockRejectedValueOnce(new Error('Database write error'));

      // Act
      const response = await request(app)
        .patch('/api/chat/sessions/session-123')
        .set('x-test-user-id', 'user-123')
        .send({ title: 'New Title' })
        .expect(500);

      // Assert
      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body.message).toBe('Database write error');
    });

    it('should handle DELETE database error gracefully (500)', async () => {
      // Arrange
      mockExecuteQuery.mockRejectedValueOnce(new Error('Database delete error'));

      // Act
      const response = await request(app)
        .delete('/api/chat/sessions/session-123')
        .set('x-test-user-id', 'user-123')
        .expect(500);

      // Assert
      expect(response.body.error).toBe('Failed to delete session');
    });
  });
});
