/**
 * AgentOrchestrator — Pipeline Routing Unit Tests
 *
 * Verifies that executeAgentSync() always routes to executeProgressive(),
 * regardless of targetAgentId. Direct agent invocations are handled
 * inside SupervisorGraphAdapter.stream() via a single-yield path.
 *
 * Uses vi.spyOn on ExecutionPipeline.prototype to intercept which method is called,
 * without running actual graph execution.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createAgentOrchestrator,
  __resetAgentOrchestrator,
} from '@domains/agent/orchestration/AgentOrchestrator';
import { ExecutionPipeline } from '@/domains/agent/orchestration/execution/ExecutionPipeline';

// ---------------------------------------------------------------------------
// Module mocks — all external infrastructure
// ---------------------------------------------------------------------------

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

vi.mock('@/modules/agents/supervisor', () => ({
  getSupervisorGraphAdapter: vi.fn().mockReturnValue({
    invoke: vi.fn().mockResolvedValue({
      messages: [],
      toolExecutions: [],
    }),
    stream: async function* () {
      // empty stream for progressive path
    },
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
      timestamp: new Date().toISOString(),
      messageId: 'msg-user-1',
    }),
    persistThinking: vi.fn().mockResolvedValue({ sequenceNumber: 2 }),
    persistAgentMessage: vi.fn().mockResolvedValue({
      sequenceNumber: 3,
      eventId: 'event-agent-1',
      timestamp: new Date().toISOString(),
      jobId: 'job-1',
    }),
    persistToolEventsAsync: vi.fn(),
    persistCitationsAsync: vi.fn(),
    persistAgentChangedAsync: vi.fn(),
    awaitPersistence: vi.fn().mockResolvedValue(undefined),
    getCheckpointMessageCount: vi.fn().mockResolvedValue(0),
    updateCheckpointMessageCount: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@services/events/EventStore', () => ({
  getEventStore: vi.fn(() => ({
    reserveSequenceNumbers: vi.fn().mockResolvedValue([]),
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

vi.mock('@/domains/billing/tracking/UsageTrackingService', () => ({
  getUsageTrackingService: vi.fn(() => ({
    trackClaudeUsage: vi.fn().mockResolvedValue(undefined),
    trackServerToolUsage: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/services/token-usage', () => ({
  getTokenUsageService: vi.fn(() => ({
    recordUsage: vi.fn(),
  })),
}));

vi.mock('@shared/providers/normalizers/DeltaNormalizer', () => ({
  getDeltaNormalizer: vi.fn(() => ({
    normalizeDelta: vi.fn().mockReturnValue([]),
  })),
}));

// ---------------------------------------------------------------------------
// Shared mock pipeline result
// ---------------------------------------------------------------------------

const MOCK_PIPELINE_RESULT = {
  result: {
    sessionId: 'test-session',
    response: 'ok',
    messageId: 'msg-1',
    tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    toolsUsed: [],
    success: true,
  },
  events: [],
  usedModel: null,
};

// ---------------------------------------------------------------------------

describe('AgentOrchestrator — pipeline routing', () => {
  const SESSION_ID = 'routing-test-session';
  const USER_ID = 'routing-test-user';
  const PROMPT = 'Test message';

  let executeProgressiveSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetAgentOrchestrator();

    // Spy on executeProgressive BEFORE creating the orchestrator
    executeProgressiveSpy = vi
      .spyOn(ExecutionPipeline.prototype, 'executeProgressive')
      .mockResolvedValue(MOCK_PIPELINE_RESULT);
  });

  afterEach(() => {
    __resetAgentOrchestrator();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // All cases route to executeProgressive() — direct invocations are handled
  // inside SupervisorGraphAdapter.stream() via a single-yield path.
  // =========================================================================
  describe('Case 1: No targetAgentId', () => {
    it('routes to executeProgressive() when targetAgentId is undefined', async () => {
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(PROMPT, SESSION_ID, vi.fn(), USER_ID);
      expect(executeProgressiveSpy).toHaveBeenCalledOnce();
    });

    it('routes to executeProgressive() when no options object is provided', async () => {
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(PROMPT, SESSION_ID, vi.fn(), USER_ID, undefined);
      expect(executeProgressiveSpy).toHaveBeenCalledOnce();
    });
  });

  describe("Case 2: targetAgentId = 'rag-knowledge'", () => {
    it("routes to executeProgressive() for targetAgentId = 'rag-knowledge'", async () => {
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(PROMPT, SESSION_ID, vi.fn(), USER_ID, {
        targetAgentId: 'rag-knowledge',
      });
      expect(executeProgressiveSpy).toHaveBeenCalledOnce();
    });

    it('routes to executeProgressive() for any targetAgentId', async () => {
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(PROMPT, SESSION_ID, vi.fn(), USER_ID, {
        targetAgentId: 'bc-agent',
      });
      expect(executeProgressiveSpy).toHaveBeenCalledOnce();
    });
  });

  describe("Case 3: targetAgentId = 'auto'", () => {
    it("routes to executeProgressive() for targetAgentId = 'auto'", async () => {
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(PROMPT, SESSION_ID, vi.fn(), USER_ID, {
        targetAgentId: 'auto',
      });
      expect(executeProgressiveSpy).toHaveBeenCalledOnce();
    });
  });

  describe("Case 4: targetAgentId = 'supervisor'", () => {
    it("routes to executeProgressive() for targetAgentId = 'supervisor'", async () => {
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(PROMPT, SESSION_ID, vi.fn(), USER_ID, {
        targetAgentId: 'supervisor',
      });
      expect(executeProgressiveSpy).toHaveBeenCalledOnce();
    });
  });

  describe('Routing invariants', () => {
    it('exactly one pipeline method is called per execution', async () => {
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(PROMPT, SESSION_ID, vi.fn(), USER_ID);
      expect(executeProgressiveSpy).toHaveBeenCalledTimes(1);
    });

    it('pipeline receives the correct prompt, sessionId, and userId', async () => {
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(PROMPT, SESSION_ID, vi.fn(), USER_ID);
      expect(executeProgressiveSpy).toHaveBeenCalledWith(
        PROMPT,
        SESSION_ID,
        USER_ID,
        expect.any(Object), // ctx
        expect.any(Object)  // pipelineOptions
      );
    });

    it('executeProgressive() receives correct args for direct invocations', async () => {
      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(PROMPT, SESSION_ID, vi.fn(), USER_ID, {
        targetAgentId: 'rag-knowledge',
      });
      expect(executeProgressiveSpy).toHaveBeenCalledWith(
        PROMPT,
        SESSION_ID,
        USER_ID,
        expect.any(Object), // ctx
        expect.any(Object)  // pipelineOptions
      );
    });
  });
});
