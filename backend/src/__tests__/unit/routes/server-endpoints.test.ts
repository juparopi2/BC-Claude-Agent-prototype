/**
 * Unit Tests - Server Inline Endpoints
 *
 * Tests for endpoints defined directly in server.ts (not in route files).
 * These include MCP, BC, Agent, Approvals, and Todos endpoints.
 *
 * Endpoints tested:
 * - GET /api - Health check
 * - GET /api/mcp/config - MCP configuration
 * - GET /api/mcp/health - MCP health check
 * - GET /api/bc/test - BC connection test
 * - GET /api/bc/customers - Get BC customers (auth required)
 * - GET /api/agent/status - Agent configuration status
 * - POST /api/agent/query - Execute agent query (auth required)
 * - POST /api/approvals/:id/respond - Respond to approval (auth + ownership)
 * - GET /api/approvals/pending - Get pending approvals (auth + ownership)
 * - GET /api/approvals/session/:sessionId - Get session approvals (auth + ownership)
 * - GET /api/todos/session/:sessionId - Get session todos (auth + ownership)
 *
 * @module __tests__/unit/routes/server-endpoints
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import { executeQuery } from '@/infrastructure/database/database';
import { validateSessionOwnership } from '@/shared/utils/session-ownership';
import { ErrorCode } from '@/shared/constants/errors';
import {
  sendError,
  sendBadRequest,
  sendUnauthorized,
  sendForbidden,
  sendNotFound,
  sendConflict,
  sendInternalError,
  sendServiceUnavailable,
} from '@/shared/utils/error-response';

// ============================================
// Mock Dependencies
// ============================================

vi.mock('@/infrastructure/database/database', () => ({
  executeQuery: vi.fn(),
}));

vi.mock('@/shared/utils/session-ownership', () => ({
  validateSessionOwnership: vi.fn(),
}));

// Mock services
const mockDirectAgentService = {
  // NOTE: DirectAgentService only has executeQueryStreaming, not executeQuery
  executeQueryStreaming: vi.fn().mockResolvedValue({
    success: true,
    response: 'Test response',
    tokenUsage: { inputTokens: 100, outputTokens: 50 },
  }),
};

const mockApprovalManager = {
  respondToApprovalAtomic: vi.fn(),
  getPendingApprovals: vi.fn(),
  validateApprovalOwnership: vi.fn(),
};

const mockTodoManager = {
  getTodosBySession: vi.fn(),
};

vi.mock('@/services/agent', () => ({
  getDirectAgentService: () => mockDirectAgentService,
}));

vi.mock('@/domains/approval/ApprovalManager', () => ({
  getApprovalManager: () => mockApprovalManager,
}));

vi.mock('@/services/todo/TodoManager', () => ({
  getTodoManager: () => mockTodoManager,
}));

vi.mock('@/shared/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ============================================
// Test Helpers
// ============================================

/**
 * Create an Express app that simulates the server.ts inline routes
 */
function createServerApp(): Application {
  const app = express();
  app.use(express.json());

  // Mock auth middleware - uses standardized error format
  const authenticateMicrosoft = (req: Request, res: Response, next: NextFunction): void => {
    const testUserId = req.headers['x-test-user-id'] as string;
    if (testUserId) {
      req.userId = testUserId;
      next();
    } else {
      sendUnauthorized(res);
    }
  };

  // Environment mock
  const env = {
    ANTHROPIC_API_KEY: 'test-api-key',
    ANTHROPIC_MODEL: 'claude-3-sonnet',
  };

  // GET /api - Health check
  app.get('/api', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      message: 'BC Claude Agent API',
      version: '1.0.0',
    });
  });

  // GET /api/bc/test - uses standardized error format
  app.get('/api/bc/test', async (_req: Request, res: Response) => {
    try {
      // Simulate BC connection test
      res.json({ status: 'ok', message: 'BC connection test' });
    } catch {
      sendInternalError(res, ErrorCode.SERVICE_ERROR);
    }
  });

  // GET /api/bc/customers (auth required) - uses standardized error format
  app.get('/api/bc/customers', authenticateMicrosoft, async (req: Request, res: Response) => {
    try {
      const result = await executeQuery('SELECT TOP 10 * FROM customers', {});
      res.json({ customers: result.recordset || [] });
    } catch {
      sendInternalError(res, ErrorCode.SERVICE_ERROR);
    }
  });

  // GET /api/agent/status
  app.get('/api/agent/status', (_req: Request, res: Response) => {
    res.json({
      configured: !!env.ANTHROPIC_API_KEY,
      config: {
        hasApiKey: !!env.ANTHROPIC_API_KEY,
        model: env.ANTHROPIC_MODEL,
        strategy: 'direct-api',
        mcpConfigured: true,
        toolsAvailable: 7,
      },
      mcpServer: {
        url: 'vendored',
        configured: true,
        type: 'in-process-data-files',
      },
      implementation: {
        type: 'DirectAgentService',
        reason: 'Bypasses Agent SDK ProcessTransport bug',
        manualAgenticLoop: true,
      },
    });
  });

  // POST /api/agent/query (auth required) - uses standardized error format
  app.post('/api/agent/query', authenticateMicrosoft, async (req: Request, res: Response) => {
    try {
      if (!env.ANTHROPIC_API_KEY) {
        sendServiceUnavailable(res, ErrorCode.SERVICE_UNAVAILABLE);
        return;
      }

      const { prompt, sessionId } = req.body;
      const userId = req.userId;

      if (!prompt || typeof prompt !== 'string') {
        sendBadRequest(res, 'prompt is required and must be a string', 'prompt');
        return;
      }

      const result = await mockDirectAgentService.executeQueryStreaming(
        prompt,
        sessionId,
        undefined, // onEvent not used for REST endpoint
        userId
      );
      res.json(result);
    } catch {
      sendInternalError(res, ErrorCode.MESSAGE_PROCESSING_ERROR);
    }
  });

  // POST /api/approvals/:id/respond (auth + ownership via atomic) - uses standardized error format
  app.post('/api/approvals/:id/respond', authenticateMicrosoft, async (req: Request, res: Response) => {
    try {
      const approvalId = req.params.id as string;
      const { decision, reason } = req.body;
      const userId = req.userId;

      if (!userId) {
        sendUnauthorized(res, ErrorCode.USER_ID_NOT_IN_SESSION);
        return;
      }

      if (!decision || !['approved', 'rejected'].includes(decision)) {
        sendError(res, ErrorCode.INVALID_DECISION);
        return;
      }

      const result = await mockApprovalManager.respondToApprovalAtomic(
        approvalId,
        decision as 'approved' | 'rejected',
        userId,
        reason
      );

      if (!result.success) {
        switch (result.error) {
          case 'APPROVAL_NOT_FOUND':
            sendNotFound(res, ErrorCode.APPROVAL_NOT_FOUND);
            return;
          case 'SESSION_NOT_FOUND':
            sendNotFound(res, ErrorCode.SESSION_NOT_FOUND);
            return;
          case 'UNAUTHORIZED':
            sendForbidden(res, ErrorCode.APPROVAL_ACCESS_DENIED);
            return;
          case 'ALREADY_RESOLVED':
            sendConflict(res, ErrorCode.ALREADY_RESOLVED);
            return;
          case 'EXPIRED':
            sendError(res, ErrorCode.APPROVAL_EXPIRED);
            return;
          case 'NO_PENDING_PROMISE':
            sendServiceUnavailable(res, ErrorCode.APPROVAL_NOT_READY);
            return;
          default:
            sendInternalError(res);
            return;
        }
      }

      res.json({ success: true, approvalId, decision });
    } catch {
      sendInternalError(res);
    }
  });

  // GET /api/approvals/pending (auth + ownership) - uses standardized error format
  app.get('/api/approvals/pending', authenticateMicrosoft, async (req: Request, res: Response) => {
    try {
      const userId = req.userId;

      if (!userId) {
        sendUnauthorized(res, ErrorCode.USER_ID_NOT_IN_SESSION);
        return;
      }

      const result = await executeQuery(
        'SELECT * FROM approvals a INNER JOIN sessions s ON a.session_id = s.id WHERE s.user_id = @userId AND a.status = \'pending\'',
        { userId }
      );

      const approvals = (result.recordset || []).map((row: Record<string, unknown>) => ({
        id: row.id,
        session_id: row.session_id,
        tool_name: row.tool_name,
        status: row.status,
      }));

      res.json({ count: approvals.length, approvals });
    } catch {
      sendInternalError(res, ErrorCode.DATABASE_ERROR);
    }
  });

  // GET /api/approvals/session/:sessionId (auth + ownership) - uses standardized error format
  app.get('/api/approvals/session/:sessionId', authenticateMicrosoft, async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.sessionId as string;
      const userId = req.userId;

      if (!userId) {
        sendUnauthorized(res);
        return;
      }

      const ownershipResult = await validateSessionOwnership(sessionId, userId);
      if (!ownershipResult.isOwner) {
        if (ownershipResult.error === 'SESSION_NOT_FOUND') {
          sendNotFound(res, ErrorCode.SESSION_NOT_FOUND);
          return;
        }
        sendForbidden(res, ErrorCode.SESSION_ACCESS_DENIED);
        return;
      }

      const pendingApprovals = await mockApprovalManager.getPendingApprovals(sessionId);
      res.json({ sessionId, count: pendingApprovals.length, approvals: pendingApprovals });
    } catch {
      sendInternalError(res, ErrorCode.DATABASE_ERROR);
    }
  });

  // GET /api/todos/session/:sessionId (auth + ownership) - uses standardized error format
  app.get('/api/todos/session/:sessionId', authenticateMicrosoft, async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.sessionId as string;
      const userId = req.userId;

      if (!userId) {
        sendUnauthorized(res);
        return;
      }

      const ownershipResult = await validateSessionOwnership(sessionId, userId);
      if (!ownershipResult.isOwner) {
        if (ownershipResult.error === 'SESSION_NOT_FOUND') {
          sendNotFound(res, ErrorCode.SESSION_NOT_FOUND);
          return;
        }
        sendForbidden(res, ErrorCode.SESSION_ACCESS_DENIED);
        return;
      }

      const todos = await mockTodoManager.getTodosBySession(sessionId);
      res.json({ sessionId, count: todos.length, todos });
    } catch {
      sendInternalError(res, ErrorCode.DATABASE_ERROR);
    }
  });

  return app;
}

// ============================================
// Test Suite
// ============================================

describe('Server Inline Endpoints', () => {
  let app: Application;
  let mockExecuteQuery: Mock;
  let mockValidateSessionOwnership: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createServerApp();
    mockExecuteQuery = executeQuery as Mock;
    mockValidateSessionOwnership = validateSessionOwnership as Mock;
  });

  // ============================================
  // GET /api - Health Check
  // ============================================
  describe('GET /api', () => {
    it('should return API health status', async () => {
      // Act
      const response = await request(app)
        .get('/api')
        .expect(200);

      // Assert
      expect(response.body.status).toBe('ok');
      expect(response.body.message).toBe('BC Claude Agent API');
      expect(response.body.version).toBeDefined();
    });
  });

  // ============================================
  // GET /api/bc/test
  // ============================================
  describe('GET /api/bc/test', () => {
    it('should return BC connection test status', async () => {
      // Act
      const response = await request(app)
        .get('/api/bc/test')
        .expect(200);

      // Assert
      expect(response.body.status).toBe('ok');
    });
  });

  // ============================================
  // GET /api/bc/customers
  // ============================================
  describe('GET /api/bc/customers', () => {
    it('should return customers for authenticated user', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [
          { id: '1', name: 'Customer A' },
          { id: '2', name: 'Customer B' },
        ],
      });

      // Act
      const response = await request(app)
        .get('/api/bc/customers')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.customers).toHaveLength(2);
    });

    it('should return 401 without authentication', async () => {
      // Act
      const response = await request(app)
        .get('/api/bc/customers')
        .expect(401);

      // Assert
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should return 500 on database error', async () => {
      // Arrange
      mockExecuteQuery.mockRejectedValueOnce(new Error('DB error'));

      // Act
      const response = await request(app)
        .get('/api/bc/customers')
        .set('x-test-user-id', 'user-123')
        .expect(500);

      // Assert - standardized error format
      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body.code).toBe(ErrorCode.SERVICE_ERROR);
    });
  });

  // ============================================
  // GET /api/agent/status
  // ============================================
  describe('GET /api/agent/status', () => {
    it('should return agent configuration status', async () => {
      // Act
      const response = await request(app)
        .get('/api/agent/status')
        .expect(200);

      // Assert
      expect(response.body.configured).toBe(true);
      expect(response.body.config.hasApiKey).toBe(true);
      expect(response.body.config.model).toBe('claude-3-sonnet');
      expect(response.body.implementation.type).toBe('DirectAgentService');
    });
  });

  // ============================================
  // POST /api/agent/query
  // ============================================
  describe('POST /api/agent/query', () => {
    it('should execute agent query for authenticated user', async () => {
      // Arrange
      mockDirectAgentService.executeQueryStreaming.mockResolvedValueOnce({
        success: true,
        response: 'Hello! How can I help you?',
        tokenUsage: { inputTokens: 100, outputTokens: 50 },
      });

      // Act
      const response = await request(app)
        .post('/api/agent/query')
        .set('x-test-user-id', 'user-123')
        .send({ prompt: 'Hello', sessionId: 'session-123' })
        .expect(200);

      // Assert
      expect(response.body.response).toBe('Hello! How can I help you?');
      expect(mockDirectAgentService.executeQueryStreaming).toHaveBeenCalled();
    });

    it('should return 400 when prompt is missing', async () => {
      // Act
      const response = await request(app)
        .post('/api/agent/query')
        .set('x-test-user-id', 'user-123')
        .send({ sessionId: 'session-123' })
        .expect(400);

      // Assert - standardized error format uses 'Bad Request' from HTTP status names
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.message).toContain('prompt is required');
    });

    it('should return 400 when prompt is not a string', async () => {
      // Act
      const response = await request(app)
        .post('/api/agent/query')
        .set('x-test-user-id', 'user-123')
        .send({ prompt: 123 })
        .expect(400);

      // Assert - standardized error format
      expect(response.body.error).toBe('Bad Request');
    });

    it('should return 401 without authentication', async () => {
      // Act
      const response = await request(app)
        .post('/api/agent/query')
        .send({ prompt: 'Hello' })
        .expect(401);

      // Assert
      expect(response.body.error).toBe('Unauthorized');
    });

    it('should return 500 on agent error', async () => {
      // Arrange
      mockDirectAgentService.executeQueryStreaming.mockRejectedValueOnce(new Error('Claude API error'));

      // Act
      const response = await request(app)
        .post('/api/agent/query')
        .set('x-test-user-id', 'user-123')
        .send({ prompt: 'Hello' })
        .expect(500);

      // Assert - standardized error format
      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body.code).toBe(ErrorCode.MESSAGE_PROCESSING_ERROR);
    });
  });

  // ============================================
  // POST /api/approvals/:id/respond
  // ============================================
  describe('POST /api/approvals/:id/respond', () => {
    it('should approve request successfully', async () => {
      // Arrange
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({ success: true });

      // Act
      const response = await request(app)
        .post('/api/approvals/approval-123/respond')
        .set('x-test-user-id', 'user-123')
        .send({ decision: 'approved', reason: 'Looks good' })
        .expect(200);

      // Assert
      expect(response.body.success).toBe(true);
      expect(response.body.decision).toBe('approved');
    });

    it('should reject request successfully', async () => {
      // Arrange
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({ success: true });

      // Act
      const response = await request(app)
        .post('/api/approvals/approval-456/respond')
        .set('x-test-user-id', 'user-123')
        .send({ decision: 'rejected', reason: 'Not now' })
        .expect(200);

      // Assert
      expect(response.body.success).toBe(true);
      expect(response.body.decision).toBe('rejected');
    });

    it('should return 400 for invalid decision', async () => {
      // Act
      const response = await request(app)
        .post('/api/approvals/approval-123/respond')
        .set('x-test-user-id', 'user-123')
        .send({ decision: 'maybe' })
        .expect(400);

      // Assert - standardized error format
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.code).toBe(ErrorCode.INVALID_DECISION);
    });

    it('should return 404 when approval not found', async () => {
      // Arrange
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({
        success: false,
        error: 'APPROVAL_NOT_FOUND',
      });

      // Act
      const response = await request(app)
        .post('/api/approvals/nonexistent/respond')
        .set('x-test-user-id', 'user-123')
        .send({ decision: 'approved' })
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
    });

    it('should return 403 for unauthorized access', async () => {
      // Arrange
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({
        success: false,
        error: 'UNAUTHORIZED',
      });

      // Act
      const response = await request(app)
        .post('/api/approvals/other-user/respond')
        .set('x-test-user-id', 'user-123')
        .send({ decision: 'approved' })
        .expect(403);

      // Assert
      expect(response.body.error).toBe('Forbidden');
    });

    it('should return 409 when already resolved', async () => {
      // Arrange
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({
        success: false,
        error: 'ALREADY_RESOLVED',
        previousStatus: 'approved',
      });

      // Act
      const response = await request(app)
        .post('/api/approvals/already-done/respond')
        .set('x-test-user-id', 'user-123')
        .send({ decision: 'rejected' })
        .expect(409);

      // Assert - standardized error format
      expect(response.body.error).toBe('Conflict');
      expect(response.body.code).toBe(ErrorCode.ALREADY_RESOLVED);
      expect(response.body.message).toContain('already been processed');
    });

    it('should return 410 when expired', async () => {
      // Arrange
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({
        success: false,
        error: 'EXPIRED',
      });

      // Act
      const response = await request(app)
        .post('/api/approvals/expired/respond')
        .set('x-test-user-id', 'user-123')
        .send({ decision: 'approved' })
        .expect(410);

      // Assert
      expect(response.body.error).toBe('Gone');
      expect(response.body.message).toContain('expired');
    });

    it('should return 503 when server state inconsistent', async () => {
      // Arrange
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({
        success: false,
        error: 'NO_PENDING_PROMISE',
      });

      // Act
      const response = await request(app)
        .post('/api/approvals/no-promise/respond')
        .set('x-test-user-id', 'user-123')
        .send({ decision: 'approved' })
        .expect(503);

      // Assert
      expect(response.body.error).toBe('Service Unavailable');
    });
  });

  // ============================================
  // GET /api/approvals/pending
  // ============================================
  describe('GET /api/approvals/pending', () => {
    it('should return pending approvals for user', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({
        recordset: [
          { id: 'app-1', session_id: 'sess-1', tool_name: 'create_customer', status: 'pending' },
          { id: 'app-2', session_id: 'sess-2', tool_name: 'delete_order', status: 'pending' },
        ],
      });

      // Act
      const response = await request(app)
        .get('/api/approvals/pending')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.count).toBe(2);
      expect(response.body.approvals).toHaveLength(2);
    });

    it('should return empty array when no pending approvals', async () => {
      // Arrange
      mockExecuteQuery.mockResolvedValueOnce({ recordset: [] });

      // Act
      const response = await request(app)
        .get('/api/approvals/pending')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.count).toBe(0);
      expect(response.body.approvals).toEqual([]);
    });

    it('should return 401 without authentication', async () => {
      // Act
      const response = await request(app)
        .get('/api/approvals/pending')
        .expect(401);

      // Assert
      expect(response.body.error).toBe('Unauthorized');
    });
  });

  // ============================================
  // GET /api/approvals/session/:sessionId
  // ============================================
  describe('GET /api/approvals/session/:sessionId', () => {
    it('should return session approvals when user owns session', async () => {
      // Arrange
      mockValidateSessionOwnership.mockResolvedValueOnce({ isOwner: true });
      mockApprovalManager.getPendingApprovals.mockResolvedValueOnce([
        { id: 'app-1', toolName: 'create_customer' },
      ]);

      // Act
      const response = await request(app)
        .get('/api/approvals/session/session-123')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.sessionId).toBe('session-123');
      expect(response.body.count).toBe(1);
    });

    it('should return 403 when user does not own session', async () => {
      // Arrange
      mockValidateSessionOwnership.mockResolvedValueOnce({
        isOwner: false,
        error: 'NOT_OWNER',
      });

      // Act
      const response = await request(app)
        .get('/api/approvals/session/other-session')
        .set('x-test-user-id', 'user-123')
        .expect(403);

      // Assert
      expect(response.body.error).toBe('Forbidden');
    });

    it('should return 404 when session not found', async () => {
      // Arrange
      mockValidateSessionOwnership.mockResolvedValueOnce({
        isOwner: false,
        error: 'SESSION_NOT_FOUND',
      });

      // Act
      const response = await request(app)
        .get('/api/approvals/session/nonexistent')
        .set('x-test-user-id', 'user-123')
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
    });
  });

  // ============================================
  // GET /api/todos/session/:sessionId
  // ============================================
  describe('GET /api/todos/session/:sessionId', () => {
    it('should return todos when user owns session', async () => {
      // Arrange
      mockValidateSessionOwnership.mockResolvedValueOnce({ isOwner: true });
      mockTodoManager.getTodosBySession.mockResolvedValueOnce([
        { id: 'todo-1', content: 'Create customer', status: 'completed' },
        { id: 'todo-2', content: 'Create order', status: 'in_progress' },
      ]);

      // Act
      const response = await request(app)
        .get('/api/todos/session/session-123')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.sessionId).toBe('session-123');
      expect(response.body.count).toBe(2);
      expect(response.body.todos).toHaveLength(2);
    });

    it('should return 403 when user does not own session', async () => {
      // Arrange
      mockValidateSessionOwnership.mockResolvedValueOnce({
        isOwner: false,
        error: 'NOT_OWNER',
      });

      // Act
      const response = await request(app)
        .get('/api/todos/session/other-session')
        .set('x-test-user-id', 'user-123')
        .expect(403);

      // Assert
      expect(response.body.error).toBe('Forbidden');
    });

    it('should return 404 when session not found', async () => {
      // Arrange
      mockValidateSessionOwnership.mockResolvedValueOnce({
        isOwner: false,
        error: 'SESSION_NOT_FOUND',
      });

      // Act
      const response = await request(app)
        .get('/api/todos/session/ghost-session')
        .set('x-test-user-id', 'user-123')
        .expect(404);

      // Assert
      expect(response.body.error).toBe('Not Found');
    });

    it('should return empty todos when session has none', async () => {
      // Arrange
      mockValidateSessionOwnership.mockResolvedValueOnce({ isOwner: true });
      mockTodoManager.getTodosBySession.mockResolvedValueOnce([]);

      // Act
      const response = await request(app)
        .get('/api/todos/session/empty-session')
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.count).toBe(0);
      expect(response.body.todos).toEqual([]);
    });
  });

  // ============================================
  // Multi-Tenant Security
  // ============================================
  describe('Multi-Tenant Security', () => {
    it('should block cross-tenant approval access via session validation', async () => {
      // Arrange
      mockValidateSessionOwnership.mockResolvedValueOnce({
        isOwner: false,
        error: 'NOT_OWNER',
      });

      // Act
      const response = await request(app)
        .get('/api/approvals/session/tenant-b-session')
        .set('x-test-user-id', 'tenant-a-user')
        .expect(403);

      // Assert
      expect(response.body.error).toBe('Forbidden');
      expect(mockApprovalManager.getPendingApprovals).not.toHaveBeenCalled();
    });

    it('should block cross-tenant todo access via session validation', async () => {
      // Arrange
      mockValidateSessionOwnership.mockResolvedValueOnce({
        isOwner: false,
        error: 'NOT_OWNER',
      });

      // Act
      const response = await request(app)
        .get('/api/todos/session/tenant-b-session')
        .set('x-test-user-id', 'tenant-a-user')
        .expect(403);

      // Assert
      expect(response.body.error).toBe('Forbidden');
      expect(mockTodoManager.getTodosBySession).not.toHaveBeenCalled();
    });

    it('should use atomic validation for approval response (TOCTOU prevention)', async () => {
      // Arrange - atomic method handles ownership internally
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({
        success: false,
        error: 'UNAUTHORIZED',
      });

      // Act
      const response = await request(app)
        .post('/api/approvals/any-id/respond')
        .set('x-test-user-id', 'attacker-user')
        .send({ decision: 'approved' })
        .expect(403);

      // Assert
      expect(response.body.error).toBe('Forbidden');
      expect(mockApprovalManager.respondToApprovalAtomic).toHaveBeenCalledWith(
        'any-id',
        'approved',
        'attacker-user',
        undefined
      );
    });
  });

  // ============================================
  // Edge Cases
  // ============================================
  describe('Edge Cases', () => {
    it('should handle special characters in approval ID', async () => {
      // Arrange
      const specialId = 'approval-with-dashes-123';
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({ success: true });

      // Act
      const response = await request(app)
        .post(`/api/approvals/${specialId}/respond`)
        .set('x-test-user-id', 'user-123')
        .send({ decision: 'approved' })
        .expect(200);

      // Assert
      expect(response.body.approvalId).toBe(specialId);
    });

    it('should handle UUID format session IDs', async () => {
      // Arrange
      const uuidSessionId = '550e8400-e29b-41d4-a716-446655440000';
      mockValidateSessionOwnership.mockResolvedValueOnce({ isOwner: true });
      mockTodoManager.getTodosBySession.mockResolvedValueOnce([]);

      // Act
      const response = await request(app)
        .get(`/api/todos/session/${uuidSessionId}`)
        .set('x-test-user-id', 'user-123')
        .expect(200);

      // Assert
      expect(response.body.sessionId).toBe(uuidSessionId);
    });

    it('should handle concurrent approval responses', async () => {
      // Arrange
      mockApprovalManager.respondToApprovalAtomic
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'ALREADY_RESOLVED', previousStatus: 'approved' });

      // Act - send two responses concurrently
      const [response1, response2] = await Promise.all([
        request(app)
          .post('/api/approvals/concurrent-1/respond')
          .set('x-test-user-id', 'user-123')
          .send({ decision: 'approved' }),
        request(app)
          .post('/api/approvals/concurrent-1/respond')
          .set('x-test-user-id', 'user-123')
          .send({ decision: 'rejected' }),
      ]);

      // Assert - one succeeds, one gets conflict
      expect([response1.status, response2.status]).toContain(200);
      expect([response1.status, response2.status]).toContain(409);
    });
  });

  // ============================================
  // Additional Edge Cases (Phase 3)
  // ============================================
  describe('Additional Edge Cases (Phase 3)', () => {
    describe('Agent Query Edge Cases', () => {
      it('should handle empty string prompt', async () => {
        // Act
        const response = await request(app)
          .post('/api/agent/query')
          .set('x-test-user-id', 'user-123')
          .send({ prompt: '' })
          .expect(400);

        // Assert - standardized error format
        expect(response.body.error).toBe('Bad Request');
      });

      it('should handle whitespace-only prompt', async () => {
        // Act
        const response = await request(app)
          .post('/api/agent/query')
          .set('x-test-user-id', 'user-123')
          .send({ prompt: '   \n\t  ' })
          .expect(200); // Whitespace is still a string, implementation decides

        // Assert - verify it was passed to the service (endpoint uses executeQueryStreaming)
        expect(mockDirectAgentService.executeQueryStreaming).toHaveBeenCalled();
      });

      it('should handle very long prompt (10KB)', async () => {
        // Arrange
        const longPrompt = 'A'.repeat(10000);
        mockDirectAgentService.executeQueryStreaming.mockResolvedValueOnce({
          success: true,
          response: 'Response',
          tokenUsage: { inputTokens: 100, outputTokens: 50 },
        });

        // Act
        const response = await request(app)
          .post('/api/agent/query')
          .set('x-test-user-id', 'user-123')
          .send({ prompt: longPrompt })
          .expect(200);

        // Assert
        expect(response.body.response).toBe('Response');
      });

      it('should handle prompt with Unicode characters', async () => {
        // Arrange
        const unicodePrompt = '你好世界 مرحبا שלום 🌍🚀';
        mockDirectAgentService.executeQueryStreaming.mockResolvedValueOnce({
          success: true,
          response: 'Hello!',
          tokenUsage: { inputTokens: 100, outputTokens: 50 },
        });

        // Act
        const response = await request(app)
          .post('/api/agent/query')
          .set('x-test-user-id', 'user-123')
          .send({ prompt: unicodePrompt })
          .expect(200);

        // Assert - verify unicode prompt was passed to service
        expect(mockDirectAgentService.executeQueryStreaming).toHaveBeenCalled();
        const call = mockDirectAgentService.executeQueryStreaming.mock.calls[0];
        expect(call[0]).toBe(unicodePrompt);
      });

      it('should handle prompt with HTML/script tags', async () => {
        // Arrange
        const xssPrompt = '<script>alert("xss")</script>';
        mockDirectAgentService.executeQueryStreaming.mockResolvedValueOnce({
          success: true,
          response: 'Safe response',
          tokenUsage: { inputTokens: 100, outputTokens: 50 },
        });

        // Act
        const response = await request(app)
          .post('/api/agent/query')
          .set('x-test-user-id', 'user-123')
          .send({ prompt: xssPrompt })
          .expect(200);

        // Assert - should pass through (Claude handles it)
        expect(mockDirectAgentService.executeQueryStreaming).toHaveBeenCalled();
        const call = mockDirectAgentService.executeQueryStreaming.mock.calls[0];
        expect(call[0]).toBe(xssPrompt);
      });

      it('should handle null sessionId gracefully', async () => {
        // Arrange
        mockDirectAgentService.executeQueryStreaming.mockResolvedValueOnce({
          success: true,
          response: 'OK',
          tokenUsage: { inputTokens: 100, outputTokens: 50 },
        });

        // Act
        const response = await request(app)
          .post('/api/agent/query')
          .set('x-test-user-id', 'user-123')
          .send({ prompt: 'Hello', sessionId: null })
          .expect(200);

        // Assert
        expect(mockDirectAgentService.executeQueryStreaming).toHaveBeenCalled();
        const call = mockDirectAgentService.executeQueryStreaming.mock.calls[0];
        expect(call[0]).toBe('Hello');
        expect(call[1]).toBeNull();
      });
    });

    describe('Approval Response Edge Cases', () => {
      it('should handle missing decision field', async () => {
        // Act
        const response = await request(app)
          .post('/api/approvals/approval-123/respond')
          .set('x-test-user-id', 'user-123')
          .send({ reason: 'No decision provided' })
          .expect(400);

        // Assert - standardized error format
        expect(response.body.error).toBe('Bad Request');
        expect(response.body.code).toBe(ErrorCode.INVALID_DECISION);
      });

      it('should handle empty reason field', async () => {
        // Arrange
        mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({ success: true });

        // Act
        const response = await request(app)
          .post('/api/approvals/approval-123/respond')
          .set('x-test-user-id', 'user-123')
          .send({ decision: 'approved', reason: '' })
          .expect(200);

        // Assert - empty reason is valid
        expect(mockApprovalManager.respondToApprovalAtomic).toHaveBeenCalledWith(
          'approval-123',
          'approved',
          'user-123',
          ''
        );
      });

      it('should handle reason with special characters', async () => {
        // Arrange
        const specialReason = 'Approved: <test> & "quotes" \'apostrophe\'';
        mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({ success: true });

        // Act
        const response = await request(app)
          .post('/api/approvals/approval-123/respond')
          .set('x-test-user-id', 'user-123')
          .send({ decision: 'approved', reason: specialReason })
          .expect(200);

        // Assert
        expect(mockApprovalManager.respondToApprovalAtomic).toHaveBeenCalledWith(
          'approval-123',
          'approved',
          'user-123',
          specialReason
        );
      });

      it('should return 404 for SESSION_NOT_FOUND error', async () => {
        // Arrange
        mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({
          success: false,
          error: 'SESSION_NOT_FOUND',
        });

        // Act
        const response = await request(app)
          .post('/api/approvals/orphan-approval/respond')
          .set('x-test-user-id', 'user-123')
          .send({ decision: 'approved' })
          .expect(404);

        // Assert - standardized error format
        expect(response.body.error).toBe('Not Found');
        expect(response.body.code).toBe(ErrorCode.SESSION_NOT_FOUND);
        expect(response.body.message).toContain('Session not found');
      });
    });

    describe('Session ID Format Edge Cases', () => {
      it('should handle session ID with URL-encoded characters', async () => {
        // Arrange
        const encodedSessionId = 'session%2Fwith%2Fslashes';
        mockValidateSessionOwnership.mockResolvedValueOnce({ isOwner: true });
        mockTodoManager.getTodosBySession.mockResolvedValueOnce([]);

        // Act
        const response = await request(app)
          .get(`/api/todos/session/${encodedSessionId}`)
          .set('x-test-user-id', 'user-123')
          .expect(200);

        // Assert - Express decodes URL params
        expect(mockValidateSessionOwnership).toHaveBeenCalled();
      });

      it('should handle very long session ID', async () => {
        // Arrange
        const longSessionId = 'sess-' + 'x'.repeat(200);
        mockValidateSessionOwnership.mockResolvedValueOnce({ isOwner: true });
        mockApprovalManager.getPendingApprovals.mockResolvedValueOnce([]);

        // Act
        const response = await request(app)
          .get(`/api/approvals/session/${longSessionId}`)
          .set('x-test-user-id', 'user-123')
          .expect(200);

        // Assert
        expect(response.body.sessionId).toBe(longSessionId);
      });
    });

    describe('Database Error Edge Cases', () => {
      it('should handle database timeout on pending approvals', async () => {
        // Arrange
        const timeoutError = new Error('Request timeout');
        (timeoutError as NodeJS.ErrnoException).code = 'ETIMEDOUT';
        mockExecuteQuery.mockRejectedValueOnce(timeoutError);

        // Act
        const response = await request(app)
          .get('/api/approvals/pending')
          .set('x-test-user-id', 'user-123')
          .expect(500);

        // Assert - standardized error format
        expect(response.body.error).toBe('Internal Server Error');
        expect(response.body.code).toBe(ErrorCode.DATABASE_ERROR);
      });

      it('should handle null recordset from database', async () => {
        // Arrange
        mockExecuteQuery.mockResolvedValueOnce({ recordset: null });

        // Act
        const response = await request(app)
          .get('/api/approvals/pending')
          .set('x-test-user-id', 'user-123')
          .expect(200);

        // Assert - should handle null as empty
        expect(response.body.count).toBe(0);
        expect(response.body.approvals).toEqual([]);
      });
    });

    describe('Todo Manager Edge Cases', () => {
      it('should handle todo manager throwing error', async () => {
        // Arrange
        mockValidateSessionOwnership.mockResolvedValueOnce({ isOwner: true });
        mockTodoManager.getTodosBySession.mockRejectedValueOnce(new Error('Redis connection lost'));

        // Act
        const response = await request(app)
          .get('/api/todos/session/session-123')
          .set('x-test-user-id', 'user-123')
          .expect(500);

        // Assert - standardized error format
        expect(response.body.error).toBe('Internal Server Error');
        expect(response.body.code).toBe(ErrorCode.DATABASE_ERROR);
      });

      it('should handle todos with null properties', async () => {
        // Arrange
        mockValidateSessionOwnership.mockResolvedValueOnce({ isOwner: true });
        mockTodoManager.getTodosBySession.mockResolvedValueOnce([
          { id: 'todo-1', content: null, status: 'pending' },
          { id: 'todo-2', content: 'Valid todo', status: null },
        ]);

        // Act
        const response = await request(app)
          .get('/api/todos/session/session-123')
          .set('x-test-user-id', 'user-123')
          .expect(200);

        // Assert
        expect(response.body.todos).toHaveLength(2);
      });
    });
  });
});
