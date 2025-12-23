/**
 * GoldenResponses - Pre-configured FakeScenario responses for agent testing
 *
 * This module provides pre-configured response patterns for the 5 golden flows:
 * 1. Simple text response - Basic conversation
 * 2. Extended thinking - Claude using thinking blocks
 * 3. Tool use (read) - Claude retrieving BC data
 * 4. Approval flow (write) - Claude requesting user approval
 * 5. Error handling - API errors and failures
 *
 * Usage:
 * ```typescript
 * import { getFakeAgentOrchestrator } from '@domains/agent/orchestration';
 * import { createGoldenScenario } from './GoldenResponses';
 *
 * const fake = getFakeAgentOrchestrator();
 * fake.setResponse(createGoldenScenario('simple'));
 * ```
 *
 * @module __tests__/e2e/helpers/GoldenResponses
 */

import type { FakeScenario } from '@domains/agent/orchestration';

/**
 * Golden flow types
 */
export type GoldenFlowType = 'simple' | 'thinking' | 'tool_use' | 'approval' | 'error';

/**
 * Create FakeScenario for simple text response flow
 *
 * Flow: User sends message -> Claude responds with text -> Complete
 *
 * @returns FakeScenario configuration
 */
export function createSimpleTextScenario(): FakeScenario {
  return {
    textBlocks: ['Hello! I am Claude, your Business Central assistant.'],
    stopReason: 'end_turn',
  };
}

/**
 * Create FakeScenario for extended thinking flow
 *
 * Flow: User sends message -> Claude thinks -> Claude responds -> Complete
 *
 * @returns FakeScenario configuration
 */
export function createThinkingScenario(): FakeScenario {
  return {
    thinkingContent: 'Let me analyze this request carefully... Considering the implications and context...',
    textBlocks: ['Based on my analysis, here is my response.'],
    stopReason: 'end_turn',
  };
}

/**
 * Create FakeScenario for tool use flow (read operation)
 *
 * Flow: User sends message -> Claude requests tool use -> Tool executes ->
 *       Claude responds with result -> Complete
 *
 * @returns FakeScenario configuration
 */
export function createToolUseScenario(): FakeScenario {
  return {
    textBlocks: [
      'Let me look up that information for you.',
      'I found 5 customers in Business Central.',
    ],
    toolCalls: [
      {
        toolName: 'bc_customers_read',
        args: { $top: 5 },
        result: { value: [{ id: '1', name: 'Customer 1' }] },
        success: true,
      },
    ],
    stopReason: 'end_turn',
  };
}

/**
 * Create FakeScenario for approval flow (write operation)
 *
 * Flow: User sends message -> Claude requests tool use (write) ->
 *       Backend requests approval -> User approves -> Tool executes ->
 *       Claude responds with result -> Complete
 *
 * @returns FakeScenario configuration
 */
export function createApprovalScenario(): FakeScenario {
  return {
    textBlocks: [
      'I will create a new customer for you.',
      'The customer has been created successfully.',
    ],
    toolCalls: [
      {
        toolName: 'bc_customers_create',
        args: { name: 'Test Customer', email: 'test@example.com' },
        result: { id: 'new-customer-id', name: 'Test Customer' },
        success: true,
      },
    ],
    stopReason: 'end_turn',
  };
}

/**
 * Create FakeScenario for error handling flow
 *
 * Flow: User sends message -> Claude API throws error -> Backend handles error
 *
 * @returns FakeScenario configuration
 */
export function createErrorScenario(): FakeScenario {
  return {
    error: 'API Error: Rate limit exceeded',
  };
}

/**
 * Create FakeScenario for a specific golden flow
 *
 * This is the main entry point for creating fake response scenarios.
 * It returns a FakeScenario configuration for one of the 5 golden flows.
 *
 * @param flow - The golden flow type to create
 * @returns FakeScenario configuration
 *
 * @example
 * ```typescript
 * import { getFakeAgentOrchestrator } from '@domains/agent/orchestration';
 * import { createGoldenScenario } from './GoldenResponses';
 *
 * const fake = getFakeAgentOrchestrator();
 * fake.setResponse(createGoldenScenario('simple'));
 * // fake is now ready to simulate a simple text response flow
 * ```
 */
export function createGoldenScenario(flow: GoldenFlowType): FakeScenario {
  switch (flow) {
    case 'simple':
      return createSimpleTextScenario();
    case 'thinking':
      return createThinkingScenario();
    case 'tool_use':
      return createToolUseScenario();
    case 'approval':
      return createApprovalScenario();
    case 'error':
      return createErrorScenario();
    default:
      throw new Error(`Unknown flow type: ${flow}`);
  }
}
