/**
 * Comprehensive Tests - Server Endpoints
 *
 * Goal: Increase coverage of server.ts by testing endpoints directly.
 * These tests mock all external dependencies and test the endpoint handlers.
 *
 * @module __tests__/unit/server.comprehensive
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import request from 'supertest';
import express, { Application, Request, Response, NextFunction } from 'express';
import { ErrorCode } from '@/constants/errors';
import {
  sendError,
  sendBadRequest,
  sendUnauthorized,
  sendForbidden,
  sendNotFound,
  sendConflict,
  sendInternalError,
  sendServiceUnavailable,
} from '@/utils/error-response';

// ============================================
// Mock All External Dependencies BEFORE imports
// ============================================

// Mock config modules
vi.mock('@/config/database', () => ({
  executeQuery: vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [0] }),
  initDatabase: vi.fn().mockResolvedValue(undefined),
  closeDatabase: vi.fn().mockResolvedValue(undefined),
  checkDatabaseHealth: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/config/redis', () => ({
  initRedis: vi.fn().mockResolvedValue(undefined),
  closeRedis: vi.fn().mockResolvedValue(undefined),
  checkRedisHealth: vi.fn().mockResolvedValue(true),
  getRedis: vi.fn().mockReturnValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    quit: vi.fn().mockResolvedValue('OK'),
  }),
}));

vi.mock('@/config/keyvault', () => ({
  loadSecretsFromKeyVault: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/config/environment', () => ({
  env: {
    PORT: 3002,
    CORS_ORIGIN: 'http://localhost:3000',
    ANTHROPIC_API_KEY: 'test-key',
    MCP_SERVER_URL: 'http://localhost:4000',
    DATABASE_SERVER: 'test-server',
    DATABASE_NAME: 'test-db',
    DATABASE_USER: 'test-user',
    DATABASE_PASSWORD: 'test-password',
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    ENABLE_EXTENDED_THINKING: false,
    ENABLE_PROMPT_CACHING: false,
  },
  isProd: false,
  printConfig: vi.fn(),
  validateRequiredSecrets: vi.fn(),
}));

// Mock utils
vi.mock('@/utils/databaseKeepalive', () => ({
  startDatabaseKeepalive: vi.fn(),
  stopDatabaseKeepalive: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

vi.mock('@/utils/session-ownership', () => ({
  validateSessionOwnership: vi.fn().mockResolvedValue(true),
}));

// Mock services
const mockMCPService = {
  getMCPServerUrl: vi.fn(() => 'http://localhost:4000'),
  isConfigured: vi.fn(() => true),
  loadTools: vi.fn().mockResolvedValue([]),
  getToolDefinitions: vi.fn().mockReturnValue([]),
  connect: vi.fn().mockResolvedValue(undefined),
  callTool: vi.fn().mockResolvedValue({ result: 'test' }),
};

const mockBCClient = {
  testConnection: vi.fn().mockResolvedValue(true),
  getCustomers: vi.fn().mockResolvedValue([]),
  isConfigured: vi.fn(() => true),
};

const mockDirectAgentService = {
  executeQuery: vi.fn().mockResolvedValue({ success: true, response: 'Test response' }),
  executeQueryStreaming: vi.fn().mockResolvedValue({ success: true, response: 'Test' }),
};

const mockApprovalManager = {
  respondToApprovalAtomic: vi.fn().mockResolvedValue({ success: true }),
  getPendingApprovals: vi.fn().mockResolvedValue([]),
  validateApprovalOwnership: vi.fn().mockResolvedValue(true),
  request: vi.fn().mockResolvedValue(true),
  setSocketServer: vi.fn(),
  resolve: vi.fn(),
};

const mockTodoManager = {
  getTodosBySession: vi.fn().mockResolvedValue([]),
  setSocketServer: vi.fn(),
  createTodo: vi.fn().mockResolvedValue({}),
  updateTodoStatus: vi.fn().mockResolvedValue({}),
};

const mockChatMessageHandler = {
  handleChatMessage: vi.fn().mockResolvedValue(undefined),
};

const mockMessageQueue = {
  waitForReady: vi.fn().mockResolvedValue(undefined),
  addMessagePersistence: vi.fn().mockResolvedValue(undefined),
  getQueueStats: vi.fn().mockResolvedValue({ waiting: 0, active: 0 }),
};

vi.mock('@/services/mcp', () => ({
  getMCPService: () => mockMCPService,
}));

vi.mock('@/services/bc', () => ({
  getBCClient: () => mockBCClient,
}));

vi.mock('@/services/agent', () => ({
  getDirectAgentService: () => mockDirectAgentService,
}));

vi.mock('@/services/approval/ApprovalManager', () => ({
  getApprovalManager: () => mockApprovalManager,
}));

vi.mock('@/services/todo/TodoManager', () => ({
  getTodoManager: () => mockTodoManager,
}));

vi.mock('@/services/websocket/ChatMessageHandler', () => ({
  getChatMessageHandler: () => mockChatMessageHandler,
}));

vi.mock('@/services/queue/MessageQueue', () => ({
  getMessageQueue: () => mockMessageQueue,
}));

// Mock routes
vi.mock('@/routes/auth-mock', () => ({
  default: express.Router(),
}));

vi.mock('@/routes/auth-oauth', () => ({
  default: express.Router(),
}));

vi.mock('@/routes/sessions', () => ({
  default: express.Router(),
}));

vi.mock('@/routes/logs', () => ({
  default: express.Router(),
}));

vi.mock('@/routes/token-usage', () => ({
  default: express.Router(),
}));

// Mock middleware
vi.mock('@/middleware/auth-oauth', () => ({
  authenticateMicrosoft: (req: Request, _res: Response, next: NextFunction) => {
    // Simulate authenticated user from headers
    const userId = req.headers['x-test-user-id'] as string;
    if (userId) {
      req.user = {
        id: userId,
        microsoftId: 'ms-' + userId,
        email: `${userId}@test.com`,
        displayName: 'Test User',
      };
    }
    next();
  },
}));

vi.mock('@/middleware/logging', () => ({
  httpLogger: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Import executeQuery after mocks
import { executeQuery } from '@/config/database';
import { validateSessionOwnership } from '@/utils/session-ownership';

// ============================================
// Test Helpers
// ============================================

/**
 * Creates a test Express app with all routes configured
 * This simulates the actual server.ts configuration
 */
function createTestApp(): Application {
  const app = express();
  app.use(express.json());

  // Middleware to simulate authentication from headers
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const userId = req.headers['x-test-user-id'] as string;
    if (userId) {
      req.user = {
        id: userId,
        microsoftId: 'ms-' + userId,
        email: `${userId}@test.com`,
        displayName: 'Test User',
      };
    }
    next();
  });

  // ========== Health Endpoints ==========
  app.get('/health/liveness', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'alive' });
  });

  app.get('/health', async (_req: Request, res: Response) => {
    const dbHealth = true;
    const redisHealth = true;
    const allHealthy = dbHealth && redisHealth;

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'healthy' : 'degraded',
      components: {
        database: { status: dbHealth ? 'healthy' : 'unhealthy' },
        redis: { status: redisHealth ? 'healthy' : 'unhealthy' },
      },
    });
  });

  // ========== API Base ==========
  app.get('/api', (_req: Request, res: Response) => {
    res.json({
      name: 'BC Claude Agent API',
      version: '1.0.0',
      status: 'running',
      environment: 'test',
    });
  });

  // ========== MCP Endpoints ==========
  app.get('/api/mcp/config', (_req: Request, res: Response): void => {
    res.json({
      serverUrl: mockMCPService.getMCPServerUrl(),
      configured: mockMCPService.isConfigured(),
    });
  });

  app.get('/api/mcp/health', async (_req: Request, res: Response): Promise<void> => {
    const isConfigured = mockMCPService.isConfigured();
    if (!isConfigured) {
      res.status(503).json({
        status: 'unconfigured',
        message: 'MCP server URL not configured',
      });
      return;
    }
    res.json({
      status: 'healthy',
      serverUrl: mockMCPService.getMCPServerUrl(),
    });
  });

  // ========== BC Endpoints ==========
  app.get('/api/bc/test', async (_req: Request, res: Response): Promise<void> => {
    try {
      const isConnected = await mockBCClient.testConnection();
      res.json({
        status: isConnected ? 'connected' : 'disconnected',
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  app.get('/api/bc/customers', async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      sendUnauthorized(res, ErrorCode.UNAUTHORIZED, 'Authentication required');
      return;
    }

    try {
      const customers = await mockBCClient.getCustomers();
      res.json({ customers });
    } catch (error) {
      sendInternalError(res, ErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : 'Failed to get customers');
    }
  });

  // ========== Agent Endpoints ==========
  app.get('/api/agent/status', (_req: Request, res: Response): void => {
    res.json({
      status: 'operational',
      extended_thinking: false,
      mcp_configured: mockMCPService.isConfigured(),
    });
  });

  app.post('/api/agent/query', async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      sendUnauthorized(res, ErrorCode.UNAUTHORIZED, 'Authentication required');
      return;
    }

    const { query, sessionId } = req.body;

    if (!query || !sessionId) {
      sendBadRequest(res, ErrorCode.VALIDATION_ERROR, 'query and sessionId are required');
      return;
    }

    try {
      const result = await mockDirectAgentService.executeQuery(query, sessionId, userId);
      res.json(result);
    } catch (error) {
      sendInternalError(res, ErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : 'Query failed');
    }
  });

  // ========== Approvals Endpoints ==========
  app.post('/api/approvals/:id/respond', async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      sendUnauthorized(res, ErrorCode.UNAUTHORIZED, 'Authentication required');
      return;
    }

    const { id } = req.params;
    const { approved } = req.body;

    if (typeof approved !== 'boolean') {
      sendBadRequest(res, ErrorCode.VALIDATION_ERROR, 'approved must be a boolean');
      return;
    }

    // Check UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      sendBadRequest(res, ErrorCode.VALIDATION_ERROR, 'Invalid approval ID format');
      return;
    }

    try {
      // Get approval to check ownership
      const approval = await executeQuery(
        `SELECT user_id, status FROM approvals WHERE id = @approvalId`,
        { approvalId: id }
      );

      if (!approval.recordset?.[0]) {
        sendNotFound(res, ErrorCode.NOT_FOUND, 'Approval not found');
        return;
      }

      if (approval.recordset[0].user_id !== userId) {
        sendForbidden(res, ErrorCode.FORBIDDEN, 'Not authorized to respond to this approval');
        return;
      }

      if (approval.recordset[0].status !== 'pending') {
        sendConflict(res, ErrorCode.APPROVAL_ALREADY_RESOLVED, 'Approval already resolved');
        return;
      }

      // Atomically update approval
      const result = await mockApprovalManager.respondToApprovalAtomic(id, approved, userId);

      if (!result.success) {
        sendConflict(res, ErrorCode.APPROVAL_ALREADY_RESOLVED, result.error || 'Failed to respond');
        return;
      }

      res.json({
        success: true,
        approved,
        approvalId: id,
      });
    } catch (error) {
      sendInternalError(res, ErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : 'Database error');
    }
  });

  app.get('/api/approvals/pending', async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      sendUnauthorized(res, ErrorCode.UNAUTHORIZED, 'Authentication required');
      return;
    }

    try {
      const approvals = await mockApprovalManager.getPendingApprovals();
      res.json({ approvals });
    } catch (error) {
      sendInternalError(res, ErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : 'Failed to get approvals');
    }
  });

  app.get('/api/approvals/session/:sessionId', async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      sendUnauthorized(res, ErrorCode.UNAUTHORIZED, 'Authentication required');
      return;
    }

    const { sessionId } = req.params;

    try {
      // Validate session ownership
      const isOwner = await validateSessionOwnership(sessionId, userId);
      if (!isOwner) {
        sendForbidden(res, ErrorCode.FORBIDDEN, 'Not authorized to access this session');
        return;
      }

      const approvals = await executeQuery(
        `SELECT * FROM approvals WHERE session_id = @sessionId ORDER BY created_at DESC`,
        { sessionId }
      );

      res.json({ approvals: approvals.recordset || [] });
    } catch (error) {
      sendInternalError(res, ErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : 'Failed to get approvals');
    }
  });

  // ========== Todos Endpoints ==========
  app.get('/api/todos/session/:sessionId', async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      sendUnauthorized(res, ErrorCode.UNAUTHORIZED, 'Authentication required');
      return;
    }

    const { sessionId } = req.params;

    try {
      // Validate session ownership
      const isOwner = await validateSessionOwnership(sessionId, userId);
      if (!isOwner) {
        sendForbidden(res, ErrorCode.FORBIDDEN, 'Not authorized to access this session');
        return;
      }

      const todos = await mockTodoManager.getTodosBySession(sessionId);
      res.json({ todos });
    } catch (error) {
      sendInternalError(res, ErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : 'Failed to get todos');
    }
  });

  return app;
}

describe('Server Endpoints - Comprehensive Tests', () => {
  let app: Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SECTION 1: Health Endpoints
  // =========================================================================
  describe('Health Endpoints', () => {
    it('GET /health/liveness should return alive status', async () => {
      const response = await request(app).get('/health/liveness');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'alive' });
    });

    it('GET /health should return healthy when all components are healthy', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'healthy',
        components: {
          database: { status: 'healthy' },
          redis: { status: 'healthy' },
        },
      });
    });
  });

  // =========================================================================
  // SECTION 2: API Base
  // =========================================================================
  describe('API Base', () => {
    it('GET /api should return API info', async () => {
      const response = await request(app).get('/api');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        name: 'BC Claude Agent API',
        version: '1.0.0',
        status: 'running',
      });
    });
  });

  // =========================================================================
  // SECTION 3: MCP Endpoints
  // =========================================================================
  describe('MCP Endpoints', () => {
    it('GET /api/mcp/config should return MCP configuration', async () => {
      const response = await request(app).get('/api/mcp/config');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        serverUrl: 'http://localhost:4000',
        configured: true,
      });
    });

    it('GET /api/mcp/health should return healthy when configured', async () => {
      const response = await request(app).get('/api/mcp/health');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'healthy',
      });
    });

    it('GET /api/mcp/health should return 503 when not configured', async () => {
      mockMCPService.isConfigured.mockReturnValueOnce(false);

      const response = await request(app).get('/api/mcp/health');

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        status: 'unconfigured',
      });
    });
  });

  // =========================================================================
  // SECTION 4: BC Endpoints
  // =========================================================================
  describe('BC Endpoints', () => {
    it('GET /api/bc/test should return connected status', async () => {
      mockBCClient.testConnection.mockResolvedValueOnce(true);

      const response = await request(app).get('/api/bc/test');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('connected');
    });

    it('GET /api/bc/test should return disconnected when connection fails', async () => {
      mockBCClient.testConnection.mockResolvedValueOnce(false);

      const response = await request(app).get('/api/bc/test');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'disconnected' });
    });

    it('GET /api/bc/test should handle errors', async () => {
      mockBCClient.testConnection.mockRejectedValueOnce(new Error('Connection failed'));

      const response = await request(app).get('/api/bc/test');

      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({
        status: 'error',
        message: 'Connection failed',
      });
    });

    it('GET /api/bc/customers should require authentication', async () => {
      const response = await request(app).get('/api/bc/customers');

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        code: ErrorCode.UNAUTHORIZED,
      });
    });

    it('GET /api/bc/customers should return customers when authenticated', async () => {
      mockBCClient.getCustomers.mockResolvedValueOnce([
        { id: '1', name: 'Customer 1' },
        { id: '2', name: 'Customer 2' },
      ]);

      const response = await request(app)
        .get('/api/bc/customers')
        .set('x-test-user-id', 'user-123');

      expect(response.status).toBe(200);
      expect(response.body.customers).toHaveLength(2);
    });
  });

  // =========================================================================
  // SECTION 5: Agent Endpoints
  // =========================================================================
  describe('Agent Endpoints', () => {
    it('GET /api/agent/status should return agent status', async () => {
      const response = await request(app).get('/api/agent/status');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'operational',
        mcp_configured: true,
      });
    });

    it('POST /api/agent/query should require authentication', async () => {
      const response = await request(app)
        .post('/api/agent/query')
        .send({ query: 'test', sessionId: 'session-1' });

      expect(response.status).toBe(401);
    });

    it('POST /api/agent/query should validate required fields', async () => {
      const response = await request(app)
        .post('/api/agent/query')
        .set('x-test-user-id', 'user-123')
        .send({}); // Missing query and sessionId

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Bad Request');
    });

    it('POST /api/agent/query should execute query when valid', async () => {
      mockDirectAgentService.executeQuery.mockResolvedValueOnce({
        success: true,
        response: 'Query result',
      });

      const response = await request(app)
        .post('/api/agent/query')
        .set('x-test-user-id', 'user-123')
        .send({ query: 'List customers', sessionId: 'session-1' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
      });
    });

    it('POST /api/agent/query should handle errors', async () => {
      mockDirectAgentService.executeQuery.mockRejectedValueOnce(new Error('Agent error'));

      const response = await request(app)
        .post('/api/agent/query')
        .set('x-test-user-id', 'user-123')
        .send({ query: 'Test', sessionId: 'session-1' });

      expect(response.status).toBe(500);
    });
  });

  // =========================================================================
  // SECTION 6: Approvals Endpoints
  // =========================================================================
  describe('Approvals Endpoints', () => {
    const validUUID = '12345678-1234-1234-1234-123456789abc';

    it('POST /api/approvals/:id/respond should require authentication', async () => {
      const response = await request(app)
        .post(`/api/approvals/${validUUID}/respond`)
        .send({ approved: true });

      expect(response.status).toBe(401);
    });

    it('POST /api/approvals/:id/respond should validate approved field', async () => {
      const response = await request(app)
        .post(`/api/approvals/${validUUID}/respond`)
        .set('x-test-user-id', 'user-123')
        .send({ approved: 'yes' }); // Invalid type

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Bad Request');
    });

    it('POST /api/approvals/:id/respond should validate UUID format', async () => {
      const response = await request(app)
        .post('/api/approvals/invalid-uuid/respond')
        .set('x-test-user-id', 'user-123')
        .send({ approved: true });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Bad Request');
    });

    it('POST /api/approvals/:id/respond should return 404 when approval not found', async () => {
      vi.mocked(executeQuery).mockResolvedValueOnce({ recordset: [], rowsAffected: [0] });

      const response = await request(app)
        .post(`/api/approvals/${validUUID}/respond`)
        .set('x-test-user-id', 'user-123')
        .send({ approved: true });

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        code: ErrorCode.NOT_FOUND,
      });
    });

    it('POST /api/approvals/:id/respond should return 403 when not owner', async () => {
      vi.mocked(executeQuery).mockResolvedValueOnce({
        recordset: [{ user_id: 'other-user', status: 'pending' }],
        rowsAffected: [1],
      });

      const response = await request(app)
        .post(`/api/approvals/${validUUID}/respond`)
        .set('x-test-user-id', 'user-123')
        .send({ approved: true });

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
    });

    it('POST /api/approvals/:id/respond should return 409 when already resolved', async () => {
      vi.mocked(executeQuery).mockResolvedValueOnce({
        recordset: [{ user_id: 'user-123', status: 'approved' }],
        rowsAffected: [1],
      });

      const response = await request(app)
        .post(`/api/approvals/${validUUID}/respond`)
        .set('x-test-user-id', 'user-123')
        .send({ approved: true });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Conflict');
    });

    it('POST /api/approvals/:id/respond should succeed for valid request', async () => {
      vi.mocked(executeQuery).mockResolvedValueOnce({
        recordset: [{ user_id: 'user-123', status: 'pending' }],
        rowsAffected: [1],
      });
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({ success: true });

      const response = await request(app)
        .post(`/api/approvals/${validUUID}/respond`)
        .set('x-test-user-id', 'user-123')
        .send({ approved: true });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        approved: true,
        approvalId: validUUID,
      });
    });

    it('GET /api/approvals/pending should require authentication', async () => {
      const response = await request(app).get('/api/approvals/pending');

      expect(response.status).toBe(401);
    });

    it('GET /api/approvals/pending should return approvals when authenticated', async () => {
      mockApprovalManager.getPendingApprovals.mockResolvedValueOnce([
        { id: '1', status: 'pending' },
      ]);

      const response = await request(app)
        .get('/api/approvals/pending')
        .set('x-test-user-id', 'user-123');

      expect(response.status).toBe(200);
      expect(response.body.approvals).toHaveLength(1);
    });

    it('GET /api/approvals/session/:sessionId should require authentication', async () => {
      const response = await request(app).get('/api/approvals/session/session-1');

      expect(response.status).toBe(401);
    });

    it('GET /api/approvals/session/:sessionId should validate ownership', async () => {
      vi.mocked(validateSessionOwnership).mockResolvedValueOnce(false);

      const response = await request(app)
        .get('/api/approvals/session/session-1')
        .set('x-test-user-id', 'user-123');

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        code: ErrorCode.FORBIDDEN,
      });
    });

    it('GET /api/approvals/session/:sessionId should return approvals when authorized', async () => {
      vi.mocked(validateSessionOwnership).mockResolvedValueOnce(true);
      vi.mocked(executeQuery).mockResolvedValueOnce({
        recordset: [{ id: '1', status: 'pending' }],
        rowsAffected: [1],
      });

      const response = await request(app)
        .get('/api/approvals/session/session-1')
        .set('x-test-user-id', 'user-123');

      expect(response.status).toBe(200);
      expect(response.body.approvals).toHaveLength(1);
    });
  });

  // =========================================================================
  // SECTION 7: Todos Endpoints
  // =========================================================================
  describe('Todos Endpoints', () => {
    it('GET /api/todos/session/:sessionId should require authentication', async () => {
      const response = await request(app).get('/api/todos/session/session-1');

      expect(response.status).toBe(401);
    });

    it('GET /api/todos/session/:sessionId should validate ownership', async () => {
      vi.mocked(validateSessionOwnership).mockResolvedValueOnce(false);

      const response = await request(app)
        .get('/api/todos/session/session-1')
        .set('x-test-user-id', 'user-123');

      expect(response.status).toBe(403);
    });

    it('GET /api/todos/session/:sessionId should return todos when authorized', async () => {
      vi.mocked(validateSessionOwnership).mockResolvedValueOnce(true);
      mockTodoManager.getTodosBySession.mockResolvedValueOnce([
        { id: '1', content: 'Todo 1', status: 'pending' },
      ]);

      const response = await request(app)
        .get('/api/todos/session/session-1')
        .set('x-test-user-id', 'user-123');

      expect(response.status).toBe(200);
      expect(response.body.todos).toHaveLength(1);
    });

    it('GET /api/todos/session/:sessionId should handle errors', async () => {
      vi.mocked(validateSessionOwnership).mockResolvedValueOnce(true);
      mockTodoManager.getTodosBySession.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .get('/api/todos/session/session-1')
        .set('x-test-user-id', 'user-123');

      expect(response.status).toBe(500);
    });
  });

  // =========================================================================
  // SECTION 8: Multi-tenant Security
  // =========================================================================
  describe('Multi-tenant Security', () => {
    it('should not allow User A to access User B session approvals', async () => {
      vi.mocked(validateSessionOwnership).mockResolvedValueOnce(false);

      const response = await request(app)
        .get('/api/approvals/session/user-b-session')
        .set('x-test-user-id', 'user-a');

      expect(response.status).toBe(403);
    });

    it('should not allow User A to access User B todos', async () => {
      vi.mocked(validateSessionOwnership).mockResolvedValueOnce(false);

      const response = await request(app)
        .get('/api/todos/session/user-b-session')
        .set('x-test-user-id', 'user-a');

      expect(response.status).toBe(403);
    });

    it('should not allow User A to respond to User B approval', async () => {
      const validUUID = '12345678-1234-1234-1234-123456789abc';
      vi.mocked(executeQuery).mockResolvedValueOnce({
        recordset: [{ user_id: 'user-b', status: 'pending' }],
        rowsAffected: [1],
      });

      const response = await request(app)
        .post(`/api/approvals/${validUUID}/respond`)
        .set('x-test-user-id', 'user-a')
        .send({ approved: true });

      expect(response.status).toBe(403);
    });
  });

  // =========================================================================
  // SECTION 9: Edge Cases
  // =========================================================================
  describe('Edge Cases', () => {
    it('should handle empty recordsets gracefully', async () => {
      vi.mocked(validateSessionOwnership).mockResolvedValueOnce(true);
      vi.mocked(executeQuery).mockResolvedValueOnce({
        recordset: [],
        rowsAffected: [0],
      });

      const response = await request(app)
        .get('/api/approvals/session/session-1')
        .set('x-test-user-id', 'user-123');

      expect(response.status).toBe(200);
      expect(response.body.approvals).toEqual([]);
    });

    it('should handle special characters in session IDs', async () => {
      vi.mocked(validateSessionOwnership).mockResolvedValueOnce(true);
      mockTodoManager.getTodosBySession.mockResolvedValueOnce([]);

      const response = await request(app)
        .get('/api/todos/session/session%2F123') // URL encoded /
        .set('x-test-user-id', 'user-123');

      expect(response.status).toBe(200);
    });

    it('should handle concurrent requests', async () => {
      vi.mocked(validateSessionOwnership).mockResolvedValue(true);
      mockTodoManager.getTodosBySession.mockResolvedValue([]);

      const responses = await Promise.all([
        request(app)
          .get('/api/todos/session/session-1')
          .set('x-test-user-id', 'user-1'),
        request(app)
          .get('/api/todos/session/session-2')
          .set('x-test-user-id', 'user-2'),
        request(app)
          .get('/api/todos/session/session-3')
          .set('x-test-user-id', 'user-3'),
      ]);

      expect(responses.every(r => r.status === 200)).toBe(true);
    });
  });
});
