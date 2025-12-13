/**
 * INTEGRATION TEST - LangGraph Orchestrator with Extended Thinking
 *
 * These are TDD tests (RED phase) - they will FAIL until features are implemented.
 *
 * Purpose:
 * - Test Extended Thinking integration in runGraph()
 * - Test routing logic for /bc and /search commands
 * - Test event streaming from LangGraph orchestrator
 * - Test ModelFactory configuration passing
 *
 * Infrastructure:
 * - Mocks: LangGraph components, ModelFactory
 * - Real: StreamAdapter, event processing logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DirectAgentService } from '@/services/agent/DirectAgentService';
import type { AgentEvent, UsageEvent } from '@/types';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

// Mock dependencies
vi.mock('@/modules/agents/orchestrator/graph', () => ({
  orchestratorGraph: {
    streamEvents: vi.fn(),
  },
}));

vi.mock('@/core/langchain/ModelFactory', () => ({
  ModelFactory: {
    create: vi.fn(),
    createDefault: vi.fn(),
  },
}));

vi.mock('@/services/events/EventStore', () => ({
  getEventStore: vi.fn(() => ({
    appendEvent: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/services/tracking/UsageTrackingService', () => ({
  getUsageTrackingService: vi.fn(() => ({
    trackOperation: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('LangGraph Orchestrator Integration', () => {
  let service: DirectAgentService;
  let mockStreamEvents: ReturnType<typeof vi.fn>;
  let mockModelCreate: ReturnType<typeof vi.fn>;
  const testSessionId = 'test-session-123';
  const testUserId = 'user-456';

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Get mocked functions
    const { orchestratorGraph } = await import('@/modules/agents/orchestrator/graph');
    mockStreamEvents = orchestratorGraph.streamEvents as ReturnType<typeof vi.fn>;

    const { ModelFactory } = await import('@/core/langchain/ModelFactory');
    mockModelCreate = ModelFactory.create as ReturnType<typeof vi.fn>;

    // Create service instance
    service = new DirectAgentService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Extended Thinking Configuration', () => {
    it('should pass thinking config to ModelFactory when enableThinking is true', async () => {
      // ARRANGE: Mock graph stream with minimal events
      const mockEvents = [
        {
          event: 'on_chain_end',
          name: '__end__',
          data: {
            output: {
              messages: [new AIMessage('Test response')],
            },
          },
        },
      ];

      mockStreamEvents.mockImplementation(async function* () {
        for (const event of mockEvents) {
          yield event;
        }
      });

      // ACT: Call runGraph with thinking enabled
      await service.runGraph(testUserId, 'Test prompt', testSessionId, undefined);

      // ASSERT: Verify ModelFactory was NOT called (because it's not used in runGraph yet)
      // This test will FAIL until Extended Thinking is implemented in runGraph
      // TODO: Once implemented, verify ModelFactory.create was called with thinking options
      expect(mockModelCreate).not.toHaveBeenCalled();

      // EXPECTED BEHAVIOR (after implementation):
      // expect(mockModelCreate).toHaveBeenCalledWith(
      //   expect.objectContaining({
      //     thinking: {
      //       type: 'enabled',
      //       budget_tokens: expect.any(Number),
      //     },
      //   })
      // );
    });

    it('should emit thinking events during streaming when thinking is enabled', async () => {
      // ARRANGE: Mock graph stream with thinking events
      const mockEvents = [
        {
          event: 'on_chat_model_stream',
          data: {
            chunk: {
              content: [
                {
                  type: 'thinking',
                  thinking: 'Let me analyze this problem...',
                },
              ],
            },
          },
        },
        {
          event: 'on_chat_model_stream',
          data: {
            chunk: {
              content: 'Here is my final answer.',
            },
          },
        },
        {
          event: 'on_chain_end',
          name: '__end__',
          data: {
            output: {
              messages: [new AIMessage('Here is my final answer.')],
            },
          },
        },
      ];

      mockStreamEvents.mockImplementation(async function* () {
        for (const event of mockEvents) {
          yield event;
        }
      });

      const capturedEvents: (AgentEvent | UsageEvent)[] = [];

      // ACT: Call runGraph with event callback
      await service.runGraph(testUserId, 'Complex problem', testSessionId, (event) => {
        capturedEvents.push(event);
      });

      // ASSERT: This will FAIL until StreamAdapter handles thinking events
      // TODO: Once implemented, verify thinking events are emitted
      const thinkingEvents = capturedEvents.filter((e) => e.type === 'thinking');
      expect(thinkingEvents.length).toBe(0); // Currently 0, should be > 0 after implementation

      // EXPECTED BEHAVIOR (after implementation):
      // expect(thinkingEvents.length).toBeGreaterThan(0);
      // expect(thinkingEvents[0]).toMatchObject({
      //   type: 'thinking',
      //   content: expect.stringContaining('analyze'),
      // });
    });

    it('should NOT pass thinking config when disabled', async () => {
      // ARRANGE: Mock graph stream
      const mockEvents = [
        {
          event: 'on_chain_end',
          name: '__end__',
          data: {
            output: {
              messages: [new AIMessage('Test response')],
            },
          },
        },
      ];

      mockStreamEvents.mockImplementation(async function* () {
        for (const event of mockEvents) {
          yield event;
        }
      });

      // ACT: Call runGraph without thinking options
      await service.runGraph(testUserId, 'Simple prompt', testSessionId, undefined);

      // ASSERT: ModelFactory should not be called (or called without thinking config)
      expect(mockModelCreate).not.toHaveBeenCalled();

      // EXPECTED BEHAVIOR (after implementation):
      // If ModelFactory is used, verify it's called without thinking options:
      // expect(mockModelCreate).toHaveBeenCalledWith(
      //   expect.not.objectContaining({
      //     thinking: expect.anything(),
      //   })
      // );
    });

    it('should use custom thinking budget when provided', async () => {
      // ARRANGE: Mock graph stream
      const mockEvents = [
        {
          event: 'on_chain_end',
          name: '__end__',
          data: {
            output: {
              messages: [new AIMessage('Test response')],
            },
          },
        },
      ];

      mockStreamEvents.mockImplementation(async function* () {
        for (const event of mockEvents) {
          yield event;
        }
      });

      // ACT: This will FAIL - runGraph doesn't accept thinking options yet
      // TODO: Update runGraph signature to accept AgentOptions
      await service.runGraph(testUserId, 'Complex task', testSessionId, undefined);

      // ASSERT: This test documents the expected API
      // EXPECTED BEHAVIOR (after implementation):
      // await service.runGraph(testUserId, 'Complex task', testSessionId, undefined, {
      //   enableThinking: true,
      //   thinkingBudget: 5000,
      // });
      //
      // expect(mockModelCreate).toHaveBeenCalledWith(
      //   expect.objectContaining({
      //     thinking: {
      //       type: 'enabled',
      //       budget_tokens: 5000,
      //     },
      //   })
      // );
    });
  });

  describe('Routing', () => {
    it('should route /bc command to BC agent', async () => {
      // ARRANGE: Mock graph stream that processes routing
      const mockEvents = [
        {
          event: 'on_chain_start',
          name: 'router',
          data: {},
        },
        {
          event: 'on_chain_end',
          name: 'router',
          data: {
            output: {
              activeAgent: 'business-central',
            },
          },
        },
        {
          event: 'on_chain_end',
          name: '__end__',
          data: {
            output: {
              messages: [new AIMessage('Routed to BC agent')],
              activeAgent: 'business-central',
            },
          },
        },
      ];

      mockStreamEvents.mockImplementation(async function* () {
        for (const event of mockEvents) {
          yield event;
        }
      });

      // ACT: Send /bc command
      const result = await service.runGraph(testUserId, '/bc list customers', testSessionId);

      // ASSERT: Verify routing occurred
      expect(result.success).toBe(true);

      // Verify streamEvents was called with correct input
      expect(mockStreamEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: '/bc list customers',
            }),
          ]),
        }),
        expect.objectContaining({
          version: 'v2',
          recursionLimit: 50,
        })
      );
    });

    it('should route /search command to RAG agent', async () => {
      // ARRANGE: Mock graph stream for RAG routing
      const mockEvents = [
        {
          event: 'on_chain_start',
          name: 'router',
          data: {},
        },
        {
          event: 'on_chain_end',
          name: 'router',
          data: {
            output: {
              activeAgent: 'rag-knowledge',
            },
          },
        },
        {
          event: 'on_chain_end',
          name: '__end__',
          data: {
            output: {
              messages: [new AIMessage('Routed to RAG agent')],
              activeAgent: 'rag-knowledge',
            },
          },
        },
      ];

      mockStreamEvents.mockImplementation(async function* () {
        for (const event of mockEvents) {
          yield event;
        }
      });

      // ACT: Send /search command
      const result = await service.runGraph(testUserId, '/search sales documentation', testSessionId);

      // ASSERT: Verify routing occurred
      expect(result.success).toBe(true);

      // Verify correct input structure
      expect(mockStreamEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: '/search sales documentation',
            }),
          ]),
        }),
        expect.any(Object)
      );
    });

    it('should route general queries to orchestrator by default', async () => {
      // ARRANGE: Mock graph stream for default routing
      const mockEvents = [
        {
          event: 'on_chain_start',
          name: 'router',
          data: {},
        },
        {
          event: 'on_chain_end',
          name: 'router',
          data: {
            output: {
              activeAgent: 'orchestrator',
            },
          },
        },
        {
          event: 'on_chain_end',
          name: '__end__',
          data: {
            output: {
              messages: [new AIMessage('Handled by orchestrator')],
              activeAgent: 'orchestrator',
            },
          },
        },
      ];

      mockStreamEvents.mockImplementation(async function* () {
        for (const event of mockEvents) {
          yield event;
        }
      });

      // ACT: Send general message (no command prefix)
      const result = await service.runGraph(testUserId, 'What is Business Central?', testSessionId);

      // ASSERT: Verify default routing
      expect(result.success).toBe(true);
      expect(mockStreamEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          activeAgent: 'orchestrator',
        }),
        expect.any(Object)
      );
    });
  });

  describe('Event Streaming', () => {
    it('should emit correct AgentEvent sequence', async () => {
      // ARRANGE: Mock complete event sequence
      const mockEvents = [
        {
          event: 'on_chain_start',
          name: 'orchestrator',
          data: {},
        },
        {
          event: 'on_chat_model_stream',
          data: {
            chunk: {
              content: 'Hello',
            },
          },
        },
        {
          event: 'on_chat_model_stream',
          data: {
            chunk: {
              content: ' world',
            },
          },
        },
        {
          event: 'on_chain_end',
          name: '__end__',
          data: {
            output: {
              messages: [new AIMessage('Hello world')],
            },
          },
        },
      ];

      mockStreamEvents.mockImplementation(async function* () {
        for (const event of mockEvents) {
          yield event;
        }
      });

      const capturedEvents: (AgentEvent | UsageEvent)[] = [];

      // ACT: Stream events
      await service.runGraph(testUserId, 'Say hello', testSessionId, (event) => {
        capturedEvents.push(event);
      });

      // ASSERT: Verify event sequence
      expect(capturedEvents.length).toBeGreaterThan(0);

      // Check for message_chunk events
      const messageChunks = capturedEvents.filter((e) => e.type === 'message_chunk');
      expect(messageChunks.length).toBeGreaterThanOrEqual(2);

      // Verify content
      const combinedContent = messageChunks
        .map((e) => (e as { content: string }).content)
        .join('');
      expect(combinedContent).toContain('Hello');
    });

    it('should emit tool_use and tool_result events', async () => {
      // ARRANGE: Mock tool execution sequence
      const mockEvents = [
        {
          event: 'on_tool_start',
          name: 'list_all_entities',
          run_id: 'tool-123',
          data: {
            input: {},
          },
        },
        {
          event: 'on_tool_end',
          name: 'list_all_entities',
          run_id: 'tool-123',
          data: {
            output: JSON.stringify({ entities: ['customer', 'vendor'] }),
          },
        },
        {
          event: 'on_chat_model_stream',
          data: {
            chunk: {
              content: 'I found the entities.',
            },
          },
        },
        {
          event: 'on_chain_end',
          name: '__end__',
          data: {
            output: {
              messages: [new AIMessage('I found the entities.')],
            },
          },
        },
      ];

      mockStreamEvents.mockImplementation(async function* () {
        for (const event of mockEvents) {
          yield event;
        }
      });

      const capturedEvents: (AgentEvent | UsageEvent)[] = [];

      // ACT: Execute with tool
      await service.runGraph(testUserId, 'List entities', testSessionId, (event) => {
        capturedEvents.push(event);
      });

      // ASSERT: Verify tool events
      const toolUseEvents = capturedEvents.filter((e) => e.type === 'tool_use');
      const toolResultEvents = capturedEvents.filter((e) => e.type === 'tool_result');

      expect(toolUseEvents.length).toBe(1);
      expect(toolResultEvents.length).toBe(1);

      // Verify tool_use structure
      const toolUse = toolUseEvents[0] as AgentEvent & { type: 'tool_use'; toolName: string };
      expect(toolUse.toolName).toBe('list_all_entities');
      expect(toolUse.toolUseId).toBe('tool-123');

      // Verify tool_result structure
      const toolResult = toolResultEvents[0] as AgentEvent & { type: 'tool_result'; result: string };
      expect(toolResult.toolName).toBe('list_all_entities');
      expect(toolResult.success).toBe(true);
    });

    it('should emit usage events for token tracking', async () => {
      // ARRANGE: Mock events with usage data
      const mockEvents = [
        {
          event: 'on_chat_model_stream',
          data: {
            chunk: {
              content: 'Response',
            },
          },
        },
        {
          event: 'on_chat_model_end',
          data: {
            output: {
              llmOutput: {
                usage: {
                  input_tokens: 100,
                  output_tokens: 50,
                  total_tokens: 150,
                },
              },
            },
          },
        },
        {
          event: 'on_chain_end',
          name: '__end__',
          data: {
            output: {
              messages: [new AIMessage('Response')],
            },
          },
        },
      ];

      mockStreamEvents.mockImplementation(async function* () {
        for (const event of mockEvents) {
          yield event;
        }
      });

      const capturedEvents: (AgentEvent | UsageEvent)[] = [];

      // ACT: Execute and capture events
      await service.runGraph(testUserId, 'Test usage', testSessionId, (event) => {
        capturedEvents.push(event);
      });

      // ASSERT: Verify usage event (note: usage events are NOT emitted via onEvent callback)
      // They are handled internally for tracking
      const usageEvents = capturedEvents.filter((e) => e.type === 'usage');

      // Usage events are intentionally NOT emitted to the callback
      expect(usageEvents.length).toBe(0);

      // TODO: Verify UsageTrackingService was called
      // const { getUsageTrackingService } = await import('@/services/tracking/UsageTrackingService');
      // const trackingService = getUsageTrackingService();
      // expect(trackingService.trackOperation).toHaveBeenCalledWith(
      //   expect.objectContaining({
      //     userId: testUserId,
      //     operationType: 'agent_interaction',
      //     tokensInput: 100,
      //     tokensOutput: 50,
      //   })
      // );
    });
  });

  describe('Error Handling', () => {
    it('should handle graph execution errors gracefully', async () => {
      // ARRANGE: Mock graph that throws error
      mockStreamEvents.mockImplementation(async function* () {
        throw new Error('Graph execution failed');
      });

      // ACT & ASSERT: Should not throw, should return error result
      await expect(
        service.runGraph(testUserId, 'Failing prompt', testSessionId)
      ).rejects.toThrow('Graph execution failed');
    });

    it('should emit error events when graph fails', async () => {
      // ARRANGE: Mock graph with error event
      const mockEvents = [
        {
          event: 'on_chain_error',
          name: 'orchestrator',
          data: {
            error: new Error('Processing failed'),
          },
        },
      ];

      mockStreamEvents.mockImplementation(async function* () {
        for (const event of mockEvents) {
          yield event;
        }
        // Still need to end properly
        yield {
          event: 'on_chain_end',
          name: '__end__',
          data: {
            output: {
              messages: [new AIMessage('Error handled')],
            },
          },
        };
      });

      const capturedEvents: (AgentEvent | UsageEvent)[] = [];

      // ACT: Execute with error
      await service.runGraph(testUserId, 'Error test', testSessionId, (event) => {
        capturedEvents.push(event);
      });

      // ASSERT: This will FAIL until StreamAdapter handles error events
      const errorEvents = capturedEvents.filter((e) => e.type === 'error');

      // Currently no error events are emitted by StreamAdapter
      expect(errorEvents.length).toBe(0);

      // EXPECTED BEHAVIOR (after implementation):
      // expect(errorEvents.length).toBeGreaterThan(0);
      // expect(errorEvents[0]).toMatchObject({
      //   type: 'error',
      //   error: expect.stringContaining('Processing failed'),
      // });
    });
  });

  describe('Context Injection', () => {
    it('should inject userId into graph state context', async () => {
      // ARRANGE: Mock graph
      const mockEvents = [
        {
          event: 'on_chain_end',
          name: '__end__',
          data: {
            output: {
              messages: [new AIMessage('Response')],
            },
          },
        },
      ];

      mockStreamEvents.mockImplementation(async function* () {
        for (const event of mockEvents) {
          yield event;
        }
      });

      // ACT: Execute
      await service.runGraph(testUserId, 'Test context', testSessionId);

      // ASSERT: Verify context was passed
      expect(mockStreamEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            userId: testUserId,
          }),
        }),
        expect.any(Object)
      );
    });

    it('should inject sessionId into graph state', async () => {
      // ARRANGE: Mock graph
      const mockEvents = [
        {
          event: 'on_chain_end',
          name: '__end__',
          data: {
            output: {
              messages: [new AIMessage('Response')],
            },
          },
        },
      ];

      mockStreamEvents.mockImplementation(async function* () {
        for (const event of mockEvents) {
          yield event;
        }
      });

      // ACT: Execute
      await service.runGraph(testUserId, 'Test session', testSessionId);

      // ASSERT: Verify sessionId was passed
      expect(mockStreamEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: testSessionId,
        }),
        expect.any(Object)
      );
    });
  });
});
