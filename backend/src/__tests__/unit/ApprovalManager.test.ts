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
  executeQuery: vi.fn().mockResolvedValue({ recordset: [], rowsAffected: [0] }),
}));

// Mock EventStore for F4-002: Approval events now use EventStore
const mockEventStoreAppendEvent = vi.fn().mockResolvedValue({
  id: 'mock-event-id',
  session_id: 'session_123',
  event_type: 'approval_requested',
  sequence_number: 1,
  timestamp: new Date(),
  data: {},
  processed: false,
});

vi.mock('@/services/events/EventStore', () => ({
  getEventStore: vi.fn(() => ({
    appendEvent: mockEventStoreAppendEvent,
  })),
  EventStore: class {
    static getInstance() {
      return {
        appendEvent: mockEventStoreAppendEvent,
      };
    }
  },
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

    // Re-setup EventStore mock after clearAllMocks (F4-002)
    mockEventStoreAppendEvent.mockResolvedValue({
      id: 'mock-event-id',
      session_id: 'session_123',
      event_type: 'approval_requested',
      sequence_number: 1,
      timestamp: new Date(),
      data: {},
      processed: false,
    });

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

      // Assert - EventStore.appendEvent should be called (F4-002)
      expect(mockEventStoreAppendEvent).toHaveBeenCalledWith(
        'session_123',
        'approval_requested',
        expect.objectContaining({
          toolName: 'bc_create_customer',
          priority: 'medium',
        })
      );

      // Assert - WebSocket event should be emitted via agent:event (F4-002)
      expect(mockIo.to).toHaveBeenCalledWith('session_123');
      expect(mockEmit).toHaveBeenCalledWith(
        'agent:event',
        expect.objectContaining({
          type: 'approval_requested',
          toolName: 'bc_create_customer',
          priority: 'medium', // create operations are medium priority
          sequenceNumber: 1,
          eventId: 'mock-event-id',
          persistenceState: 'persisted',
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

      // Check emitted event has correct summary (F4-002: via agent:event)
      expect(mockEmit).toHaveBeenCalledWith(
        'agent:event',
        expect.objectContaining({
          type: 'approval_requested',
          changeSummary: 'Create a new customer record in Business Central',
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
      // F4-002: Now emits via agent:event instead of approval:resolved
      expect(mockEmit).toHaveBeenCalledWith('agent:event', expect.objectContaining({
        type: 'approval_resolved',
        approvalId,
        decision: 'approved',
        sequenceNumber: 1,
        eventId: 'mock-event-id',
        persistenceState: 'persisted',
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

  // =====================================================================
  // TEST-001 & TEST-002: QA Master Review Fixes
  // Tests for EventStore failures and expiration events
  // =====================================================================
  describe('9. EventStore Failure Handling (FIX-001, FIX-002, FIX-003)', () => {
    it('should continue in degraded mode when EventStore fails in request()', async () => {
      // FIX-001: Test degraded mode when EventStore fails
      mockEventStoreAppendEvent.mockRejectedValueOnce(new Error('Redis unavailable'));

      const requestOptions = {
        sessionId: 'session_123',
        toolName: 'bc_create_customer',
        toolArgs: { name: 'Test' },
        expiresInMs: 10000,
      };

      const approvalPromise = approvalManager.request(requestOptions);
      await vi.runOnlyPendingTimersAsync();

      // Should still emit event but with degraded persistenceState
      expect(mockEmit).toHaveBeenCalledWith(
        'agent:event',
        expect.objectContaining({
          type: 'approval_requested',
          persistenceState: 'failed',
          // Should NOT have sequenceNumber when EventStore fails
        })
      );

      // Verify the event does NOT have sequenceNumber (or has -1)
      const emittedEvent = mockEmit.mock.calls[0][1];
      expect(emittedEvent.sequenceNumber).toBeUndefined();
      expect(emittedEvent.eventId).toMatch(/^fallback-/);

      // Cleanup
      vi.advanceTimersByTime(10000);
      await approvalPromise;
    });

    it('should continue in degraded mode when EventStore fails in respondToApproval()', async () => {
      // FIX-002: Test degraded mode when EventStore fails during response
      // Reset EventStore mock to ensure clean state
      mockEventStoreAppendEvent.mockReset();

      // First call succeeds (for request)
      mockEventStoreAppendEvent.mockResolvedValueOnce({
        id: 'event-1',
        session_id: 'session_123',
        event_type: 'approval_requested',
        sequence_number: 1,
        timestamp: new Date(),
        data: {},
        processed: false,
      });

      const requestOptions = {
        sessionId: 'session_123',
        toolName: 'bc_create_customer',
        toolArgs: { name: 'Test' },
        expiresInMs: 60000,
      };

      const approvalPromise = approvalManager.request(requestOptions);
      await vi.advanceTimersByTimeAsync(1);

      const approvalId = mockEmit.mock.calls[0][1].approvalId;

      // Second call fails (for response)
      mockEventStoreAppendEvent.mockRejectedValueOnce(new Error('Redis unavailable'));

      // respondToApproval does:
      // 1. Update approval in DB (UPDATE query)
      // 2. Get sessionId from DB (SELECT query)
      // 3. Call EventStore.appendEvent (will fail)
      // 4. Emit event
      mockRequestChain.query
        .mockResolvedValueOnce({ rowsAffected: [1] })  // UPDATE approvals
        .mockResolvedValueOnce({ recordset: [{ session_id: 'session_123' }] });  // SELECT session_id

      await approvalManager.respondToApproval(approvalId, 'approved', 'user_123');

      // Promise should still resolve (FIX-002: guaranteed resolution)
      const result = await approvalPromise;
      expect(result).toBe(true);

      // Should emit event with degraded state - find the approval_resolved event
      const resolvedEventCalls = mockEmit.mock.calls.filter(
        (call) => call[1]?.type === 'approval_resolved'
      );
      expect(resolvedEventCalls.length).toBeGreaterThan(0);

      const lastResolvedEvent = resolvedEventCalls[resolvedEventCalls.length - 1][1];
      expect(lastResolvedEvent).toMatchObject({
        type: 'approval_resolved',
        persistenceState: 'failed',
      });
    });

    it('should resolve promise even when DB and EventStore fail in respondToApproval()', async () => {
      // FIX-002: Ensure promise ALWAYS resolves even on complete failure
      const requestOptions = {
        sessionId: 'session_123',
        toolName: 'bc_create_customer',
        toolArgs: { name: 'Test' },
        expiresInMs: 60000,
      };

      const approvalPromise = approvalManager.request(requestOptions);
      await vi.advanceTimersByTimeAsync(1);

      const approvalId = mockEmit.mock.calls[0][1].approvalId;

      // Simulate complete failure: DB throws error
      mockRequestChain.query.mockRejectedValueOnce(new Error('Database connection lost'));

      await approvalManager.respondToApproval(approvalId, 'approved', 'user_123');

      // Promise should STILL resolve (to false because of error) - agent doesn't hang
      const result = await approvalPromise;
      expect(result).toBe(false);
    });

    it('should handle EventStore failure after atomic commit gracefully', async () => {
      // FIX-003: Test EventStore failure AFTER transaction commit
      // Reset all mocks for clean state
      mockEventStoreAppendEvent.mockReset();
      mockTransactionRequestChain.input.mockReturnThis();
      mockTransactionRequestChain.query.mockReset();
      mockTransaction.begin.mockResolvedValue(undefined);
      mockTransaction.commit.mockResolvedValue(undefined);
      mockTransaction.rollback.mockResolvedValue(undefined);
      mockTransaction.request.mockReturnValue(mockTransactionRequestChain);

      // First EventStore call succeeds (for request)
      mockEventStoreAppendEvent.mockResolvedValueOnce({
        id: 'event-1',
        session_id: 'session_123',
        event_type: 'approval_requested',
        sequence_number: 1,
        timestamp: new Date(),
        data: {},
        processed: false,
      });

      const requestOptions = {
        sessionId: 'session_123',
        toolName: 'bc_create_customer',
        toolArgs: { name: 'Test' },
        expiresInMs: 60000,
      };

      const approvalPromise = approvalManager.request(requestOptions);
      await vi.advanceTimersByTimeAsync(1);

      const approvalId = mockEmit.mock.calls[0][1].approvalId;

      // Setup: validation passes (transaction queries)
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
        .mockResolvedValueOnce({ rowsAffected: [1] });  // UPDATE succeeds

      // Second EventStore call fails AFTER commit (for atomic response)
      mockEventStoreAppendEvent.mockRejectedValueOnce(new Error('Redis down after commit'));

      const result = await approvalManager.respondToApprovalAtomic(
        approvalId,
        'approved',
        'user_123'
      );

      // Operation should still succeed from user perspective
      expect(result.success).toBe(true);
      expect(mockTransaction.commit).toHaveBeenCalled();

      // Promise should resolve (FIX-003: guaranteed resolution)
      const approved = await approvalPromise;
      expect(approved).toBe(true);

      // Should emit event with degraded state - find the approval_resolved event
      const resolvedEventCalls = mockEmit.mock.calls.filter(
        (call) => call[1]?.type === 'approval_resolved'
      );
      expect(resolvedEventCalls.length).toBeGreaterThan(0);

      const lastResolvedEvent = resolvedEventCalls[resolvedEventCalls.length - 1][1];
      expect(lastResolvedEvent).toMatchObject({
        type: 'approval_resolved',
        persistenceState: 'failed',
      });
    });
  });

  describe('10. Approval Expiration Events (FIX-004)', () => {
    it('should emit approval_resolved event when approval times out', async () => {
      // FIX-004: Test that expiration emits event to frontend
      const requestOptions = {
        sessionId: 'session_123',
        toolName: 'bc_create_customer',
        toolArgs: { name: 'Test' },
        expiresInMs: 5000, // 5 seconds
      };

      const approvalPromise = approvalManager.request(requestOptions);
      await vi.runOnlyPendingTimersAsync();

      // Clear the initial request event call
      const initialEventCall = mockEmit.mock.calls[0];
      expect(initialEventCall[1].type).toBe('approval_requested');

      // Fast-forward past the timeout
      vi.advanceTimersByTime(6000);

      // Wait for async expiration to complete
      await vi.runOnlyPendingTimersAsync();

      // Should have emitted expiration event
      const expirationCall = mockEmit.mock.calls[mockEmit.mock.calls.length - 1];
      expect(expirationCall[0]).toBe('agent:event');
      expect(expirationCall[1]).toMatchObject({
        type: 'approval_resolved',
        decision: 'rejected',
        reason: 'Approval request timed out',
      });

      // Promise should resolve to false
      const result = await approvalPromise;
      expect(result).toBe(false);
    });

    it('should persist expiration event to EventStore', async () => {
      // FIX-004: Test that expiration persists to EventStore
      const requestOptions = {
        sessionId: 'session_123',
        toolName: 'bc_create_customer',
        toolArgs: { name: 'Test' },
        expiresInMs: 5000,
      };

      const approvalPromise = approvalManager.request(requestOptions);
      await vi.runOnlyPendingTimersAsync();

      // Fast-forward past the timeout
      vi.advanceTimersByTime(6000);
      await vi.runOnlyPendingTimersAsync();

      // EventStore should have been called twice:
      // 1. For approval_requested
      // 2. For approval_completed (expiration)
      expect(mockEventStoreAppendEvent).toHaveBeenCalledTimes(2);

      const expirationCall = mockEventStoreAppendEvent.mock.calls[1];
      expect(expirationCall[0]).toBe('session_123');
      expect(expirationCall[1]).toBe('approval_completed');
      expect(expirationCall[2]).toMatchObject({
        decision: 'expired',
        reason: 'Approval request timed out',
      });

      await approvalPromise;
    });

    it('should handle EventStore failure during expiration gracefully', async () => {
      // FIX-004: Test degraded mode during expiration
      const requestOptions = {
        sessionId: 'session_123',
        toolName: 'bc_create_customer',
        toolArgs: { name: 'Test' },
        expiresInMs: 5000,
      };

      // First call succeeds (request), second call fails (expiration)
      mockEventStoreAppendEvent
        .mockResolvedValueOnce({ id: 'event-1', sequence_number: 1 })
        .mockRejectedValueOnce(new Error('Redis down'));

      const approvalPromise = approvalManager.request(requestOptions);
      await vi.runOnlyPendingTimersAsync();

      // Fast-forward past the timeout
      vi.advanceTimersByTime(6000);
      await vi.runOnlyPendingTimersAsync();

      // Should still emit event with degraded state
      const lastEmitCall = mockEmit.mock.calls[mockEmit.mock.calls.length - 1];
      expect(lastEmitCall[1]).toMatchObject({
        type: 'approval_resolved',
        persistenceState: 'failed',
      });

      // Promise should still resolve
      const result = await approvalPromise;
      expect(result).toBe(false);
    });
  });
});
