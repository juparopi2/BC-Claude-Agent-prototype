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
 * - ISSUE FOUND: FakeAgentOrchestrator emitted `session_start` but Real didn't
 * - FIX: Added `session_start` emission to AgentOrchestrator (this sprint)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeAgentOrchestrator } from '@domains/agent/orchestration/FakeAgentOrchestrator';
import type { AgentEvent } from '@bc-agent/shared';

// Mock external dependencies for the real AgentOrchestrator
vi.mock('@/modules/agents/orchestrator/graph', () => ({
  orchestratorGraph: {
    streamEvents: vi.fn(),
  },
}));

vi.mock('@shared/providers/adapters/StreamAdapterFactory', () => ({
  StreamAdapterFactory: {
    create: vi.fn(() => ({
      processChunk: vi.fn(),
      normalizeStopReason: vi.fn((stopReason: string) => {
        const mapping: Record<string, string> = {
          'end_turn': 'success',
          'max_tokens': 'max_turns',
          'tool_use': 'success',
          'stop_sequence': 'success',
        };
        return mapping[stopReason] ?? 'success';
      }),
    })),
  },
}));

vi.mock('@langchain/core/messages', () => ({
  HumanMessage: vi.fn((content) => ({ content, type: 'human' })),
}));

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

// Mock GraphStreamProcessor singleton
const mockGraphProcessor = {
  process: vi.fn(),
};
vi.mock('@domains/agent/streaming/GraphStreamProcessor', () => ({
  getGraphStreamProcessor: vi.fn(() => mockGraphProcessor),
}));

// Mock ToolExecutionProcessor singleton
vi.mock('@domains/agent/tools', () => ({
  getToolExecutionProcessor: vi.fn(() => ({
    processExecutions: vi.fn().mockResolvedValue([]),
  })),
}));

// Mock AgentEventEmitter singleton - capture events
let capturedRealEvents: AgentEvent[] = [];
vi.mock('@domains/agent/emission', () => ({
  getAgentEventEmitter: vi.fn(() => ({
    emit: vi.fn((event: AgentEvent) => {
      capturedRealEvents.push(event);
    }),
    emitError: vi.fn(),
    emitUserMessageConfirmed: vi.fn((sessionId: string, data: Record<string, unknown>) => {
      capturedRealEvents.push({
        type: 'user_message_confirmed',
        sessionId,
        ...data,
      } as AgentEvent);
    }),
    getEventIndex: vi.fn().mockReturnValue(0),
  })),
}));

// Now import with mocks in place
import { orchestratorGraph } from '@/modules/agents/orchestrator/graph';
import {
  createAgentOrchestrator,
  __resetAgentOrchestrator,
} from '@domains/agent/orchestration/AgentOrchestrator';

describe('OrchestratorParity', () => {
  const sessionId = 'test-session';
  const userId = 'test-user';
  const prompt = 'Hello';

  beforeEach(() => {
    vi.clearAllMocks();
    capturedRealEvents = [];
    __resetAgentOrchestrator();

    // Setup minimal mocks for real orchestrator to execute
    vi.mocked(orchestratorGraph.streamEvents).mockResolvedValue(
      (async function* () {
        // Empty stream
      })()
    );

    mockGraphProcessor.process.mockReturnValue(
      (async function* () {
        yield { type: 'final_response', content: 'Done', stopReason: 'end_turn' };
      })()
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
      await realOrchestrator.executeAgentSync(prompt, sessionId, () => {}, userId);

      // Verify Real emits session_start first
      expect(capturedRealEvents.length).toBeGreaterThan(0);
      expect(capturedRealEvents[0].type).toBe('session_start');
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
      await realOrchestrator.executeAgentSync(prompt, sessionId, () => {}, userId);

      // Get event sequence from Real
      const realEventTypes = capturedRealEvents.map(e => e.type);

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
      await realOrchestrator.executeAgentSync(prompt, sessionId, () => {}, userId);

      // Verify Real ends with complete
      expect(capturedRealEvents[capturedRealEvents.length - 1].type).toBe('complete');
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
      await realOrchestrator.executeAgentSync(prompt, sessionId, () => {}, userId);

      // Extract core event types (exclude message_chunk which varies)
      const fakeCoreTypes = fakeEvents
        .map(e => e.type)
        .filter(t => ['session_start', 'user_message_confirmed', 'message', 'complete'].includes(t));

      const realCoreTypes = capturedRealEvents
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
      await realOrchestrator.executeAgentSync(prompt, sessionId, () => {}, userId);

      const realSessionStart = capturedRealEvents.find(e => e.type === 'session_start');
      expect(realSessionStart).toBeDefined();
      expect(realSessionStart).toHaveProperty('sessionId');
      expect(realSessionStart).toHaveProperty('userId');
      expect(realSessionStart).toHaveProperty('timestamp');
      expect(realSessionStart).toHaveProperty('eventId');
    });
  });
});
