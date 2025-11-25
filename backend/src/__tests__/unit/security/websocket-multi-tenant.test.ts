/**
 * WebSocket Multi-Tenant Security Tests
 *
 * Tests for F4-003 security fixes:
 * 1. approval:response - Must use authenticated userId, not client payload
 * 2. session:join - Must validate session ownership before allowing room join
 *
 * These tests verify that multi-tenant isolation is enforced at the WebSocket layer.
 *
 * @module __tests__/unit/security/websocket-multi-tenant
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { createServer } from 'http';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { AddressInfo } from 'net';
import { server as mswServer } from '../../mocks/server';

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
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('@/utils/session-ownership', () => ({
  validateSessionOwnership: vi.fn(),
}));

vi.mock('@/services/approval/ApprovalManager', () => ({
  getApprovalManager: vi.fn(),
}));

import { validateSessionOwnership } from '@/utils/session-ownership';
import { getApprovalManager } from '@/services/approval/ApprovalManager';

/**
 * Authenticated Socket interface matching server.ts
 */
interface AuthenticatedSocket extends Socket {
  userId?: string;
  userEmail?: string;
}

describe('WebSocket Multi-Tenant Security (F4-003)', () => {
  let httpServer: ReturnType<typeof createServer>;
  let io: SocketIOServer;
  let clientSocket: ClientSocket;
  let serverSocket: AuthenticatedSocket;
  let mockValidateSessionOwnership: ReturnType<typeof vi.fn>;
  let mockApprovalManager: {
    respondToApprovalAtomic: ReturnType<typeof vi.fn>;
  };

  const TEST_USER_A_ID = 'user-a-authenticated';
  const TEST_USER_B_ID = 'user-b-victim';
  const TEST_SESSION_A_ID = 'session-owned-by-user-a';
  const TEST_SESSION_B_ID = 'session-owned-by-user-b';

  // Disable MSW for Socket.IO tests (WebSocket connections aren't HTTP)
  beforeAll(() => {
    mswServer.close();
  });

  afterAll(() => {
    mswServer.listen({ onUnhandledRequest: 'warn' });
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup mocks
    mockValidateSessionOwnership = vi.mocked(validateSessionOwnership);
    mockApprovalManager = {
      respondToApprovalAtomic: vi.fn(),
    };
    vi.mocked(getApprovalManager).mockReturnValue(mockApprovalManager as ReturnType<typeof getApprovalManager>);

    // Setup HTTP server with Socket.IO
    httpServer = createServer();
    io = new SocketIOServer(httpServer, {
      cors: { origin: '*', methods: ['GET', 'POST'] },
    });

    // Start server on random port
    await new Promise<void>((resolve) => {
      httpServer.listen(() => resolve());
    });

    const port = (httpServer.address() as AddressInfo).port;

    // Setup authentication middleware - User A is authenticated
    io.use((socket, next) => {
      const authSocket = socket as AuthenticatedSocket;
      authSocket.userId = TEST_USER_A_ID;
      authSocket.userEmail = 'user-a@test.com';
      next();
    });

    // Setup handlers matching server.ts implementation
    io.on('connection', (socket) => {
      serverSocket = socket as AuthenticatedSocket;
      const authSocket = serverSocket;

      // Handler: approval:response (F4-003 fix)
      socket.on('approval:response', async (data: {
        approvalId: string;
        decision: 'approved' | 'rejected';
        userId?: string;
        reason?: string;
      }) => {
        const { approvalId, decision, reason } = data;
        const authenticatedUserId = authSocket.userId;

        if (!authenticatedUserId) {
          socket.emit('approval:error', {
            error: 'Socket not authenticated. Please reconnect.',
          });
          return;
        }

        if (!decision || !['approved', 'rejected'].includes(decision)) {
          socket.emit('approval:error', {
            error: 'Invalid decision. Must be "approved" or "rejected".',
          });
          return;
        }

        try {
          const approvalManager = getApprovalManager();
          const result = await approvalManager.respondToApprovalAtomic(
            approvalId,
            decision,
            authenticatedUserId, // Uses socket userId, NOT client payload
            reason
          );

          if (!result.success) {
            socket.emit('approval:error', {
              error: result.error === 'UNAUTHORIZED'
                ? 'You do not have permission to respond to this approval.'
                : 'Approval response failed.',
              code: result.error,
            });
            return;
          }

          // F4-002: Now emit via agent:event instead of approval:resolved
          socket.emit('agent:event', {
            type: 'approval_resolved',
            approvalId,
            decision,
            sessionId: data.sessionId || 'session_123',
            timestamp: new Date(),
            eventId: 'mock-event-id',
            sequenceNumber: 1,
            persistenceState: 'persisted',
          });
        } catch (error) {
          socket.emit('approval:error', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      });

      // Handler: session:join (F4-003 fix)
      socket.on('session:join', async (data: { sessionId: string }) => {
        const { sessionId } = data;
        const authenticatedUserId = authSocket.userId;

        if (!authenticatedUserId) {
          socket.emit('session:error', {
            error: 'Socket not authenticated. Please reconnect.',
            code: 'NOT_AUTHENTICATED',
          });
          return;
        }

        if (!sessionId) {
          socket.emit('session:error', {
            error: 'Session ID is required.',
            code: 'MISSING_SESSION_ID',
          });
          return;
        }

        try {
          const ownershipResult = await validateSessionOwnership(sessionId, authenticatedUserId);

          if (!ownershipResult.isOwner) {
            if (ownershipResult.error === 'SESSION_NOT_FOUND') {
              socket.emit('session:error', {
                error: 'Session not found.',
                code: 'SESSION_NOT_FOUND',
              });
              return;
            }

            socket.emit('session:error', {
              error: 'You do not have access to this session.',
              code: 'UNAUTHORIZED',
            });
            return;
          }

          socket.join(sessionId);
          socket.emit('session:joined', { sessionId });
        } catch (error) {
          socket.emit('session:error', {
            error: 'Failed to join session. Please try again.',
            code: 'INTERNAL_ERROR',
          });
        }
      });

      // Handler: session:leave (no ownership validation needed)
      socket.on('session:leave', (data: { sessionId: string }) => {
        const { sessionId } = data;
        socket.leave(sessionId);
        socket.emit('session:left', { sessionId });
      });
    });

    // Create client socket
    clientSocket = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
    });

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
      clientSocket.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      clientSocket.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });

  afterEach(async () => {
    if (clientSocket) {
      clientSocket.removeAllListeners();
      if (clientSocket.connected) clientSocket.disconnect();
      clientSocket.close();
    }

    if (io) {
      const sockets = await io.fetchSockets();
      sockets.forEach((s) => s.disconnect(true));
      io.removeAllListeners();
      io.close();
    }

    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  describe('approval:response Security', () => {
    it('should use authenticated userId from socket, ignoring client-provided userId', async () => {
      // Arrange: User A is authenticated, tries to send User B's ID in payload
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({
        success: true,
        sessionId: TEST_SESSION_A_ID,
      });

      // F4-002: Now listen for agent:event instead of approval:resolved
      const promise = new Promise<{ type: string; approvalId: string }>((resolve) => {
        clientSocket.on('agent:event', (event: { type: string; approvalId: string }) => {
          if (event.type === 'approval_resolved') {
            resolve(event);
          }
        });
      });

      // Act: Send approval with User B's ID (impersonation attempt)
      clientSocket.emit('approval:response', {
        approvalId: 'approval-123',
        decision: 'approved',
        userId: TEST_USER_B_ID, // Attacker tries to impersonate User B
      });

      // Assert: Server uses authenticated User A's ID, not the payload
      await promise;
      expect(mockApprovalManager.respondToApprovalAtomic).toHaveBeenCalledWith(
        'approval-123',
        'approved',
        TEST_USER_A_ID, // Should be authenticated user, NOT User B
        undefined
      );
    });

    it('should reject approval response if user does not own the session', async () => {
      // Arrange: Atomic method returns UNAUTHORIZED
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({
        success: false,
        error: 'UNAUTHORIZED',
      });

      const promise = new Promise<{ error: string; code: string }>((resolve) => {
        clientSocket.on('approval:error', resolve);
      });

      // Act
      clientSocket.emit('approval:response', {
        approvalId: 'approval-belongs-to-user-b',
        decision: 'approved',
      });

      // Assert
      const error = await promise;
      expect(error.error).toBe('You do not have permission to respond to this approval.');
      expect(error.code).toBe('UNAUTHORIZED');
    });

    it('should reject invalid decision values', async () => {
      // Arrange
      const promise = new Promise<{ error: string }>((resolve) => {
        clientSocket.on('approval:error', resolve);
      });

      // Act: Send invalid decision
      clientSocket.emit('approval:response', {
        approvalId: 'approval-123',
        decision: 'invalid-decision' as 'approved' | 'rejected',
      });

      // Assert
      const error = await promise;
      expect(error.error).toBe('Invalid decision. Must be "approved" or "rejected".');
      expect(mockApprovalManager.respondToApprovalAtomic).not.toHaveBeenCalled();
    });

    it('should handle approval not found error', async () => {
      // Arrange
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({
        success: false,
        error: 'APPROVAL_NOT_FOUND',
      });

      const promise = new Promise<{ code: string }>((resolve) => {
        clientSocket.on('approval:error', resolve);
      });

      // Act
      clientSocket.emit('approval:response', {
        approvalId: 'non-existent-approval',
        decision: 'approved',
      });

      // Assert
      const error = await promise;
      expect(error.code).toBe('APPROVAL_NOT_FOUND');
    });
  });

  describe('session:join Security', () => {
    it('should allow joining session when user owns it', async () => {
      // Arrange: User A owns the session
      mockValidateSessionOwnership.mockResolvedValueOnce({
        isOwner: true,
      });

      const promise = new Promise<{ sessionId: string }>((resolve) => {
        clientSocket.on('session:joined', resolve);
      });

      // Act
      clientSocket.emit('session:join', { sessionId: TEST_SESSION_A_ID });

      // Assert
      const result = await promise;
      expect(result.sessionId).toBe(TEST_SESSION_A_ID);
      expect(mockValidateSessionOwnership).toHaveBeenCalledWith(
        TEST_SESSION_A_ID,
        TEST_USER_A_ID
      );
    });

    it('should reject joining session when user does not own it', async () => {
      // Arrange: User A tries to join User B's session
      mockValidateSessionOwnership.mockResolvedValueOnce({
        isOwner: false,
        error: 'NOT_OWNER',
      });

      const promise = new Promise<{ error: string; code: string }>((resolve) => {
        clientSocket.on('session:error', resolve);
      });

      // Act: User A (authenticated) tries to join User B's session
      clientSocket.emit('session:join', { sessionId: TEST_SESSION_B_ID });

      // Assert
      const error = await promise;
      expect(error.error).toBe('You do not have access to this session.');
      expect(error.code).toBe('UNAUTHORIZED');
    });

    it('should return SESSION_NOT_FOUND when session does not exist', async () => {
      // Arrange
      mockValidateSessionOwnership.mockResolvedValueOnce({
        isOwner: false,
        error: 'SESSION_NOT_FOUND',
      });

      const promise = new Promise<{ error: string; code: string }>((resolve) => {
        clientSocket.on('session:error', resolve);
      });

      // Act
      clientSocket.emit('session:join', { sessionId: 'non-existent-session' });

      // Assert
      const error = await promise;
      expect(error.error).toBe('Session not found.');
      expect(error.code).toBe('SESSION_NOT_FOUND');
    });

    it('should reject when sessionId is missing', async () => {
      // Arrange
      const promise = new Promise<{ error: string; code: string }>((resolve) => {
        clientSocket.on('session:error', resolve);
      });

      // Act: Send empty sessionId
      clientSocket.emit('session:join', { sessionId: '' });

      // Assert
      const error = await promise;
      expect(error.error).toBe('Session ID is required.');
      expect(error.code).toBe('MISSING_SESSION_ID');
      expect(mockValidateSessionOwnership).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      // Arrange
      mockValidateSessionOwnership.mockRejectedValueOnce(new Error('Database connection failed'));

      const promise = new Promise<{ error: string; code: string }>((resolve) => {
        clientSocket.on('session:error', resolve);
      });

      // Act
      clientSocket.emit('session:join', { sessionId: TEST_SESSION_A_ID });

      // Assert
      const error = await promise;
      expect(error.error).toBe('Failed to join session. Please try again.');
      expect(error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('approval:response Edge Cases', () => {
    it('should handle EXPIRED approval error', async () => {
      // Arrange
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({
        success: false,
        error: 'EXPIRED',
      });

      const promise = new Promise<{ code: string }>((resolve) => {
        clientSocket.on('approval:error', resolve);
      });

      // Act
      clientSocket.emit('approval:response', {
        approvalId: 'expired-approval',
        decision: 'approved',
      });

      // Assert
      const error = await promise;
      expect(error.code).toBe('EXPIRED');
    });

    it('should handle ALREADY_RESOLVED approval error', async () => {
      // Arrange
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({
        success: false,
        error: 'ALREADY_RESOLVED',
        previousStatus: 'approved',
      });

      const promise = new Promise<{ code: string }>((resolve) => {
        clientSocket.on('approval:error', resolve);
      });

      // Act
      clientSocket.emit('approval:response', {
        approvalId: 'already-resolved',
        decision: 'rejected',
      });

      // Assert
      const error = await promise;
      expect(error.code).toBe('ALREADY_RESOLVED');
    });

    it('should handle SESSION_NOT_FOUND for orphaned approval', async () => {
      // Arrange
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({
        success: false,
        error: 'SESSION_NOT_FOUND',
      });

      const promise = new Promise<{ code: string }>((resolve) => {
        clientSocket.on('approval:error', resolve);
      });

      // Act
      clientSocket.emit('approval:response', {
        approvalId: 'orphaned-approval',
        decision: 'approved',
      });

      // Assert
      const error = await promise;
      expect(error.code).toBe('SESSION_NOT_FOUND');
    });

    it('should handle NO_PENDING_PROMISE error (server restart scenario)', async () => {
      // Arrange
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({
        success: false,
        error: 'NO_PENDING_PROMISE',
      });

      const promise = new Promise<{ code: string }>((resolve) => {
        clientSocket.on('approval:error', resolve);
      });

      // Act
      clientSocket.emit('approval:response', {
        approvalId: 'stale-approval',
        decision: 'approved',
      });

      // Assert
      const error = await promise;
      expect(error.code).toBe('NO_PENDING_PROMISE');
    });

    it('should handle exception thrown by ApprovalManager', async () => {
      // Arrange
      mockApprovalManager.respondToApprovalAtomic.mockRejectedValueOnce(
        new Error('Database connection lost')
      );

      const promise = new Promise<{ error: string }>((resolve) => {
        clientSocket.on('approval:error', resolve);
      });

      // Act
      clientSocket.emit('approval:response', {
        approvalId: 'approval-123',
        decision: 'approved',
      });

      // Assert
      const error = await promise;
      expect(error.error).toBe('Database connection lost');
    });

    it('should successfully reject an approval', async () => {
      // Arrange
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({
        success: true,
        sessionId: TEST_SESSION_A_ID,
      });

      // F4-002: Now listen for agent:event instead of approval:resolved
      const promise = new Promise<{ type: string; decision: string }>((resolve) => {
        clientSocket.on('agent:event', (event: { type: string; decision: string }) => {
          if (event.type === 'approval_resolved') {
            resolve(event);
          }
        });
      });

      // Act
      clientSocket.emit('approval:response', {
        approvalId: 'approval-to-reject',
        decision: 'rejected',
      });

      // Assert
      const result = await promise;
      expect(result.decision).toBe('rejected');
      expect(mockApprovalManager.respondToApprovalAtomic).toHaveBeenCalledWith(
        'approval-to-reject',
        'rejected',
        TEST_USER_A_ID,
        undefined
      );
    });

    it('should pass reason to ApprovalManager when provided', async () => {
      // Arrange
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({
        success: true,
        sessionId: TEST_SESSION_A_ID,
      });

      // F4-002: Now listen for agent:event instead of approval:resolved
      const promise = new Promise<{ type: string; approvalId: string }>((resolve) => {
        clientSocket.on('agent:event', (event: { type: string; approvalId: string }) => {
          if (event.type === 'approval_resolved') {
            resolve(event);
          }
        });
      });

      // Act
      clientSocket.emit('approval:response', {
        approvalId: 'approval-with-reason',
        decision: 'rejected',
        reason: 'Invalid customer data',
      });

      // Assert
      await promise;
      expect(mockApprovalManager.respondToApprovalAtomic).toHaveBeenCalledWith(
        'approval-with-reason',
        'rejected',
        TEST_USER_A_ID,
        'Invalid customer data'
      );
    });

    it('should reject when decision is undefined', async () => {
      // Arrange
      const promise = new Promise<{ error: string }>((resolve) => {
        clientSocket.on('approval:error', resolve);
      });

      // Act: Send without decision
      clientSocket.emit('approval:response', {
        approvalId: 'approval-123',
      });

      // Assert
      const error = await promise;
      expect(error.error).toBe('Invalid decision. Must be "approved" or "rejected".');
    });
  });

  describe('session:join Edge Cases', () => {
    it('should verify socket is in room after successful join', async () => {
      // Arrange
      mockValidateSessionOwnership.mockResolvedValueOnce({ isOwner: true });

      const promise = new Promise<{ sessionId: string }>((resolve) => {
        clientSocket.on('session:joined', resolve);
      });

      // Act
      clientSocket.emit('session:join', { sessionId: TEST_SESSION_A_ID });
      await promise;

      // Assert: Verify socket is in the room
      const rooms = serverSocket.rooms;
      expect(rooms.has(TEST_SESSION_A_ID)).toBe(true);
    });

    it('should handle INVALID_INPUT error from ownership validation', async () => {
      // Arrange
      mockValidateSessionOwnership.mockResolvedValueOnce({
        isOwner: false,
        error: 'INVALID_INPUT',
      });

      const promise = new Promise<{ code: string }>((resolve) => {
        clientSocket.on('session:error', resolve);
      });

      // Act
      clientSocket.emit('session:join', { sessionId: 'some-session' });

      // Assert
      const error = await promise;
      expect(error.code).toBe('UNAUTHORIZED'); // Generic error for non-SESSION_NOT_FOUND
    });

    it('should handle DATABASE_ERROR from ownership validation', async () => {
      // Arrange
      mockValidateSessionOwnership.mockResolvedValueOnce({
        isOwner: false,
        error: 'DATABASE_ERROR',
      });

      const promise = new Promise<{ code: string }>((resolve) => {
        clientSocket.on('session:error', resolve);
      });

      // Act
      clientSocket.emit('session:join', { sessionId: 'some-session' });

      // Assert
      const error = await promise;
      expect(error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('session:leave Behavior', () => {
    it('should allow leaving a session without ownership validation', async () => {
      // Note: session:leave does NOT require ownership validation
      // Users can always leave rooms they're in

      // First join a room
      mockValidateSessionOwnership.mockResolvedValueOnce({ isOwner: true });
      const joinPromise = new Promise<void>((resolve) => {
        clientSocket.on('session:joined', () => resolve());
      });
      clientSocket.emit('session:join', { sessionId: TEST_SESSION_A_ID });
      await joinPromise;

      // Verify in room
      expect(serverSocket.rooms.has(TEST_SESSION_A_ID)).toBe(true);

      // Now leave (no ownership check needed)
      const leavePromise = new Promise<{ sessionId: string }>((resolve) => {
        clientSocket.on('session:left', resolve);
      });
      clientSocket.emit('session:leave', { sessionId: TEST_SESSION_A_ID });
      const result = await leavePromise;

      // Assert
      expect(result.sessionId).toBe(TEST_SESSION_A_ID);
      expect(serverSocket.rooms.has(TEST_SESSION_A_ID)).toBe(false);
    });

    it('should handle leaving a session user was never in', async () => {
      // This should still succeed (no-op)
      const leavePromise = new Promise<{ sessionId: string }>((resolve) => {
        clientSocket.on('session:left', resolve);
      });

      clientSocket.emit('session:leave', { sessionId: 'never-joined-session' });
      const result = await leavePromise;

      expect(result.sessionId).toBe('never-joined-session');
    });
  });

  describe('Unauthenticated Socket Scenarios', () => {
    // These tests use a separate server setup with unauthenticated middleware

    it('should reject approval:response when socket has no userId', async () => {
      // Create new server without authentication
      const unauthServer = createServer();
      const unauthIO = new SocketIOServer(unauthServer, {
        cors: { origin: '*' },
      });

      await new Promise<void>((resolve) => unauthServer.listen(() => resolve()));
      const port = (unauthServer.address() as AddressInfo).port;

      // NO authentication middleware - userId will be undefined
      unauthIO.on('connection', (socket) => {
        const authSocket = socket as AuthenticatedSocket;
        // authSocket.userId is NOT set

        socket.on('approval:response', async (data: {
          approvalId: string;
          decision: 'approved' | 'rejected';
        }) => {
          const authenticatedUserId = authSocket.userId;

          if (!authenticatedUserId) {
            socket.emit('approval:error', {
              error: 'Socket not authenticated. Please reconnect.',
            });
            return;
          }
        });
      });

      const unauthClient = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true,
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
        unauthClient.on('connect', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      // Act & Assert
      const errorPromise = new Promise<{ error: string }>((resolve) => {
        unauthClient.on('approval:error', resolve);
      });

      unauthClient.emit('approval:response', {
        approvalId: 'test-approval',
        decision: 'approved',
      });

      const error = await errorPromise;
      expect(error.error).toBe('Socket not authenticated. Please reconnect.');

      // Cleanup
      unauthClient.disconnect();
      unauthClient.close();
      unauthIO.close();
      await new Promise<void>((resolve, reject) => {
        unauthServer.close((err) => err ? reject(err) : resolve());
      });
    });

    it('should reject session:join when socket has no userId', async () => {
      // Create new server without authentication
      const unauthServer = createServer();
      const unauthIO = new SocketIOServer(unauthServer, {
        cors: { origin: '*' },
      });

      await new Promise<void>((resolve) => unauthServer.listen(() => resolve()));
      const port = (unauthServer.address() as AddressInfo).port;

      // NO authentication middleware
      unauthIO.on('connection', (socket) => {
        const authSocket = socket as AuthenticatedSocket;

        socket.on('session:join', async (data: { sessionId: string }) => {
          const authenticatedUserId = authSocket.userId;

          if (!authenticatedUserId) {
            socket.emit('session:error', {
              error: 'Socket not authenticated. Please reconnect.',
              code: 'NOT_AUTHENTICATED',
            });
            return;
          }
        });
      });

      const unauthClient = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true,
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
        unauthClient.on('connect', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      // Act & Assert
      const errorPromise = new Promise<{ error: string; code: string }>((resolve) => {
        unauthClient.on('session:error', resolve);
      });

      unauthClient.emit('session:join', { sessionId: 'test-session' });

      const error = await errorPromise;
      expect(error.error).toBe('Socket not authenticated. Please reconnect.');
      expect(error.code).toBe('NOT_AUTHENTICATED');

      // Cleanup
      unauthClient.disconnect();
      unauthClient.close();
      unauthIO.close();
      await new Promise<void>((resolve, reject) => {
        unauthServer.close((err) => err ? reject(err) : resolve());
      });
    });
  });

  describe('Multi-Tenant Isolation Scenarios', () => {
    it('should prevent cross-tenant access via approval impersonation', async () => {
      // Scenario: User A authenticates, sends approval response with User B's ID
      // Expected: Server ignores payload userId, uses authenticated userId

      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({
        success: false,
        error: 'UNAUTHORIZED', // Because approval belongs to User B, not User A
      });

      const promise = new Promise<{ code: string }>((resolve) => {
        clientSocket.on('approval:error', resolve);
      });

      // Attacker (User A) tries to approve User B's approval request
      clientSocket.emit('approval:response', {
        approvalId: 'approval-for-user-b-session',
        decision: 'approved',
        userId: TEST_USER_B_ID, // Impersonation attempt - IGNORED
      });

      const error = await promise;
      expect(error.code).toBe('UNAUTHORIZED');

      // Verify server used authenticated user ID
      expect(mockApprovalManager.respondToApprovalAtomic).toHaveBeenCalledWith(
        'approval-for-user-b-session',
        'approved',
        TEST_USER_A_ID, // Authenticated user, not impersonated
        undefined
      );
    });

    it('should prevent cross-tenant session room subscription', async () => {
      // Scenario: User A tries to join User B's session room
      // Expected: Ownership validation fails, room join denied

      mockValidateSessionOwnership.mockResolvedValueOnce({
        isOwner: false,
        error: 'NOT_OWNER',
        actualOwner: TEST_USER_B_ID, // Internal only, not exposed to client
      });

      const errorPromise = new Promise<{ code: string }>((resolve) => {
        clientSocket.on('session:error', resolve);
      });

      // User A tries to subscribe to User B's session events
      clientSocket.emit('session:join', { sessionId: TEST_SESSION_B_ID });

      const error = await errorPromise;
      expect(error.code).toBe('UNAUTHORIZED');

      // Verify room was NOT joined (socket should not be in room)
      const rooms = serverSocket.rooms;
      expect(rooms.has(TEST_SESSION_B_ID)).toBe(false);
    });

    it('should allow legitimate same-tenant operations', async () => {
      // Scenario: User A performs operations on their own resources
      // Expected: All operations succeed

      // Setup: User A owns session and approval
      mockValidateSessionOwnership.mockResolvedValueOnce({ isOwner: true });
      mockApprovalManager.respondToApprovalAtomic.mockResolvedValueOnce({
        success: true,
        sessionId: TEST_SESSION_A_ID,
      });

      // Test 1: Join own session
      const joinPromise = new Promise<{ sessionId: string }>((resolve) => {
        clientSocket.on('session:joined', resolve);
      });
      clientSocket.emit('session:join', { sessionId: TEST_SESSION_A_ID });
      const joinResult = await joinPromise;
      expect(joinResult.sessionId).toBe(TEST_SESSION_A_ID);

      // Test 2: Respond to own approval
      // F4-002: Now listen for agent:event instead of approval:resolved
      const approvalPromise = new Promise<{ type: string; decision: string }>((resolve) => {
        clientSocket.on('agent:event', (event: { type: string; decision: string }) => {
          if (event.type === 'approval_resolved') {
            resolve(event);
          }
        });
      });
      clientSocket.emit('approval:response', {
        approvalId: 'my-approval',
        decision: 'approved',
      });
      const approvalResult = await approvalPromise;
      expect(approvalResult.decision).toBe('approved');
    });
  });
});
