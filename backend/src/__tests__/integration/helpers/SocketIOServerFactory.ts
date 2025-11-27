/**
 * Socket.IO Test Server Factory
 *
 * Centralizes Socket.IO server creation for integration tests.
 * Eliminates 100+ lines of duplicated setup code across test files.
 *
 * @module __tests__/integration/helpers/SocketIOServerFactory
 */

import { Server as HttpServer, createServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import express, { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import { createClient as createRedisClient, RedisClientType } from 'redis';
import RedisStore from 'connect-redis';
import { TEST_SESSION_SECRET, TEST_SESSION_COOKIE } from './constants';
import { REDIS_TEST_CONFIG } from '../setup.integration';
import { normalizeUUID } from '@/utils/uuid';

/**
 * Extended Socket type with authentication properties
 */
export interface AuthenticatedSocket extends Socket {
  userId?: string;
  userEmail?: string;
}

/**
 * Custom handlers that can be provided to the factory
 */
export interface SocketIOServerHandlers {
  /**
   * Called when a client joins a session room
   */
  onSessionJoin?: (socket: AuthenticatedSocket, data: { sessionId: string }) => void | Promise<void>;

  /**
   * Called when a client leaves a session room
   */
  onSessionLeave?: (socket: AuthenticatedSocket, data: { sessionId: string }) => void | Promise<void>;

  /**
   * Called when a chat message is received
   */
  onChatMessage?: (
    socket: AuthenticatedSocket,
    data: { sessionId: string; message: string; userId?: string },
    io: SocketIOServer
  ) => void | Promise<void>;

  /**
   * Called when a ping is received
   */
  onPing?: (socket: AuthenticatedSocket) => void;

  /**
   * Additional custom event handlers
   */
  customHandlers?: Record<string, (socket: AuthenticatedSocket, data: unknown) => void | Promise<void>>;
}

/**
 * Options for creating a test Socket.IO server
 */
export interface SocketIOServerOptions {
  /**
   * Custom event handlers
   */
  handlers?: SocketIOServerHandlers;

  /**
   * Whether to normalize UUIDs in session middleware (default: true)
   */
  normalizeUUIDs?: boolean;

  /**
   * CORS origin setting (default: '*')
   */
  corsOrigin?: string;

  /**
   * Session middleware (if you want to provide a custom one)
   */
  sessionMiddleware?: express.RequestHandler;
}

/**
 * Result from creating a test Socket.IO server
 */
export interface SocketIOServerResult {
  /**
   * The HTTP server instance
   */
  httpServer: HttpServer;

  /**
   * The Socket.IO server instance
   */
  io: SocketIOServer;

  /**
   * The port the server is listening on
   */
  port: number;

  /**
   * The Redis client used for sessions
   */
  redisClient: RedisClientType;

  /**
   * The Express app instance
   */
  app: express.Application;

  /**
   * The session middleware (for use in tests)
   */
  sessionMiddleware: express.RequestHandler;

  /**
   * Cleanup function - call this in afterAll()
   */
  cleanup: () => Promise<void>;
}

/**
 * Default fallback port if dynamic port allocation fails
 */
const DEFAULT_FALLBACK_PORT = 3099;

/**
 * Creates a fully configured Socket.IO test server with Redis session store.
 *
 * This factory eliminates the need to duplicate 100+ lines of Socket.IO setup
 * code across integration test files. It provides:
 *
 * - Express app with session middleware
 * - Redis-backed session store
 * - Socket.IO server with authentication middleware
 * - Configurable event handlers
 * - Automatic port allocation
 * - Cleanup function for afterAll()
 *
 * @example
 * ```typescript
 * let serverResult: SocketIOServerResult;
 *
 * beforeAll(async () => {
 *   serverResult = await createTestSocketIOServer({
 *     handlers: {
 *       onSessionJoin: async (socket, data) => {
 *         // Custom join logic
 *       },
 *     },
 *   });
 * }, 60000);
 *
 * afterAll(async () => {
 *   await serverResult.cleanup();
 * }, 30000);
 * ```
 */
export async function createTestSocketIOServer(
  options: SocketIOServerOptions = {}
): Promise<SocketIOServerResult> {
  const { handlers = {}, normalizeUUIDs = true, corsOrigin = '*' } = options;

  // 1. Create Redis client for session store
  const redisClient = createRedisClient({
    socket: {
      host: REDIS_TEST_CONFIG.host,
      port: REDIS_TEST_CONFIG.port,
    },
  }) as RedisClientType;

  await redisClient.connect();

  // 2. Create Express app
  const app = express();

  // 3. Create session middleware (use provided or create default)
  const sessionMiddleware =
    options.sessionMiddleware ||
    session({
      store: new RedisStore({ client: redisClient }),
      secret: TEST_SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: TEST_SESSION_COOKIE,
    });

  app.use(sessionMiddleware);

  // 4. Create HTTP server
  const httpServer = createServer(app);

  // 5. Create Socket.IO server
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // 6. Authentication middleware
  io.use((socket, next) => {
    const req = socket.request as Request;
    const res = {} as Response;

    sessionMiddleware(req, res, ((err: Error | null | undefined) => {
      if (err) {
        return next(new Error('Session error'));
      }

      const sessionData = (req as { session?: { microsoftOAuth?: { userId?: string; email?: string } } })
        .session;

      if (sessionData?.microsoftOAuth?.userId) {
        const authSocket = socket as AuthenticatedSocket;

        // Normalize UUIDs for case-insensitive comparison
        // (SQL Server returns UPPERCASE, JavaScript generates lowercase)
        authSocket.userId = normalizeUUIDs
          ? normalizeUUID(sessionData.microsoftOAuth.userId)
          : sessionData.microsoftOAuth.userId;
        authSocket.userEmail = sessionData.microsoftOAuth.email;

        next();
      } else {
        next(new Error('Authentication required'));
      }
    }) as NextFunction);
  });

  // 7. Connection handler with configurable event handlers
  io.on('connection', (socket) => {
    const authSocket = socket as AuthenticatedSocket;
    const userId = authSocket.userId;

    // Emit connected event
    socket.emit('connected', { userId, socketId: socket.id });

    // Session join handler
    socket.on('session:join', async (data: { sessionId: string }) => {
      if (handlers.onSessionJoin) {
        await handlers.onSessionJoin(authSocket, data);
      } else {
        // Default: just join the room
        socket.join(data.sessionId);
        socket.emit('session:joined', { sessionId: data.sessionId });
      }
    });

    // Session leave handler
    socket.on('session:leave', async (data: { sessionId: string }) => {
      if (handlers.onSessionLeave) {
        await handlers.onSessionLeave(authSocket, data);
      } else {
        // Default: just leave the room
        socket.leave(data.sessionId);
        socket.emit('session:left', { sessionId: data.sessionId });
      }
    });

    // Chat message handler
    socket.on('chat:message', async (data: { sessionId: string; message: string; userId?: string }) => {
      if (handlers.onChatMessage) {
        await handlers.onChatMessage(authSocket, data, io);
      }
      // No default implementation - requires custom handler
    });

    // Ping handler
    socket.on('ping', () => {
      if (handlers.onPing) {
        handlers.onPing(authSocket);
      } else {
        // Default: respond with pong
        socket.emit('pong', { userId, timestamp: Date.now() });
      }
    });

    // Register custom handlers
    if (handlers.customHandlers) {
      for (const [event, handler] of Object.entries(handlers.customHandlers)) {
        socket.on(event, (data: unknown) => handler(authSocket, data));
      }
    }
  });

  // 8. Start server on dynamic port
  const port = await new Promise<number>((resolve) => {
    httpServer.listen(0, () => {
      const address = httpServer.address();
      const assignedPort = typeof address === 'object' && address ? address.port : DEFAULT_FALLBACK_PORT;
      resolve(assignedPort);
    });
  });

  // 9. Create cleanup function
  const cleanup = async (): Promise<void> => {
    return new Promise((resolve) => {
      io.close(() => {
        httpServer.close(async () => {
          try {
            await redisClient.quit();
          } catch {
            // Ignore errors during cleanup
          }
          resolve();
        });
      });
    });
  };

  return {
    httpServer,
    io,
    port,
    redisClient,
    app,
    sessionMiddleware,
    cleanup,
  };
}

/**
 * Type guard to check if a socket is authenticated
 */
export function isAuthenticatedSocket(socket: Socket): socket is AuthenticatedSocket {
  return typeof (socket as AuthenticatedSocket).userId === 'string';
}
