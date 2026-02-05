/**
 * BatchResultNormalizer Unit Tests
 *
 * Tests for the batch result normalizer that converts
 * LangGraph AgentState to NormalizedAgentEvent[].
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BatchResultNormalizer,
  getBatchResultNormalizer,
  __resetBatchResultNormalizer,
} from '@/shared/providers/normalizers/BatchResultNormalizer';
import type { AgentState, ToolExecution } from '@/modules/agents/orchestrator/state';
import type { BaseMessage } from '@langchain/core/messages';
import type {
  NormalizedToolRequestEvent,
} from '@bc-agent/shared';

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

/**
 * Create a mock BaseMessage
 */
function createMockMessage(
  content: string | Array<{ type: string; [key: string]: unknown }>,
  type: 'ai' | 'human' | 'tool' = 'ai'
): BaseMessage {
  return {
    _getType: () => type,
    content,
    response_metadata: { stop_reason: 'end_turn' },
    additional_kwargs: {},
  } as unknown as BaseMessage;
}

/**
 * Create a mock AgentState
 */
function createMockState(
  messages: BaseMessage[],
  toolExecutions: ToolExecution[] = []
): AgentState {
  return {
    messages,
    toolExecutions,
    currentAgent: 'bc',
    pendingApproval: null,
    aborted: false,
    sessionId: 'test-session',
    userId: 'test-user',
    prompt: 'test prompt',
    semanticSearchResults: [],
    fileContext: null,
    conversationHistory: [],
    enableThinking: false,
    thinkingBudget: 0,
  } as AgentState;
}

describe('BatchResultNormalizer', () => {
  let normalizer: BatchResultNormalizer;
  const sessionId = 'test-session-123';

  beforeEach(() => {
    __resetBatchResultNormalizer();
    normalizer = new BatchResultNormalizer();
  });

  describe('singleton', () => {
    it('should return same instance via getBatchResultNormalizer', () => {
      const instance1 = getBatchResultNormalizer();
      const instance2 = getBatchResultNormalizer();
      expect(instance1).toBe(instance2);
    });

    it('should reset singleton for testing', () => {
      const instance1 = getBatchResultNormalizer();
      __resetBatchResultNormalizer();
      const instance2 = getBatchResultNormalizer();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('normalize', () => {
    describe('simple text response', () => {
      it('should produce [assistant_message] array', () => {
        const state = createMockState([
          createMockMessage('Hello from AI'),
        ]);

        const events = normalizer.normalize(state, sessionId);

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('assistant_message');
      });

      it('should set originalIndex correctly', () => {
        const state = createMockState([
          createMockMessage('Response'),
        ]);

        const events = normalizer.normalize(state, sessionId);

        expect(events[0].originalIndex).toBe(0);
      });
    });

    describe('thinking + response', () => {
      it('should produce [thinking, assistant_message]', () => {
        const state = createMockState([
          createMockMessage([
            { type: 'thinking', thinking: 'Thinking...' },
            { type: 'text', text: 'Response' },
          ]),
        ]);

        const events = normalizer.normalize(state, sessionId);

        expect(events).toHaveLength(2);
        expect(events[0].type).toBe('thinking');
        expect(events[1].type).toBe('assistant_message');
      });

      it('should preserve order', () => {
        const state = createMockState([
          createMockMessage([
            { type: 'thinking', thinking: 'First' },
            { type: 'text', text: 'Second' },
          ]),
        ]);

        const events = normalizer.normalize(state, sessionId);

        expect(events[0].originalIndex).toBeLessThan(events[1].originalIndex);
      });
    });

    describe('tool execution', () => {
      it('should produce [tool_request, tool_response, assistant_message]', () => {
        const state = createMockState(
          [
            createMockMessage([
              { type: 'tool_use', id: 'toolu_123', name: 'search', input: {} },
            ]),
            createMockMessage('Tool result', 'tool'),
            createMockMessage('Final response'),
          ],
          [
            {
              toolUseId: 'toolu_123',
              toolName: 'search',
              success: true,
              result: 'Found 5 results',
            },
          ]
        );

        const events = normalizer.normalize(state, sessionId);

        const types = events.map(e => e.type);
        expect(types).toContain('tool_request');
        expect(types).toContain('tool_response');
        expect(types).toContain('assistant_message');
      });

      it('should match toolUseId between request and response', () => {
        const state = createMockState(
          [
            createMockMessage([
              { type: 'tool_use', id: 'toolu_abc', name: 'test_tool', input: { q: 'test' } },
            ]),
          ],
          [
            {
              toolUseId: 'toolu_abc',
              toolName: 'test_tool',
              success: true,
              result: 'Success',
            },
          ]
        );

        const events = normalizer.normalize(state, sessionId);

        const toolRequest = events.find(e => e.type === 'tool_request') as NormalizedToolRequestEvent;
        const toolResponse = events.find(e => e.type === 'tool_response');

        expect(toolRequest?.toolUseId).toBe('toolu_abc');
        expect((toolResponse as { toolUseId: string })?.toolUseId).toBe('toolu_abc');
      });

      it('should include tool results from state.toolExecutions', () => {
        const state = createMockState(
          [
            createMockMessage([
              { type: 'tool_use', id: 'toolu_xyz', name: 'search', input: {} },
            ]),
          ],
          [
            {
              toolUseId: 'toolu_xyz',
              toolName: 'search',
              success: true,
              result: 'Search results here',
            },
          ]
        );

        const events = normalizer.normalize(state, sessionId);
        const toolResponse = events.find(e => e.type === 'tool_response');

        expect(toolResponse).toBeDefined();
        expect((toolResponse as { result: string }).result).toBe('Search results here');
        expect((toolResponse as { success: boolean }).success).toBe(true);
      });
    });

    describe('ReAct loops (multiple AI messages)', () => {
      it('should process ALL AI messages (not just last)', () => {
        const state = createMockState([
          createMockMessage('User request', 'human'),
          createMockMessage([
            { type: 'thinking', thinking: 'First thinking' },
            { type: 'tool_use', id: 'toolu_1', name: 'search', input: {} },
          ]),
          createMockMessage('Tool result', 'tool'),
          createMockMessage('Final answer'),
        ]);

        const events = normalizer.normalize(state, sessionId);

        // Should have events from BOTH AI messages
        const types = events.map(e => e.type);
        expect(types).toContain('thinking');
        expect(types).toContain('tool_request');
        expect(types.filter(t => t === 'assistant_message')).toHaveLength(1);
      });

      it('should handle multiple tool calls across messages', () => {
        const state = createMockState(
          [
            createMockMessage([
              { type: 'tool_use', id: 'toolu_1', name: 'tool1', input: {} },
            ]),
            createMockMessage('Result 1', 'tool'),
            createMockMessage([
              { type: 'tool_use', id: 'toolu_2', name: 'tool2', input: {} },
            ]),
            createMockMessage('Result 2', 'tool'),
            createMockMessage('Final'),
          ],
          [
            { toolUseId: 'toolu_1', toolName: 'tool1', success: true, result: 'R1' },
            { toolUseId: 'toolu_2', toolName: 'tool2', success: true, result: 'R2' },
          ]
        );

        const events = normalizer.normalize(state, sessionId);

        const toolRequests = events.filter(e => e.type === 'tool_request');
        const toolResponses = events.filter(e => e.type === 'tool_response');

        expect(toolRequests).toHaveLength(2);
        expect(toolResponses).toHaveLength(2);
      });

      it('should maintain order across all messages', () => {
        const state = createMockState([
          createMockMessage('First AI message'),
          createMockMessage('User reply', 'human'),
          createMockMessage('Second AI message'),
        ]);

        const events = normalizer.normalize(state, sessionId);

        // All events should have sequential indices
        for (let i = 1; i < events.length; i++) {
          expect(events[i].originalIndex).toBeGreaterThan(events[i - 1].originalIndex);
        }
      });
    });

    describe('interleaving', () => {
      it('should interleave tool_response after tool_request', () => {
        const state = createMockState(
          [
            createMockMessage([
              { type: 'tool_use', id: 'toolu_int', name: 'test', input: {} },
              { type: 'text', text: 'After tool' },
            ]),
          ],
          [
            { toolUseId: 'toolu_int', toolName: 'test', success: true, result: 'OK' },
          ]
        );

        const events = normalizer.normalize(state, sessionId);

        const toolReqIndex = events.findIndex(e => e.type === 'tool_request');
        const toolRespIndex = events.findIndex(e => e.type === 'tool_response');

        expect(toolRespIndex).toBe(toolReqIndex + 1);
      });
    });

    describe('edge cases', () => {
      it('should handle empty messages array', () => {
        const state = createMockState([]);

        const events = normalizer.normalize(state, sessionId);

        expect(events).toHaveLength(0);
      });

      it('should handle no AI messages', () => {
        const state = createMockState([
          createMockMessage('User message', 'human'),
          createMockMessage('Tool result', 'tool'),
        ]);

        const events = normalizer.normalize(state, sessionId);

        expect(events).toHaveLength(0);
      });

      it('should handle missing toolExecutions', () => {
        const state = createMockState(
          [
            createMockMessage([
              { type: 'tool_use', id: 'toolu_orphan', name: 'test', input: {} },
            ]),
          ],
          [] // No tool executions
        );

        const events = normalizer.normalize(state, sessionId);

        const toolRequest = events.find(e => e.type === 'tool_request');
        const toolResponse = events.find(e => e.type === 'tool_response');

        expect(toolRequest).toBeDefined();
        expect(toolResponse).toBeUndefined(); // No response without execution
      });

      it('should handle undefined messages', () => {
        const state = {
          messages: undefined,
          toolExecutions: [],
        } as unknown as AgentState;

        const events = normalizer.normalize(state, sessionId);

        expect(events).toHaveLength(0);
      });

      it('should handle undefined toolExecutions', () => {
        const state = {
          messages: [createMockMessage('Test')],
          toolExecutions: undefined,
        } as unknown as AgentState;

        const events = normalizer.normalize(state, sessionId);

        expect(events.length).toBeGreaterThan(0);
      });
    });

    describe('complete event', () => {
      it('should include complete event when option is set', () => {
        const state = createMockState([
          createMockMessage('Response'),
        ]);

        const events = normalizer.normalize(state, sessionId, { includeComplete: true });

        const completeEvent = events.find(e => e.type === 'complete');
        expect(completeEvent).toBeDefined();
        expect(completeEvent?.persistenceStrategy).toBe('transient');
      });

      it('should not include complete event by default', () => {
        const state = createMockState([
          createMockMessage('Response'),
        ]);

        const events = normalizer.normalize(state, sessionId);

        const completeEvent = events.find(e => e.type === 'complete');
        expect(completeEvent).toBeUndefined();
      });
    });
  });

  describe('sorting', () => {
    it('should sort events by originalIndex', () => {
      const state = createMockState([
        createMockMessage([
          { type: 'thinking', thinking: 'Think' },
          { type: 'tool_use', id: 't1', name: 'test', input: {} },
          { type: 'text', text: 'Response' },
        ]),
      ], [
        { toolUseId: 't1', toolName: 'test', success: true, result: 'OK' },
      ]);

      const events = normalizer.normalize(state, sessionId);

      // Verify events are sorted
      for (let i = 1; i < events.length; i++) {
        expect(events[i].originalIndex).toBeGreaterThanOrEqual(events[i - 1].originalIndex);
      }
    });
  });
});
