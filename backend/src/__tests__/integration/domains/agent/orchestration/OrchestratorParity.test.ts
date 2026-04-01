/**
 * @file OrchestratorParity.test.ts
 * @description Parity tests between FakeAgentOrchestrator and AgentOrchestrator
 *
 * Purpose: Ensure the FakeAgentOrchestrator used in tests emits the same
 * event sequence as the real AgentOrchestrator. This prevents test drift
 * where tests pass with Fake but fail in production.
 *
 * Background:
 * - FakeAgentOrchestrator: Used in integration/E2E tests (no Claude API calls)
 * - AgentOrchestrator: Production code that calls Claude API
 * - Both use the progressive execution model (executeProgressive → stream())
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeAgentOrchestrator } from '@domains/agent/orchestration/FakeAgentOrchestrator';
import type { AgentEvent } from '@bc-agent/shared';
import { AIMessage } from '@langchain/core/messages';

// Mock external dependencies for the real AgentOrchestrator
const mockStreamFn = vi.fn();

vi.mock('@/modules/agents/supervisor', () => ({
  getSupervisorGraphAdapter: vi.fn().mockReturnValue({
    stream: mockStreamFn,
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

// Mock persistence
vi.mock('@domains/agent/persistence', () => ({
  getPersistenceCoordinator: vi.fn(() => ({
    persistUserMessage: vi.fn().mockResolvedValue({
      sequenceNumber: 1,
      eventId: 'event-user-1',
      timestamp: '2025-12-22T10:00:00.000Z',
      messageId: 'msg-user-1',
    }),
    persistThinking: vi.fn().mockResolvedValue({ sequenceNumber: 2 }),
    persistAgentMessage: vi.fn().mockResolvedValue({
      sequenceNumber: 3,
      timestamp: '2025-12-22T10:00:00.000Z',
      eventId: 'event-123',
    }),
    getCheckpointMessageCount: vi.fn().mockResolvedValue(0),
    updateCheckpointMessageCount: vi.fn().mockResolvedValue(undefined),
    persistAgentChangedAsync: vi.fn(),
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

vi.mock('@domains/agent/context', () => ({
  createFileContextPreparer: vi.fn(() => ({
    prepare: vi.fn().mockResolvedValue({ contextText: '' }),
  })),
}));

import {
  createAgentOrchestrator,
  __resetAgentOrchestrator,
} from '@domains/agent/orchestration/AgentOrchestrator';

/**
 * Create a mock stream that yields a single step with the given content.
 */
function createMockStream(content: string) {
  const step = {
    messages: [
      { content: 'Hello', _getType: () => 'human' },
      new AIMessage({
        content,
        response_metadata: {
          stop_reason: 'end_turn',
          usage: { input_tokens: 50, output_tokens: 10 },
        },
      }),
    ],
    toolExecutions: [],
    stepNumber: 1,
    usedModel: null,
  };
  return (async function* () {
    yield step;
  })();
}

describe('OrchestratorParity', () => {
  const sessionId = 'test-session';
  const userId = 'test-user';
  const prompt = 'Hello';

  beforeEach(() => {
    vi.clearAllMocks();
    __resetAgentOrchestrator();

    // Setup mock stream to yield a single step each time it is called
    mockStreamFn.mockImplementation(() => createMockStream('Done'));
  });

  afterEach(() => {
    __resetAgentOrchestrator();
  });

  describe('Event Sequence Parity', () => {
    it('FakeAgentOrchestrator and AgentOrchestrator should emit session_start as first event', async () => {
      // Run FakeAgentOrchestrator
      const fakeOrchestrator = new FakeAgentOrchestrator();
      fakeOrchestrator.setResponse({
        textBlocks: ['Hello!'],
        enablePersistence: false,
      });

      const fakeEvents: AgentEvent[] = [];
      await fakeOrchestrator.executeAgentSync(prompt, sessionId, (e) => fakeEvents.push(e), userId);

      // Verify Fake emits session_start first
      expect(fakeEvents.length).toBeGreaterThan(0);
      expect(fakeEvents[0].type).toBe('session_start');

      // Run Real AgentOrchestrator (with mocked internals)
      const realOrchestrator = createAgentOrchestrator();
      const realEvents: AgentEvent[] = [];
      await realOrchestrator.executeAgentSync(prompt, sessionId, (e) => realEvents.push(e), userId);

      // Verify Real emits session_start first
      expect(realEvents.length).toBeGreaterThan(0);
      expect(realEvents[0].type).toBe('session_start');
    });

    it('Both orchestrators should emit user_message_confirmed after session_start', async () => {
      // Run FakeAgentOrchestrator
      const fakeOrchestrator = new FakeAgentOrchestrator();
      fakeOrchestrator.setResponse({
        textBlocks: ['Hello!'],
        enablePersistence: false,
      });

      const fakeEvents: AgentEvent[] = [];
      await fakeOrchestrator.executeAgentSync(prompt, sessionId, (e) => fakeEvents.push(e), userId);

      // Get event sequence from Fake
      const fakeEventTypes = fakeEvents.map(e => e.type);

      // Verify sequence: session_start → user_message_confirmed
      const fakeSessionStartIdx = fakeEventTypes.indexOf('session_start');
      const fakeUserMsgIdx = fakeEventTypes.indexOf('user_message_confirmed');
      expect(fakeSessionStartIdx).toBe(0);
      expect(fakeUserMsgIdx).toBe(1);

      // Run Real AgentOrchestrator
      const realOrchestrator = createAgentOrchestrator();
      const realEvents: AgentEvent[] = [];
      await realOrchestrator.executeAgentSync(prompt, sessionId, (e) => realEvents.push(e), userId);

      // Get event sequence from Real
      const realEventTypes = realEvents.map(e => e.type);

      // Verify sequence: session_start → user_message_confirmed
      const realSessionStartIdx = realEventTypes.indexOf('session_start');
      const realUserMsgIdx = realEventTypes.indexOf('user_message_confirmed');
      expect(realSessionStartIdx).toBe(0);
      expect(realUserMsgIdx).toBe(1);
    });

    it('Both orchestrators should emit complete as last event', async () => {
      // Run FakeAgentOrchestrator
      const fakeOrchestrator = new FakeAgentOrchestrator();
      fakeOrchestrator.setResponse({
        textBlocks: ['Hello!'],
        enablePersistence: false,
      });

      const fakeEvents: AgentEvent[] = [];
      await fakeOrchestrator.executeAgentSync(prompt, sessionId, (e) => fakeEvents.push(e), userId);

      // Verify Fake ends with complete
      expect(fakeEvents[fakeEvents.length - 1].type).toBe('complete');

      // Run Real AgentOrchestrator
      const realOrchestrator = createAgentOrchestrator();
      const realEvents: AgentEvent[] = [];
      await realOrchestrator.executeAgentSync(prompt, sessionId, (e) => realEvents.push(e), userId);

      // Verify Real ends with complete
      expect(realEvents[realEvents.length - 1].type).toBe('complete');
    });

    it('Both orchestrators should have same core event sequence structure', async () => {
      // Run FakeAgentOrchestrator
      const fakeOrchestrator = new FakeAgentOrchestrator();
      fakeOrchestrator.setResponse({
        textBlocks: ['Hello!'],
        enablePersistence: false,
      });

      const fakeEvents: AgentEvent[] = [];
      await fakeOrchestrator.executeAgentSync(prompt, sessionId, (e) => fakeEvents.push(e), userId);

      // Run Real AgentOrchestrator
      const realOrchestrator = createAgentOrchestrator();
      const realEvents: AgentEvent[] = [];
      await realOrchestrator.executeAgentSync(prompt, sessionId, (e) => realEvents.push(e), userId);

      // Extract core event types (exclude message_chunk which Fake emits but Real doesn't in sync mode)
      const fakeCoreTypes = fakeEvents
        .map(e => e.type)
        .filter(t => ['session_start', 'user_message_confirmed', 'message', 'complete'].includes(t));

      const realCoreTypes = realEvents
        .map(e => e.type)
        .filter(t => ['session_start', 'user_message_confirmed', 'message', 'complete'].includes(t));

      // Core sequence should match
      expect(realCoreTypes).toEqual(fakeCoreTypes);
    });
  });

  describe('Event Content Parity', () => {
    it('session_start event should have required fields in both', async () => {
      // Run FakeAgentOrchestrator
      const fakeOrchestrator = new FakeAgentOrchestrator();
      fakeOrchestrator.setResponse({
        textBlocks: ['Hello!'],
        enablePersistence: false,
      });

      const fakeEvents: AgentEvent[] = [];
      await fakeOrchestrator.executeAgentSync(prompt, sessionId, (e) => fakeEvents.push(e), userId);

      const fakeSessionStart = fakeEvents.find(e => e.type === 'session_start');
      expect(fakeSessionStart).toBeDefined();
      expect(fakeSessionStart).toHaveProperty('sessionId');
      expect(fakeSessionStart).toHaveProperty('userId');
      expect(fakeSessionStart).toHaveProperty('timestamp');
      expect(fakeSessionStart).toHaveProperty('eventId');

      // Run Real AgentOrchestrator
      const realOrchestrator = createAgentOrchestrator();
      const realEvents: AgentEvent[] = [];
      await realOrchestrator.executeAgentSync(prompt, sessionId, (e) => realEvents.push(e), userId);

      const realSessionStart = realEvents.find(e => e.type === 'session_start');
      expect(realSessionStart).toBeDefined();
      expect(realSessionStart).toHaveProperty('sessionId');
      expect(realSessionStart).toHaveProperty('userId');
      expect(realSessionStart).toHaveProperty('timestamp');
      expect(realSessionStart).toHaveProperty('eventId');
    });
  });
});
