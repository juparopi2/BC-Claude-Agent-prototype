/**
 * GoldenResponses - Pre-configured FakeAnthropicClient responses
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
 * const fake = new FakeAnthropicClient();
 * configureGoldenFlow(fake, 'simple');
 * const service = new DirectAgentService(undefined, undefined, fake);
 * ```
 *
 * @module __tests__/e2e/helpers/GoldenResponses
 */

import { FakeAnthropicClient } from '@/services/agent/FakeAnthropicClient';

/**
 * Golden flow types
 */
export type GoldenFlowType = 'simple' | 'thinking' | 'tool_use' | 'approval' | 'error';

/**
 * Configure FakeAnthropicClient for simple text response flow
 *
 * Flow: User sends message -> Claude responds with text -> Complete
 *
 * @param fake - The FakeAnthropicClient instance to configure
 */
export function configureSimpleTextResponse(fake: FakeAnthropicClient): void {
  fake.addResponse({
    textBlocks: ['Hello! I am Claude, your Business Central assistant.'],
    stopReason: 'end_turn',
  });
}

/**
 * Configure FakeAnthropicClient for extended thinking flow
 *
 * Flow: User sends message -> Claude thinks -> Claude responds -> Complete
 *
 * @param fake - The FakeAnthropicClient instance to configure
 */
export function configureThinkingResponse(fake: FakeAnthropicClient): void {
  fake.addResponse({
    thinkingBlocks: [
      'Let me analyze this request carefully...',
      'Considering the implications and context...',
    ],
    textBlocks: ['Based on my analysis, here is my response.'],
    stopReason: 'end_turn',
  });
}

/**
 * Configure FakeAnthropicClient for tool use flow (read operation)
 *
 * Flow: User sends message -> Claude requests tool use -> Tool executes ->
 *       Claude responds with result -> Complete
 *
 * @param fake - The FakeAnthropicClient instance to configure
 */
export function configureToolUseResponse(fake: FakeAnthropicClient): void {
  // First response: request tool use
  fake.addResponse({
    textBlocks: ['Let me look up that information for you.'],
    toolUseBlocks: [
      {
        id: 'toolu_01test123',
        name: 'bc_customers_read',
        input: { $top: 5 },
      },
    ],
    stopReason: 'tool_use',
  });

  // Second response: after tool result
  fake.addResponse({
    textBlocks: ['I found 5 customers in Business Central.'],
    stopReason: 'end_turn',
  });
}

/**
 * Configure FakeAnthropicClient for approval flow (write operation)
 *
 * Flow: User sends message -> Claude requests tool use (write) ->
 *       Backend requests approval -> User approves -> Tool executes ->
 *       Claude responds with result -> Complete
 *
 * @param fake - The FakeAnthropicClient instance to configure
 */
export function configureApprovalResponse(fake: FakeAnthropicClient): void {
  // First response: request tool use for write operation
  fake.addResponse({
    textBlocks: ['I will create a new customer for you.'],
    toolUseBlocks: [
      {
        id: 'toolu_02approval456',
        name: 'bc_customers_create',
        input: { name: 'Test Customer', email: 'test@example.com' },
      },
    ],
    stopReason: 'tool_use',
  });

  // Second response: after approval and tool result
  fake.addResponse({
    textBlocks: ['The customer has been created successfully.'],
    stopReason: 'end_turn',
  });
}

/**
 * Configure FakeAnthropicClient for error handling flow
 *
 * Flow: User sends message -> Claude API throws error -> Backend handles error
 *
 * @param fake - The FakeAnthropicClient instance to configure
 */
export function configureErrorResponse(fake: FakeAnthropicClient): void {
  fake.throwOnNextCall(new Error('API Error: Rate limit exceeded'));
}

/**
 * Reset and configure FakeAnthropicClient for a specific golden flow
 *
 * This is the main entry point for configuring fake responses.
 * It resets the fake client and configures it for one of the 5 golden flows.
 *
 * @param fake - The FakeAnthropicClient instance to configure
 * @param flow - The golden flow type to configure
 *
 * @example
 * ```typescript
 * const fake = new FakeAnthropicClient();
 * configureGoldenFlow(fake, 'simple');
 * // fake is now ready to simulate a simple text response flow
 * ```
 */
export function configureGoldenFlow(
  fake: FakeAnthropicClient,
  flow: GoldenFlowType
): void {
  fake.reset();
  switch (flow) {
    case 'simple':
      configureSimpleTextResponse(fake);
      break;
    case 'thinking':
      configureThinkingResponse(fake);
      break;
    case 'tool_use':
      configureToolUseResponse(fake);
      break;
    case 'approval':
      configureApprovalResponse(fake);
      break;
    case 'error':
      configureErrorResponse(fake);
      break;
  }
}
