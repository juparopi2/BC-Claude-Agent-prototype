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

    const health = {
      status: dbHealth && redisHealth ? 'healthy' : 'unhealthy',
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
    });
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
