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
import { env, isProd, printConfig, validateRequiredSecrets } from './config/environment';
import { loadSecretsFromKeyVault } from './config/keyvault';
import { initDatabase, closeDatabase, checkDatabaseHealth } from './config/database';
import { initRedis, closeRedis, checkRedisHealth } from './config/redis';
import { getMCPService } from './services/mcp';
import { getBCClient } from './services/bc';
import { getAgentService } from './services/agent';

/**
 * Express application instance
 */
const app = express();

/**
 * HTTP server instance
 */
const httpServer = createServer(app);

/**
 * Socket.IO server instance
 */
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: env.CORS_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

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

    // Step 3: Initialize database connection
    await initDatabase();
    console.log('');

    // Step 4: Initialize Redis connection
    await initRedis();
    console.log('');

    // Step 5: Initialize MCP Service
    const mcpService = getMCPService();
    if (mcpService.isConfigured()) {
      console.log('🔌 Initializing MCP Service...');
      const mcpHealth = await mcpService.validateMCPConnection();
      if (mcpHealth.connected) {
        console.log(`✅ MCP Service connected: ${mcpService.getMCPServerUrl()}`);
      } else {
        console.warn(`⚠️  MCP Service not reachable: ${mcpHealth.error}`);
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

    // Step 7: Initialize Agent Service
    console.log('🤖 Initializing Agent Service...');
    const agentService = getAgentService();
    const agentConfig = agentService.getConfigStatus();
    if (agentConfig.hasApiKey) {
      console.log('✅ Agent Service initialized');
      console.log(`   Model: ${agentConfig.model}`);
      console.log(`   MCP Configured: ${agentConfig.mcpConfigured ? 'Yes' : 'No'}`);
    } else {
      console.warn('⚠️  Agent Service: ANTHROPIC_API_KEY not configured');
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
    origin: env.CORS_ORIGIN,
    credentials: true,
  }));

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
  // Health check endpoint
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

  app.get('/api/bc/customers', async (req: Request, res: Response) => {
    try {
      const bcClient = getBCClient();

      // Parse query parameters
      const top = req.query.top ? parseInt(req.query.top as string) : 10;
      const filter = req.query.filter as string | undefined;

      const customers = await bcClient.query('customers', {
        select: ['id', 'number', 'displayName', 'email', 'blocked', 'balance'],
        top,
        filter,
        count: true,
      });

      res.json({
        count: customers['@odata.count'],
        customers: customers.value,
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
    const agentService = getAgentService();
    const mcpService = getMCPService();

    const status = {
      configured: agentService.isConfigured(),
      config: agentService.getConfigStatus(),
      mcpServer: {
        url: mcpService.getMCPServerUrl(),
        configured: mcpService.isConfigured(),
      },
    };

    res.json(status);
  });

  app.post('/api/agent/query', async (req: Request, res: Response): Promise<void> => {
    try {
      const agentService = getAgentService();

      if (!agentService.isConfigured()) {
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

      console.log(`[Agent] Executing query: "${prompt.substring(0, 50)}..."`);

      // Execute query with event logging
      const result = await agentService.executeQuery(
        prompt,
        sessionId,
        (event) => {
          console.log(`[Agent Event] ${event.type}:`,
            event.type === 'message' && 'content' in event
              ? event.content.substring(0, 100)
              : ''
          );
        }
      );

      console.log(`[Agent] Query completed in ${result.durationMs}ms`);
      console.log(`[Agent] Tools used: ${result.toolsUsed.join(', ') || 'none'}`);

      res.json(result);
    } catch (error) {
      console.error('[API] Agent query failed:', error);
      res.status(500).json({
        error: 'Query failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // TODO: Add route handlers
  // app.use('/api/auth', authRoutes);
  // app.use('/api/chat', chatRoutes);
  // app.use('/api/approvals', approvalsRoutes);

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
  io.on('connection', (socket) => {
    console.log(`✅ Client connected: ${socket.id}`);

    // TODO: Implement Socket.IO event handlers
    // socket.on('message', handleMessage);
    // socket.on('approval_response', handleApprovalResponse);

    socket.on('disconnect', () => {
      console.log(`❌ Client disconnected: ${socket.id}`);
    });

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

process.on('unhandledRejection', (reason: any) => {
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
