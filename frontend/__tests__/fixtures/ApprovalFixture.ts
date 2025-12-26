/**
 * ApprovalFixture - Builder pattern for Approval test data (Frontend)
 *
 * Generates consistent AgentEvent objects for approval flows.
 *
 * Usage:
 * ```typescript
 * const event = ApprovalFixture.requested()
 *   .withApprovalId('app-1')
 *   .forTool('createCustomer')
 *   .build();
 * ```
 */

import type { ApprovalRequestedEvent, ApprovalResolvedEvent } from '@bc-agent/shared';

export class ApprovalRequestedBuilder {
  private event: Partial<ApprovalRequestedEvent> = {
    type: 'approval_requested',
    eventId: `evt-${Date.now()}`,
    timestamp: new Date().toISOString(),
    persistenceState: 'persisted',
    approvalId: 'test-approval-id',
    sessionId: 'test-session-id',
    toolName: 'test_tool',
    args: {},
    changeSummary: 'Test change summary',
    priority: 'medium',
  };

  withApprovalId(id: string): this {
    this.event.approvalId = id;
    return this;
  }

  forSession(sessionId: string): this {
    this.event.sessionId = sessionId;
    return this;
  }

  forTool(name: string, args: Record<string, unknown> = {}): this {
    this.event.toolName = name;
    this.event.args = args;
    return this;
  }

  withSummary(summary: string): this {
    this.event.changeSummary = summary;
    return this;
  }

  withPriority(priority: 'low' | 'medium' | 'high'): this {
    this.event.priority = priority;
    return this;
  }

  build(): ApprovalRequestedEvent {
    return this.event as ApprovalRequestedEvent;
  }
}

export class ApprovalResolvedBuilder {
  private event: Partial<ApprovalResolvedEvent> = {
    type: 'approval_resolved',
    eventId: `evt-${Date.now()}`,
    timestamp: new Date().toISOString(),
    persistenceState: 'persisted',
    approvalId: 'test-approval-id',
    sessionId: 'test-session-id',
    decision: 'approved',
  };

  withApprovalId(id: string): this {
    this.event.approvalId = id;
    return this;
  }

  forSession(sessionId: string): this {
    this.event.sessionId = sessionId;
    return this;
  }

  approved(isApproved: boolean = true): this {
    this.event.decision = isApproved ? 'approved' : 'rejected';
    return this;
  }

  withReason(reason: string): this {
    this.event.reason = reason;
    return this;
  }

  build(): ApprovalResolvedEvent {
    return this.event as ApprovalResolvedEvent;
  }
}

export class ApprovalFixture {
  static requested(): ApprovalRequestedBuilder {
    return new ApprovalRequestedBuilder();
  }

  static resolved(): ApprovalResolvedBuilder {
    return new ApprovalResolvedBuilder();
  }
}
