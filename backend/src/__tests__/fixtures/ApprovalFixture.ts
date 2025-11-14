/**
 * ApprovalFixture - Builder pattern for Approval test data
 *
 * This fixture makes it easy to create approval requests for tests.
 * Uses the Builder pattern to allow fluent, readable test setup.
 *
 * Benefits:
 * - Reduces test boilerplate for approval scenarios
 * - Provides realistic default data
 * - Easy to test approval flows (approve, deny, timeout)
 * - Self-documenting
 *
 * Usage:
 * ```typescript
 * const approval = ApprovalFixture.request()
 *   .forSession('session-123')
 *   .withTool('customer_create', { name: 'John Doe' })
 *   .build();
 * ```
 */

import { vi } from 'vitest';

/**
 * Approval request data structure
 */
export interface ApprovalRequest {
  sessionId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  metadata?: {
    timestamp?: Date;
    userId?: string;
    riskLevel?: string;
  };
}

/**
 * Builder for creating approval request test data
 */
export class ApprovalRequestBuilder {
  private request: Partial<ApprovalRequest> = {
    sessionId: 'test-session-default',
    toolName: 'test_tool',
    toolArgs: {},
    metadata: {},
  };

  /**
   * Sets the session ID
   */
  forSession(sessionId: string): this {
    this.request.sessionId = sessionId;
    return this;
  }

  /**
   * Sets the tool name and arguments
   */
  withTool(toolName: string, toolArgs: Record<string, unknown>): this {
    this.request.toolName = toolName;
    this.request.toolArgs = toolArgs;
    return this;
  }

  /**
   * Sets the user ID
   */
  forUser(userId: string): this {
    if (!this.request.metadata) {
      this.request.metadata = {};
    }
    this.request.metadata.userId = userId;
    return this;
  }

  /**
   * Sets the risk level
   */
  withRiskLevel(riskLevel: string): this {
    if (!this.request.metadata) {
      this.request.metadata = {};
    }
    this.request.metadata.riskLevel = riskLevel;
    return this;
  }

  /**
   * Sets the timestamp
   */
  atTime(timestamp: Date): this {
    if (!this.request.metadata) {
      this.request.metadata = {};
    }
    this.request.metadata.timestamp = timestamp;
    return this;
  }

  /**
   * Builds the approval request
   */
  build(): ApprovalRequest {
    return this.request as ApprovalRequest;
  }
}

/**
 * Main fixture class with static factory methods
 */
export class ApprovalFixture {
  /**
   * Creates a new approval request builder
   */
  static request(): ApprovalRequestBuilder {
    return new ApprovalRequestBuilder();
  }

  /**
   * Common presets for typical approval scenarios
   */
  static readonly Presets = {
    /**
     * Customer create approval
     */
    customerCreate: (sessionId = 'test-session', name = 'John Doe') =>
      ApprovalFixture.request()
        .forSession(sessionId)
        .withTool('customer_create', {
          name,
          email: `${name.toLowerCase().replace(' ', '.')}@test.com`,
          phone: '+1234567890',
        })
        .withRiskLevel('high')
        .build(),

    /**
     * Sales order create approval
     */
    salesOrderCreate: (sessionId = 'test-session', customerId = 'CUST-001') =>
      ApprovalFixture.request()
        .forSession(sessionId)
        .withTool('salesOrder_create', {
          customerId,
          items: [
            { productId: 'PROD-001', quantity: 2, price: 100 },
            { productId: 'PROD-002', quantity: 1, price: 250 },
          ],
          totalAmount: 450,
        })
        .withRiskLevel('high')
        .build(),

    /**
     * Delete operation approval (critical risk)
     */
    deleteOperation: (sessionId = 'test-session', entityName = 'customer', id = '123') =>
      ApprovalFixture.request()
        .forSession(sessionId)
        .withTool(`${entityName}_delete`, { id })
        .withRiskLevel('critical')
        .build(),

    /**
     * Workflow validation approval
     */
    workflowValidation: (sessionId = 'test-session') =>
      ApprovalFixture.request()
        .forSession(sessionId)
        .withTool('validate_workflow', {
          workflow: [
            { operation_id: 'customer_create', parameters: { name: 'Test' } },
            { operation_id: 'salesOrder_create', parameters: { customerId: '{customer.id}' } },
          ],
        })
        .withRiskLevel('high')
        .build(),

    /**
     * Low-risk operation (shouldn't require approval in real scenario, but useful for testing)
     */
    lowRisk: (sessionId = 'test-session') =>
      ApprovalFixture.request()
        .forSession(sessionId)
        .withTool('customer_list', {})
        .withRiskLevel('low')
        .build(),

    /**
     * Multiple approvals in sequence
     */
    sequence: (sessionId = 'test-session', count = 3) => {
      const requests: ApprovalRequest[] = [];
      for (let i = 0; i < count; i++) {
        requests.push(
          ApprovalFixture.request()
            .forSession(sessionId)
            .withTool(`operation_${i}`, { index: i })
            .withRiskLevel('medium')
            .build()
        );
      }
      return requests;
    },
  };

  /**
   * Helper to create a mock Socket.IO instance for testing
   */
  static createMockSocketIO(): {
    to: (room: string) => { emit: (event: string, data: unknown) => void };
  } {
    const emitFn = vi.fn();
    return {
      to: vi.fn(() => ({ emit: emitFn })),
    };
  }

  /**
   * Helper to simulate approval timeout
   */
  static timeout = {
    /**
     * Default timeout duration (5 minutes)
     */
    default: 5 * 60 * 1000,

    /**
     * Fast timeout for testing (100ms)
     */
    fast: 100,

    /**
     * Creates a date in the past (for testing expired approvals)
     */
    expired: () => new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
  };
}
