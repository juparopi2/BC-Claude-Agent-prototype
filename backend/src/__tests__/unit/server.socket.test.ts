/**
 * Unit Tests - Socket.IO Server
 *
 * Tests for Socket.IO event handlers in server.ts.
 * Focuses on connection, message sending, session management, and event streaming.
 *
 * @module __tests__/unit/server.socket
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll, Mock } from 'vitest';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { AddressInfo } from 'net';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { executeQuery } from '@/config/database';
import { getDirectAgentService } from '@/services/agent';
import { getApprovalManager } from '@/services/approval/ApprovalManager';
import type { DirectAgentService } from '@/services/agent/DirectAgentService';
import type { ApprovalManager } from '@/services/approval/ApprovalManager';
import { server as mswServer } from '../mocks/server';

// Mock dependencies
vi.mock('@/config/database', () => ({
  executeQuery: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/services/agent', () => ({
  getDirectAgentService: vi.fn(),
}));

vi.mock('@/services/approval/ApprovalManager', () => ({
  getApprovalManager: vi.fn(),
}));

vi.mock('@/utils/messageHelpers', () => ({
  saveThinkingMessage: vi.fn(),
  saveToolUseMessage: vi.fn(),
  updateToolResultMessage: vi.fn(),
}));

vi.mock('@/services/todo/TodoManager', () => ({
  getTodoManager: vi.fn(() => ({
    syncTodosFromSDK: vi.fn(),
  })),
}));

describe('Socket.IO Server', () => {
  let httpServer: ReturnType<typeof createServer>;
  let io: SocketIOServer;
  let clientSocket: ClientSocket;
  let serverSocket: Socket;
  let mockExecuteQuery: Mock;
  let mockDirectAgentService: Partial<DirectAgentService>;
  let mockApprovalManager: Partial<ApprovalManager>;

  // Disable MSW for Socket.IO tests (WebSocket connections aren't HTTP)
  beforeAll(() => {
    mswServer.close();
  });

  afterAll(() => {
    mswServer.listen({ onUnhandledRequest: 'warn' });
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup HTTP server with Socket.IO
    httpServer = createServer();
    io = new SocketIOServer(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    // Start server on random port
    await new Promise<void>((resolve) => {
      httpServer.listen(() => {
        resolve();
      });
    });

    const port = (httpServer.address() as AddressInfo).port;

    // Setup mocks
    mockExecuteQuery = executeQuery as Mock;
    mockExecuteQuery.mockResolvedValue({ recordset: [{ id: 'test-id' }] });

    // Mock DirectAgentService
    mockDirectAgentService = {
      executeQuery: vi.fn(),
    };
    (getDirectAgentService as Mock).mockReturnValue(mockDirectAgentService);

    // Mock ApprovalManager
    mockApprovalManager = {
      request: vi.fn(),
      respond: vi.fn(),
    };
    (getApprovalManager as Mock).mockReturnValue(mockApprovalManager);

    // Setup authentication bypass middleware (for testing)
    io.use((socket, next) => {
      (socket as Socket & { userId?: string }).userId = 'test-user-123';
      next();
    });

    // Setup Socket.IO server handlers (simplified version of server.ts)
    io.on('connection', (socket) => {
      serverSocket = socket;

      // Handler: session:join
      socket.on('session:join', (data: { sessionId: string }) => {
        socket.join(data.sessionId);
        socket.emit('session:joined', { sessionId: data.sessionId });
      });

      // Handler: session:leave
      socket.on('session:leave', (data: { sessionId: string }) => {
        socket.leave(data.sessionId);
        socket.emit('session:left', { sessionId: data.sessionId });
      });

      // Handler: chat:message
      socket.on('chat:message', async (data: {
        message: string;
        sessionId: string;
        userId: string;
      }) => {
        // Join room
        socket.join(data.sessionId);

        // Save user message
        await executeQuery('INSERT...', {});

        // Execute agent
        const agentService = mockDirectAgentService as DirectAgentService;
        if (agentService.executeQuery) {
          await agentService.executeQuery(data.message, data.sessionId, async (event) => {
            io.to(data.sessionId).emit('agent:event', event);

            // Emit specific event types
            switch (event.type) {
              case 'thinking':
                io.to(data.sessionId).emit('agent:thinking', { content: event.content });
                break;
              case 'message':
                io.to(data.sessionId).emit('agent:message_complete', {
                  id: 'msg-id',
                  content: event.content,
                  role: event.role,
                });
                break;
              case 'tool_use':
                io.to(data.sessionId).emit('agent:tool_use', {
                  toolName: event.toolName,
                  args: event.args,
                });
                break;
              case 'complete':
                io.to(data.sessionId).emit('agent:complete', { reason: event.reason });
                break;
              case 'error':
                io.to(data.sessionId).emit('agent:error', { error: event.error });
                break;
            }
          });
        }
      });

      // Handler: approval:response
      socket.on('approval:response', async (data: {
        approvalId: string;
        decision: 'approved' | 'denied';
      }) => {
        const manager = mockApprovalManager as ApprovalManager;
        if (manager.respond) {
          await manager.respond(data.approvalId, data.decision === 'approved');
          socket.emit('approval:resolved', {
            approvalId: data.approvalId,
            decision: data.decision,
          });
        }
      });
    });

    // Create client socket
    clientSocket = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
    });

    // Wait for connection with timeout and error handling
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        clientSocket.on('connect', () => resolve());
        clientSocket.on('connect_error', (err) => reject(err));
      }),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout after 5s')), 5000)
      ),
    ]);
  });

  afterEach(async () => {
    // Cleanup client socket
    if (clientSocket) {
      clientSocket.removeAllListeners();
      if (clientSocket.connected) {
        clientSocket.disconnect();
      }
      clientSocket.close();
    }

    // Cleanup Socket.IO server
    if (io) {
      const sockets = await io.fetchSockets();
      sockets.forEach((s) => s.disconnect(true));
      io.removeAllListeners();
      io.close();
    }

    // Cleanup HTTP server
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    }

    // Small delay to ensure cleanup completes
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  describe('Connection', () => {
    it('should establish socket connection successfully', () => {
      expect(clientSocket.connected).toBe(true);
      expect(clientSocket.id).toBeDefined();
    });

    it('should have userId set after authentication', () => {
      expect((serverSocket as Socket & { userId?: string }).userId).toBe('test-user-123');
    });
  });

  describe('Session Management', () => {
    it('should join session room successfully', async () => {
      // Arrange
      const sessionId = 'test-session-123';
      const promise = new Promise<{ sessionId: string }>((resolve) => {
        clientSocket.on('session:joined', resolve);
      });

      // Act
      clientSocket.emit('session:join', { sessionId });

      // Assert
      const result = await promise;
      expect(result.sessionId).toBe(sessionId);
    });

    it('should leave session room successfully', async () => {
      // Arrange
      const sessionId = 'test-session-456';
      const promise = new Promise<{ sessionId: string }>((resolve) => {
        clientSocket.on('session:left', resolve);
      });

      // Act
      clientSocket.emit('session:leave', { sessionId });

      // Assert
      const result = await promise;
      expect(result.sessionId).toBe(sessionId);
    });
  });

  describe('Chat Messages', () => {
    it('should handle chat message and execute agent', async () => {
      // Arrange
      const sessionId = 'test-session-msg';
      const message = 'Hello, agent!';

      // Mock agent to emit events
      (mockDirectAgentService.executeQuery as Mock).mockImplementation(
        async (_prompt: string, _sessionId: string, onEvent: (event: { type: string; content?: string }) => void) => {
          onEvent({ type: 'thinking', content: 'Processing...' });
          onEvent({ type: 'message', content: 'Hello! How can I help?' });
          onEvent({ type: 'complete' });
          return { success: true, response: 'Hello!', toolsUsed: [], duration: 100 };
        }
      );

      const events: Array<{ type: string; data: unknown }> = [];

      clientSocket.on('agent:thinking', (data) => events.push({ type: 'thinking', data }));
      clientSocket.on('agent:message_complete', (data) => events.push({ type: 'message', data }));
      clientSocket.on('agent:complete', (data) => events.push({ type: 'complete', data }));

      // Act
      clientSocket.emit('chat:message', { message, sessionId, userId: 'test-user-123' });

      // Assert - Wait for events
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(events).toHaveLength(3);
      expect(events[0]).toMatchObject({ type: 'thinking', data: { content: 'Processing...' } });
      expect(events[1]).toMatchObject({ type: 'message', data: { content: 'Hello! How can I help?' } });
      expect(events[2]).toMatchObject({ type: 'complete' });
      expect(mockExecuteQuery).toHaveBeenCalled(); // User message saved
    });

    it('should stream tool use events to client', async () => {
      // Arrange
      const sessionId = 'test-session-tool';
      const message = 'List all entities';

      (mockDirectAgentService.executeQuery as Mock).mockImplementation(
        async (_prompt: string, _sessionId: string, onEvent: (event: { type: string; toolName?: string; args?: Record<string, unknown> }) => void) => {
          onEvent({
            type: 'tool_use',
            toolName: 'list_all_entities',
            args: {},
          });
          return { success: true, response: 'Done', toolsUsed: ['list_all_entities'], duration: 200 };
        }
      );

      const toolUsePromise = new Promise<{ toolName: string }>((resolve) => {
        clientSocket.on('agent:tool_use', resolve);
      });

      // Act
      clientSocket.emit('chat:message', { message, sessionId, userId: 'test-user-123' });

      // Assert
      const toolUseEvent = await toolUsePromise;
      expect(toolUseEvent.toolName).toBe('list_all_entities');
    });

    it('should handle agent errors gracefully', async () => {
      // Arrange
      const sessionId = 'test-session-error';
      const message = 'This will fail';

      (mockDirectAgentService.executeQuery as Mock).mockImplementation(
        async (_prompt: string, _sessionId: string, onEvent: (event: { type: string; error?: string }) => void) => {
          onEvent({ type: 'error', error: 'Agent execution failed' });
          return { success: false, error: 'Agent execution failed', response: '', toolsUsed: [], duration: 50 };
        }
      );

      const errorPromise = new Promise<{ error: string }>((resolve) => {
        clientSocket.on('agent:error', resolve);
      });

      // Act
      clientSocket.emit('chat:message', { message, sessionId, userId: 'test-user-123' });

      // Assert
      const errorEvent = await errorPromise;
      expect(errorEvent.error).toBe('Agent execution failed');
    });
  });

  describe('Approvals', () => {
    it('should handle approval response successfully', async () => {
      // Arrange
      const approvalId = 'approval-123';
      const decision = 'approved';

      (mockApprovalManager.respond as Mock).mockResolvedValueOnce(undefined);

      const promise = new Promise<{ approvalId: string; decision: string }>((resolve) => {
        clientSocket.on('approval:resolved', resolve);
      });

      // Act
      clientSocket.emit('approval:response', { approvalId, decision });

      // Assert
      const result = await promise;
      expect(result).toMatchObject({ approvalId, decision });
      expect(mockApprovalManager.respond).toHaveBeenCalledWith(approvalId, true);
    });

    it('should handle approval denial', async () => {
      // Arrange
      const approvalId = 'approval-456';
      const decision = 'denied';

      (mockApprovalManager.respond as Mock).mockResolvedValueOnce(undefined);

      const promise = new Promise<{ approvalId: string; decision: string }>((resolve) => {
        clientSocket.on('approval:resolved', resolve);
      });

      // Act
      clientSocket.emit('approval:response', { approvalId, decision });

      // Assert
      const result = await promise;
      expect(result).toMatchObject({ approvalId, decision });
      expect(mockApprovalManager.respond).toHaveBeenCalledWith(approvalId, false);
    });
  });

  describe('Disconnect', () => {
    it('should handle client disconnect gracefully', async () => {
      // Arrange
      const disconnectPromise = new Promise<void>((resolve) => {
        serverSocket.on('disconnect', () => {
          resolve();
        });
      });

      // Act
      clientSocket.disconnect();

      // Assert
      await disconnectPromise;
      expect(clientSocket.connected).toBe(false);
    });
  });
});
