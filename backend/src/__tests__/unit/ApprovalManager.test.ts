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

// Mock database with persistent spy
vi.mock('@/config/database', () => ({
  getDatabase: vi.fn(() => ({
    request: mockDbRequest,  // Use the persistent spy
  })),
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
});
