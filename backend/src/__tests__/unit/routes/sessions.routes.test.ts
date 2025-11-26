/**
 * Unit Tests - Sessions Routes
 *
 * Tests for the sessions API endpoints (CRUD operations).
 * Uses supertest for HTTP endpoint testing with mocked dependencies.
 *
 * @module __tests__/unit/routes/sessions.routes
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';
import sessionsRouter from '@/routes/sessions';
import { executeQuery } from '@/config/database';
import crypto from 'crypto';

// Mock dependencies
vi.mock('@/config/database', () => ({
  executeQuery: vi.fn()
}));

vi.mock('crypto', () => ({
  default: {
    randomUUID: vi.fn()
  }
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

// Mock auth middleware
vi.mock('@/middleware/auth-oauth', () => ({
  authenticateMicrosoft: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    // Set userId from test
    req.userId = (req as Express.Request & { testUserId?: string }).testUserId || 'test-user-123';
    next();
  }
}));

describe('Sessions Routes', () => {
  let app: Application;
  let mockExecuteQuery: Mock;
  let mockRandomUUID: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup Express app with router
    app = express();
    app.use(express.json());

    // Add middleware to inject test userId
    app.use((req, _res, next) => {
      (req as Express.Request & { testUserId?: string }).testUserId = 'test-user-123';
      next();
    });

    app.use('/api/chat/sessions', sessionsRouter);

    mockExecuteQuery = executeQuery as Mock;
    mockRandomUUID = crypto.randomUUID as Mock;
  });

  describe('GET /api/chat/sessions', () => {
    it('should return all sessions for authenticated user', async () => {
      // Arrange
      const mockSessions = [
        {
          id: 'session-1',
          user_id: 'test-user-123',
          title: 'Chat Session 1',
          is_active: true,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-02')
        },
        {
          id: 'session-2',
          user_id: 'test-user-123',
          title: 'Chat Session 2',
          is_active: false,
          created_at: new Date('2024-01-03'),
          updated_at: new Date('2024-01-04')
        }
      ];

      mockExecuteQuery.mockResolvedValueOnce({ recordset: mockSessions });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions')
        .expect(200);

      // Assert
      expect(response.body.sessions).toHaveLength(2);
      expect(response.body.sessions[0]).toMatchObject({
        id: 'session-1',
        user_id: 'test-user-123',
        title: 'Chat Session 1',
        status: 'active'
      });
      expect(response.body.sessions[1]).toMatchObject({
        id: 'session-2',
        status: 'completed' // is_active: false → completed
      });
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        { userId: 'test-user-123' }
      );
    });

    it('should return empty array when user has no sessions', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions')
        .expect(200);

      // Assert
      expect(response.body.sessions).toEqual([]);
    });

    // Note: Authentication tests moved to integration tests
    // Unit tests focus on business logic with mocked auth

    it('should return 500 on database error', async () => {
      // Arrange
      mockExecuteQuery.mockRejectedValueOnce(new Error('Database connection lost'));

      // Act
      const response = await request(app)
        .get('/api/chat/sessions')
        .expect(500);

      // Assert - sendError format: { error: HTTP_STATUS_NAME, message: CUSTOM_MESSAGE, code: ERROR_CODE }
      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body.message).toBe('Failed to get sessions');
    });
  });

  describe('POST /api/chat/sessions', () => {
    it('should create a new session with provided title', async () => {
      // Arrange
      const mockSessionId = 'new-session-123';
      mockRandomUUID.mockReturnValueOnce(mockSessionId);

      const mockCreatedSession = {
        id: mockSessionId,
        user_id: 'test-user-123',
        title: 'My Custom Title',
        is_active: true,
        created_at: new Date('2024-01-05'),
        updated_at: new Date('2024-01-05')
      };

      mockExecuteQuery.mockResolvedValueOnce({ recordset: [mockCreatedSession] });

      // Act
      const response = await request(app)
        .post('/api/chat/sessions')
        .send({ title: 'My Custom Title' })
        .expect(201);

      // Assert
      expect(response.body.session).toMatchObject({
        id: mockSessionId,
        user_id: 'test-user-123',
        title: 'My Custom Title',
        status: 'active'
      });
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO sessions'),
        expect.objectContaining({
          sessionId: mockSessionId,
          userId: 'test-user-123',
          title: 'My Custom Title'
        })
      );
    });

    it('should create session with default title when not provided', async () => {
      // Arrange
      const mockSessionId = 'new-session-456';
      mockRandomUUID.mockReturnValueOnce(mockSessionId);

      const mockCreatedSession = {
        id: mockSessionId,
        user_id: 'test-user-123',
        title: 'New Chat',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      };

      mockExecuteQuery.mockResolvedValueOnce({ recordset: [mockCreatedSession] });

      // Act
      const response = await request(app)
        .post('/api/chat/sessions')
        .send({})
        .expect(201);

      // Assert
      expect(response.body.session.title).toBe('New Chat');
    });

    it('should return 400 when title exceeds 500 characters', async () => {
      // Arrange
      const longTitle = 'a'.repeat(501);

      // Act
      const response = await request(app)
        .post('/api/chat/sessions')
        .send({ title: longTitle })
        .expect(400);

      // Assert - sendError format: { error: HTTP_STATUS_NAME, message: CUSTOM_MESSAGE }
      expect(response.body.error).toBe('Bad Request');
    });

    // Note: Authentication tests moved to integration tests

    it('should return 500 when database insert fails', async () => {
      // Arrange
      mockRandomUUID.mockReturnValueOnce('failing-session');
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] }); // Empty result

      // Act
      const response = await request(app)
        .post('/api/chat/sessions')
        .send({ title: 'Test' })
        .expect(500);

      // Assert - sendError format: { error: HTTP_STATUS_NAME, message: CUSTOM_MESSAGE }
      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body.message).toBe('Failed to create session');
    });
  });

  describe('GET /api/chat/sessions/:sessionId', () => {
    it('should return specific session when user owns it', async () => {
      // Arrange
      const mockSession = {
        id: 'session-specific',
        user_id: 'test-user-123',
        title: 'Specific Session',
        is_active: true,
        created_at: new Date('2024-01-10'),
        updated_at: new Date('2024-01-10')
      };

      mockExecuteQuery.mockResolvedValueOnce({ recordset: [mockSession] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-specific')
        .expect(200);

      // Assert
      expect(response.body.session).toMatchObject({
        id: 'session-specific',
        user_id: 'test-user-123',
        title: 'Specific Session'
      });
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = @sessionId AND user_id = @userId'),
        { sessionId: 'session-specific', userId: 'test-user-123' }
      );
    });

    it('should return 404 when session does not exist', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/nonexistent-session')
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
      expect(response.body.message).toBe('Session not found or access denied');
    });

    it('should return 404 when user does not own the session', async () => {
      // Arrange - Session belongs to different user
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] }); // No results due to ownership check

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/other-user-session')
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
    });

    // Note: Authentication tests moved to integration tests
  });

  describe('GET /api/chat/sessions/:sessionId/messages', () => {
    it('should return messages for a session with default pagination', async () => {
      // Arrange
      // First query: verify session ownership
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{ id: 'session-msgs' }]
      });

      // Second query: get messages
      const mockMessages = [
        {
          id: 'msg-1',
          session_id: 'session-msgs',
          role: 'user',
          message_type: 'standard',
          content: 'Hello',
          metadata: null,
          stop_reason: null,
          token_count: 5,
          created_at: new Date('2024-01-15T10:00:00Z')
        },
        {
          id: 'msg-2',
          session_id: 'session-msgs',
          role: 'assistant',
          message_type: 'standard',
          content: 'Hi there!',
          metadata: null,
          stop_reason: 'end_turn',
          token_count: 10,
          created_at: new Date('2024-01-15T10:00:05Z')
        }
      ];

      mockExecuteQuery.mockResolvedValueOnce({ recordset: mockMessages });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-msgs/messages')
        .expect(200);

      // Assert
      expect(response.body.messages).toHaveLength(2);
      expect(response.body.messages[0]).toMatchObject({
        id: 'msg-1',
        role: 'user',
        message_type: 'standard',
        content: 'Hello'
      });
      expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
      expect(mockExecuteQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('OFFSET @offset ROWS'),
        expect.objectContaining({ sessionId: 'session-msgs', offset: 0, limit: 50 })
      );
    });

    it('should handle custom pagination parameters', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [{ id: 'session-page' }] });
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-page/messages?limit=10&offset=5')
        .expect(200);

      // Assert
      expect(mockExecuteQuery).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({ limit: 10, offset: 5 })
      );
    });

    it('should return 400 when pagination params are invalid', async () => {
      // Act
      const response = await request(app)
        .get('/api/chat/sessions/any/messages?limit=invalid')
        .expect(400);

      // Assert - sendError format: { error: HTTP_STATUS_NAME, message: CUSTOM_MESSAGE }
      expect(response.body.error).toBe('Bad Request');
    });

    it('should return 404 when session does not exist or user lacks access', async () => {
      // Arrange - Session ownership check fails
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/no-access-session/messages')
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
      expect(response.body.message).toBe('Session not found or access denied');
    });

    it('should handle thinking and tool_use message types', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [{ id: 'session-types' }] });

      const mockMessages = [
        {
          id: 'msg-thinking',
          session_id: 'session-types',
          role: 'assistant',
          message_type: 'thinking',
          content: 'Let me think about this...',  // Content is in content column, not metadata
          metadata: JSON.stringify({ duration_ms: 1500 }),
          stop_reason: null,
          token_count: 20,
          created_at: new Date()
        },
        {
          id: 'msg-tool',
          session_id: 'session-types',
          role: 'assistant',
          message_type: 'tool_use',
          content: '',
          metadata: JSON.stringify({
            tool_name: 'list_all_entities',
            tool_args: {},
            tool_result: { entities: [] },
            status: 'success'
          }),
          stop_reason: 'tool_use',
          token_count: 50,
          created_at: new Date()
        }
      ];

      mockExecuteQuery.mockResolvedValueOnce({ recordset: mockMessages });

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/session-types/messages')
        .expect(200);

      // Assert
      expect(response.body.messages).toHaveLength(2);

      // Verify thinking message structure
      expect(response.body.messages[0]).toMatchObject({
        id: 'msg-thinking',
        type: 'thinking',
        content: 'Let me think about this...',
        duration_ms: 1500
      });

      // Verify tool_use message structure
      expect(response.body.messages[1]).toMatchObject({
        id: 'msg-tool',
        type: 'tool_use',
        tool_name: 'list_all_entities',
        status: 'success'
      });
    });
  });

  describe('PATCH /api/chat/sessions/:sessionId', () => {
    it('should update session title successfully', async () => {
      // Arrange
      // First query: UPDATE
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      // Second query: SELECT updated session
      const mockUpdatedSession = {
        id: 'session-update',
        user_id: 'test-user-123',
        title: 'Updated Title',
        is_active: true,
        created_at: new Date('2024-01-20'),
        updated_at: new Date('2024-01-21')
      };
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [mockUpdatedSession] });

      // Act
      const response = await request(app)
        .patch('/api/chat/sessions/session-update')
        .send({ title: 'Updated Title' })
        .expect(200);

      // Assert
      expect(response.body.success).toBe(true);
      expect(response.body.session.title).toBe('Updated Title');
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sessions'),
        expect.objectContaining({
          sessionId: 'session-update',
          userId: 'test-user-123',
          title: 'Updated Title'
        })
      );
    });

    it('should trim whitespace from title', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [{
          id: 'session-trim',
          user_id: 'test-user-123',
          title: 'Trimmed Title',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        }]
      });

      // Act
      await request(app)
        .patch('/api/chat/sessions/session-trim')
        .send({ title: '  Trimmed Title  ' })
        .expect(200);

      // Assert
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ title: 'Trimmed Title' })
      );
    });

    it('should return 400 when title is missing', async () => {
      // Act
      const response = await request(app)
        .patch('/api/chat/sessions/any')
        .send({})
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.message).toContain('Title is required');
    });

    it('should return 400 when title is empty string', async () => {
      // Act
      const response = await request(app)
        .patch('/api/chat/sessions/any')
        .send({ title: '   ' })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
    });

    it('should return 400 when title exceeds 500 characters', async () => {
      // Act
      const response = await request(app)
        .patch('/api/chat/sessions/any')
        .send({ title: 'a'.repeat(501) })
        .expect(400);

      // Assert
      expect(response.body.message).toContain('500 characters');
    });

    it('should return 404 when session does not exist or user lacks access', async () => {
      // Arrange - No rows affected
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [0] });

      // Act
      const response = await request(app)
        .patch('/api/chat/sessions/no-access')
        .send({ title: 'Test' })
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
    });
  });

  describe('DELETE /api/chat/sessions/:sessionId', () => {
    it('should delete session successfully (CASCADE delete)', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [1] });

      // Act
      const response = await request(app)
        .delete('/api/chat/sessions/session-delete')
        .expect(200);

      // Assert
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Session deleted');
      expect(mockExecuteQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM sessions'),
        { sessionId: 'session-delete', userId: 'test-user-123' }
      );
    });

    it('should return 404 when session does not exist', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [0] });

      // Act
      const response = await request(app)
        .delete('/api/chat/sessions/nonexistent')
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
      expect(response.body.message).toBe('Session not found or access denied');
    });

    it('should return 404 when user does not own the session', async () => {
      // Arrange - No rows affected due to ownership check
      mockExecuteQuery.mockResolvedValueOnce({ rowsAffected: [0] });

      // Act
      const response = await request(app)
        .delete('/api/chat/sessions/other-user-session')
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
    });

    // Note: Authentication tests moved to integration tests

    it('should return 500 on database error', async () => {
      // Arrange
      mockExecuteQuery.mockRejectedValueOnce(new Error('Constraint violation'));

      // Act
      const response = await request(app)
        .delete('/api/chat/sessions/error-session')
        .expect(500);

      // Assert - sendError format: { error: HTTP_STATUS_NAME, message: CUSTOM_MESSAGE }
      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body.message).toBe('Failed to delete session');
    });
  });
});
