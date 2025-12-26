/**
 * Event Sequences Fixtures
 *
 * Standard sequences of AgentEvents for testing flows.
 */

import type { AgentEvent } from '@bc-agent/shared';
import { AgentEventFactory } from './AgentEventFactory';

export const EventSequences = {
  /**
   * Standard chat flow: User message -> Thinking -> Message Chunk -> Complete
   */
  chatFlow: (sessionId: string, messageId: string): AgentEvent[] => [
    AgentEventFactory.sessionStart({ sessionId }),
    AgentEventFactory.userMessageConfirmed({ messageId, sequenceNumber: 1 }),
    AgentEventFactory.thinking({ content: 'Analyzing request...', sessionId }),
    AgentEventFactory.messageChunk({ content: 'Hello', sessionId }),
    AgentEventFactory.messageChunk({ content: ' world', sessionId }),
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
