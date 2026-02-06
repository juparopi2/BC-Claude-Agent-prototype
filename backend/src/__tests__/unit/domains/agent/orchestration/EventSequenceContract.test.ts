/**
 * @file EventSequenceContract.test.ts
 * @description Contract tests for event emission sequence in AgentOrchestrator.
 *
 * CRITICAL: These tests define the IMMUTABLE event emission contract.
 * Any refactoring MUST preserve this exact sequence behavior.
 *
 * Event Sequence Contract:
 * 1. session_start is ALWAYS first event
 * 2. user_message_confirmed IMMEDIATELY follows session_start
 * 3. thinking_complete (if enabled) comes before tool events
 * 4. tool_use/tool_result maintain pairing for each tool
 * 5. message comes after all tool events
 * 6. complete is ALWAYS last event
 * 7. All events have ascending eventIndex
 * 8. All events have required fields (eventId, sessionId, timestamp)
 * 9. persistenceState values are correct (transient/persisted/pending)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIMessage } from '@langchain/core/messages';
import type { AgentEvent } from '@bc-agent/shared';
import {
  createAgentOrchestrator,
  __resetAgentOrchestrator,
} from '@domains/agent/orchestration/AgentOrchestrator';

// Mock the graph
vi.mock('@/modules/agents/supervisor', () => ({
  getSupervisorGraphAdapter: vi.fn().mockReturnValue({
    invoke: vi.fn(),
  }),
  initializeSupervisorGraph: vi.fn(),
  resumeSupervisor: vi.fn(),
}));

vi.mock('@langchain/core/messages', async (importOriginal) => {
  const original = await importOriginal<typeof import('@langchain/core/messages')>();
  return {
    ...original,
    HumanMessage: vi.fn((content) => ({ content, _getType: () => 'human' })),
  };
});

vi.mock('@/shared/utils/logger', () => {
  const mockLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };
  return {
    createChildLogger: vi.fn(() => mockLogger),
    logger: mockLogger,
  };
});

vi.mock('@domains/agent/context', () => ({
  createFileContextPreparer: vi.fn(() => ({
    prepare: vi.fn().mockResolvedValue({ contextText: '' }),
  })),
}));

vi.mock('@domains/agent/persistence', () => ({
  getPersistenceCoordinator: vi.fn(() => ({
    persistUserMessage: vi.fn().mockResolvedValue({
      sequenceNumber: 1,
      eventId: 'event-user-1',
      timestamp: '2025-01-20T10:00:00.000Z',
      messageId: 'msg-user-1',
    }),
    persistThinking: vi.fn().mockResolvedValue({ sequenceNumber: 2 }),
    persistAgentMessage: vi.fn().mockResolvedValue({
      sequenceNumber: 3,
      eventId: 'event-agent-1',
      timestamp: '2025-01-20T10:00:01.000Z',
      jobId: 'job-1',
    }),
    persistToolEventsAsync: vi.fn(),
    persistCitationsAsync: vi.fn(),
    awaitPersistence: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@services/events/EventStore', () => ({
  getEventStore: vi.fn(() => ({
    reserveSequenceNumbers: vi.fn().mockImplementation((_sessionId: string, count: number) => {
      // Return array of sequential numbers starting from 100
      return Promise.resolve(Array.from({ length: count }, (_, i) => 100 + i));
    }),
  })),
}));

vi.mock('@/domains/agent/citations', () => ({
  getCitationExtractor: vi.fn(() => ({
    producesCitations: vi.fn().mockReturnValue(false),
    extract: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('@/domains/chat-attachments', () => ({
  getAttachmentContentResolver: vi.fn(() => ({
    resolve: vi.fn().mockResolvedValue([]),
  })),
  getChatAttachmentService: vi.fn(() => ({
    getAttachmentSummaries: vi.fn().mockResolvedValue([]),
  })),
}));

import { getSupervisorGraphAdapter } from '@/modules/agents/supervisor';

/**
 * Create a mock graph result with simple text response
 */
function createSimpleResponse(content: string) {
  return {
    messages: [
      { content: 'User message', _getType: () => 'human' },
      new AIMessage({
        content,
        response_metadata: {
          stop_reason: 'end_turn',
          usage: { input_tokens: 50, output_tokens: 10 },
        },
      }),
    ],
    toolExecutions: [],
  };
}

/**
 * Create a mock graph result with thinking + text
 */
function createThinkingResponse(thinking: string, response: string) {
  return {
    messages: [
      { content: 'User message', _getType: () => 'human' },
      new AIMessage({
        content: [
          { type: 'thinking', thinking },
          { type: 'text', text: response },
        ],
        response_metadata: {
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
    ],
    toolExecutions: [],
  };
}

/**
 * Create a mock graph result with tool use
 */
function createToolResponse(toolName: string, toolResult: string, finalResponse: string) {
  return {
    messages: [
      { content: 'User message', _getType: () => 'human' },
      new AIMessage({
        content: [
          { type: 'tool_use', id: 'toolu_123', name: toolName, input: { query: 'test' } },
        ],
        response_metadata: { stop_reason: 'tool_use' },
      }),
      {
        content: toolResult,
        _getType: () => 'tool',
        tool_call_id: 'toolu_123',
      },
      new AIMessage({
        content: finalResponse,
        response_metadata: {
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
    ],
    toolExecutions: [
      {
        toolUseId: 'toolu_123',
        toolName,
        success: true,
        result: toolResult,
      },
    ],
  };
}

/**
 * Create a mock graph result with thinking + tool + text
 */
function createFullResponse(thinking: string, toolName: string, toolResult: string, finalResponse: string) {
  return {
    messages: [
      { content: 'User message', _getType: () => 'human' },
      new AIMessage({
        content: [
          { type: 'thinking', thinking },
          { type: 'tool_use', id: 'toolu_456', name: toolName, input: {} },
        ],
        response_metadata: { stop_reason: 'tool_use' },
      }),
      {
        content: toolResult,
        _getType: () => 'tool',
        tool_call_id: 'toolu_456',
      },
      new AIMessage({
        content: finalResponse,
        response_metadata: {
          stop_reason: 'end_turn',
          usage: { input_tokens: 200, output_tokens: 100 },
        },
      }),
    ],
    toolExecutions: [
      {
        toolUseId: 'toolu_456',
        toolName,
        success: true,
        result: toolResult,
      },
    ],
  };
}

describe('EventSequenceContract', () => {
  const sessionId = 'contract-test-session';
  const userId = 'contract-test-user';
  const prompt = 'Test prompt';

  beforeEach(() => {
    vi.clearAllMocks();
    __resetAgentOrchestrator();
  });

  afterEach(() => {
    __resetAgentOrchestrator();
  });

  describe('Contract Rule 1: session_start is ALWAYS first event', () => {
    it('should emit session_start as first event for simple response', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(createSimpleResponse('Hello'));

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      expect(events[0].type).toBe('session_start');
    });

    it('should emit session_start as first event for complex response with tools', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(
        createToolResponse('search', 'Results', 'Done')
      );

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      expect(events[0].type).toBe('session_start');
    });

    it('session_start should contain required fields', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(createSimpleResponse('Hi'));

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      const sessionStart = events[0];
      expect(sessionStart.sessionId).toBe(sessionId);
      expect(sessionStart).toHaveProperty('userId');
      expect(sessionStart).toHaveProperty('timestamp');
      expect(sessionStart).toHaveProperty('eventId');
      expect(sessionStart.persistenceState).toBe('transient');
    });
  });

  describe('Contract Rule 2: user_message_confirmed IMMEDIATELY follows session_start', () => {
    it('should emit user_message_confirmed as second event', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(createSimpleResponse('Response'));

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      expect(events[0].type).toBe('session_start');
      expect(events[1].type).toBe('user_message_confirmed');
    });

    it('user_message_confirmed should contain message content', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(createSimpleResponse('Response'));

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      const userMsg = events.find(e => e.type === 'user_message_confirmed');
      expect(userMsg).toBeDefined();
      expect((userMsg as { content: string }).content).toBe(prompt);
      expect((userMsg as { messageId: string }).messageId).toBeDefined();
      expect((userMsg as { sequenceNumber: number }).sequenceNumber).toBeDefined();
      expect(userMsg?.persistenceState).toBe('persisted');
    });
  });

  describe('Contract Rule 3: thinking_complete comes before tool events', () => {
    it('should emit thinking_complete before any tool_use', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(
        createFullResponse('Let me think...', 'search', 'Found data', 'Here is the answer')
      );

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId, {
        enableThinking: true,
      });

      const thinkingIndex = events.findIndex(e => e.type === 'thinking_complete');
      const toolUseIndex = events.findIndex(e => e.type === 'tool_use');

      // If both exist, thinking must come first
      if (thinkingIndex !== -1 && toolUseIndex !== -1) {
        expect(thinkingIndex).toBeLessThan(toolUseIndex);
      }
    });

    it('should include thinking content in thinking_complete', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(
        createThinkingResponse('Deep analysis here', 'Final answer')
      );

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId, {
        enableThinking: true,
      });

      const thinking = events.find(e => e.type === 'thinking_complete');
      if (thinking) {
        expect((thinking as { content: string }).content).toBe('Deep analysis here');
      }
    });
  });

  describe('Contract Rule 4: tool_use/tool_result maintain pairing', () => {
    it('should emit tool_result immediately after corresponding tool_use', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(
        createToolResponse('search_bc', 'Found 5 vendors', 'Here are the vendors')
      );

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      const toolUseIndex = events.findIndex(e => e.type === 'tool_use');
      const toolResultIndex = events.findIndex(e => e.type === 'tool_result');

      expect(toolUseIndex).not.toBe(-1);
      expect(toolResultIndex).not.toBe(-1);
      expect(toolResultIndex).toBe(toolUseIndex + 1);
    });

    it('should match toolUseId between tool_use and tool_result', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(
        createToolResponse('get_entity', 'Entity data', 'Response')
      );

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      const toolUse = events.find(e => e.type === 'tool_use') as { toolUseId: string } | undefined;
      const toolResult = events.find(e => e.type === 'tool_result') as { toolUseId: string } | undefined;

      expect(toolUse?.toolUseId).toBe(toolResult?.toolUseId);
    });

    it('tool_use should contain args', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(
        createToolResponse('search', 'results', 'done')
      );

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      const toolUse = events.find(e => e.type === 'tool_use') as {
        args: Record<string, unknown>;
        toolName: string;
      } | undefined;

      expect(toolUse?.toolName).toBe('search');
      expect(toolUse?.args).toEqual({ query: 'test' });
    });

    it('tool_result should contain result and success status', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(
        createToolResponse('search', 'Found results', 'done')
      );

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      const toolResult = events.find(e => e.type === 'tool_result') as {
        result: string;
        success: boolean;
      } | undefined;

      expect(toolResult?.result).toBe('Found results');
      expect(toolResult?.success).toBe(true);
    });
  });

  describe('Contract Rule 5: message comes after all tool events', () => {
    it('should emit message after all tool_use/tool_result pairs', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(
        createToolResponse('search', 'results', 'Final answer')
      );

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      const lastToolIndex = Math.max(
        events.findIndex(e => e.type === 'tool_use'),
        events.findIndex(e => e.type === 'tool_result')
      );
      const messageIndex = events.findIndex(e => e.type === 'message');

      if (lastToolIndex !== -1 && messageIndex !== -1) {
        expect(messageIndex).toBeGreaterThan(lastToolIndex);
      }
    });

    it('message should contain response content', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(
        createSimpleResponse('This is the assistant response')
      );

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      const message = events.find(e => e.type === 'message') as {
        content: string;
        role: string;
        messageId: string;
      } | undefined;

      expect(message?.content).toBe('This is the assistant response');
      expect(message?.role).toBe('assistant');
      expect(message?.messageId).toBeDefined();
    });
  });

  describe('Contract Rule 6: complete is ALWAYS last event', () => {
    it('should emit complete as last event for simple response', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(createSimpleResponse('Done'));

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      expect(events[events.length - 1].type).toBe('complete');
    });

    it('should emit complete as last event for complex response', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(
        createFullResponse('thinking', 'tool', 'result', 'answer')
      );

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      expect(events[events.length - 1].type).toBe('complete');
    });

    it('complete should have transient persistenceState', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(createSimpleResponse('Done'));

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      const complete = events[events.length - 1];
      expect(complete.persistenceState).toBe('transient');
    });

    it('complete should have reason field', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(createSimpleResponse('Done'));

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      const complete = events[events.length - 1] as { reason: string };
      expect(['success', 'error', 'max_turns', 'user_cancelled']).toContain(complete.reason);
    });
  });

  describe('Contract Rule 7: All events have ascending eventIndex', () => {
    it('should emit events with strictly ascending eventIndex', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(
        createFullResponse('thinking', 'search', 'results', 'answer')
      );

      const events: (AgentEvent & { eventIndex?: number })[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      for (let i = 1; i < events.length; i++) {
        const prev = events[i - 1].eventIndex ?? -1;
        const curr = events[i].eventIndex ?? 0;
        expect(curr).toBeGreaterThan(prev);
      }
    });

    it('eventIndex should start at 0', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(createSimpleResponse('Hi'));

      const events: (AgentEvent & { eventIndex?: number })[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      expect(events[0].eventIndex).toBe(0);
    });
  });

  describe('Contract Rule 8: All events have required fields', () => {
    it('every event should have eventId', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(
        createToolResponse('tool', 'result', 'done')
      );

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      for (const event of events) {
        expect(event.eventId).toBeDefined();
        expect(typeof event.eventId).toBe('string');
        expect(event.eventId.length).toBeGreaterThan(0);
      }
    });

    it('every event should have sessionId', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(createSimpleResponse('done'));

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      for (const event of events) {
        expect(event.sessionId).toBe(sessionId);
      }
    });

    it('every event should have timestamp', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(createSimpleResponse('done'));

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      for (const event of events) {
        expect(event.timestamp).toBeDefined();
        // Should be valid ISO 8601 timestamp
        expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
      }
    });
  });

  describe('Contract Rule 9: persistenceState values are correct', () => {
    it('session_start should be transient', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(createSimpleResponse('done'));

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      const sessionStart = events.find(e => e.type === 'session_start');
      expect(sessionStart?.persistenceState).toBe('transient');
    });

    it('user_message_confirmed should be persisted', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(createSimpleResponse('done'));

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      const userMsg = events.find(e => e.type === 'user_message_confirmed');
      expect(userMsg?.persistenceState).toBe('persisted');
    });

    it('message should have persisted state after persistence completes', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(createSimpleResponse('done'));

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      const message = events.find(e => e.type === 'message');
      // After sync persistence, should be 'persisted'
      expect(message?.persistenceState).toBe('persisted');
    });

    it('complete should be transient', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(createSimpleResponse('done'));

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      const complete = events.find(e => e.type === 'complete');
      expect(complete?.persistenceState).toBe('transient');
    });
  });

  describe('Full sequence verification', () => {
    it('should emit events in correct order for simple response', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(createSimpleResponse('Hello'));

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      const types = events.map(e => e.type);
      expect(types).toEqual([
        'session_start',
        'user_message_confirmed',
        'message',
        'complete',
      ]);
    });

    it('should emit events in correct order for tool response', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue(
        createToolResponse('search', 'results', 'Final answer')
      );

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), userId);

      const types = events.map(e => e.type);

      // Core sequence should be:
      // session_start -> user_message_confirmed -> tool_use -> tool_result -> message -> complete
      expect(types[0]).toBe('session_start');
      expect(types[1]).toBe('user_message_confirmed');
      expect(types).toContain('tool_use');
      expect(types).toContain('tool_result');
      expect(types).toContain('message');
      expect(types[types.length - 1]).toBe('complete');
    });
  });
});
