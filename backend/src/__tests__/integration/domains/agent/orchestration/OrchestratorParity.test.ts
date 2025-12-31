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
 * - Both now use synchronous execution model with invoke()
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeAgentOrchestrator } from '@domains/agent/orchestration/FakeAgentOrchestrator';
import type { AgentEvent } from '@bc-agent/shared';
import { AIMessage } from '@langchain/core/messages';

// Mock external dependencies for the real AgentOrchestrator
vi.mock('@/modules/agents/orchestrator/graph', () => ({
  orchestratorGraph: {
    invoke: vi.fn(),
  },
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
  })),
}));

// Now import with mocks in place
import { orchestratorGraph } from '@/modules/agents/orchestrator/graph';
import {
  createAgentOrchestrator,
  __resetAgentOrchestrator,
} from '@domains/agent/orchestration/AgentOrchestrator';

/**
 * Create a mock AgentState result from orchestratorGraph.invoke()
 */
function createMockInvokeResult(content: string) {
  return {
    messages: [
      // User message
      { content: 'Hello', _getType: () => 'human' },
      // AI response
      new AIMessage({
        content,
        response_metadata: {
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 50,
            output_tokens: 10,
          },
        },
      }),
    ],
    toolExecutions: [],
  };
}

describe('OrchestratorParity', () => {
  const sessionId = 'test-session';
  const userId = 'test-user';
  const prompt = 'Hello';

  beforeEach(() => {
    vi.clearAllMocks();
    __resetAgentOrchestrator();

    // Setup mock for invoke to return proper result
    vi.mocked(orchestratorGraph.invoke).mockResolvedValue(
      createMockInvokeResult('Done')
    );
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
