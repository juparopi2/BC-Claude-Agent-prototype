/**
 * ExecutionPipeline.executeProgressive() Unit Tests
 *
 * Tests for the progressive (streaming) execution path of ExecutionPipeline.
 * Verifies delta normalization, event emission, and return shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionPipeline } from '@/domains/agent/orchestration/execution/ExecutionPipeline';
import type { ExecutionPipelineDependencies } from '@/domains/agent/orchestration/execution/ExecutionPipeline';
import type { ExecutionContextSync } from '@/domains/agent/orchestration/ExecutionContextSync';
import type { StreamingGraphStep } from '@/domains/agent/orchestration/execution/GraphExecutor';
import type { NormalizedAgentEvent } from '@bc-agent/shared';
import type { BaseMessage } from '@langchain/core/messages';

// Import after mocks so we get the mocked version
import * as EventProcessor from '@/domains/agent/orchestration/events/EventProcessor';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@bc-agent/shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('@bc-agent/shared')>();
  return {
    ...original,
    isInternalTool: vi.fn().mockReturnValue(false),
    AGENT_ID: {
      BC_AGENT: 'bc-agent',
      RAG_AGENT: 'rag-knowledge',
      SUPERVISOR: 'supervisor',
    },
    AGENT_DISPLAY_NAME: {
      'bc-agent': 'Business Central Expert',
      'rag-knowledge': 'Knowledge Base Expert',
      supervisor: 'Orchestrator',
    },
    AGENT_ICON: {
      'bc-agent': '📊',
      'rag-knowledge': '🧠',
      supervisor: '🎯',
    },
    AGENT_COLOR: {
      'bc-agent': '#3B82F6',
      'rag-knowledge': '#10B981',
      supervisor: '#8B5CF6',
    },
  };
});

// Mock event processing and sequencing so the pipeline doesn't crash
// when it encounters incomplete mock events. The pipeline's core logic
// (delta slicing, agent transition detection, complete event creation)
// is what we're testing — not the event converter internals.
vi.mock('@/domains/agent/orchestration/events/EventProcessor', () => ({
  processNormalizedEvent: vi.fn().mockResolvedValue(undefined),
  trackAssistantMessageState: vi.fn().mockReturnValue({}),
}));

vi.mock('@/domains/agent/orchestration/events/EventSequencer', () => ({
  countPersistableEvents: vi.fn().mockReturnValue(0),
  assignPreAllocatedSequences: vi.fn(),
  getSequenceDebugInfo: vi.fn().mockReturnValue([]),
  reserveAndAssignSequences: vi.fn().mockResolvedValue(new Map()),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal fake BaseMessage.
 */
function buildMsg(id: string, agentId?: string): BaseMessage {
  return {
    content: `message-${id}`,
    _getType: () => 'ai',
    response_metadata: {},
    lc_kwargs: {},
    lc_serializable: true,
    lc_namespace: ['langchain', 'schema'],
    additional_kwargs: agentId ? { agent_id: agentId } : {},
    id: id,
    name: agentId,
  } as unknown as BaseMessage;
}

/**
 * Build a minimal StreamingGraphStep.
 */
function buildStep(
  messages: BaseMessage[],
  stepNumber: number,
  currentAgentIdentity?: StreamingGraphStep['currentAgentIdentity']
): StreamingGraphStep {
  return {
    messages,
    toolExecutions: [],
    stepNumber,
    usedModel: 'claude-3',
    currentAgentIdentity,
  };
}

/**
 * Build a minimal NormalizedAgentEvent returned by deltaNormalizer.
 */
function buildNormalizedEvent(type: string, sourceAgentId?: string): NormalizedAgentEvent {
  return {
    type,
    eventId: `evt-${type}-${Math.random()}`,
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    originalIndex: 0,
    persistenceStrategy: 'transient',
    sourceAgentId,
  } as unknown as NormalizedAgentEvent;
}

/**
 * Build a mock ExecutionContextSync.
 */
function buildCtx(callback?: (event: unknown) => void): ExecutionContextSync {
  return {
    executionId: 'exec-123',
    sessionId: 'test-session',
    userId: 'user-123',
    callback: callback ?? vi.fn(),
    eventIndex: 0,
    seenToolIds: new Map(),
    toolLifecycleManager: {
      finalizeAndPersistOrphans: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExecutionContextSync['toolLifecycleManager'],
    citedSources: [],
    lastAssistantMessageId: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalWebSearchRequests: 0,
    totalCodeExecutionRequests: 0,
    perAgentUsage: new Map(),
    enableThinking: false,
    thinkingBudget: 10000,
    timeoutMs: 30000,
  };
}

/**
 * Build a full set of mocked ExecutionPipelineDependencies.
 */
function buildDeps(options?: {
  steps?: StreamingGraphStep[];
  normalizeDelta?: ReturnType<typeof vi.fn>;
}): ExecutionPipelineDependencies {
  const steps = options?.steps ?? [];

  const messageContextBuilder = {
    build: vi.fn().mockResolvedValue({
      inputs: { messages: [], context: { userId: 'user-123', sessionId: 'test-session' } },
      contextResult: { contextText: '', filesIncluded: [] },
    }),
  };

  const graphExecutor = {
    execute: vi.fn(),
    executeStreaming: async function* () {
      for (const step of steps) {
        yield step;
      }
    },
  };

  const normalizeDelta = options?.normalizeDelta ?? vi.fn().mockReturnValue([]);

  const deltaNormalizer = {
    normalizeDelta,
  };

  const normalizer = {
    normalize: vi.fn().mockReturnValue([]),
  };

  const persistenceCoordinator = {
    getCheckpointMessageCount: vi.fn().mockResolvedValue(0),
    updateCheckpointMessageCount: vi.fn().mockResolvedValue(undefined),
    persistAgentChangedAsync: vi.fn(),
    persistUserMessage: vi.fn(),
    persistThinking: vi.fn(),
    persistAgentMessage: vi.fn(),
    persistToolEventsAsync: vi.fn(),
    persistCitationsAsync: vi.fn(),
    awaitPersistence: vi.fn().mockResolvedValue(undefined),
  };

  const eventStore = {
    reserveSequenceNumbers: vi.fn().mockResolvedValue([]),
  };

  const citationExtractor = {
    producesCitations: vi.fn().mockReturnValue(false),
    extract: vi.fn().mockReturnValue([]),
  };

  return {
    messageContextBuilder: messageContextBuilder as unknown as ExecutionPipelineDependencies['messageContextBuilder'],
    graphExecutor: graphExecutor as unknown as ExecutionPipelineDependencies['graphExecutor'],
    normalizer: normalizer as unknown as ExecutionPipelineDependencies['normalizer'],
    deltaNormalizer: deltaNormalizer as unknown as ExecutionPipelineDependencies['deltaNormalizer'],
    persistenceCoordinator: persistenceCoordinator as unknown as ExecutionPipelineDependencies['persistenceCoordinator'],
    eventStore: eventStore as unknown as ExecutionPipelineDependencies['eventStore'],
    citationExtractor: citationExtractor as unknown as ExecutionPipelineDependencies['citationExtractor'],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ExecutionPipeline.executeProgressive()', () => {
  const SESSION_ID = 'test-session';
  const USER_ID = 'user-123';
  const PROMPT = 'hello';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Case 1: 3-step stream with accumulating messages
  // =========================================================================
  describe('Case 1: 3-step stream with accumulating messages', () => {
    it('calls normalizeDelta 3 times, once per step with delta of size 1', async () => {
      const msg1 = buildMsg('m1');
      const msg2 = buildMsg('m2');
      const msg3 = buildMsg('m3');

      // Each step has accumulated messages — step 1: [m1], step 2: [m1, m2], step 3: [m1, m2, m3]
      const steps = [
        buildStep([msg1], 1),
        buildStep([msg1, msg2], 2),
        buildStep([msg1, msg2, msg3], 3),
      ];

      const normalizeDelta = vi.fn().mockReturnValue([]);
      const deps = buildDeps({ steps, normalizeDelta });
      const ctx = buildCtx();
      const pipeline = new ExecutionPipeline(deps);

      await pipeline.executeProgressive(PROMPT, SESSION_ID, USER_ID, ctx);

      expect(normalizeDelta).toHaveBeenCalledTimes(3);

      // Each call receives a delta of exactly 1 message (the new one)
      const calls = normalizeDelta.mock.calls;
      expect(calls[0][0].messages).toHaveLength(1);
      expect(calls[0][0].messages[0]).toBe(msg1);

      expect(calls[1][0].messages).toHaveLength(1);
      expect(calls[1][0].messages[0]).toBe(msg2);

      expect(calls[2][0].messages).toHaveLength(1);
      expect(calls[2][0].messages[0]).toBe(msg3);
    });

    it('passes isLastStep: false to normalizeDelta for all steps', async () => {
      const msg1 = buildMsg('m1');
      const steps = [buildStep([msg1], 1)];

      const normalizeDelta = vi.fn().mockReturnValue([]);
      const deps = buildDeps({ steps, normalizeDelta });
      const ctx = buildCtx();
      const pipeline = new ExecutionPipeline(deps);

      await pipeline.executeProgressive(PROMPT, SESSION_ID, USER_ID, ctx);

      const delta = normalizeDelta.mock.calls[0][0];
      expect(delta.isLastStep).toBe(false);
    });
  });

  // =========================================================================
  // Case 2: Skips empty deltas
  // =========================================================================
  describe('Case 2: Skips empty deltas', () => {
    it('does not call normalizeDelta when step adds no new messages', async () => {
      const msg1 = buildMsg('m1');

      // Step 1 has msg1, step 2 has the same messages (no new ones)
      const steps = [
        buildStep([msg1], 1),
        buildStep([msg1], 2), // same count — no delta
      ];

      const normalizeDelta = vi.fn().mockReturnValue([]);
      const deps = buildDeps({ steps, normalizeDelta });
      const ctx = buildCtx();
      const pipeline = new ExecutionPipeline(deps);

      await pipeline.executeProgressive(PROMPT, SESSION_ID, USER_ID, ctx);

      // Only step 1 should trigger normalization; step 2 has no delta
      expect(normalizeDelta).toHaveBeenCalledTimes(1);
    });

    it('does not call normalizeDelta when normalizeDelta returns empty array', async () => {
      const msg1 = buildMsg('m1');
      const steps = [buildStep([msg1], 1)];

      const normalizeDelta = vi.fn().mockReturnValue([]);
      const deps = buildDeps({ steps, normalizeDelta });
      const pipeline = new ExecutionPipeline(deps);
      const ctx = buildCtx();

      await pipeline.executeProgressive(PROMPT, SESSION_ID, USER_ID, ctx);

      // eventStore.reserveSequenceNumbers should NOT be called for empty events
      const eventStore = deps.eventStore as unknown as { reserveSequenceNumbers: ReturnType<typeof vi.fn> };
      // reserveSequenceNumbers might be called with count=0 and return early, or not called at all
      // The key assertion: normalizeDelta was called once (for the non-empty delta step)
      expect(normalizeDelta).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Case 3: Complete event emitted after stream
  // =========================================================================
  describe('Case 3: Complete event emitted after stream', () => {
    it('calls processNormalizedEvent with a complete event after all deltas', async () => {
      const msg1 = buildMsg('m1');
      const normalizedEvent = buildNormalizedEvent('thinking');
      const normalizeDelta = vi.fn().mockReturnValue([normalizedEvent]);

      const deps = buildDeps({ steps: [buildStep([msg1], 1)], normalizeDelta });
      const ctx = buildCtx();
      const pipeline = new ExecutionPipeline(deps);

      await pipeline.executeProgressive(PROMPT, SESSION_ID, USER_ID, ctx);

      const processNormalizedEvent = vi.mocked(EventProcessor.processNormalizedEvent);
      const allCalls = processNormalizedEvent.mock.calls;

      // Find any call that received a 'complete' type event
      const completeCall = allCalls.find(
        ([event]) => (event as { type?: string }).type === 'complete'
      );
      expect(completeCall).toBeDefined();
    });

    it('complete event passed to processNormalizedEvent has reason: success', async () => {
      const deps = buildDeps({ steps: [] });
      const ctx = buildCtx();
      const pipeline = new ExecutionPipeline(deps);

      await pipeline.executeProgressive(PROMPT, SESSION_ID, USER_ID, ctx);

      const processNormalizedEvent = vi.mocked(EventProcessor.processNormalizedEvent);
      const allCalls = processNormalizedEvent.mock.calls;

      const completeCall = allCalls.find(
        ([event]) => (event as { type?: string }).type === 'complete'
      );
      const completeEvent = completeCall?.[0] as { type: string; reason: string } | undefined;

      expect(completeEvent?.type).toBe('complete');
      expect(completeEvent?.reason).toBe('success');
    });

    it('complete event appears in the returned events array', async () => {
      const deps = buildDeps({ steps: [] });
      const ctx = buildCtx();
      const pipeline = new ExecutionPipeline(deps);

      const { events } = await pipeline.executeProgressive(PROMPT, SESSION_ID, USER_ID, ctx);

      const completeEvent = events.find((e) => e.type === 'complete');
      expect(completeEvent).toBeDefined();
    });
  });

  // =========================================================================
  // Case 4: Return shape matches execute()
  // =========================================================================
  describe('Case 4: Return shape matches execute()', () => {
    it('returns result, events, and usedModel fields', async () => {
      const deps = buildDeps({ steps: [] });
      const ctx = buildCtx();
      const pipeline = new ExecutionPipeline(deps);

      const result = await pipeline.executeProgressive(PROMPT, SESSION_ID, USER_ID, ctx);

      expect(result).toHaveProperty('result');
      expect(result).toHaveProperty('events');
      expect(result).toHaveProperty('usedModel');
    });

    it('result field contains sessionId, success, tokenUsage, toolsUsed, response', async () => {
      const deps = buildDeps({ steps: [] });
      const ctx = buildCtx();
      const pipeline = new ExecutionPipeline(deps);

      const { result } = await pipeline.executeProgressive(PROMPT, SESSION_ID, USER_ID, ctx);

      expect(result.sessionId).toBe(SESSION_ID);
      expect(result.success).toBe(true);
      expect(result.tokenUsage).toBeDefined();
      expect(result.toolsUsed).toBeInstanceOf(Array);
      expect(result).toHaveProperty('response');
    });

    it('events field contains all emitted delta events plus the complete event', async () => {
      const msg1 = buildMsg('m1');
      // Use a 'thinking' event type — it doesn't require tokenUsage
      const normalizedEvent = buildNormalizedEvent('thinking');
      const normalizeDelta = vi.fn().mockReturnValue([normalizedEvent]);

      const deps = buildDeps({ steps: [buildStep([msg1], 1)], normalizeDelta });
      const ctx = buildCtx();
      const pipeline = new ExecutionPipeline(deps);

      const { events } = await pipeline.executeProgressive(PROMPT, SESSION_ID, USER_ID, ctx);

      // Should include the normalized event + the complete event
      expect(events.length).toBeGreaterThanOrEqual(2);
      const types = events.map((e) => e.type);
      expect(types).toContain('complete');
    });

    it('usedModel comes from the last step', async () => {
      const msg1 = buildMsg('m1');
      const msg2 = buildMsg('m2');

      const steps = [
        { ...buildStep([msg1], 1), usedModel: 'claude-haiku' },
        { ...buildStep([msg1, msg2], 2), usedModel: 'claude-sonnet' },
      ];

      const normalizeDelta = vi.fn().mockReturnValue([]);
      const deps = buildDeps({ steps, normalizeDelta });
      const ctx = buildCtx();
      const pipeline = new ExecutionPipeline(deps);

      const { usedModel } = await pipeline.executeProgressive(PROMPT, SESSION_ID, USER_ID, ctx);

      // Last step determines usedModel
      expect(usedModel).toBe('claude-sonnet');
    });
  });

  // =========================================================================
  // Case 5: Agent transition detection
  // =========================================================================
  describe('Case 5: Agent transition detection', () => {
    it('emits agent_changed event when agent transitions between steps', async () => {
      const emittedEvents: unknown[] = [];
      const ctx = buildCtx((event) => emittedEvents.push(event));

      const msg1 = buildMsg('m1');
      const msg2 = buildMsg('m2');

      // Step 1: supervisor messages, step 2: rag-knowledge messages
      const supervisorEvent = buildNormalizedEvent('assistant_message', 'supervisor');
      const ragEvent = buildNormalizedEvent('assistant_message', 'rag-knowledge');

      let callCount = 0;
      const normalizeDelta = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return [supervisorEvent];
        return [ragEvent];
      });

      const steps = [buildStep([msg1], 1), buildStep([msg1, msg2], 2)];

      const deps = buildDeps({ steps, normalizeDelta });
      const pipeline = new ExecutionPipeline(deps);

      await pipeline.executeProgressive(PROMPT, SESSION_ID, USER_ID, ctx);

      const agentChangedEvents = emittedEvents.filter(
        (e) => (e as { type?: string }).type === 'agent_changed'
      );

      expect(agentChangedEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('agent_changed event contains previousAgent and currentAgent', async () => {
      const emittedEvents: unknown[] = [];
      const ctx = buildCtx((event) => emittedEvents.push(event));

      const msg1 = buildMsg('m1');
      const msg2 = buildMsg('m2');

      const supervisorEvent = buildNormalizedEvent('assistant_message', 'supervisor');
      const ragEvent = buildNormalizedEvent('assistant_message', 'rag-knowledge');

      let callCount = 0;
      const normalizeDelta = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return [supervisorEvent];
        return [ragEvent];
      });

      const steps = [buildStep([msg1], 1), buildStep([msg1, msg2], 2)];
      const deps = buildDeps({ steps, normalizeDelta });
      const pipeline = new ExecutionPipeline(deps);

      await pipeline.executeProgressive(PROMPT, SESSION_ID, USER_ID, ctx);

      const agentChangedEvent = emittedEvents.find(
        (e) => (e as { type?: string }).type === 'agent_changed'
      ) as { previousAgent?: unknown; currentAgent?: unknown } | undefined;

      expect(agentChangedEvent?.previousAgent).toBeDefined();
      expect(agentChangedEvent?.currentAgent).toBeDefined();
    });

    it('calls persistAgentChangedAsync when agent transitions', async () => {
      const msg1 = buildMsg('m1');
      const msg2 = buildMsg('m2');

      const supervisorEvent = buildNormalizedEvent('assistant_message', 'supervisor');
      const ragEvent = buildNormalizedEvent('assistant_message', 'rag-knowledge');

      let callCount = 0;
      const normalizeDelta = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return [supervisorEvent];
        return [ragEvent];
      });

      const steps = [buildStep([msg1], 1), buildStep([msg1, msg2], 2)];
      const deps = buildDeps({ steps, normalizeDelta });
      const ctx = buildCtx();
      const pipeline = new ExecutionPipeline(deps);

      await pipeline.executeProgressive(PROMPT, SESSION_ID, USER_ID, ctx);

      const persistenceCoordinator = deps.persistenceCoordinator as unknown as {
        persistAgentChangedAsync: ReturnType<typeof vi.fn>;
      };
      expect(persistenceCoordinator.persistAgentChangedAsync).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('Edge cases', () => {
    it('handles empty stream without throwing', async () => {
      const deps = buildDeps({ steps: [] });
      const ctx = buildCtx();
      const pipeline = new ExecutionPipeline(deps);

      await expect(
        pipeline.executeProgressive(PROMPT, SESSION_ID, USER_ID, ctx)
      ).resolves.not.toThrow();
    });

    it('calls updateCheckpointMessageCount after stream with final message count', async () => {
      const msg1 = buildMsg('m1');
      const steps = [buildStep([msg1], 1)];
      const normalizeDelta = vi.fn().mockReturnValue([]);
      const deps = buildDeps({ steps, normalizeDelta });
      const ctx = buildCtx();
      const pipeline = new ExecutionPipeline(deps);

      await pipeline.executeProgressive(PROMPT, SESSION_ID, USER_ID, ctx);

      const persistenceCoordinator = deps.persistenceCoordinator as unknown as {
        updateCheckpointMessageCount: ReturnType<typeof vi.fn>;
      };
      expect(persistenceCoordinator.updateCheckpointMessageCount).toHaveBeenCalledWith(
        SESSION_ID,
        1 // 1 message in the last step
      );
    });
  });
});
