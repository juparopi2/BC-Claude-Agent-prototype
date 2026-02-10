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
import crypto from 'crypto';

// Mock Prisma client (used by SessionService and CitationService)
vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    sessions: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    messages: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    message_citations: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

// Mock CitationService to prevent Prisma usage during module load
vi.mock('@/services/citations', () => ({
  getCitationService: vi.fn(() => ({
    getCitationsForMessages: vi.fn().mockResolvedValue(new Map()),
  })),
}));

// Mock MessageChatAttachmentService to prevent any other transitive dependencies
vi.mock('@/services/files/MessageChatAttachmentService', () => ({
  getMessageChatAttachmentService: vi.fn(() => ({
    getAttachmentsForMessages: vi.fn().mockResolvedValue(new Map()),
  })),
}));

vi.mock('crypto', () => ({
  default: {
    randomUUID: vi.fn()
  }
}));

vi.mock('@/shared/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  },
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn()
  }))
}));

// Mock auth middleware
vi.mock('@/domains/auth/middleware/auth-oauth', () => ({
  authenticateMicrosoft: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    // Set userId from test
    req.userId = (req as Express.Request & { testUserId?: string }).testUserId || 'test-user-123';
    next();
  }
}));

// Mock SessionTitleGenerator
vi.mock('@/services/sessions/SessionTitleGenerator', () => ({
  getSessionTitleGenerator: vi.fn(() => ({
    generateTitle: vi.fn().mockResolvedValue('Generated Title'),
  })),
}));

import { prisma } from '@/infrastructure/database/prisma';

const mockSessions = vi.mocked(prisma.sessions);
const mockMessages = vi.mocked(prisma.messages);

describe('Sessions Routes', () => {
  let app: Application;
  let mockRandomUUID: Mock;

  beforeEach(() => {
    // Clear all mocks including queued return values
    vi.clearAllMocks();

    // Get fresh references to mocks
    mockRandomUUID = crypto.randomUUID as Mock;

    // Explicitly reset mock state to remove any queued return values
    mockRandomUUID.mockReset();

    // Setup Express app with router
    app = express();
    app.use(express.json());

    // Add middleware to inject test userId
    app.use((req, _res, next) => {
      (req as Express.Request & { testUserId?: string }).testUserId = 'test-user-123';
      next();
    });

    app.use('/api/chat/sessions', sessionsRouter);
  });

  describe('GET /api/chat/sessions', () => {
    it('should return all sessions for authenticated user with pagination', async () => {
      // Arrange
      const mockSessionRows = [
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

      mockSessions.findMany.mockResolvedValueOnce(mockSessionRows as never);

      // Act
      const response = await request(app)
        .get('/api/chat/sessions')
        .expect(200);

      // Assert - Now returns paginated response
      expect(response.body.sessions).toHaveLength(2);
      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.hasMore).toBe(false);
      expect(response.body.pagination.nextCursor).toBe(null);
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
      expect(mockSessions.findMany).toHaveBeenCalledWith({
        where: { user_id: 'test-user-123' },
        orderBy: { updated_at: 'desc' },
        take: 21,
      });
    });

    it('should return empty array when user has no sessions', async () => {
      // Arrange
      mockSessions.findMany.mockResolvedValueOnce([] as never);

      // Act
      const response = await request(app)
        .get('/api/chat/sessions')
        .expect(200);

      // Assert - Now returns paginated response
      expect(response.body.sessions).toEqual([]);
      expect(response.body.pagination.hasMore).toBe(false);
    });

    // Note: Authentication tests moved to integration tests
    // Unit tests focus on business logic with mocked auth

    it('should return 500 on database error', async () => {
      // Arrange
      mockSessions.findMany.mockRejectedValueOnce(new Error('Database connection lost') as never);

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
      // Arrange - UUID is normalized to uppercase per CLAUDE.md spec
      const mockSessionId = 'new-session-123';
      const uppercaseSessionId = mockSessionId.toUpperCase();
      mockRandomUUID.mockReturnValueOnce(mockSessionId);

      const mockCreatedSession = {
        id: uppercaseSessionId,
        user_id: 'test-user-123',
        title: 'My Custom Title',
        is_active: true,
        created_at: new Date('2024-01-05'),
        updated_at: new Date('2024-01-05')
      };

      mockSessions.create.mockResolvedValueOnce(mockCreatedSession as never);

      // Act
      const response = await request(app)
        .post('/api/chat/sessions')
        .send({ title: 'My Custom Title' })
        .expect(201);

      // Assert - Route returns unwrapped session (REST standard)
      expect(response.body).toMatchObject({
        id: uppercaseSessionId,
        user_id: 'test-user-123',
        title: 'My Custom Title',
        status: 'active'
      });
      expect(mockSessions.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: uppercaseSessionId,
          user_id: 'test-user-123',
          title: 'My Custom Title',
          is_active: true,
        }),
      });
    });

    it('should create session with default title when not provided', async () => {
      // Arrange - UUID is normalized to uppercase per CLAUDE.md spec
      const mockSessionId = 'new-session-456';
      const uppercaseSessionId = mockSessionId.toUpperCase();
      mockRandomUUID.mockReturnValueOnce(mockSessionId);

      const mockCreatedSession = {
        id: uppercaseSessionId,
        user_id: 'test-user-123',
        title: 'New Chat',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      };

      mockSessions.create.mockResolvedValueOnce(mockCreatedSession as never);

      // Act
      const response = await request(app)
        .post('/api/chat/sessions')
        .send({})
        .expect(201);

      // Assert - Route returns unwrapped session (REST standard)
      expect(response.body.title).toBe('New Chat');
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
      mockSessions.create.mockRejectedValueOnce(new Error('Database insert failed') as never);

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
    // Valid UUID for get session tests
    const GET_SESSION_UUID = 'f0f0f0f0-f0f0-f0f0-f0f0-f0f0f0f0f0f0';

    it('should return specific session when user owns it', async () => {
      // Arrange - Use valid UUID
      const mockSession = {
        id: GET_SESSION_UUID,
        user_id: 'test-user-123',
        title: 'Specific Session',
        is_active: true,
        created_at: new Date('2024-01-10'),
        updated_at: new Date('2024-01-10')
      };

      mockSessions.findFirst.mockResolvedValueOnce(mockSession as never);
      // Second query: message count
      mockMessages.count.mockResolvedValueOnce(5 as never);

      // Act
      const response = await request(app)
        .get(`/api/chat/sessions/${GET_SESSION_UUID}`)
        .expect(200);

      // Assert - Route returns unwrapped session with messageCount (REST standard)
      expect(response.body).toMatchObject({
        id: GET_SESSION_UUID,
        user_id: 'test-user-123',
        title: 'Specific Session'
      });
      expect(response.body.messageCount).toBe(5);
      expect(mockSessions.findFirst).toHaveBeenCalledWith({
        where: { id: GET_SESSION_UUID, user_id: 'test-user-123' },
      });
    });

    it('should return 404 when session does not exist', async () => {
      // Arrange - Use valid UUID format so it reaches database query
      mockSessions.findFirst.mockResolvedValueOnce(null as never);

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/00000000-0000-0000-0000-000000000000')
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
      expect(response.body.message).toBe('Session not found or access denied');
    });

    it('should return 404 when user does not own the session', async () => {
      // Arrange - Session belongs to different user (use valid UUID)
      mockSessions.findFirst.mockResolvedValueOnce(null as never); // No results due to ownership check

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/11111111-1111-1111-1111-111111111111')
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
    });

    // Note: Authentication tests moved to integration tests
  });

  describe('GET /api/chat/sessions/:sessionId/messages', () => {
    // Valid UUID for session messages tests
    const VALID_SESSION_UUID = '22222222-2222-2222-2222-222222222222';

    it('should return messages for a session with default pagination', async () => {
      // Arrange
      // First query: verify session ownership
      mockSessions.findFirst.mockResolvedValueOnce({ id: VALID_SESSION_UUID } as never);

      // Second query: get messages (returned in DESC order, reversed in code)
      const mockMsgs = [
        {
          id: 'msg-2',
          session_id: VALID_SESSION_UUID,
          role: 'assistant',
          message_type: 'standard',
          content: 'Hi there!',
          metadata: null,
          stop_reason: 'end_turn',
          token_count: 10,
          sequence_number: 2,
          created_at: new Date('2024-01-15T10:00:05Z'),
          model: null,
          input_tokens: null,
          output_tokens: null,
          event_id: null,
          tool_use_id: null,
          agent_id: null,
        },
        {
          id: 'msg-1',
          session_id: VALID_SESSION_UUID,
          role: 'user',
          message_type: 'standard',
          content: 'Hello',
          metadata: null,
          stop_reason: null,
          token_count: 5,
          sequence_number: 1,
          created_at: new Date('2024-01-15T10:00:00Z'),
          model: null,
          input_tokens: null,
          output_tokens: null,
          event_id: null,
          tool_use_id: null,
          agent_id: null,
        }
      ];

      mockMessages.findMany.mockResolvedValueOnce(mockMsgs as never);

      // Act
      const response = await request(app)
        .get(`/api/chat/sessions/${VALID_SESSION_UUID}/messages`)
        .expect(200);

      // Assert - After reversing, msg-1 (seq 1) is first
      expect(response.body.messages).toHaveLength(2);
      expect(response.body.messages[0]).toMatchObject({
        id: 'msg-1',
        role: 'user',
        type: 'standard',
        content: 'Hello'
      });
      // Now includes pagination info
      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.hasMore).toBe(false);
      // 1 findFirst (ownership) + 1 messages.findMany
      expect(mockSessions.findFirst).toHaveBeenCalledTimes(1);
      expect(mockMessages.findMany).toHaveBeenCalledWith({
        where: { session_id: VALID_SESSION_UUID },
        orderBy: { sequence_number: 'desc' },
        take: 51,
      });
    });

    it('should handle custom pagination parameters', async () => {
      // Arrange - Use valid UUID
      const paginationSessionUUID = '33333333-3333-3333-3333-333333333333';
      mockSessions.findFirst.mockResolvedValueOnce({ id: paginationSessionUUID } as never);
      mockMessages.findMany.mockResolvedValueOnce([] as never);

      // Act - Now using cursor-based pagination with before parameter
      const response = await request(app)
        .get(`/api/chat/sessions/${paginationSessionUUID}/messages?limit=10`)
        .expect(200);

      // Assert - fetchLimit is limit + 1 for hasMore check
      expect(mockMessages.findMany).toHaveBeenCalledWith({
        where: { session_id: paginationSessionUUID },
        orderBy: { sequence_number: 'desc' },
        take: 11,
      });
    });

    it('should return 400 when pagination params are invalid', async () => {
      // Act - Use valid UUID to reach pagination validation
      const response = await request(app)
        .get('/api/chat/sessions/44444444-4444-4444-4444-444444444444/messages?limit=invalid')
        .expect(400);

      // Assert - sendError format: { error: HTTP_STATUS_NAME, message: CUSTOM_MESSAGE }
      expect(response.body.error).toBe('Bad Request');
    });

    it('should return 404 when session does not exist or user lacks access', async () => {
      // Arrange - Session ownership check fails (use valid UUID)
      mockSessions.findFirst.mockResolvedValueOnce(null as never);

      // Act
      const response = await request(app)
        .get('/api/chat/sessions/55555555-5555-5555-5555-555555555555/messages')
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
      expect(response.body.message).toBe('Session not found or access denied');
    });

    it('should handle thinking and tool_use message types', async () => {
      // Arrange - Use valid UUID
      const typesSessionUUID = '66666666-6666-6666-6666-666666666666';
      mockSessions.findFirst.mockResolvedValueOnce({ id: typesSessionUUID } as never);

      // Note: Messages are fetched ORDER BY sequence_number DESC, then reversed
      // So mockMessages should be in DESC order (newest first)
      const mockMsgs = [
        {
          id: 'msg-tool',
          session_id: typesSessionUUID,
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
          sequence_number: 2,
          created_at: new Date(),
          model: null,
          input_tokens: null,
          output_tokens: null,
          event_id: null,
          tool_use_id: null,
          agent_id: null,
        },
        {
          id: 'msg-thinking',
          session_id: typesSessionUUID,
          role: 'assistant',
          message_type: 'thinking',
          content: 'Let me think about this...',  // Content is in content column, not metadata
          metadata: JSON.stringify({ duration_ms: 1500 }),
          stop_reason: null,
          token_count: 20,
          sequence_number: 1,
          created_at: new Date(),
          model: null,
          input_tokens: null,
          output_tokens: null,
          event_id: null,
          tool_use_id: null,
          agent_id: null,
        }
      ];

      mockMessages.findMany.mockResolvedValueOnce(mockMsgs as never);

      // Act
      const response = await request(app)
        .get(`/api/chat/sessions/${typesSessionUUID}/messages`)
        .expect(200);

      // Assert
      expect(response.body.messages).toHaveLength(2);

      // After reversing, thinking (seq 1) should be first, tool_use (seq 2) should be second
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
    // Valid UUIDs for PATCH tests
    const PATCH_SESSION_UUID = '77777777-7777-7777-7777-777777777777';
    const PATCH_TRIM_UUID = '88888888-8888-8888-8888-888888888888';
    const PATCH_VALIDATION_UUID = '99999999-9999-9999-9999-999999999999';

    it('should update session title successfully', async () => {
      // Arrange
      // First query: updateMany
      mockSessions.updateMany.mockResolvedValueOnce({ count: 1 } as never);

      // Second query: findFirst to get updated session
      const mockUpdatedSession = {
        id: PATCH_SESSION_UUID,
        user_id: 'test-user-123',
        title: 'Updated Title',
        is_active: true,
        created_at: new Date('2024-01-20'),
        updated_at: new Date('2024-01-21')
      };
      mockSessions.findFirst.mockResolvedValueOnce(mockUpdatedSession as never);

      // Act
      const response = await request(app)
        .patch(`/api/chat/sessions/${PATCH_SESSION_UUID}`)
        .send({ title: 'Updated Title' })
        .expect(200);

      // Assert - Route returns unwrapped session (REST standard, no success wrapper)
      expect(response.body.title).toBe('Updated Title');
      expect(response.body.id).toBe(PATCH_SESSION_UUID);
      expect(mockSessions.updateMany).toHaveBeenCalledWith({
        where: { id: PATCH_SESSION_UUID, user_id: 'test-user-123' },
        data: expect.objectContaining({ title: 'Updated Title' }),
      });
    });

    it('should trim whitespace from title', async () => {
      // Arrange
      mockSessions.updateMany.mockResolvedValueOnce({ count: 1 } as never);
      mockSessions.findFirst.mockResolvedValueOnce({
        id: PATCH_TRIM_UUID,
        user_id: 'test-user-123',
        title: 'Trimmed Title',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      } as never);

      // Act
      await request(app)
        .patch(`/api/chat/sessions/${PATCH_TRIM_UUID}`)
        .send({ title: '  Trimmed Title  ' })
        .expect(200);

      // Assert
      expect(mockSessions.updateMany).toHaveBeenCalledWith({
        where: { id: PATCH_TRIM_UUID, user_id: 'test-user-123' },
        data: expect.objectContaining({ title: 'Trimmed Title' }),
      });
    });

    it('should return 400 when title is missing', async () => {
      // Act - Use valid UUID to reach validation
      const response = await request(app)
        .patch(`/api/chat/sessions/${PATCH_VALIDATION_UUID}`)
        .send({})
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 when title is empty string', async () => {
      // Act - Use valid UUID to reach validation (Zod trims before min check)
      const response = await request(app)
        .patch(`/api/chat/sessions/${PATCH_VALIDATION_UUID}`)
        .send({ title: '   ' })
        .expect(400);

      // Assert
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.message).toContain('Title is required');
    });

    it('should return 400 when title exceeds 500 characters', async () => {
      // Act - Use valid UUID to reach validation
      const response = await request(app)
        .patch(`/api/chat/sessions/${PATCH_VALIDATION_UUID}`)
        .send({ title: 'a'.repeat(501) })
        .expect(400);

      // Assert - Zod error message format
      expect(response.body.message).toContain('500');
    });

    it('should return 404 when session does not exist or user lacks access', async () => {
      // Arrange - No rows affected (use valid UUID)
      mockSessions.updateMany.mockResolvedValueOnce({ count: 0 } as never);

      // Act
      const response = await request(app)
        .patch('/api/chat/sessions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
        .send({ title: 'Test' })
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
    });
  });

  describe('DELETE /api/chat/sessions/:sessionId', () => {
    // Valid UUIDs for DELETE tests
    const DELETE_SESSION_UUID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const DELETE_NONEXIST_UUID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const DELETE_OTHER_UUID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const DELETE_ERROR_UUID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

    it('should delete session successfully (CASCADE delete)', async () => {
      // Arrange
      mockSessions.deleteMany.mockResolvedValueOnce({ count: 1 } as never);

      // Act - Route returns 204 No Content (REST standard for successful DELETE)
      await request(app)
        .delete(`/api/chat/sessions/${DELETE_SESSION_UUID}`)
        .expect(204);

      // Assert - No body with 204, just verify DB call
      expect(mockSessions.deleteMany).toHaveBeenCalledWith({
        where: { id: DELETE_SESSION_UUID, user_id: 'test-user-123' },
      });
    });

    it('should return 404 when session does not exist', async () => {
      // Arrange
      mockSessions.deleteMany.mockResolvedValueOnce({ count: 0 } as never);

      // Act
      const response = await request(app)
        .delete(`/api/chat/sessions/${DELETE_NONEXIST_UUID}`)
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
      expect(response.body.message).toBe('Session not found or access denied');
    });

    it('should return 404 when user does not own the session', async () => {
      // Arrange - No rows affected due to ownership check
      mockSessions.deleteMany.mockResolvedValueOnce({ count: 0 } as never);

      // Act
      const response = await request(app)
        .delete(`/api/chat/sessions/${DELETE_OTHER_UUID}`)
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
    });

    // Note: Authentication tests moved to integration tests

    it('should return 500 on database error', async () => {
      // Arrange
      mockSessions.deleteMany.mockRejectedValueOnce(new Error('Constraint violation') as never);

      // Act
      const response = await request(app)
        .delete(`/api/chat/sessions/${DELETE_ERROR_UUID}`)
        .expect(500);

      // Assert - sendError format: { error: HTTP_STATUS_NAME, message: CUSTOM_MESSAGE }
      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body.message).toBe('Failed to delete session');
    });
  });
});
