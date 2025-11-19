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
import { env, isProd, printConfig, validateRequiredSecrets } from './config/environment';
import { loadSecretsFromKeyVault } from './config/keyvault';
import { initDatabase, closeDatabase, checkDatabaseHealth, executeQuery } from './config/database';
import { initRedis, closeRedis, checkRedisHealth, getRedis } from './config/redis';
import { startDatabaseKeepalive, stopDatabaseKeepalive } from './utils/databaseKeepalive';
import { logger } from './utils/logger';
import { getMCPService } from './services/mcp';
import { getBCClient } from './services/bc';
import { getDirectAgentService } from './services/agent';
import { getApprovalManager } from './services/approval/ApprovalManager';
import { getTodoManager } from './services/todo/TodoManager';
import authMockRoutes from './routes/auth-mock';
import authOAuthRoutes from './routes/auth-oauth';
import sessionsRoutes from './routes/sessions';
import { authenticateMicrosoft } from './middleware/auth-oauth';
import { MicrosoftOAuthSession } from './types/microsoft.types';
import { Socket } from 'socket.io';

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

    // Step 4: Initialize Redis connection
    await initRedis();
    console.log('');

    // Step 4.5: Initialize session middleware with RedisStore
    sessionMiddleware = session({
      store: new RedisStore({
        client: getRedis()!,
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

    // Step 5: Initialize MCP Service
    const mcpService = getMCPService();
    if (mcpService.isConfigured()) {
      console.log('🔌 Initializing MCP Service...');
      try {
        const mcpHealth = await mcpService.validateMCPConnection();
        if (mcpHealth.connected) {
          console.log(`✅ MCP Service connected: ${mcpService.getMCPServerUrl()}`);
        } else {
          console.warn(`⚠️  MCP Service not reachable: ${mcpHealth.error}`);
          console.warn('   Server will continue without MCP health check validation');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`⚠️  MCP health check failed: ${errorMessage}`);
        console.warn('   Server will continue initialization anyway');
      }
      console.log('');
    } else {
      console.warn('⚠️  MCP Service not configured (MCP_SERVER_URL missing)');
      console.log('');
    }

    // Step 6: Initialize BC Client (validate credentials)
    console.log('🔑 Validating Business Central credentials...');
    const bcClient = getBCClient();
    const bcValid = await bcClient.validateCredentials();
    if (bcValid) {
      console.log('✅ Business Central authentication successful');
    } else {
      console.warn('⚠️  Business Central authentication failed');
    }
    console.log('');

    // Step 7: Initialize Approval Manager (requires Socket.IO)
    console.log('📋 Initializing Approval Manager...');
    const approvalManager = getApprovalManager(io);
    console.log('✅ Approval Manager initialized');
    console.log('');

    // Step 9: Initialize Todo Manager (requires Socket.IO)
    console.log('✅ Initializing Todo Manager...');
    const todoManager = getTodoManager(io);
    console.log('✅ Todo Manager initialized');
    console.log('');

    // Step 10: Initialize Direct Agent Service (bypasses ProcessTransport bug)
    console.log('🤖 Initializing Direct Agent Service (workaround)...');
    // Initialize singleton (will be used by routes/socket handlers)
    getDirectAgentService(approvalManager, todoManager);
    if (env.ANTHROPIC_API_KEY) {
      console.log('✅ Direct Agent Service initialized');
      console.log(`   Model: ${env.ANTHROPIC_MODEL}`);
      console.log(`   Strategy: Direct API (bypasses Agent SDK bug)`);
      console.log(`   MCP Tools: 7 (loaded from data files)`);
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

  // Session middleware (shared with Socket.IO)
  app.use(sessionMiddleware);

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging (simple for now)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
    });
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

  // Health check endpoint - checks all services
  app.get('/health', async (_req: Request, res: Response) => {
    const dbHealth = await checkDatabaseHealth();
    const redisHealth = await checkRedisHealth();

    // Check MCP health
    const mcpService = getMCPService();
    let mcpHealth = 'not_configured';
    if (mcpService.isConfigured()) {
      const mcpStatus = await mcpService.validateMCPConnection();
      mcpHealth = mcpStatus.connected ? 'up' : 'down';
    }

    // Check BC health
    const bcClient = getBCClient();
    const bcConnected = await bcClient.testConnection();
    const bcHealth = bcConnected ? 'up' : 'down';

    const allHealthy = dbHealth && redisHealth && mcpHealth !== 'down' && bcHealth === 'up';

    const health = {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealth ? 'up' : 'down',
        redis: redisHealth ? 'up' : 'down',
        mcp: mcpHealth,
        businessCentral: bcHealth,
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
        mcp: {
          config: '/api/mcp/config',
          health: '/api/mcp/health',
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

  // MCP endpoints
  app.get('/api/mcp/config', (_req: Request, res: Response): void => {
    const mcpService = getMCPService();

    if (!mcpService.isConfigured()) {
      res.status(503).json({
        error: 'MCP not configured',
        message: 'MCP_SERVER_URL is not set',
      });
      return;
    }

    const config = mcpService.getMCPServerConfig();
    res.json({
      configured: true,
      serverUrl: mcpService.getMCPServerUrl(),
      serverName: mcpService.getMCPServerName(),
      config: {
        type: config.type,
        name: config.name,
      },
    });
  });

  app.get('/api/mcp/health', async (_req: Request, res: Response): Promise<void> => {
    const mcpService = getMCPService();

    if (!mcpService.isConfigured()) {
      res.status(503).json({
        connected: false,
        error: 'MCP not configured',
      });
      return;
    }

    const health = await mcpService.validateMCPConnection();
    const statusCode = health.connected ? 200 : 503;

    res.status(statusCode).json(health);
  });

  // BC endpoints
  app.get('/api/bc/test', async (_req: Request, res: Response): Promise<void> => {
    try {
      const bcClient = getBCClient();

      // Test authentication
      const authValid = await bcClient.validateCredentials();
      if (!authValid) {
        res.status(401).json({
          error: 'Authentication failed',
          message: 'BC credentials are invalid',
        });
        return;
      }

      // Test connection
      const connected = await bcClient.testConnection();
      if (!connected) {
        res.status(503).json({
          error: 'Connection failed',
          message: 'Unable to connect to BC API',
        });
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
      res.status(500).json({
        error: 'Test failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  app.get('/api/bc/customers', async (req: Request, res: Response): Promise<void> => {
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
        console.error('[API] Query customers failed:', result.error);
        return res.status(500).json({
          error: 'Query failed',
          details: result.error.error.message,
        });
      }

      res.json({
        count: result.data['@odata.count'],
        customers: result.data.value,
      });
    } catch (error) {
      console.error('[API] Query customers failed:', error);
      res.status(500).json({
        error: 'Query failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Agent endpoints
  app.get('/api/agent/status', (_req: Request, res: Response): void => {
    const mcpService = getMCPService();

    const status = {
      configured: !!env.ANTHROPIC_API_KEY,
      config: {
        hasApiKey: !!env.ANTHROPIC_API_KEY,
        model: env.ANTHROPIC_MODEL,
        strategy: 'direct-api',
        mcpConfigured: true,
        toolsAvailable: 7,
      },
      mcpServer: {
        url: mcpService.getMCPServerUrl(),
        configured: mcpService.isConfigured(),
        type: 'in-process-data-files',
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
        res.status(503).json({
          error: 'Agent not configured',
          message: 'ANTHROPIC_API_KEY is not set',
        });
        return;
      }

      const { prompt, sessionId } = req.body;

      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({
          error: 'Invalid request',
          message: 'prompt is required and must be a string',
        });
        return;
      }

      // Execute query
      const result = await agentService.executeQuery(prompt, sessionId);

      res.json(result);
    } catch (error) {
      console.error('[API] Agent query failed:', error);
      res.status(500).json({
        error: 'Query failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Approval endpoints
  // POST /api/approvals/:id/respond - Respond to an approval request
  app.post('/api/approvals/:id/respond', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
    try {
      const approvalId = req.params.id as string;
      const { decision, reason } = req.body;
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token',
        });
        return;
      }

      if (!decision || !['approved', 'rejected'].includes(decision)) {
        res.status(400).json({
          error: 'Invalid request',
          message: 'decision must be either "approved" or "rejected"',
        });
        return;
      }

      // TypeScript narrowing workaround
      const userIdVerified: string = userId;
      const decisionVerified: 'approved' | 'rejected' = decision as 'approved' | 'rejected';

      const approvalManager = getApprovalManager();
      await approvalManager.respondToApproval(approvalId, decisionVerified, userIdVerified, reason);

      res.json({
        success: true,
        approvalId,
        decision,
      });
    } catch (error) {
      console.error('[API] Approval response failed:', error);
      res.status(500).json({
        error: 'Approval response failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // GET /api/approvals/pending - Get all pending approvals for current user (cross-session)
  app.get('/api/approvals/pending', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;

      if (!userId) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'User ID not found in token',
        });
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
      const approvals = result.recordset.map((row) => {
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
      res.status(500).json({
        error: 'Failed to get pending approvals',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // GET /api/approvals/session/:sessionId - Get pending approvals for a session
  app.get('/api/approvals/session/:sessionId', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
    try {
      const sessionId = req.params.sessionId as string;

      const approvalManager = getApprovalManager();
      const pendingApprovals = await approvalManager.getPendingApprovals(sessionId);

      res.json({
        sessionId,
        count: pendingApprovals.length,
        approvals: pendingApprovals,
      });
    } catch (error) {
      console.error('[API] Get pending approvals failed:', error);
      res.status(500).json({
        error: 'Failed to get pending approvals',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });


  // Todo endpoints
  // GET /api/todos/session/:sessionId - Get todos for a session
  app.get('/api/todos/session/:sessionId', authenticateMicrosoft, async (req: Request, res: Response): Promise<void> => {
    try {
      const sessionId = req.params.sessionId as string;

      const todoManager = getTodoManager();
      const todos = await todoManager.getTodosBySession(sessionId);

      res.json({
        sessionId,
        count: todos.length,
        todos,
      });
    } catch (error) {
      console.error('[API] Get todos failed:', error);
      res.status(500).json({
        error: 'Failed to get todos',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Auth routes - Microsoft OAuth (requires database)
  if (isDatabaseAvailable) {
    // app.use('/api/auth', authRoutes); // JWT DEPRECATED - removed
    app.use('/api/auth', authOAuthRoutes);
  } else {
    app.use('/api/auth', authMockRoutes);
  }

  // Chat sessions routes (requires database)
  if (isDatabaseAvailable) {
    app.use('/api/chat/sessions', sessionsRoutes);
  }

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Route ${req.method} ${req.path} not found`,
    });
  });
}

/**
 * Configure error handling
 */
function configureErrorHandling(): void {
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('❌ Unhandled error:', err);

    // Don't leak error details in production
    const error = isProd
      ? { message: 'Internal Server Error' }
      : { message: err.message, stack: err.stack };

    res.status(500).json({
      error: 'Internal Server Error',
      details: error,
    });
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

    // Handler: Chat message (TODO: Will be replaced with modular ChatMessageHandler in FASE 4)
    socket.on('chat:message', async (_data: { message: string; sessionId: string; userId: string }) => {
      // TODO FASE 4: Replace this with getChatMessageHandler(io).handle(data, socket)
      socket.emit('agent:error', { error: 'Chat handler temporarily disabled during refactor' });
    });

    // Handler: Approval response
    socket.on('approval:response', async (data: {
      approvalId: string;
      decision: 'approved' | 'rejected';
      userId: string;
      reason?: string;
    }) => {
      const { approvalId, decision, userId, reason } = data;

      try {

        const approvalManager = getApprovalManager();
        await approvalManager.respondToApproval(approvalId, decision, userId, reason);

        socket.emit('approval:resolved', {
          approvalId,
          decision,
        });
      } catch (error) {
        console.error('[Socket] Approval response error:', error);
        socket.emit('approval:error', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Handler: Join session
    socket.on('session:join', (data: { sessionId: string }) => {
      const { sessionId } = data;
      socket.join(sessionId);
      logger.info(`[Socket.IO] ✅ Client ${socket.id} joined room: ${sessionId}`);

      socket.emit('session:joined', { sessionId });
    });

    // Handler: Leave session
    socket.on('session:leave', (data: { sessionId: string }) => {
      const { sessionId } = data;
      socket.leave(sessionId);
      logger.info(`[Socket.IO] Client ${socket.id} left room: ${sessionId}`);

      socket.emit('session:left', { sessionId });
    });

    // Disconnect handler
    socket.on('disconnect', () => {
      logger.info(`[Socket.IO] ❌ Client disconnected: ${socket.id}`);
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
    // Close HTTP server
    httpServer.close(() => {
      console.log('✅ HTTP server closed');
    });

    // Close Socket.IO
    io.close(() => {
      console.log('✅ Socket.IO server closed');
    });

    // Stop database keepalive
    stopDatabaseKeepalive();

    // Close database connection
    await closeDatabase();

    // Close Redis connection
    await closeRedis();

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
 * Start the application
 */
startServer();

/**
 * Export Express app and Socket.IO for testing
 */
export { app, io };

