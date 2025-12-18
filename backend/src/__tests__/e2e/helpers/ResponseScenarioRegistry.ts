/**
 * ResponseScenarioRegistry - Shared Response Execution for E2E Tests
 *
 * Executes a response scenario ONCE and caches the results for multiple tests.
 * This dramatically reduces API calls - instead of N tests making N calls,
 * one scenario execution serves multiple test verifications.
 *
 * @module __tests__/e2e/helpers/ResponseScenarioRegistry
 */

import { FakeAnthropicClient } from '@/services/agent/FakeAnthropicClient';
import {
  TestSessionFactory,
  TestUser,
  TestChatSession,
} from '../../integration/helpers/TestSessionFactory';
import { E2ETestClient, createE2ETestClient } from './E2ETestClient';
import { E2E_API_MODE } from '../setup.e2e';
import { executeQuery } from '@/config/database';

/** Event from WebSocket collected during scenario execution */
export interface AgentEvent {
  type: string;
  data: Record<string, unknown>;
  sequenceNumber?: number;
  timestamp: number;
}

/** Database message record from messages table */
export interface ScenarioDatabaseMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  sequenceNumber?: number;
  createdAt: Date;
}

/** Database event record from message_events table */
export interface ScenarioDatabaseEvent {
  id: string;
  sessionId: string;
  eventType: string;
  eventData: Record<string, unknown>;
  sequenceNumber: number;
  createdAt: Date;
}

/** Result of executing a scenario */
export interface ScenarioResult {
  /** Scenario that was executed */
  scenarioId: string;
  /** All events collected via WebSocket during execution */
  events: AgentEvent[];
  /** Database messages after scenario completion */
  dbMessages: ScenarioDatabaseMessage[];
  /** Database events from message_events table */
  dbEvents: ScenarioDatabaseEvent[];
  /** The session used for this scenario */
  session: TestChatSession;
  /** The user used for this scenario */
  user: TestUser;
  /** Timestamp when scenario was executed */
  executedAt: Date;
  /** Total duration in ms */
  durationMs: number;
  /** Error if scenario failed */
  error?: Error;
}

/** Scenario definition */
export interface ScenarioDefinition {
  /** Unique scenario identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Configure FakeAnthropicClient for this scenario */
  configureFake: (fake: FakeAnthropicClient) => void;
  /** Message to send */
  message: string;
  /** Enable thinking mode */
  thinking?: { enable: boolean; budget?: number };
  /** Expected event types (for validation) */
  expectedEventTypes: string[];
  /** Approval response (if scenario requires approval) */
  approvalResponse?: { approve: boolean; feedback?: string };
  /** Timeout for scenario execution (default: 60000) */
  timeout?: number;
}

/** Pre-defined scenarios */
export type ScenarioId =
  | 'simple-message'
  | 'thinking-only'
  | 'thinking-tools'
  | 'approval-flow'
  | 'multi-tool'
  | 'error-handling'
  | 'single-tool-no-thinking'
  | 'multi-tool-with-thinking'
  | 'tool-error'
  | 'max-tokens';

/**
 * ResponseScenarioRegistry - Shared Response Execution for E2E Tests
 *
 * Executes a response scenario ONCE and caches the results for multiple tests.
 * This dramatically reduces API calls - instead of N tests making N calls,
 * one scenario execution serves multiple test verifications.
 */
export class ResponseScenarioRegistry {
  private cache = new Map<string, ScenarioResult>();
  private executing = new Map<string, Promise<ScenarioResult>>();
  private scenarios = new Map<string, ScenarioDefinition>();

  constructor() {
    this.registerPredefinedScenarios();
  }

  /**
   * Register a custom scenario
   */
  registerScenario(scenario: ScenarioDefinition): void {
    this.scenarios.set(scenario.id, scenario);
  }

  /**
   * Execute a scenario and cache the result
   *
   * If the scenario is already cached, returns cached result immediately.
   * If the scenario is currently executing, waits for that execution.
   * Otherwise, executes the scenario and caches the result.
   */
  async executeScenario(
    scenarioId: string,
    factory: TestSessionFactory,
    testUser: TestUser,
    options?: {
      /** Force re-execution even if cached */
      forceRefresh?: boolean;
      /** Custom E2E test client (will create one if not provided) */
      client?: E2ETestClient;
    }
  ): Promise<ScenarioResult> {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) {
      throw new Error(`Unknown scenario: ${scenarioId}`);
    }

    // Return cached result if available and not forcing refresh
    if (!options?.forceRefresh && this.cache.has(scenarioId)) {
      console.log(`[Scenario] Returning cached result for: ${scenarioId}`);
      return this.cache.get(scenarioId)!;
    }

    // If already executing, wait for that execution
    if (this.executing.has(scenarioId)) {
      console.log(`[Scenario] Waiting for in-progress execution: ${scenarioId}`);
      return this.executing.get(scenarioId)!;
    }

    // Execute scenario
    console.log(`[Scenario] Executing: ${scenarioId}`);
    const promise = this.doExecuteScenario(scenario, factory, testUser, options?.client);
    this.executing.set(scenarioId, promise);

    try {
      const result = await promise;
      this.cache.set(scenarioId, result);
      return result;
    } finally {
      this.executing.delete(scenarioId);
    }
  }

  /**
   * Get cached scenario result without executing
   */
  getCachedResult(scenarioId: string): ScenarioResult | undefined {
    return this.cache.get(scenarioId);
  }

  /**
   * Invalidate cached result for a scenario
   */
  invalidateScenario(scenarioId: string): void {
    this.cache.delete(scenarioId);
  }

  /**
   * Invalidate all cached results
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Get all registered scenario IDs
   */
  getScenarioIds(): string[] {
    return Array.from(this.scenarios.keys());
  }

  private async doExecuteScenario(
    scenario: ScenarioDefinition,
    factory: TestSessionFactory,
    testUser: TestUser,
    providedClient?: E2ETestClient
  ): Promise<ScenarioResult> {
    const startTime = Date.now();
    const events: AgentEvent[] = [];
    let error: Error | undefined;

    // Create session for this scenario
    const session = await factory.createChatSession(testUser.id, {
      title: `Scenario: ${scenario.name}`,
    });

    // Configure FakeAnthropicClient if not using real API
    if (!E2E_API_MODE.useRealApi) {
      const fake = new FakeAnthropicClient();
      scenario.configureFake(fake);
      // Reset DirectAgentService with configured fake
      const { getDirectAgentService, __resetDirectAgentService } = await import('@/services/agent');
      __resetDirectAgentService();
      getDirectAgentService(undefined, undefined, fake);
    }

    // Create or use provided client
    const client = providedClient || createE2ETestClient();
    const shouldCleanupClient = !providedClient;

    try {
      // Set session cookie and connect
      client.setSessionCookie(testUser.sessionCookie);
      await client.connect();
      await client.joinSession(session.id);

      // Set up event collection
      const eventPromise = client.collectEvents(200, {
        timeout: scenario.timeout || 60000,
        stopOnEventType: 'complete',
      });

      // Send message
      await client.sendMessage(session.id, scenario.message, {
        enableThinking: scenario.thinking?.enable,
        thinkingBudget: scenario.thinking?.budget,
      });

      // Handle approval if needed
      if (scenario.approvalResponse) {
        // Wait for approval_requested event
        const approvalEvent = await client.waitForAgentEvent('approval_requested', {
          timeout: 30000,
        });
        if (approvalEvent) {
          const approvalId = (approvalEvent.data as { approvalId?: string })?.approvalId;
          if (approvalId) {
            await client.respondToApproval(approvalId, scenario.approvalResponse.approve ? 'approved' : 'rejected');
          }
        }
      }

      // Wait for all events
      const collectedEvents = await eventPromise;

      // Transform to AgentEvent format
      for (const event of collectedEvents) {
        events.push({
          type: (event.type as string) || 'unknown',
          data: (event as unknown as Record<string, unknown>),
          sequenceNumber: (event as { sequenceNumber?: number }).sequenceNumber,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
    } finally {
      // Cleanup
      try {
        await client.disconnect();
      } catch {
        /* ignore cleanup errors */
      }
      if (shouldCleanupClient) {
        // Additional cleanup if needed
      }
    }

    // Fetch database state
    const { dbMessages, dbEvents } = await this.fetchDatabaseState(session.id);

    return {
      scenarioId: scenario.id,
      events,
      dbMessages,
      dbEvents,
      session,
      user: testUser,
      executedAt: new Date(),
      durationMs: Date.now() - startTime,
      error,
    };
  }

  private async fetchDatabaseState(sessionId: string): Promise<{
    dbMessages: ScenarioDatabaseMessage[];
    dbEvents: ScenarioDatabaseEvent[];
  }> {
    // Fetch messages
    const messagesResult = await executeQuery<{
      id: string;
      session_id: string;
      role: string;
      content: string;
      sequence_number: number | null;
      created_at: Date;
    }>(
      `SELECT id, session_id, role, content, sequence_number, created_at
       FROM messages
       WHERE session_id = @sessionId
       ORDER BY sequence_number, created_at`,
      { sessionId }
    );

    const dbMessages: ScenarioDatabaseMessage[] = messagesResult.recordset.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role as 'user' | 'assistant',
      content: row.content,
      sequenceNumber: row.sequence_number ?? undefined,
      createdAt: row.created_at,
    }));

    // Fetch message_events
    const eventsResult = await executeQuery<{
      id: string;
      session_id: string;
      event_type: string;
      data: string;
      sequence_number: number;
      timestamp: Date;
    }>(
      `SELECT id, session_id, event_type, data, sequence_number, timestamp
       FROM message_events
       WHERE session_id = @sessionId
       ORDER BY sequence_number`,
      { sessionId }
    );

    const dbEvents: ScenarioDatabaseEvent[] = eventsResult.recordset.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      eventType: row.event_type,
      eventData: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
      sequenceNumber: row.sequence_number,
      createdAt: row.timestamp,
    }));

    return { dbMessages, dbEvents };
  }

  private registerPredefinedScenarios(): void {
    // Simple text message
    this.scenarios.set('simple-message', {
      id: 'simple-message',
      name: 'Simple Text Response',
      configureFake: (fake) => {
        fake.addResponse({
          textBlocks: ['Hello! I am Claude, ready to help you with Business Central.'],
          stopReason: 'end_turn',
        });
      },
      message: 'Hello, introduce yourself.',
      expectedEventTypes: ['user_message_confirmed', 'message_chunk', 'message', 'complete'],
    });

    // Thinking only
    this.scenarios.set('thinking-only', {
      id: 'thinking-only',
      name: 'Extended Thinking Only',
      configureFake: (fake) => {
        fake.addResponse({
          thinkingBlocks: [
            'Let me think about this question carefully. I need to consider the accounting implications and best practices for Business Central.',
            'After analyzing the request, I should provide a comprehensive answer.',
          ],
          textBlocks: [
            'Based on my analysis, here is a detailed explanation of the accounting cycle in Business Central...',
          ],
          stopReason: 'end_turn',
        });
      },
      message: 'Explain the accounting cycle in Business Central. Think carefully.',
      thinking: { enable: true, budget: 10000 },
      expectedEventTypes: [
        'user_message_confirmed',
        'thinking',
        'thinking_chunk',
        'message_chunk',
        'message',
        'complete',
      ],
    });

    // Thinking + Tools
    this.scenarios.set('thinking-tools', {
      id: 'thinking-tools',
      name: 'Extended Thinking + Tool Use',
      configureFake: (fake) => {
        // First response: thinking + tool use
        fake.addResponse({
          thinkingBlocks: ['I need to retrieve customer data. Let me use the appropriate tool.'],
          textBlocks: ['Let me look up the customer information for you.'],
          toolUseBlocks: [
            {
              id: 'toolu_01scenario_customers',
              name: 'bc_customers_read',
              input: { $top: 5, $select: 'number,displayName,email' },
            },
          ],
          stopReason: 'tool_use',
        });
        // Second response: after tool result
        fake.addResponse({
          textBlocks: ['Here are the top 5 customers from your Business Central system.'],
          stopReason: 'end_turn',
        });
      },
      message: 'List the first 5 customers.',
      thinking: { enable: true, budget: 10000 },
      expectedEventTypes: [
        'user_message_confirmed',
        'thinking',
        'message_chunk',
        'tool_use',
        'tool_result',
        'message',
        'complete',
      ],
    });

    // Multi-tool scenario
    this.scenarios.set('multi-tool', {
      id: 'multi-tool',
      name: 'Multiple Tool Calls',
      configureFake: (fake) => {
        fake.addResponse({
          textBlocks: ['Let me retrieve both customers and items for you.'],
          toolUseBlocks: [
            {
              id: 'toolu_01multi_customers',
              name: 'bc_customers_read',
              input: { $top: 3 },
            },
            {
              id: 'toolu_01multi_items',
              name: 'bc_items_read',
              input: { $top: 3 },
            },
          ],
          stopReason: 'tool_use',
        });
        fake.addResponse({
          textBlocks: ['Here is the combined data from customers and items.'],
          stopReason: 'end_turn',
        });
      },
      message: 'Show me 3 customers and 3 items.',
      expectedEventTypes: [
        'user_message_confirmed',
        'message_chunk',
        'tool_use',
        'tool_result',
        'message',
        'complete',
      ],
    });

    // Error handling
    this.scenarios.set('error-handling', {
      id: 'error-handling',
      name: 'Error Response',
      configureFake: (fake) => {
        fake.throwOnNextCall(new Error('API rate limit exceeded'));
      },
      message: 'This should trigger an error.',
      expectedEventTypes: ['user_message_confirmed', 'error', 'complete'],
    });

    // Approval flow (for write operations)
    this.scenarios.set('approval-flow', {
      id: 'approval-flow',
      name: 'Approval Required (Write Operation)',
      configureFake: (fake) => {
        // First response requests a write operation
        fake.addResponse({
          textBlocks: ['I will create a new customer for you.'],
          toolUseBlocks: [
            {
              id: 'toolu_01approval_create',
              name: 'bc_customers_create',
              input: { displayName: 'Test Customer', email: 'test@example.com' },
            },
          ],
          stopReason: 'tool_use',
        });
        // After approval, final response
        fake.addResponse({
          textBlocks: ['The customer has been created successfully.'],
          stopReason: 'end_turn',
        });
      },
      message: 'Create a new customer named Test Customer with email test@example.com.',
      approvalResponse: { approve: true },
      expectedEventTypes: [
        'user_message_confirmed',
        'message_chunk',
        'tool_use',
        'approval_requested',
        'approval_resolved',
        'tool_result',
        'message',
        'complete',
      ],
      timeout: 90000, // Longer timeout for approval flow
    });

    // Single tool call without thinking
    this.scenarios.set('single-tool-no-thinking', {
      id: 'single-tool-no-thinking',
      name: 'Single Tool Call (No Thinking)',
      configureFake: (fake) => {
        fake.addResponse({
          textBlocks: ['Let me look up the customer information for you.'],
          toolUseBlocks: [
            {
              id: `toolu_single_${Date.now()}`,
              name: 'bc_customers_read',
              input: { $top: 3 },
            },
          ],
          stopReason: 'tool_use',
        });
        fake.addResponse({
          textBlocks: ['Here are the first 3 customers from Business Central.'],
          stopReason: 'end_turn',
        });
      },
      message: 'List the first 3 customers.',
      expectedEventTypes: [
        'user_message_confirmed',
        'message_chunk',
        'tool_use',
        'tool_result',
        'message',
        'complete',
      ],
    });

    // Multiple tools with thinking
    this.scenarios.set('multi-tool-with-thinking', {
      id: 'multi-tool-with-thinking',
      name: 'Multiple Tools with Thinking',
      configureFake: (fake) => {
        fake.addResponse({
          thinkingBlocks: [
            'I need to retrieve both customers and items from Business Central.',
            'Let me use both tools to get this information.',
          ],
          textBlocks: ['Let me retrieve both customers and items for you.'],
          toolUseBlocks: [
            {
              id: `toolu_multi_cust_${Date.now()}`,
              name: 'bc_customers_read',
              input: { $top: 3 },
            },
            {
              id: `toolu_multi_item_${Date.now() + 1}`,
              name: 'bc_items_read',
              input: { $top: 3 },
            },
          ],
          stopReason: 'tool_use',
        });
        fake.addResponse({
          textBlocks: ['Here is the combined data from customers and items.'],
          stopReason: 'end_turn',
        });
      },
      message: 'Show me 3 customers and 3 items.',
      thinking: { enable: true, budget: 10000 },
      expectedEventTypes: [
        'user_message_confirmed',
        'thinking',
        'message_chunk',
        'tool_use',
        'tool_result',
        'message',
        'complete',
      ],
    });

    // Tool execution error
    this.scenarios.set('tool-error', {
      id: 'tool-error',
      name: 'Tool Execution Error',
      configureFake: (fake) => {
        fake.addResponse({
          textBlocks: ['Let me look up that information.'],
          toolUseBlocks: [
            {
              id: `toolu_error_${Date.now()}`,
              name: 'bc_customers_read',
              input: { $top: 3 },
            },
          ],
          stopReason: 'tool_use',
        });
        // After tool_result (which will be an error), Claude responds
        fake.addResponse({
          textBlocks: ['I encountered an error while trying to retrieve the data. The Business Central connection failed.'],
          stopReason: 'end_turn',
        });
      },
      message: 'List customers from a disconnected Business Central.',
      expectedEventTypes: [
        'user_message_confirmed',
        'message_chunk',
        'tool_use',
        'tool_result',
        'message',
        'complete',
      ],
    });

    // Max tokens exceeded
    this.scenarios.set('max-tokens', {
      id: 'max-tokens',
      name: 'Max Tokens Exceeded',
      configureFake: (fake) => {
        fake.addResponse({
          textBlocks: [
            'This is a long response that will be truncated when the maximum token limit is reached. The response continues with more content...',
          ],
          stopReason: 'max_tokens',
          usage: { input_tokens: 100, output_tokens: 4096 },
        });
      },
      message: 'Generate a very long response about Business Central.',
      expectedEventTypes: [
        'user_message_confirmed',
        'message_chunk',
        'message',
        'complete',
      ],
    });
  }
}

// Singleton instance
let registryInstance: ResponseScenarioRegistry | null = null;

export function getScenarioRegistry(): ResponseScenarioRegistry {
  if (!registryInstance) {
    registryInstance = new ResponseScenarioRegistry();
  }
  return registryInstance;
}

export function resetScenarioRegistry(): void {
  if (registryInstance) {
    registryInstance.invalidateAll();
  }
  registryInstance = null;
}
