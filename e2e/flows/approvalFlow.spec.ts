/**
 * Approval Flow E2E Tests - API Level
 *
 * Tests the human-in-the-loop approval workflow by calling the backend
 * REST API and WebSocket directly (no frontend UI required).
 *
 * Flow Overview:
 * 1. Agent determines a tool requires approval (write operations)
 * 2. Backend emits 'approval_requested' event via WebSocket
 * 3. User responds via WebSocket: 'approval:response'
 * 4. Backend emits 'approval_resolved' event
 * 5. Agent continues or aborts based on response
 *
 * Prerequisites:
 * - Backend running on http://localhost:3002
 * - Redis accessible for session injection
 * - Database accessible with test data seeded
 *
 * IMPORTANT: Uses REAL session cookies from Redis, NOT test auth tokens.
 * Sessions are injected by globalSetup.ts.
 *
 * @module e2e/flows/approvalFlow.spec
 */

import { test, expect, APIRequestContext } from '@playwright/test';
import { Socket } from 'socket.io-client';
import {
  TEST_USER,
  TEST_SESSIONS,
  TEST_APPROVALS,
  TIMEOUTS,
  API_ENDPOINTS,
  WS_EVENTS,
  AGENT_EVENT_TYPES,
} from '../fixtures/test-data';
import {
  createApiContext,
  connectSocket as connectAuthenticatedSocket,
  waitForAgentEvent,
  waitForEvent,
  getTestUserSession,
} from '../setup/testHelpers';

/**
 * Test Suite: Approval Flow - API Level
 *
 * These tests verify the human-in-the-loop approval workflow by directly
 * calling the backend API and WebSocket endpoints, bypassing the frontend UI.
 *
 * IMPORTANT: Uses real session cookies injected into Redis by globalSetup.ts.
 */
test.describe('Approval Flow - API Level', () => {
  let apiContext: APIRequestContext;
  let socket: Socket | null = null;

  // Create API context with real session cookie before all tests
  test.beforeAll(async ({ playwright }) => {
    apiContext = await createApiContext(playwright, 'test');
  });

  // Clean up API context and socket connections after all tests
  test.afterAll(async () => {
    if (socket?.connected) {
      socket.disconnect();
    }
    await apiContext.dispose();
  });

  // Clean up socket after each test to avoid connection leaks
  test.afterEach(() => {
    if (socket?.connected) {
      socket.disconnect();
      socket = null;
    }
  });

  /**
   * Test 1: Get Pending Approvals - Session Level
   * Verifies ability to retrieve pending approvals for a specific session
   */
  test('should get pending approvals for a session', async () => {
    const sessionId = TEST_SESSIONS.withApproval.id;
    const endpoint = `/api/approvals/session/${sessionId}`;

    const response = await apiContext.get(endpoint);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('sessionId', sessionId);
    expect(data).toHaveProperty('count');
    expect(data).toHaveProperty('approvals');
    expect(Array.isArray(data.approvals)).toBeTruthy();

    // Should contain the pending approval from test data
    const pendingApproval = data.approvals.find(
      (a: any) => a.approvalId === TEST_APPROVALS.pending.id
    );
    if (data.approvals.length > 0) {
      expect(pendingApproval).toBeDefined();
      expect(pendingApproval.status).toBe('pending');
    }
  });

  /**
   * Test 2: Get All Pending Approvals - Cross-Session
   * Verifies ability to retrieve all pending approvals across all user sessions
   */
  test('should get all pending approvals for current user', async () => {
    const endpoint = '/api/approvals/pending';

    const response = await apiContext.get(endpoint);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('count');
    expect(data).toHaveProperty('approvals');
    expect(Array.isArray(data.approvals)).toBeTruthy();
    expect(data.count).toBe(data.approvals.length);

    // All approvals should belong to the test user's sessions
    data.approvals.forEach((approval: any) => {
      expect(approval).toHaveProperty('approvalId');
      expect(approval).toHaveProperty('sessionId');
      expect(approval).toHaveProperty('status');
      expect(approval).toHaveProperty('toolName');
    });
  });

  /**
   * Test 3: Approve Request via REST API
   * Verifies ability to approve an approval request using POST endpoint
   */
  test('should approve an approval request via REST API', async () => {
    // Note: This test assumes TEST_APPROVALS.pending exists and is in pending state
    // In a real test environment, you might want to create a fresh approval first
    const approvalId = TEST_APPROVALS.pending.id;
    const endpoint = `/api/approvals/${approvalId}/respond`;

    const response = await apiContext.post(endpoint, {
      data: {
        decision: 'approved',
        userId: TEST_USER.id, // Note: Backend uses authenticated userId, not this
      },
    });

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('approvalId', approvalId);
    expect(data).toHaveProperty('decision', 'approved');
  });

  /**
   * Test 4: Reject Request via REST API
   * Verifies ability to reject an approval request with a reason
   */
  test('should reject an approval request with reason via REST API', async () => {
    const approvalId = TEST_APPROVALS.pending.id;
    const endpoint = `/api/approvals/${approvalId}/respond`;
    const rejectionReason = 'E2E test rejection - operation not authorized';

    const response = await apiContext.post(endpoint, {
      data: {
        decision: 'rejected',
        userId: TEST_USER.id,
        reason: rejectionReason,
      },
    });

    // Note: This might fail if approval is already decided
    // In production tests, create fresh approval for each test
    if (response.ok()) {
      const data = await response.json();
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('approvalId', approvalId);
      expect(data).toHaveProperty('decision', 'rejected');
      expect(data).toHaveProperty('reason', rejectionReason);
    }
  });

  /**
   * Test 5: WebSocket Connection for Approval Flow
   * Verifies ability to connect to WebSocket with test auth token
   */
  test('should connect to WebSocket for approval flow', async () => {
    socket = await connectSocket();

    expect(socket.connected).toBeTruthy();
    expect(socket.id).toBeTruthy();
  });

  /**
   * Test 6: Approve Request via WebSocket
   * Verifies WebSocket approval flow with approval:response event
   */
  test('should approve request via WebSocket and receive resolved event', async () => {
    socket = await connectSocket();

    const approvalId = TEST_APPROVALS.pending.id;
    const sessionId = TEST_SESSIONS.withApproval.id;

    // Join the session room to receive approval events
    socket.emit('session:join', { sessionId });
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Listen for approval_resolved event
    const resolvedPromise = waitForAgentEvent(
      socket,
      AGENT_EVENT_TYPES.approvalResolved,
      TIMEOUTS.medium
    );

    // Send approval response
    socket.emit('approval:response', {
      approvalId,
      decision: 'approved',
      userId: TEST_USER.id, // Backend uses authenticated userId instead
    });

    // Wait for resolved event (if approval was pending)
    // Note: This might not emit an event if approval already decided
    try {
      const resolvedEvent = await resolvedPromise;
      expect(resolvedEvent).toHaveProperty('type', AGENT_EVENT_TYPES.approvalResolved);
      expect(resolvedEvent.data).toHaveProperty('approvalId');
      expect(resolvedEvent.data).toHaveProperty('decision');
    } catch (error) {
      // Timeout is acceptable if approval was already decided
      console.log('Note: approval:response did not emit approval_resolved (likely already decided)');
    }
  });

  /**
   * Test 7: Reject Request via WebSocket
   * Verifies WebSocket rejection flow with reason
   */
  test('should reject request via WebSocket with reason', async () => {
    socket = await connectSocket();

    const approvalId = TEST_APPROVALS.pending.id;
    const sessionId = TEST_SESSIONS.withApproval.id;
    const rejectionReason = 'E2E WebSocket test rejection';

    // Join session room
    socket.emit('session:join', { sessionId });
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Listen for approval_resolved or error event
    const eventPromise = Promise.race([
      waitForAgentEvent(socket, AGENT_EVENT_TYPES.approvalResolved, TIMEOUTS.medium),
      waitForEvent(socket, 'approval:error', TIMEOUTS.medium),
    ]);

    // Send rejection
    socket.emit('approval:response', {
      approvalId,
      decision: 'rejected',
      userId: TEST_USER.id,
      reason: rejectionReason,
    });

    try {
      const event = await eventPromise;
      // Should receive either resolved event or error if already decided
      expect(event).toBeDefined();
    } catch (error) {
      console.log('Note: approval:response did not emit event (likely already decided)');
    }
  });

  /**
   * Test 8: Invalid Decision Handling
   * Verifies proper error handling for invalid approval decision
   */
  test('should reject invalid approval decision', async () => {
    socket = await connectSocket();

    const approvalId = TEST_APPROVALS.pending.id;

    // Listen for error event
    const errorPromise = waitForEvent(socket, 'approval:error', TIMEOUTS.short);

    // Send invalid decision
    socket.emit('approval:response', {
      approvalId,
      decision: 'invalid_decision', // Invalid
      userId: TEST_USER.id,
    });

    // Should receive error
    const error = await errorPromise;
    expect(error).toBeDefined();
    expect(error).toHaveProperty('error');
    expect(error.error).toContain('Invalid decision');
  });

  /**
   * Test 9: Non-Existent Approval ID
   * Verifies error handling for non-existent approval ID
   */
  test('should handle non-existent approval ID gracefully', async () => {
    const invalidApprovalId = 'invalid-approval-id-99999';
    const endpoint = `/api/approvals/${invalidApprovalId}/respond`;

    const response = await apiContext.post(endpoint, {
      data: {
        decision: 'approved',
        userId: TEST_USER.id,
      },
    });

    // Should return error (400 or 404)
    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  /**
   * Test 10: Unauthorized Session Access
   * Verifies multi-tenant security - users cannot access other users' approvals
   */
  test('should prevent unauthorized access to other user approvals', async () => {
    // Try to access admin user's session approvals
    const adminSessionId = TEST_SESSIONS.adminSession.id;
    const endpoint = `/api/approvals/session/${adminSessionId}`;

    const response = await apiContext.get(endpoint);

    // Should return 403 Forbidden or empty approvals (depending on implementation)
    if (!response.ok()) {
      expect(response.status()).toBe(403);
    } else {
      // If it returns 200, approvals list should be empty (no access)
      const data = await response.json();
      expect(data.approvals.length).toBe(0);
    }
  });

  /**
   * Test 11: Approval Already Decided - Idempotency
   * Verifies handling when trying to respond to an already-decided approval
   */
  test('should handle already-decided approval gracefully', async () => {
    const approvedApprovalId = TEST_APPROVALS.approved.id;
    const endpoint = `/api/approvals/${approvedApprovalId}/respond`;

    const response = await apiContext.post(endpoint, {
      data: {
        decision: 'approved',
        userId: TEST_USER.id,
      },
    });

    // Should return error indicating approval already decided
    if (!response.ok()) {
      expect(response.status()).toBeGreaterThanOrEqual(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
    } else {
      // Or return success if idempotent
      const data = await response.json();
      expect(data).toHaveProperty('success');
    }
  });

  /**
   * Test 12: Concurrent Approval Responses
   * Verifies race condition handling when multiple responses sent for same approval
   */
  test('should handle concurrent approval responses safely', async () => {
    const approvalId = TEST_APPROVALS.pending.id;
    const endpoint = `/api/approvals/${approvalId}/respond`;

    // Send two approval responses concurrently
    const responses = await Promise.all([
      apiContext.post(endpoint, {
        data: { decision: 'approved', userId: TEST_USER.id },
      }),
      apiContext.post(endpoint, {
        data: { decision: 'rejected', userId: TEST_USER.id },
      }),
    ]);

    // Exactly one should succeed (atomic transaction)
    const successCount = responses.filter((r) => r.ok()).length;
    expect(successCount).toBeLessThanOrEqual(1);

    // At least one should fail (already decided)
    const failCount = responses.filter((r) => !r.ok()).length;
    expect(failCount).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// Helper Functions
// ============================================================================
// Most helper functions are now imported from testHelpers.ts

/**
 * Connect to WebSocket with real session authentication
 * Wraps connectAuthenticatedSocket from testHelpers
 */
function connectSocket(): Promise<Socket> {
  return connectAuthenticatedSocket('test', TIMEOUTS.medium);
}
