/**
 * BC Claude Agent - Backend Server
 *
 * Express server with Socket.IO for real-time communication.
 * Integrates with Azure SQL, Redis, Business Central (via MCP), and Claude API.
 *
 * @module server
 */

import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import session from 'express-session';
import RedisStore from 'connect-redis';
import { env, isProd, printConfig, validateRequiredSecrets } from '@infrastructure/config/environment';
import { loadSecretsFromKeyVault } from '@infrastructure/keyvault/keyvault';
import { initDatabase, closeDatabase, checkDatabaseHealth, executeQuery } from '@infrastructure/database/database';
import { initRedis, closeRedis, checkRedisHealth } from '@infrastructure/redis/redis'; // ioredis for BullMQ only
import { initRedisClient, closeRedisClient, getRedisClient } from '@infrastructure/redis/redis-client'; // redis package for sessions
import { startDatabaseKeepalive, stopDatabaseKeepalive } from '@shared/utils/databaseKeepalive';
import { logger } from '@shared/utils/logger';
import { getBCClient } from '@/services/bc';
import { getDirectAgentService } from '@/services/agent';
import { getApprovalManager } from '@/domains/approval/ApprovalManager';
import { getTodoManager } from '@/services/todo/TodoManager';
import { getChatMessageHandler } from '@/services/websocket/ChatMessageHandler';
import { getMessageQueue } from '@/infrastructure/queue/MessageQueue';
import authOAuthRoutes from './routes/auth-oauth';
import sessionsRoutes from './routes/sessions';
import logsRoutes from './routes/logs';
import tokenUsageRoutes from './routes/token-usage';
import fileRoutes from './routes/files';
import usageRoutes from './routes/usage';
import billingRoutes from './routes/billing';
import gdprRoutes from './routes/gdpr';
import { authenticateMicrosoft } from '@domains/auth/middleware/auth-oauth';
import { httpLogger } from '@shared/middleware/logging';
import { validateSessionOwnership } from '@shared/utils/session-ownership';
import { MicrosoftOAuthSession } from './types/microsoft.types';
import { Socket } from 'socket.io';
import { ErrorCode } from '@shared/constants/errors';
import {
  sendError,
  sendBadRequest,
  sendUnauthorized,
  sendForbidden,
  sendNotFound,
  sendConflict,
  sendInternalError,
  sendServiceUnavailable,
} from '@shared/utils/error-response';

/**
 * Extend express-session types to include Microsoft OAuth session data
 */
declare module 'express-session' {
  interface SessionData {
    microsoftOAuth?: MicrosoftOAuthSession;
    oauthState?: string;
  }
}

/**
 * Extend Socket.IO socket interface to include user info
 */
interface AuthenticatedSocket extends Socket {
  userId?: string;
  userEmail?: string;
}

/**
 * Express application instance
 */
const app = express();

/**
 * HTTP server instance
 */
const httpServer = createServer(app);

/**
 * Session middleware configuration (shared between Express and Socket.IO)
 * Initialized after Redis connection in initializeApp()
 */
let sessionMiddleware: ReturnType<typeof session>;

/**
 * Socket.IO server instance
 */
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: env.CORS_ORIGIN.includes(',')
      ? env.CORS_ORIGIN.split(',').map(o => o.trim())
      : env.CORS_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

/**
 * Database availability flag
 */
let isDatabaseAvailable = false;

/**
 * Initialize the application
 */
async function initializeApp(): Promise<void> {
  try {
    console.log('🚀 Starting BC Claude Agent Backend...\n');

    // Print configuration
    printConfig();
    console.log('');

    // Step 1: Load secrets from Azure Key Vault (if in production)
    if (isProd || env.AZURE_KEY_VAULT_NAME) {
      await loadSecretsFromKeyVault();
      console.log('');
    }

    // Step 2: Validate required secrets
    validateRequiredSecrets();

    // Step 2.5: Log API key status for diagnostics
    console.log('🔑 Environment variables loaded:');
    console.log(`   ANTHROPIC_API_KEY: ${env.ANTHROPIC_API_KEY ? `✅ Present (${env.ANTHROPIC_API_KEY.length} chars, starts with "${env.ANTHROPIC_API_KEY.substring(0, 8)}...")` : '❌ MISSING'}`);
    console.log('');

    // Step 3: Initialize database connection with retry
    let dbConnected = false;
    const maxDbRetries = 3;
    const dbRetryDelay = 3000; // 3 seconds

    for (let attempt = 1; attempt <= maxDbRetries && !dbConnected; attempt++) {
      try {
        console.log(`🔌 Initializing database connection (server-level attempt ${attempt}/${maxDbRetries})...`);
        await initDatabase();
        isDatabaseAvailable = true;
        dbConnected = true;

        // Start database keepalive to maintain connection during inactivity
        startDatabaseKeepalive();

        console.log('');
      } catch (dbError) {
        console.error(`❌ Database initialization failed (attempt ${attempt}/${maxDbRetries})`);
        console.error(`   Error: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`);

        if (attempt < maxDbRetries) {
          console.log(`🔄 Retrying in ${dbRetryDelay / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, dbRetryDelay));
        } else {
          isDatabaseAvailable = false;
          console.warn('⚠️  Database connection failed after all retries - using mock authentication');
          console.log('');
        }
      }
    }

    // Step 4: Initialize Redis connections
    // 4a. Redis client (redis package) for sessions - compatible with connect-redis@7
    await initRedisClient();
    console.log('');

    // 4b. ioredis client for BullMQ (MessageQueue)
    await initRedis();
    console.log('');

    // Step 4.5: Initialize session middleware with RedisStore
    const redisClient = getRedisClient();
    if (!redisClient) {
      throw new Error('Redis client not initialized for session store');
    }

    sessionMiddleware = session({
      store: new RedisStore({
        client: redisClient,
        prefix: 'sess:',
        ttl: 86400, // 24 hours in seconds
      }),
      secret: process.env.SESSION_SECRET || 'development-secret-change-in-production',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: isProd, // HTTPS only in production
        httpOnly: true,
        maxAge: parseInt(process.env.SESSION_MAX_AGE || '86400000'), // 24 hours default
        sameSite: 'lax',
      },
    });
    console.log('✅ Session middleware configured with RedisStore');
    console.log('');

    // Step 4.6: Initialize MessageQueue eagerly (fail fast if Redis unavailable)
    console.log('🔌 Initializing MessageQueue (BullMQ)...');
    try {
      const messageQueue = getMessageQueue();
      await messageQueue.waitForReady();
      console.log('✅ MessageQueue initialized successfully');
      console.log('   Queues: message-persistence, tool-execution, event-processing');
    } catch (error) {
      console.error('❌ MessageQueue initialization failed:', error instanceof Error ? error.message : 'Unknown error');
      throw new Error('Critical: MessageQueue requires Redis connection for BullMQ');
    }
    console.log('');

    // Step 5: Initialize BC Client (validate credentials)
    console.log('🔑 Validating Business Central credentials...');
    const bcClient = getBCClient();
    const bcValid = await bcClient.validateCredentials();
    if (bcValid) {
      console.log('✅ Business Central authentication successful');
    } else {
      console.warn('⚠️  Business Central authentication failed');
    }
    console.log('');

    // Step 6: Initialize Approval Manager (requires Socket.IO)
    console.log('📋 Initializing Approval Manager...');
    const approvalManager = getApprovalManager(io);
    console.log('✅ Approval Manager initialized');
    console.log('');

    // Step 7: Initialize Todo Manager (requires Socket.IO)
    console.log('✅ Initializing Todo Manager...');
    const todoManager = getTodoManager(io);
    console.log('✅ Todo Manager initialized');
    console.log('');

    // Step 8: Initialize Direct Agent Service (bypasses ProcessTransport bug)
    console.log('🤖 Initializing Direct Agent Service (workaround)...');
    // Initialize singleton (will be used by routes/socket handlers)
    getDirectAgentService(approvalManager, todoManager);
    if (env.ANTHROPIC_API_KEY) {
      console.log('✅ Direct Agent Service initialized');
      console.log(`   Model: ${env.ANTHROPIC_MODEL}`);
      console.log(`   Strategy: Direct API (bypasses Agent SDK bug)`);
      console.log(`   Tools: 115 BC entities (vendored from data files)`);
    } else {
      console.warn('⚠️  Direct Agent Service: ANTHROPIC_API_KEY not configured');
    }
    console.log('');

    console.log('✅ All services initialized successfully\n');
  } catch (error) {
    console.error('❌ Failed to initialize application:', error);
    process.exit(1);
  }
}

/**
 * Configure Express middleware
 */
function configureMiddleware(): void {
  // CORS
  app.use(cors({
    origin: env.CORS_ORIGIN.includes(',')
      ? env.CORS_ORIGIN.split(',').map(o => o.trim())
      : env.CORS_ORIGIN,
    credentials: true,
  }));

  // HTTP request/response logging (Pino) - EARLY in middleware chain
  app.use(httpLogger);

  // Session middleware (shared with Socket.IO)
  app.use(sessionMiddleware);

  // Body parsing with explicit UTF-8 charset
  app.use(express.json({ type: 'application/json' }));
  app.use(express.urlencoded({ extended: true, type: 'application/x-www-form-urlencoded' }));

  // Ensure all JSON responses have UTF-8 charset
  app.use((_req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
  });
}

/**
 * Configure routes
 */
function configureRoutes(): void {
  // Liveness probe - always returns 200 if server is running
  app.get('/health/liveness', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'alive',
      timestamp: new Date().toISOString(),
    });
  });

  // Health check endpoint - checks critical services only (DB + Redis)
  app.get('/health', async (_req: Request, res: Response) => {
    const dbHealth = await checkDatabaseHealth();
    const redisHealth = await checkRedisHealth();

    // Critical services: Database and Redis (required for core functionality)
    const allHealthy = dbHealth && redisHealth;

    const health = {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealth ? 'up' : 'down',
        redis: redisHealth ? 'up' : 'down',
      },
    };

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  });

  // API root
  app.get('/api', (_req: Request, res: Response) => {
    res.json({
      name: 'BC Claude Agent API',
      version: '1.0.0',
      status: 'running',
      documentation: '/api/docs',
      endpoints: {
        health: '/health',
        liveness: '/health/liveness',
        auth: {
          register: '/api/auth/register',
          login: '/api/auth/login',
          logout: '/api/auth/logout',
          refresh: '/api/auth/refresh',
          me: '/api/auth/me',
          status: '/api/auth/status',
        },
        bc: {
          test: '/api/bc/test',
          customers: '/api/bc/customers',
        },
        agent: {
          status: '/api/agent/status',
          query: '/api/agent/query',
        },
        approvals: {
          respond: '/api/approvals/:id/respond',
          getPending: '/api/approvals/session/:sessionId',
        },
        todos: {
          getTodos: '/api/todos/session/:sessionId',
        },
      },
    });
  });

  // BC endpoints
  app.get('/api/bc/test', async (_req: Request, res: Response): Promise<void> => {
    try {
      const bcClient = getBCClient();

      // Test authentication
      const authValid = await bcClient.validateCredentials();
      if (!authValid) {
        sendUnauthorized(res, ErrorCode.INVALID_TOKEN);
        return;
      }

      // Test connection
      const connected = await bcClient.testConnection();
      if (!connected) {
        sendServiceUnavailable(res, ErrorCode.BC_UNAVAILABLE);
        return;
      }

      // Get token status
      const tokenStatus = bcClient.getTokenStatus();

      res.json({
        authenticated: true,
        connected: true,
        token: {
          hasToken: tokenStatus.hasToken,
          expiresAt: tokenStatus.expiresAt,
        },
      });
    } catch (error) {
      console.error('[API] BC test failed:', error);
      sendInternalError(res, ErrorCode.SERVICE_ERROR);
    }
  });

  // GET /api/bc/customers - List Business Central customers
  // Security: Requires Microsoft OAuth authentication (multi-tenant safety)
  app.get('/api/bc/customers', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId;

    logger.info('[API] BC customers query requested', {
      userId,
      top: req.query.top,
      filter: req.query.filter,
    });

    try {
      const bcClient = getBCClient();

      // Parse query parameters
      const top = req.query.top ? parseInt(req.query.top as string) : 10;
      const filter = req.query.filter as string | undefined;

      const result = await bcClient.query('customers', {
        select: ['id', 'number', 'displayName', 'email', 'blocked', 'balance'],
        top,
        filter,
        count: true,
      });

      if (!result.success) {
        logger.error('[API] Query customers failed', {
          userId,
          error: result.error,
        });
        sendInternalError(res, ErrorCode.SERVICE_ERROR);
        return;
      }

      logger.info('[API] BC customers query successful', {
        userId,
        count: result.data['@odata.count'],
      });

      res.json({
        count: result.data['@odata.count'],
        customers: result.data.value,
      });
    } catch (error) {
      logger.error('[API] Query customers failed', {
        userId,
        err: error,
      });
      sendInternalError(res, ErrorCode.SERVICE_ERROR);
    }
  });

  // Agent endpoints
  app.get('/api/agent/status', (_req: Request, res: Response): void => {
    const status = {
      configured: !!env.ANTHROPIC_API_KEY,
      config: {
        hasApiKey: !!env.ANTHROPIC_API_KEY,
        model: env.ANTHROPIC_MODEL,
        strategy: 'direct-api',
        mcpConfigured: true,
        toolsAvailable: 115,
      },
      toolsSource: {
        type: 'vendored-json-files',
        location: 'backend/mcp-server/data/v1.0/',
        count: 115,
      },
      implementation: {
        type: 'DirectAgentService',
        reason: 'Bypasses Agent SDK ProcessTransport bug',
        manualAgenticLoop: true,
      },
    };

    res.json(status);
  });

  app.post('/api/agent/query', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
    try {
      const agentService = getDirectAgentService();

      if (!env.ANTHROPIC_API_KEY) {
        sendServiceUnavailable(res, ErrorCode.SERVICE_UNAVAILABLE);
        return;
      }

      const { prompt, sessionId, attachments } = req.body;
      const userId = req.userId;

      if (!prompt || typeof prompt !== 'string') {
        sendBadRequest(res, 'prompt is required and must be a string', 'prompt');
        return;
      }

      if (attachments && (!Array.isArray(attachments) || !attachments.every((id: unknown) => typeof id === 'string'))) {
        sendBadRequest(res, 'attachments must be an array of string file IDs', 'attachments');
        return;
      }

      if (!userId) {
        sendBadRequest(res, 'userId is required (missing from session)', 'userId');
        return;
      }

      // Execute query with streaming (REST endpoint doesn't stream to client)
      const result = await agentService.executeQueryStreaming(
        prompt,
        sessionId,
        undefined, // onEvent - not used for REST endpoint
        userId,
        {
          attachments: attachments as string[]
        }
      );

      res.json(result);
    } catch (error) {
      console.error('[API] Agent query failed:', error);
      sendInternalError(res, ErrorCode.MESSAGE_PROCESSING_ERROR);
    }
  });

  // Approval endpoints
  // POST /api/approvals/:id/respond - Respond to an approval request
  // Uses atomic validation to prevent TOCTOU race conditions (F4-001 security fix)
  app.post('/api/approvals/:id/respond', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
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

      // TypeScript narrowing workaround
      const userIdVerified: string = userId;
      const decisionVerified: 'approved' | 'rejected' = decision as 'approved' | 'rejected';

      const approvalManager = getApprovalManager();

      // SECURITY: Use atomic method that combines validation + response in single transaction
      // This prevents TOCTOU (Time Of Check To Time Of Use) race conditions
      const result = await approvalManager.respondToApprovalAtomic(
        approvalId,
        decisionVerified,
        userIdVerified,
        reason
      );

      if (!result.success) {
        // Return appropriate error based on the failure reason
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

      res.json({
        success: true,
        approvalId,
        decision,
      });
    } catch (error) {
      logger.error({ err: error, path: req.path }, 'Approval response failed');
      sendInternalError(res);
    }
  });

  // GET /api/approvals/pending - Get all pending approvals for current user (cross-session)
  app.get('/api/approvals/pending', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;

      if (!userId) {
        sendUnauthorized(res, ErrorCode.USER_ID_NOT_IN_SESSION);
        return;
      }

      // Query all pending approvals for sessions belonging to the user
      const query = `
        SELECT
          a.id,
          a.session_id,
          a.tool_name,
          a.tool_args,
          a.status,
          a.priority,
          a.expires_at,
          a.created_at,
          s.user_id
        FROM approvals a
        INNER JOIN sessions s ON a.session_id = s.id
        WHERE s.user_id = @userId AND a.status = 'pending'
        ORDER BY a.created_at DESC
      `;

      const result = await executeQuery<{
        id: string;
        session_id: string;
        tool_name: string;
        tool_args: string;
        status: string;
        priority: string;
        expires_at: Date;
        created_at: Date;
        user_id: string;
      }>(query, { userId });

      // Transform backend format to frontend format
      const approvals = (result.recordset || []).map((row) => {
        // Parse tool_args JSON
        let actionData: Record<string, unknown> = {};
        try {
          actionData = row.tool_args ? JSON.parse(row.tool_args) : {};
        } catch (e) {
          console.error('[API] Failed to parse tool_args:', e);
        }

        // Convert priority string to number
        const priorityMap: Record<string, number> = {
          high: 3,
          medium: 2,
          low: 1,
        };

        return {
          id: row.id,
          session_id: row.session_id,
          user_id: row.user_id,
          action_type: row.tool_name, // Map tool_name to action_type
          action_data: actionData,     // Parse tool_args to action_data
          status: row.status as 'pending' | 'approved' | 'rejected',
          priority: priorityMap[row.priority] || 2,
          expires_at: row.expires_at ? row.expires_at.toISOString() : undefined,
          created_at: row.created_at.toISOString(),
        };
      });

      res.json({
        count: approvals.length,
        approvals,
      });
    } catch (error) {
      console.error('[API] Get pending approvals failed:', error);
      sendInternalError(res, ErrorCode.DATABASE_ERROR);
    }
  });

  // GET /api/approvals/session/:sessionId - Get pending approvals for a session
  // Security: Validates user owns the session (multi-tenant safety)
  app.get('/api/approvals/session/:sessionId', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
    try {
      const sessionId = req.params.sessionId as string;
      const userId = req.userId;

      if (!userId) {
        sendUnauthorized(res);
        return;
      }

      // Multi-tenant validation: User must own the session
      const ownershipResult = await validateSessionOwnership(sessionId, userId);
      if (!ownershipResult.isOwner) {
        if (ownershipResult.error === 'SESSION_NOT_FOUND') {
          sendNotFound(res, ErrorCode.SESSION_NOT_FOUND);
          return;
        }

        logger.warn('Unauthorized approvals access attempt blocked', {
          sessionId,
          attemptedByUserId: userId,
          error: ownershipResult.error,
        });

        sendForbidden(res, ErrorCode.SESSION_ACCESS_DENIED);
        return;
      }

      const approvalManager = getApprovalManager();
      const pendingApprovals = await approvalManager.getPendingApprovals(sessionId);

      res.json({
        sessionId,
        count: pendingApprovals.length,
        approvals: pendingApprovals,
      });
    } catch (error) {
      console.error('[API] Get pending approvals failed:', error);
      sendInternalError(res, ErrorCode.DATABASE_ERROR);
    }
  });


  // Todo endpoints
  // GET /api/todos/session/:sessionId - Get todos for a session
  // Security: Validates user owns the session (multi-tenant safety)
  app.get('/api/todos/session/:sessionId', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
    try {
      const sessionId = req.params.sessionId as string;
      const userId = req.userId;

      if (!userId) {
        sendUnauthorized(res);
        return;
      }

      // Multi-tenant validation: User must own the session
      const ownershipResult = await validateSessionOwnership(sessionId, userId);
      if (!ownershipResult.isOwner) {
        if (ownershipResult.error === 'SESSION_NOT_FOUND') {
          sendNotFound(res, ErrorCode.SESSION_NOT_FOUND);
          return;
        }

        logger.warn('Unauthorized todos access attempt blocked', {
          sessionId,
          attemptedByUserId: userId,
          error: ownershipResult.error,
        });

        sendForbidden(res, ErrorCode.SESSION_ACCESS_DENIED);
        return;
      }

      const todoManager = getTodoManager();
      const todos = await todoManager.getTodosBySession(sessionId);

      res.json({
        sessionId,
        count: todos.length,
        todos,
      });
    } catch (error) {
      console.error('[API] Get todos failed:', error);
      sendInternalError(res, ErrorCode.DATABASE_ERROR);
    }
  });

  // Auth routes - Microsoft OAuth (requires database)
  if (isDatabaseAvailable) {
    app.use('/api/auth', authOAuthRoutes);
  } else {
    logger.warn('Auth routes not available - database is required for authentication');
  }

  // Chat sessions routes (requires database)
  if (isDatabaseAvailable) {
    app.use('/api/chat/sessions', sessionsRoutes);
    // Token usage analytics endpoints (requires database)
    app.use('/api/token-usage', tokenUsageRoutes);
    // File upload/download endpoints (requires database)
    app.use('/api/files', fileRoutes);
    // Usage tracking and quota endpoints (requires database)
    app.use('/api/usage', usageRoutes);
    // Billing and invoice endpoints (requires database)
    app.use('/api/billing', billingRoutes);
    // GDPR compliance endpoints (requires database)
    app.use('/api/gdpr', gdprRoutes);
  }

  // Client log ingestion endpoint
  app.use('/api', logsRoutes);

  // 404 handler
  app.use((req: Request, res: Response) => {
    sendError(res, ErrorCode.NOT_FOUND, `Route ${req.method} ${req.path} not found`);
  });
}

/**
 * Configure error handling
 */
function configureErrorHandling(): void {
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    // Log error with full context (Pino automatically serializes Error objects)
    if ('log' in req && typeof (req as { log?: { error: (context: unknown, message: string) => void } }).log?.error === 'function') {
      (req as { log: { error: (context: unknown, message: string) => void } }).log.error({ err }, 'Unhandled error');
    } else {
      logger.error({ err }, 'Unhandled error');
    }

    // Use standardized error response - don't leak error details in production
    if (isProd) {
      sendInternalError(res);
    } else {
      // In development, include error details for debugging
      sendError(res, ErrorCode.INTERNAL_ERROR, err.message, { stack: err.stack || 'No stack trace' });
    }
  });
}

/**
 * Configure Socket.IO
 */
function configureSocketIO(): void {
  // Wrap session middleware for Socket.IO (converts Express middleware to Socket.IO middleware)
  io.engine.use(sessionMiddleware);

  // Socket.IO authentication middleware
  io.use((socket, next) => {
    const req = socket.request as express.Request;

    // Check if session exists
    if (!req.session || !req.session.microsoftOAuth) {
      console.warn('[Socket.IO] Connection rejected: No valid session', {
        socketId: socket.id,
      });
      return next(new Error('Authentication required'));
    }

    const oauthSession = req.session.microsoftOAuth as MicrosoftOAuthSession;

    // Verify session has userId
    if (!oauthSession.userId) {
      console.warn('[Socket.IO] Connection rejected: No userId in session', {
        socketId: socket.id,
      });
      return next(new Error('Invalid session'));
    }

    // Check token expiration
    if (oauthSession.tokenExpiresAt && new Date(oauthSession.tokenExpiresAt) <= new Date()) {
      console.warn('[Socket.IO] Connection rejected: Token expired', {
        socketId: socket.id,
        userId: oauthSession.userId,
      });
      return next(new Error('Session expired'));
    }

    // Attach userId to socket for later use
    const authSocket = socket as AuthenticatedSocket;
    authSocket.userId = oauthSession.userId;
    authSocket.userEmail = oauthSession.email;

    next();
  });

  io.on('connection', (socket) => {
    const authSocket = socket as AuthenticatedSocket;
    const userId = authSocket.userId;
    logger.info(`[Socket.IO] ✅ Client connected: ${socket.id} (User: ${userId})`);

    // Handler: Chat message
    socket.on('chat:message', async (data: { message: string; sessionId: string; userId: string }) => {
      logger.info('[WebSocket] chat:message event received', {
        sessionId: data?.sessionId,
        userId: data?.userId,
        messageLength: data?.message?.length || 0,
        hasMessage: !!data?.message,
        messagePreview: data?.message?.substring(0, 50) || 'EMPTY',
      });

      const chatHandler = getChatMessageHandler();
      await chatHandler.handle(data, socket, io);
    });

    // Handler: Approval response
    // Security: Uses authenticated userId from socket, NOT from client payload
    // Uses atomic method to prevent TOCTOU race conditions
    socket.on('approval:response', async (data: {
      approvalId: string;
      decision: 'approved' | 'rejected';
      userId?: string; // Ignored - we use authSocket.userId instead
      reason?: string;
    }) => {
      const { approvalId, decision, reason } = data;

      // Security: Get userId from authenticated socket, NOT from client payload
      // This prevents impersonation attacks where attacker sends another user's ID
      const authenticatedUserId = authSocket.userId;

      if (!authenticatedUserId) {
        logger.warn('[Socket] Approval response rejected: Socket not authenticated', {
          socketId: socket.id,
          approvalId,
        });
        socket.emit('approval:error', {
          error: 'Socket not authenticated. Please reconnect.',
        });
        return;
      }

      // Validate decision is valid
      if (!decision || !['approved', 'rejected'].includes(decision)) {
        logger.warn('[Socket] Approval response rejected: Invalid decision', {
          socketId: socket.id,
          approvalId,
          decision,
          userId: authenticatedUserId,
        });
        socket.emit('approval:error', {
          error: 'Invalid decision. Must be "approved" or "rejected".',
        });
        return;
      }

      try {
        const approvalManager = getApprovalManager();

        // Security: Use atomic method that combines validation + response in single transaction
        // This prevents TOCTOU (Time Of Check To Time Of Use) race conditions
        const result = await approvalManager.respondToApprovalAtomic(
          approvalId,
          decision,
          authenticatedUserId, // Use authenticated userId, not client-provided
          reason
        );

        if (!result.success) {
          // Map error codes to user-friendly messages
          const errorMessages: Record<string, string> = {
            'APPROVAL_NOT_FOUND': 'Approval request not found.',
            'SESSION_NOT_FOUND': 'Session associated with this approval no longer exists.',
            'UNAUTHORIZED': 'You do not have permission to respond to this approval.',
            'ALREADY_RESOLVED': `This approval has already been ${result.previousStatus || 'resolved'}.`,
            'EXPIRED': 'This approval request has expired.',
            'NO_PENDING_PROMISE': 'Server state inconsistent. Please retry the operation.',
          };

          const errorMessage = errorMessages[result.error || ''] || 'An unexpected error occurred.';

          logger.warn('[Socket] Approval response failed', {
            socketId: socket.id,
            approvalId,
            userId: authenticatedUserId,
            error: result.error,
          });

          socket.emit('approval:error', {
            error: errorMessage,
            code: result.error,
          });
          return;
        }

        logger.info('[Socket] Approval response processed successfully', {
          socketId: socket.id,
          approvalId,
          decision,
          userId: authenticatedUserId,
        });

        // F4-002: The ApprovalManager now emits via agent:event with type 'approval_resolved'
        // No need to emit approval:resolved here - it's handled by respondToApprovalAtomic()
        // which persists to EventStore and emits agent:event with sequenceNumber
      } catch (error) {
        logger.error('[Socket] Approval response error', {
          err: error,
          socketId: socket.id,
          approvalId,
          userId: authenticatedUserId,
        });
        socket.emit('approval:error', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Handler: Join session
    // Security: Validates user owns the session before allowing them to join the room
    // This prevents users from receiving events from other users' sessions
    socket.on('session:join', async (data: { sessionId: string }) => {
      const { sessionId } = data;

      // Security: Get userId from authenticated socket
      const authenticatedUserId = authSocket.userId;

      if (!authenticatedUserId) {
        logger.warn('[Socket] Session join rejected: Socket not authenticated', {
          socketId: socket.id,
          sessionId,
        });
        socket.emit('session:error', {
          error: 'Socket not authenticated. Please reconnect.',
          code: 'NOT_AUTHENTICATED',
        });
        return;
      }

      if (!sessionId) {
        logger.warn('[Socket] Session join rejected: Missing sessionId', {
          socketId: socket.id,
          userId: authenticatedUserId,
        });
        socket.emit('session:error', {
          error: 'Session ID is required.',
          code: 'MISSING_SESSION_ID',
        });
        return;
      }

      try {
        // Security: Validate user owns this session (multi-tenant safety)
        const ownershipResult = await validateSessionOwnership(sessionId, authenticatedUserId);

        if (!ownershipResult.isOwner) {
          if (ownershipResult.error === 'SESSION_NOT_FOUND') {
            logger.warn('[Socket] Session join rejected: Session not found', {
              socketId: socket.id,
              sessionId,
              userId: authenticatedUserId,
            });
            socket.emit('session:error', {
              error: 'Session not found.',
              code: 'SESSION_NOT_FOUND',
            });
            return;
          }

          logger.warn('[Socket] Session join rejected: Unauthorized access attempt', {
            socketId: socket.id,
            sessionId,
            attemptedByUserId: authenticatedUserId,
            error: ownershipResult.error,
          });
          socket.emit('session:error', {
            error: 'You do not have access to this session.',
            code: 'UNAUTHORIZED',
          });
          return;
        }

        // Ownership validated - allow joining the room
        socket.join(sessionId);
        logger.info(`[Socket.IO] Client ${socket.id} joined room: ${sessionId}`, {
          userId: authenticatedUserId,
        });

        socket.emit('session:joined', { sessionId });

        // NEW: Explicit acknowledgment that socket is ready to receive events
        // This ensures the socket is fully in the room before client proceeds
        socket.emit('session:ready', { sessionId, timestamp: new Date().toISOString() });
      } catch (error) {
        logger.error('[Socket] Session join error', {
          err: error,
          socketId: socket.id,
          sessionId,
          userId: authenticatedUserId,
        });
        socket.emit('session:error', {
          error: 'Failed to join session. Please try again.',
          code: 'INTERNAL_ERROR',
        });
      }
    });

    // Handler: Leave session
    // Note: No ownership validation needed for leaving - users can always leave rooms
    socket.on('session:leave', (data: { sessionId: string }) => {
      const { sessionId } = data;
      socket.leave(sessionId);
      logger.info(`[Socket.IO] Client ${socket.id} left room: ${sessionId}`, {
        userId: authSocket.userId,
      });

      socket.emit('session:left', { sessionId });
    });

    // Disconnect handler
    socket.on('disconnect', () => {
      logger.info(`[Socket.IO] ❌ Client disconnected: ${socket.id}`);
    });

    // Catch-all for unknown events (debugging only)
    socket.onAny((eventName, ...args) => {
      const knownEvents = [
        'chat:message',
        'approval:response',
        'session:join',
        'session:leave',
        'disconnect',
      ];

      if (!knownEvents.includes(eventName)) {
        logger.warn('[WebSocket] Unknown event received', {
          eventName,
          socketId: socket.id,
          userId: authSocket.userId,
          argsCount: args.length,
          preview: JSON.stringify(args).substring(0, 200),
        });
      }
    });

    // Error handler
    socket.on('error', (error) => {
      console.error(`❌ Socket error for ${socket.id}:`, error);
    });
  });
}

/**
 * Start the server
 */
async function startServer(): Promise<void> {
  try {
    // Initialize app
    await initializeApp();

    // Configure middleware
    configureMiddleware();

    // Configure routes
    configureRoutes();

    // Configure error handling
    configureErrorHandling();

    // Configure Socket.IO
    configureSocketIO();

    // Start listening
    httpServer.listen(env.PORT, () => {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`✅ Server running on port ${env.PORT}`);
      console.log(`   Environment: ${env.NODE_ENV}`);
      console.log(`   HTTP: http://localhost:${env.PORT}`);
      console.log(`   WebSocket: ws://localhost:${env.PORT}`);
      console.log(`   Health: http://localhost:${env.PORT}/health`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n⚠️  ${signal} received, shutting down gracefully...`);

  try {
    // 1. Close HTTP server (stop accepting new requests)
    await new Promise<void>((resolve) => {
      httpServer.close(() => {
        console.log('✅ HTTP server closed');
        resolve();
      });
    });

    // 2. Close Socket.IO (disconnect clients)
    await new Promise<void>((resolve) => {
      io.close(() => {
        console.log('✅ Socket.IO server closed');
        resolve();
      });
    });

    // 3. Close MessageQueue (CRITICAL - drain active jobs before DB closes)
    console.log('🔄 Closing MessageQueue (draining active jobs)...');
    try {
      const messageQueue = getMessageQueue();
      await messageQueue.close();
      console.log('✅ MessageQueue closed');
    } catch (error) {
      console.error('⚠️  MessageQueue close error:', error);
      // Continue shutdown even if MessageQueue fails
    }

    // 4. Stop database keepalive
    stopDatabaseKeepalive();

    // 5. Close database connection
    await closeDatabase();

    // 6. Close Redis connections (do this AFTER MessageQueue closes)
    await closeRedisClient(); // Session client (redis package)
    await closeRedis(); // BullMQ client (ioredis)

    console.log('✅ All connections closed, exiting...');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
}

/**
 * Handle uncaught errors
 */
process.on('uncaughtException', (error: Error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('❌ Unhandled Rejection:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

/**
 * Handle process signals
 */
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/**
 * Create and configure the Express app for testing
 * This is used by E2E tests to get a configured app instance
 */
export async function createApp(): Promise<typeof app> {
  // Initialize app (database, redis, secrets)
  await initializeApp();

  // Configure middleware
  configureMiddleware();

  // Configure routes
  configureRoutes();

  // Configure error handling
  configureErrorHandling();

  // Configure Socket.IO
  configureSocketIO();

  return app;
}

/**
 * Get the HTTP server instance for testing
 * This is used by E2E tests to start the server on a custom port
 */
export function getHttpServer(): typeof httpServer {
  return httpServer;
}

/**
 * Start the application (only when not imported for testing)
 * Check if this module is being run directly or imported
 */
if (require.main === module || process.env.NODE_ENV !== 'test') {
  startServer();
}

/**
 * Export Express app and Socket.IO for testing
 */
export { app, io, httpServer };



