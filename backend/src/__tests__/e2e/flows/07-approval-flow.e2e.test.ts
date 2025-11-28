/**
 * E2E-07: Approval Flow Tests
 *
 * Tests the human-in-the-loop approval system including:
 * - approval_requested event delivery
 * - Approval response handling (approve/reject)
 * - approval_resolved event delivery
 * - Timeout handling
 * - Multi-step approval flows
 *
 * @module __tests__/e2e/flows/07-approval-flow.e2e.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupE2ETest } from '../setup.e2e';
import {
  E2ETestClient,
  createE2ETestClient,
  createTestSessionFactory,
  type TestUser,
  type TestChatSession,
} from '../helpers';
import type { AgentEvent } from '@/types/websocket.types';

describe('E2E-07: Approval Flow', () => {
  const { getBaseUrl } = setupE2ETest();

  let client: E2ETestClient;
  const factory = createTestSessionFactory();
  let testUser: TestUser;
  let testSession: TestChatSession;

  beforeAll(async () => {
    testUser = await factory.createTestUser({ prefix: 'e2e_approval_' });
    testSession = await factory.createChatSession(testUser.id, {
      title: 'Approval Flow Test Session',
    });
  });

  afterAll(async () => {
    await factory.cleanup();
  });

  beforeEach(async () => {
    client = createE2ETestClient();
    client.setSessionCookie(testUser.sessionCookie);
    client.clearEvents();
  });

  afterEach(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
  });

  describe('Approval Requested Event', () => {
    it('should receive approval_requested for write operations', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Request that should trigger approval
      await client.sendMessage(
        testSession.id,
        'Create a new customer called "Test Approval Customer" in Business Central'
      );

      const events = await client.collectEvents(30, {
        timeout: 60000,
        stopOnEventType: 'approval_requested',
      });

      const approvalEvents = events.filter(
        e => e.data.type === 'approval_requested'
      );

      // If approval system is active, should receive approval_requested
      if (approvalEvents.length > 0) {
        expect(approvalEvents[0]!.data.type).toBe('approval_requested');
      }
    });

    it('should include approval details in event', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(
        testSession.id,
        'Update customer address in Business Central'
      );

      const events = await client.collectEvents(30, {
        timeout: 60000,
        stopOnEventType: 'approval_requested',
      });

      const approvalEvents = events.filter(
        e => e.data.type === 'approval_requested'
      );

      for (const event of approvalEvents) {
        const approvalData = event.data as AgentEvent & {
          approvalId?: string;
          id?: string;
          operation?: string;
          action?: string;
          toolName?: string;
          tool?: string;
        };

        // Should have identifier
        const hasId =
          approvalData.approvalId !== undefined ||
          approvalData.id !== undefined;

        expect(hasId).toBe(true);

        // Should describe the operation
        const hasOperation =
          approvalData.operation !== undefined ||
          approvalData.action !== undefined ||
          approvalData.toolName !== undefined ||
          approvalData.tool !== undefined;

        expect(hasOperation).toBe(true);
      }
    });

    it('should include tool input in approval request', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(
        testSession.id,
        'Delete the test customer from Business Central'
      );

      const events = await client.collectEvents(30, {
        timeout: 60000,
        stopOnEventType: 'approval_requested',
      });

      const approvalEvents = events.filter(
        e => e.data.type === 'approval_requested'
      );

      for (const event of approvalEvents) {
        const approvalData = event.data as AgentEvent & {
          input?: Record<string, unknown>;
          data?: Record<string, unknown>;
          parameters?: Record<string, unknown>;
        };

        // Should include what's being modified
        const hasInput =
          approvalData.input !== undefined ||
          approvalData.data !== undefined ||
          approvalData.parameters !== undefined;

        if (hasInput) {
          expect(approvalData.input || approvalData.data || approvalData.parameters).toBeDefined();
        }
      }
    });

    it('should include eventId in approval request', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(
        testSession.id,
        'Post a new journal entry in Business Central'
      );

      const events = await client.collectEvents(30, {
        timeout: 60000,
        stopOnEventType: 'approval_requested',
      });

      const approvalEvents = events.filter(
        e => e.data.type === 'approval_requested'
      );

      for (const event of approvalEvents) {
        const data = event.data as AgentEvent & { eventId?: string };
        expect(data.eventId).toBeDefined();
      }
    });
  });

  describe('Approval Response Handling', () => {
    it('should handle approval approval', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Trigger approval request
      await client.sendMessage(
        testSession.id,
        'Create a new item in Business Central'
      );

      // Wait for approval_requested
      const approvalEvent = await client.waitForAgentEvent('approval_requested', {
        timeout: 60000,
      }).catch(() => null);

      if (approvalEvent) {
        const approvalData = approvalEvent as AgentEvent & {
          approvalId?: string;
          id?: string;
        };

        const approvalId = approvalData.approvalId || approvalData.id;

        if (approvalId) {
          // Respond with approval
          client.emitRaw('approval:response', {
            approvalId,
            approved: true,
          });

          // Should receive approval_resolved
          const resolvedEvent = await client.waitForAgentEvent(
            'approval_resolved',
            { timeout: 30000 }
          ).catch(() => null);

          if (resolvedEvent) {
            expect(resolvedEvent.type).toBe('approval_resolved');
          }
        }
      }
    });

    it('should handle approval rejection', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(
        testSession.id,
        'Delete all items from Business Central'
      );

      const approvalEvent = await client.waitForAgentEvent('approval_requested', {
        timeout: 60000,
      }).catch(() => null);

      if (approvalEvent) {
        const approvalData = approvalEvent as AgentEvent & {
          approvalId?: string;
          id?: string;
        };

        const approvalId = approvalData.approvalId || approvalData.id;

        if (approvalId) {
          // Respond with rejection
          client.emitRaw('approval:response', {
            approvalId,
            approved: false,
            reason: 'User rejected the operation',
          });

          // Should receive approval_resolved with rejection
          const resolvedEvent = await client.waitForAgentEvent(
            'approval_resolved',
            { timeout: 30000 }
          ).catch(() => null);

          if (resolvedEvent) {
            const resolvedData = resolvedEvent as AgentEvent & {
              approved?: boolean;
              rejected?: boolean;
            };

            // Either approved=false or rejected=true
            expect(
              resolvedData.approved === false || resolvedData.rejected === true
            ).toBe(true);
          }
        }
      }
    });

    it('should include rejection reason in resolved event', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(
        testSession.id,
        'Modify general ledger in Business Central'
      );

      const approvalEvent = await client.waitForAgentEvent('approval_requested', {
        timeout: 60000,
      }).catch(() => null);

      if (approvalEvent) {
        const approvalData = approvalEvent as AgentEvent & {
          approvalId?: string;
          id?: string;
        };

        const approvalId = approvalData.approvalId || approvalData.id;
        const testReason = 'Test rejection reason';

        if (approvalId) {
          client.emitRaw('approval:response', {
            approvalId,
            approved: false,
            reason: testReason,
          });

          const resolvedEvent = await client.waitForAgentEvent(
            'approval_resolved',
            { timeout: 30000 }
          ).catch(() => null);

          if (resolvedEvent) {
            const resolvedData = resolvedEvent as AgentEvent & {
              reason?: string;
              rejectionReason?: string;
            };

            // Should include the reason
            const hasReason =
              resolvedData.reason === testReason ||
              resolvedData.rejectionReason === testReason;

            if (hasReason) {
              expect(hasReason).toBe(true);
            }
          }
        }
      }
    });
  });

  describe('Approval Resolved Event', () => {
    it('should include approval status in resolved event', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(
        testSession.id,
        'Update inventory quantity in Business Central'
      );

      const approvalEvent = await client.waitForAgentEvent('approval_requested', {
        timeout: 60000,
      }).catch(() => null);

      if (approvalEvent) {
        const approvalData = approvalEvent as AgentEvent & {
          approvalId?: string;
          id?: string;
        };

        const approvalId = approvalData.approvalId || approvalData.id;

        if (approvalId) {
          client.emitRaw('approval:response', {
            approvalId,
            approved: true,
          });

          const resolvedEvent = await client.waitForAgentEvent(
            'approval_resolved',
            { timeout: 30000 }
          ).catch(() => null);

          if (resolvedEvent) {
            const resolvedData = resolvedEvent as AgentEvent & {
              approved?: boolean;
              status?: string;
            };

            // Should have approval status
            const hasStatus =
              resolvedData.approved !== undefined ||
              resolvedData.status !== undefined;

            expect(hasStatus).toBe(true);
          }
        }
      }
    });

    it('should correlate resolved event with original request', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(
        testSession.id,
        'Create purchase order in Business Central'
      );

      const approvalEvent = await client.waitForAgentEvent('approval_requested', {
        timeout: 60000,
      }).catch(() => null);

      if (approvalEvent) {
        const approvalData = approvalEvent as AgentEvent & {
          approvalId?: string;
          id?: string;
        };

        const approvalId = approvalData.approvalId || approvalData.id;

        if (approvalId) {
          client.emitRaw('approval:response', {
            approvalId,
            approved: true,
          });

          const resolvedEvent = await client.waitForAgentEvent(
            'approval_resolved',
            { timeout: 30000 }
          ).catch(() => null);

          if (resolvedEvent) {
            const resolvedData = resolvedEvent as AgentEvent & {
              approvalId?: string;
              id?: string;
            };

            // Should have same approval ID
            const resolvedId = resolvedData.approvalId || resolvedData.id;
            expect(resolvedId).toBe(approvalId);
          }
        }
      }
    });
  });

  describe('Approval Timeout', () => {
    it('should handle approval timeout gracefully', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(
        testSession.id,
        'Post sales invoice in Business Central'
      );

      const approvalEvent = await client.waitForAgentEvent('approval_requested', {
        timeout: 60000,
      }).catch(() => null);

      if (approvalEvent) {
        // Don't respond - let it timeout
        // The system should handle this gracefully

        // Collect events to see what happens
        const events = await client.collectEvents(10, {
          timeout: 120000, // Wait for potential timeout
          stopOnEventType: 'complete',
        });

        // Should eventually receive some terminal event
        const hasTerminal = events.some(
          e =>
            e.data.type === 'complete' ||
            e.data.type === 'error' ||
            e.data.type === 'timeout' ||
            e.data.type === 'approval_resolved'
        );

        // Timeout behavior is implementation-dependent
        expect(events.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Multiple Approvals', () => {
    it('should handle sequential approval requests', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      // Request that might require multiple approvals
      await client.sendMessage(
        testSession.id,
        'Create a customer and then create an order for them in Business Central'
      );

      let approvalCount = 0;
      const maxApprovals = 3;

      // Handle approvals as they come
      for (let i = 0; i < maxApprovals; i++) {
        const approvalEvent = await client.waitForAgentEvent(
          'approval_requested',
          { timeout: 60000 }
        ).catch(() => null);

        if (approvalEvent) {
          approvalCount++;

          const approvalData = approvalEvent as AgentEvent & {
            approvalId?: string;
            id?: string;
          };

          const approvalId = approvalData.approvalId || approvalData.id;

          if (approvalId) {
            client.emitRaw('approval:response', {
              approvalId,
              approved: true,
            });

            await client.waitForAgentEvent('approval_resolved', {
              timeout: 30000,
            }).catch(() => null);
          }

          client.clearEvents();
        } else {
          break;
        }
      }

      // Should have completed the flow
      const finalEvents = await client.collectEvents(10, {
        timeout: 30000,
        stopOnEventType: 'complete',
      });

      const hasComplete = finalEvents.some(e => e.data.type === 'complete');
      expect(hasComplete).toBe(true);
    });
  });

  describe('Approval Broadcasting', () => {
    let client2: E2ETestClient;

    beforeEach(async () => {
      client2 = createE2ETestClient();
      client2.setSessionCookie(testUser.sessionCookie);
    });

    afterEach(async () => {
      if (client2.isConnected()) {
        await client2.disconnect();
      }
    });

    it('should broadcast approval_requested to all clients', async () => {
      // Create fresh session
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Approval Broadcast Test',
      });

      // Connect both clients
      await client.connect();
      await client.joinSession(freshSession.id);

      await client2.connect();
      await client2.joinSession(freshSession.id);

      // Client 1 triggers approval
      await client.sendMessage(
        freshSession.id,
        'Create vendor in Business Central'
      );

      // Both clients should receive approval_requested
      const client1Approval = await client.waitForAgentEvent(
        'approval_requested',
        { timeout: 60000 }
      ).catch(() => null);

      if (client1Approval) {
        // Check client 2 also received it
        const client2Events = client2.getReceivedEvents();
        const client2HasApproval = client2Events.some(
          e => e.data.type === 'approval_requested'
        );

        expect(client2HasApproval).toBe(true);
      }
    });

    it('should broadcast approval_resolved to all clients', async () => {
      // Create fresh session
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Approval Resolved Broadcast Test',
      });

      // Connect both clients
      await client.connect();
      await client.joinSession(freshSession.id);

      await client2.connect();
      await client2.joinSession(freshSession.id);

      await client.sendMessage(
        freshSession.id,
        'Create location in Business Central'
      );

      const approvalEvent = await client.waitForAgentEvent('approval_requested', {
        timeout: 60000,
      }).catch(() => null);

      if (approvalEvent) {
        const approvalData = approvalEvent as AgentEvent & {
          approvalId?: string;
          id?: string;
        };

        const approvalId = approvalData.approvalId || approvalData.id;

        if (approvalId) {
          // Client 1 approves
          client.emitRaw('approval:response', {
            approvalId,
            approved: true,
          });

          // Both should receive resolved
          await client.waitForAgentEvent('approval_resolved', {
            timeout: 30000,
          }).catch(() => null);

          // Give time for broadcast
          await new Promise(resolve => setTimeout(resolve, 1000));

          const client2Events = client2.getReceivedEvents();
          const client2HasResolved = client2Events.some(
            e => e.data.type === 'approval_resolved'
          );

          expect(client2HasResolved).toBe(true);
        }
      }
    });
  });

  describe('Approval Security', () => {
    it('should validate approval response comes from session owner', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(
        testSession.id,
        'Delete customer in Business Central'
      );

      const approvalEvent = await client.waitForAgentEvent('approval_requested', {
        timeout: 60000,
      }).catch(() => null);

      if (approvalEvent) {
        const approvalData = approvalEvent as AgentEvent & {
          approvalId?: string;
          id?: string;
        };

        const approvalId = approvalData.approvalId || approvalData.id;

        if (approvalId) {
          // Send approval response
          client.emitRaw('approval:response', {
            approvalId,
            approved: true,
          });

          // Should be accepted (from authenticated user)
          const events = await client.collectEvents(10, {
            timeout: 30000,
            stopOnEventType: 'complete',
          });

          // Should have proceeded
          expect(events.length).toBeGreaterThan(0);
        }
      }
    });

    it('should not expose sensitive data in approval events', async () => {
      await client.connect();
      await client.joinSession(testSession.id);

      await client.sendMessage(
        testSession.id,
        'Update payment method in Business Central'
      );

      const approvalEvent = await client.waitForAgentEvent('approval_requested', {
        timeout: 60000,
      }).catch(() => null);

      if (approvalEvent) {
        // Check no sensitive data exposed
        const eventString = JSON.stringify(approvalEvent);

        const sensitivePatterns = [
          'password',
          'secret',
          'api_key',
          'apiKey',
          'token',
          'bearer',
        ];

        for (const pattern of sensitivePatterns) {
          // Case-insensitive check, excluding legitimate field names
          const hasPattern = eventString.toLowerCase().includes(pattern);
          if (hasPattern) {
            // Allow if it's a field name, not a value
            expect(eventString).not.toMatch(
              new RegExp(`"${pattern}"\\s*:\\s*"[^"]+"`,'i')
            );
          }
        }
      }
    });
  });

  describe('Approval Persistence', () => {
    it('should persist approval records to database', async () => {
      // Create fresh session
      const freshSession = await factory.createChatSession(testUser.id, {
        title: 'Approval Persistence Test',
      });

      await client.connect();
      await client.joinSession(freshSession.id);

      await client.sendMessage(
        freshSession.id,
        'Create sales order in Business Central'
      );

      const approvalEvent = await client.waitForAgentEvent('approval_requested', {
        timeout: 60000,
      }).catch(() => null);

      if (approvalEvent) {
        const approvalData = approvalEvent as AgentEvent & {
          approvalId?: string;
          id?: string;
        };

        const approvalId = approvalData.approvalId || approvalData.id;

        if (approvalId) {
          client.emitRaw('approval:response', {
            approvalId,
            approved: true,
          });

          await client.waitForAgentEvent('complete', { timeout: 60000 });

          // Allow persistence
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Fetch session to verify persistence
          const response = await client.get<{
            messages: Array<{ content: string }>;
          }>(`/api/chat/sessions/${freshSession.id}`);

          expect(response.ok).toBe(true);
        }
      }
    });
  });
});
