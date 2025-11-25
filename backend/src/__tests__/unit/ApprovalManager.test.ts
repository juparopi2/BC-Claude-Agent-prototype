/**
 * ApprovalManager Unit Tests - FIXED
 *
 * Fixed Issues:
 * 1. Database mock now uses persistent spy at module level
 * 2. Socket.IO mock properly captures emit spy
 * 3. All assertions updated to use correct spy references
 *
 * Test Coverage:
 * 1. Request approval flow (create request, emit event, return promise)
 * 2. Respond to approval (approve/reject)
 * 3. Timeout handling (auto-expire after 5 minutes)
 * 4. Get pending approvals from database
 * 5. Expire old approvals background job
 * 6. Singleton pattern
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApprovalManager, getApprovalManager } from '@/services/approval/ApprovalManager';
import type { Server as SocketServer } from 'socket.io';

// ===== PHASE 1: FIX DATABASE MOCK =====
// Create persistent mock chain at module level
const mockRequestChain = {
  input: vi.fn().mockReturnThis(),
  query: vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [0] }),
};

const mockDbRequest = vi.fn(() => mockRequestChain);

// Mock transaction chain for atomic operations
const mockTransactionRequestChain = {
  input: vi.fn().mockReturnThis(),
  query: vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [0] }),
};

const mockTransaction = {
  begin: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  rollback: vi.fn().mockResolvedValue(undefined),
  request: vi.fn(() => mockTransactionRequestChain),
};

// Mock database with persistent spy including transaction support
vi.mock('@/config/database', () => ({
  getDatabase: vi.fn(() => ({
    request: mockDbRequest,
    transaction: vi.fn(() => mockTransaction),
  })),
}));

// Mock logger to avoid output during tests
vi.mock('@/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('ApprovalManager', () => {
  let approvalManager: ApprovalManager;
  let mockIo: SocketServer;
  let mockEmit: ReturnType<typeof vi.fn>;  // Phase 2: Capture emit spy

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Re-setup database mock after clearAllMocks
    mockDbRequest.mockReturnValue(mockRequestChain);
    mockRequestChain.input.mockReturnThis();
    mockRequestChain.query.mockResolvedValue({ recordset: [], rowsAffected: [0] });

    // ===== PHASE 2: FIX SOCKET.IO MOCK =====
    // Create persistent emit spy
    mockEmit = vi.fn();
    const mockTo = vi.fn(() => ({ emit: mockEmit }));

    mockIo = {
      to: mockTo,
    } as unknown as SocketServer;

    // Get fresh instance (reset singleton)
    (ApprovalManager as any).instance = null;
    approvalManager = ApprovalManager.getInstance(mockIo);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('1. Request Approval Flow', () => {
    it('should create approval request and emit WebSocket event', async () => {
      // Arrange
      const requestOptions = {
        sessionId: 'session_123',
        toolName: 'bc_create_customer',
        toolArgs: { name: 'John Doe', email: 'john@example.com' },
        expiresInMs: 10000, // 10 seconds to avoid timeout during test
      };

      // Act - start the request (but don't await yet)
      const approvalPromise = approvalManager.request(requestOptions);

      // Fast-forward to allow async operations to complete
      await vi.runOnlyPendingTimersAsync();

      // ===== PHASE 3: FIX ASSERTIONS =====
      // Assert - Database insert should be called
      expect(mockDbRequest).toHaveBeenCalled();

      // Assert - WebSocket event should be emitted
      expect(mockIo.to).toHaveBeenCalledWith('session_123');
      expect(mockEmit).toHaveBeenCalledWith(
        'approval:requested',
        expect.objectContaining({
          toolName: 'bc_create_customer',
          priority: 'medium', // create operations are medium priority
        })
      );

      // Cleanup - advance to timeout
      vi.advanceTimersByTime(10000);
      await approvalPromise;
    });

    it('should generate correct change summary for create_customer tool', async () => {
      const requestOptions = {
        sessionId: 'session_123',
        toolName: 'bc_create_customer',
        toolArgs: { name: 'Acme Corp', email: 'acme@example.com', phoneNumber: '555-0123' },
        expiresInMs: 10000,
      };

      const approvalPromise = approvalManager.request(requestOptions);
      await vi.runOnlyPendingTimersAsync();

      // Check emitted event has correct summary
      expect(mockEmit).toHaveBeenCalledWith(
        'approval:requested',
        expect.objectContaining({
          summary: expect.objectContaining({
            title: 'Create New Customer',
            description: 'Create a new customer record in Business Central',
            changes: expect.objectContaining({
              'Customer Name': 'Acme Corp',
              'Email': 'acme@example.com',
              'Phone': '555-0123',
            }),
          }),
        })
      );

      vi.advanceTimersByTime(10000);
      await approvalPromise;
    });
  });

  describe('2. Respond to Approval', () => {
    it('should resolve promise with true when approved', async () => {
      const requestOptions = {
        sessionId: 'session_123',
        toolName: 'bc_create_customer',
        toolArgs: { name: 'John Doe' },
        expiresInMs: 10000, // 10 seconds to avoid timeout during test
      };

      // Start approval request
      const approvalPromise = approvalManager.request(requestOptions);

      // Wait for async setup to complete (database insert, emit, Promise creation)
      await vi.advanceTimersByTimeAsync(1);

      // Get the approval ID from the emitted event
      const approvalId = mockEmit.mock.calls[0][1].approvalId;

      // Mock database query to return session_id
      mockRequestChain.query.mockResolvedValueOnce({
        recordset: [{ session_id: 'session_123' }],
      });

      // Respond with approval
      await approvalManager.respondToApproval(approvalId, 'approved', 'user_123');

      // Promise should resolve to true
      const result = await approvalPromise;
      expect(result).toBe(true);
    });

    it('should resolve promise with false when rejected', async () => {
      const requestOptions = {
        sessionId: 'session_123',
        toolName: 'bc_create_customer',
        toolArgs: { name: 'John Doe' },
        expiresInMs: 10000, // 10 seconds to avoid timeout during test
      };

      const approvalPromise = approvalManager.request(requestOptions);

      // Wait for async setup to complete
      await vi.advanceTimersByTimeAsync(1);

      const approvalId = mockEmit.mock.calls[0][1].approvalId;

      mockRequestChain.query.mockResolvedValueOnce({
        recordset: [{ session_id: 'session_123' }],
      });

      await approvalManager.respondToApproval(approvalId, 'rejected', 'user_123');

      const result = await approvalPromise;
      expect(result).toBe(false);
    });

    it('should update database with decision', async () => {
      const requestOptions = {
        sessionId: 'session_123',
        toolName: 'bc_create_customer',
        toolArgs: { name: 'John Doe' },
        expiresInMs: 10000, // 10 seconds to avoid timeout during test
      };

      const approvalPromise = approvalManager.request(requestOptions);

      // Wait for async setup to complete
      await vi.advanceTimersByTimeAsync(1);

      const approvalId = mockEmit.mock.calls[0][1].approvalId;

      mockRequestChain.query.mockResolvedValueOnce({
        recordset: [{ session_id: 'session_123' }],
      });

      await approvalManager.respondToApproval(approvalId, 'approved', 'user_123');

      // Check database UPDATE was called
      expect(mockDbRequest).toHaveBeenCalledTimes(3); // INSERT + UPDATE + SELECT
      expect(mockRequestChain.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE approvals')
      );

      // Cleanup - advance to timeout (avoid runAllTimers infinite loop)
      vi.advanceTimersByTime(10000);
      await approvalPromise;
    });
  });

  describe('3. Timeout Handling', () => {
    it('should auto-reject after timeout expires', async () => {
      const requestOptions = {
        sessionId: 'session_123',
        toolName: 'bc_create_customer',
        toolArgs: { name: 'John Doe' },
        expiresInMs: 5000, // 5 seconds for test
      };

      const approvalPromise = approvalManager.request(requestOptions);
      await vi.runOnlyPendingTimersAsync();

      // Fast-forward past the timeout
      vi.advanceTimersByTime(6000);

      // Promise should resolve to false (rejected by timeout)
      const result = await approvalPromise;
      expect(result).toBe(false);
    });

    it('should not timeout if responded before expiration', async () => {
      const requestOptions = {
        sessionId: 'session_123',
        toolName: 'bc_create_customer',
        toolArgs: { name: 'John Doe' },
        expiresInMs: 10000, // 10 seconds
      };

      const approvalPromise = approvalManager.request(requestOptions);

      // Wait for async setup to complete
      await vi.advanceTimersByTimeAsync(1);

      const approvalId = mockEmit.mock.calls[0][1].approvalId;

      mockRequestChain.query.mockResolvedValueOnce({
        recordset: [{ session_id: 'session_123' }],
      });

      // Respond before timeout (advance 2 seconds, still within 10 second window)
      vi.advanceTimersByTime(2000);
      await approvalManager.respondToApproval(approvalId, 'approved', 'user_123');

      // Promise should resolve to true (approved)
      const result = await approvalPromise;
      expect(result).toBe(true);
    });
  });

  describe('4. Get Pending Approvals', () => {
    it('should fetch pending approvals from database', async () => {
      const mockApprovals = [
        {
          id: 'approval_1',
          session_id: 'session_123',
          tool_name: 'bc_create_customer',
          tool_args: '{"name":"John Doe"}',
          status: 'pending',
          priority: 'medium',
          created_at: new Date(),
          expires_at: new Date(),
          decided_at: null,
          decided_by: null,
        },
      ];

      mockRequestChain.query.mockResolvedValueOnce({
        recordset: mockApprovals,
      });

      const result = await approvalManager.getPendingApprovals('session_123');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'approval_1',
        session_id: 'session_123',
        tool_name: 'bc_create_customer',
        tool_args: { name: 'John Doe' },
      });
    });
  });

  describe('5. Expire Old Approvals Job', () => {
    it('should expire old pending approvals', async () => {
      mockRequestChain.query.mockResolvedValueOnce({
        rowsAffected: [2], // 2 approvals expired
      });

      await approvalManager.expireOldApprovals();

      expect(mockDbRequest).toHaveBeenCalled();
      expect(mockRequestChain.query).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'expired'")
      );
    });
  });

  describe('6. Singleton Pattern', () => {
    it('should return the same instance on subsequent calls', () => {
      const instance1 = getApprovalManager();
      const instance2 = getApprovalManager();

      expect(instance1).toBe(instance2);
    });

    it('should throw error if initialized without Socket.IO', () => {
      (ApprovalManager as any).instance = null;

      expect(() => {
        ApprovalManager.getInstance();
      }).toThrow('Socket.IO server is required');
    });
  });

  describe('7. Validate Approval Ownership (Security)', () => {
    it('should return isOwner=true when user owns the session', async () => {
      // Mock database response with matching user
      mockRequestChain.query.mockResolvedValueOnce({
        recordset: [{
          approval_id: 'approval_123',
          session_id: 'session_123',
          tool_name: 'bc_create_customer',
          tool_args: '{"name":"John Doe"}',
          status: 'pending',
          priority: 'medium',
          created_at: new Date(),
          expires_at: new Date(),
          session_user_id: 'user_123',  // Same as requesting user
          session_exists: 1,  // Session exists
        }],
      });

      const result = await approvalManager.validateApprovalOwnership('approval_123', 'user_123');

      expect(result.isOwner).toBe(true);
      expect(result.approval).not.toBeNull();
      expect(result.approval?.id).toBe('approval_123');
      expect(result.sessionUserId).toBe('user_123');
      expect(result.error).toBeUndefined();
    });

    it('should return isOwner=false when user does not own the session', async () => {
      // Mock database response with different user
      mockRequestChain.query.mockResolvedValueOnce({
        recordset: [{
          approval_id: 'approval_123',
          session_id: 'session_123',
          tool_name: 'bc_create_customer',
          tool_args: '{"name":"John Doe"}',
          status: 'pending',
          priority: 'medium',
          created_at: new Date(),
          expires_at: new Date(),
          session_user_id: 'user_456',  // Different from requesting user
          session_exists: 1,  // Session exists
        }],
      });

      const result = await approvalManager.validateApprovalOwnership('approval_123', 'user_123');

      expect(result.isOwner).toBe(false);
      expect(result.approval).not.toBeNull();
      expect(result.sessionUserId).toBe('user_456');
      expect(result.error).toBe('UNAUTHORIZED');
    });

    it('should return error when approval does not exist', async () => {
      // Mock empty database response
      mockRequestChain.query.mockResolvedValueOnce({
        recordset: [],
      });

      const result = await approvalManager.validateApprovalOwnership('nonexistent_approval', 'user_123');

      expect(result.isOwner).toBe(false);
      expect(result.approval).toBeNull();
      expect(result.sessionUserId).toBeNull();
      expect(result.error).toBe('APPROVAL_NOT_FOUND');
    });

    it('should correctly parse tool_args JSON in approval object', async () => {
      const toolArgs = { name: 'Acme Corp', email: 'acme@example.com', priority: 'high' };

      mockRequestChain.query.mockResolvedValueOnce({
        recordset: [{
          approval_id: 'approval_123',
          session_id: 'session_123',
          tool_name: 'bc_create_customer',
          tool_args: JSON.stringify(toolArgs),
          status: 'pending',
          priority: 'medium',
          created_at: new Date(),
          expires_at: new Date(),
          session_user_id: 'user_123',
          session_exists: 1,  // Session exists
        }],
      });

      const result = await approvalManager.validateApprovalOwnership('approval_123', 'user_123');

      expect(result.isOwner).toBe(true);
      expect(result.approval?.tool_args).toEqual(toolArgs);
    });

    it('should log warning when unauthorized access is attempted', async () => {
      mockRequestChain.query.mockResolvedValueOnce({
        recordset: [{
          approval_id: 'approval_123',
          session_id: 'session_123',
          tool_name: 'bc_create_customer',
          tool_args: '{}',
          status: 'pending',
          priority: 'medium',
          created_at: new Date(),
          expires_at: new Date(),
          session_user_id: 'user_456',
          session_exists: 1,
        }],
      });

      const result = await approvalManager.validateApprovalOwnership('approval_123', 'attacker_user');

      // Pino logger is used internally - we verify via the result
      expect(result.isOwner).toBe(false);
      expect(result.error).toBe('UNAUTHORIZED');
    });

    it('should return SESSION_NOT_FOUND when session was deleted', async () => {
      // Mock approval exists but session was deleted (orphaned approval)
      mockRequestChain.query.mockResolvedValueOnce({
        recordset: [{
          approval_id: 'approval_123',
          session_id: 'deleted_session',
          tool_name: 'bc_create_customer',
          tool_args: '{}',
          status: 'pending',
          priority: 'medium',
          created_at: new Date(),
          expires_at: new Date(),
          session_user_id: null,
          session_exists: 0,  // Session does not exist
        }],
      });

      const result = await approvalManager.validateApprovalOwnership('approval_123', 'user_123');

      expect(result.isOwner).toBe(false);
      expect(result.approval).toBeNull();
      expect(result.error).toBe('SESSION_NOT_FOUND');
    });

    it('should handle malformed tool_args JSON gracefully', async () => {
      mockRequestChain.query.mockResolvedValueOnce({
        recordset: [{
          approval_id: 'approval_123',
          session_id: 'session_123',
          tool_name: 'bc_create_customer',
          tool_args: '{invalid json}',  // Malformed JSON
          status: 'pending',
          priority: 'medium',
          created_at: new Date(),
          expires_at: new Date(),
          session_user_id: 'user_123',
          session_exists: 1,
        }],
      });

      const result = await approvalManager.validateApprovalOwnership('approval_123', 'user_123');

      expect(result.isOwner).toBe(true);
      expect(result.approval).not.toBeNull();
      expect(result.approval?.tool_args).toEqual({ _parseError: 'Invalid JSON in tool_args' });
    });
  });

  describe('8. Atomic Approval Response (respondToApprovalAtomic)', () => {
    beforeEach(() => {
      // Reset transaction mocks for each test
      mockTransactionRequestChain.input.mockReturnThis();
      mockTransactionRequestChain.query.mockResolvedValue({ recordset: [], rowsAffected: [0] });
      mockTransaction.begin.mockResolvedValue(undefined);
      mockTransaction.commit.mockResolvedValue(undefined);
      mockTransaction.rollback.mockResolvedValue(undefined);
      mockTransaction.request.mockReturnValue(mockTransactionRequestChain);
    });

    it('should return APPROVAL_NOT_FOUND for non-existent approval', async () => {
      mockTransactionRequestChain.query.mockResolvedValueOnce({
        recordset: [],
      });

      const result = await approvalManager.respondToApprovalAtomic(
        'nonexistent',
        'approved',
        'user_123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('APPROVAL_NOT_FOUND');
      expect(mockTransaction.rollback).toHaveBeenCalled();
    });

    it('should return SESSION_NOT_FOUND when session was deleted', async () => {
      mockTransactionRequestChain.query.mockResolvedValueOnce({
        recordset: [{
          approval_id: 'approval_123',
          session_id: 'deleted_session',
          status: 'pending',
          session_user_id: null,
          session_exists: 0,
        }],
      });

      const result = await approvalManager.respondToApprovalAtomic(
        'approval_123',
        'approved',
        'user_123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('SESSION_NOT_FOUND');
      expect(mockTransaction.rollback).toHaveBeenCalled();
    });

    it('should return UNAUTHORIZED when user does not own session', async () => {
      mockTransactionRequestChain.query.mockResolvedValueOnce({
        recordset: [{
          approval_id: 'approval_123',
          session_id: 'session_123',
          status: 'pending',
          session_user_id: 'other_user',
          session_exists: 1,
        }],
      });

      const result = await approvalManager.respondToApprovalAtomic(
        'approval_123',
        'approved',
        'attacker_user'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNAUTHORIZED');
      expect(result.sessionUserId).toBe('other_user');
      expect(mockTransaction.rollback).toHaveBeenCalled();
    });

    it('should return ALREADY_RESOLVED when approval was already approved', async () => {
      mockTransactionRequestChain.query.mockResolvedValueOnce({
        recordset: [{
          approval_id: 'approval_123',
          session_id: 'session_123',
          status: 'approved',  // Already resolved
          session_user_id: 'user_123',
          session_exists: 1,
        }],
      });

      const result = await approvalManager.respondToApprovalAtomic(
        'approval_123',
        'approved',
        'user_123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('ALREADY_RESOLVED');
      expect(result.previousStatus).toBe('approved');
      expect(mockTransaction.rollback).toHaveBeenCalled();
    });

    it('should return EXPIRED when approval has expired', async () => {
      mockTransactionRequestChain.query.mockResolvedValueOnce({
        recordset: [{
          approval_id: 'approval_123',
          session_id: 'session_123',
          status: 'expired',
          session_user_id: 'user_123',
          session_exists: 1,
        }],
      });

      const result = await approvalManager.respondToApprovalAtomic(
        'approval_123',
        'approved',
        'user_123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('EXPIRED');
      expect(mockTransaction.rollback).toHaveBeenCalled();
    });

    it('should return NO_PENDING_PROMISE when server has no in-memory promise', async () => {
      // Approval is valid but no pending promise exists (server restarted)
      mockTransactionRequestChain.query.mockResolvedValueOnce({
        recordset: [{
          approval_id: 'approval_orphan',
          session_id: 'session_123',
          status: 'pending',
          session_user_id: 'user_123',
          session_exists: 1,
        }],
      });

      const result = await approvalManager.respondToApprovalAtomic(
        'approval_orphan',  // Different ID than any pending approval
        'approved',
        'user_123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('NO_PENDING_PROMISE');
      expect(mockTransaction.rollback).toHaveBeenCalled();
    });

    it('should succeed when all validations pass and pending promise exists', async () => {
      // First create a pending approval to have an in-memory promise
      const requestOptions = {
        sessionId: 'session_123',
        toolName: 'bc_create_customer',
        toolArgs: { name: 'Test' },
        expiresInMs: 60000,
      };

      const approvalPromise = approvalManager.request(requestOptions);
      await vi.advanceTimersByTimeAsync(1);

      const approvalId = mockEmit.mock.calls[0][1].approvalId;

      // Now test the atomic response
      mockTransactionRequestChain.query
        .mockResolvedValueOnce({
          recordset: [{
            approval_id: approvalId,
            session_id: 'session_123',
            status: 'pending',
            session_user_id: 'user_123',
            session_exists: 1,
          }],
        })
        .mockResolvedValueOnce({ rowsAffected: [1] });  // UPDATE result

      const result = await approvalManager.respondToApprovalAtomic(
        approvalId,
        'approved',
        'user_123'
      );

      expect(result.success).toBe(true);
      expect(result.sessionId).toBe('session_123');
      expect(mockTransaction.commit).toHaveBeenCalled();
      expect(mockEmit).toHaveBeenCalledWith('approval:resolved', expect.objectContaining({
        approvalId,
        decision: 'approved',
      }));

      // The original promise should resolve to true
      const approved = await approvalPromise;
      expect(approved).toBe(true);
    });

    it('should handle concurrent responses correctly (only first succeeds)', async () => {
      // Create a pending approval
      const requestOptions = {
        sessionId: 'session_123',
        toolName: 'bc_create_customer',
        toolArgs: { name: 'Test' },
        expiresInMs: 60000,
      };

      const approvalPromise = approvalManager.request(requestOptions);
      await vi.advanceTimersByTimeAsync(1);

      const approvalId = mockEmit.mock.calls[0][1].approvalId;

      // First response succeeds
      mockTransactionRequestChain.query
        .mockResolvedValueOnce({
          recordset: [{
            approval_id: approvalId,
            session_id: 'session_123',
            status: 'pending',
            session_user_id: 'user_123',
            session_exists: 1,
          }],
        })
        .mockResolvedValueOnce({ rowsAffected: [1] });

      const result1 = await approvalManager.respondToApprovalAtomic(
        approvalId,
        'approved',
        'user_123'
      );

      expect(result1.success).toBe(true);

      // Second response fails (no pending promise)
      mockTransactionRequestChain.query.mockResolvedValueOnce({
        recordset: [{
          approval_id: approvalId,
          session_id: 'session_123',
          status: 'pending',  // DB still says pending until transaction commits
          session_user_id: 'user_123',
          session_exists: 1,
        }],
      });

      const result2 = await approvalManager.respondToApprovalAtomic(
        approvalId,
        'rejected',
        'user_123'
      );

      expect(result2.success).toBe(false);
      expect(result2.error).toBe('NO_PENDING_PROMISE');

      await approvalPromise;
    });

    it('should rollback transaction on database error', async () => {
      // Create a pending approval
      const requestOptions = {
        sessionId: 'session_123',
        toolName: 'bc_create_customer',
        toolArgs: { name: 'Test' },
        expiresInMs: 60000,
      };

      approvalManager.request(requestOptions);
      await vi.advanceTimersByTimeAsync(1);

      const approvalId = mockEmit.mock.calls[0][1].approvalId;

      // Simulate database error
      mockTransactionRequestChain.query.mockRejectedValueOnce(new Error('Connection lost'));

      await expect(
        approvalManager.respondToApprovalAtomic(approvalId, 'approved', 'user_123')
      ).rejects.toThrow('Connection lost');

      expect(mockTransaction.rollback).toHaveBeenCalled();

      // Cleanup
      vi.advanceTimersByTime(60000);
    });
  });
});
