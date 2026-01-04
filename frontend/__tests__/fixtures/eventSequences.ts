/**
 * Event Sequences Fixtures
 *
 * Standard sequences of AgentEvents for testing flows.
 */

import type { AgentEvent } from '@bc-agent/shared';
import { AgentEventFactory } from './AgentEventFactory';

export const EventSequences = {
  /**
   * Standard chat flow (sync architecture): User message -> Thinking -> Message -> Complete
   * NOTE: Chunks removed - sync architecture uses complete messages only
   */
  chatFlow: (sessionId: string, messageId: string): AgentEvent[] => [
    AgentEventFactory.sessionStart({ sessionId }),
    AgentEventFactory.userMessageConfirmed({ messageId, sequenceNumber: 1 }),
    AgentEventFactory.thinking({ content: 'Analyzing request...', sessionId }),
    AgentEventFactory.message({ content: 'Hello world', sessionId, messageId, stopReason: 'end_turn' }),
    AgentEventFactory.complete({ sessionId, reason: 'success' }),
  ],

  /**
   * Tool execution flow: Tool Use -> Tool Result
   */
  toolFlow: (sessionId: string, toolUseId: string): AgentEvent[] => [
    AgentEventFactory.toolUse({ toolUseId, toolName: 'listCustomers', args: { limit: 5 }, sessionId }),
    AgentEventFactory.toolResult({ toolUseId, result: { customers: [] }, success: false, sessionId }),
  ],

  /**
   * Approval flow: Requested -> Resolved
   */
  approvalFlow: (sessionId: string, approvalId: string): AgentEvent[] => [
    {
      type: 'approval_requested',
      approvalId,
      sessionId,
      toolName: 'createCustomer',
      args: { name: 'Test' },
      changeSummary: 'Create customer Test',
      priority: 'medium',
      eventId: `evt-${Date.now()}`,
      timestamp: new Date().toISOString(),
      persistenceState: 'persisted',
    },
    {
      type: 'approval_resolved',
      approvalId,
      sessionId,
      decision: 'approved',
      eventId: `evt-${Date.now() + 100}`,
      timestamp: new Date().toISOString(),
      persistenceState: 'persisted',
    },
  ],
};
