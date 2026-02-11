/**
 * Target Agent Routing Tests
 *
 * Tests for targetAgentId-based direct agent invocation,
 * which bypasses the supervisor LLM.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AGENT_ID } from '@bc-agent/shared';
import {
  initializeSupervisorGraph,
  getSupervisorGraphAdapter,
  __resetSupervisorGraph,
} from '../supervisor-graph';

// ============================================================================
// Mocks - use vi.hoisted() so they are available in vi.mock() factories
// ============================================================================

const { mockAgentInvoke, mockSupervisorStream } = vi.hoisted(() => ({
  mockAgentInvoke: vi.fn().mockResolvedValue({ messages: [] }),
  mockSupervisorStream: vi.fn().mockReturnValue((async function* () {
    yield { messages: [] };
  })()),
}));

// Mock ModelFactory
vi.mock('@/core/langchain/ModelFactory', () => ({
  ModelFactory: {
    create: vi.fn().mockResolvedValue({
      bindTools: vi.fn().mockReturnValue({
        invoke: vi.fn().mockResolvedValue({ content: 'test' }),
      }),
      invoke: vi.fn().mockResolvedValue({ content: 'test' }),
    }),
  },
}));

// Mock createSupervisor
vi.mock('@langchain/langgraph-supervisor', () => ({
  createSupervisor: vi.fn().mockReturnValue({
    compile: vi.fn().mockReturnValue({
      invoke: vi.fn().mockResolvedValue({ messages: [] }),
      stream: mockSupervisorStream,
      getState: vi.fn().mockResolvedValue({ tasks: [] }),
    }),
  }),
}));

// Mock createReactAgent (not directly used in tests, but required by agent-builders)
vi.mock('@langchain/langgraph/prebuilt', () => ({
  createReactAgent: vi.fn().mockReturnValue({
    invoke: mockAgentInvoke,
  }),
}));

// Mock buildReactAgents to return agents with known IDs
vi.mock('../agent-builders', () => ({
  buildReactAgents: vi.fn().mockResolvedValue([
    {
      id: AGENT_ID.BC_AGENT,
      name: 'BC Agent',
      agent: { invoke: mockAgentInvoke },
    },
    {
      id: AGENT_ID.RAG_AGENT,
      name: 'RAG Agent',
      agent: { invoke: mockAgentInvoke },
    },
  ]),
}));

// Mock checkpointer
vi.mock('@/infrastructure/checkpointer', () => ({
  getCheckpointer: vi.fn().mockReturnValue({}),
}));

// Mock analytics
vi.mock('@/domains/analytics', () => ({
  getAgentAnalyticsService: vi.fn().mockReturnValue({
    recordInvocation: vi.fn().mockResolvedValue(undefined),
  }),
}));

// ============================================================================
// Tests
// ============================================================================

describe('targetAgentId routing', () => {
  beforeEach(async () => {
    __resetSupervisorGraph();
    mockAgentInvoke.mockClear();
    mockSupervisorStream.mockClear().mockReturnValue((async function* () {
      yield { messages: [] };
    })());
    await initializeSupervisorGraph();
  });

  it('should invoke target agent directly when targetAgentId matches a registered agent', async () => {
    const adapter = getSupervisorGraphAdapter();

    await adapter.invoke({
      messages: [{ content: 'list all customers' }],
      context: {
        userId: 'TEST-USER',
        sessionId: 'TEST-SESSION',
        options: {
          targetAgentId: AGENT_ID.BC_AGENT,
        },
      },
    });

    // The agent's invoke should be called (direct invocation)
    expect(mockAgentInvoke).toHaveBeenCalled();
    // Supervisor stream should NOT be called
    expect(mockSupervisorStream).not.toHaveBeenCalled();
  });

  it('should pass prompt through unmodified (no prefix stripping)', async () => {
    const adapter = getSupervisorGraphAdapter();
    const originalPrompt = '/bc list all customers';

    await adapter.invoke({
      messages: [{ content: originalPrompt }],
      context: {
        userId: 'TEST-USER',
        sessionId: 'TEST-SESSION',
        options: {
          targetAgentId: AGENT_ID.BC_AGENT,
        },
      },
    });

    // The prompt should be passed as-is, not stripped
    const invokeCall = mockAgentInvoke.mock.calls[0];
    const messagesArg = invokeCall[0].messages;
    expect(messagesArg[0].content).toBe(originalPrompt);
  });

  it('should fall through to supervisor LLM when targetAgentId is "auto"', async () => {
    const adapter = getSupervisorGraphAdapter();

    await adapter.invoke({
      messages: [{ content: 'hello' }],
      context: {
        userId: 'TEST-USER',
        sessionId: 'TEST-SESSION',
        options: {
          targetAgentId: 'auto',
        },
      },
    });

    // Supervisor stream should be called (fallthrough)
    expect(mockSupervisorStream).toHaveBeenCalled();
    // Direct agent invoke should NOT be called
    expect(mockAgentInvoke).not.toHaveBeenCalled();
  });

  it('should fall through to supervisor LLM when targetAgentId is undefined', async () => {
    const adapter = getSupervisorGraphAdapter();

    await adapter.invoke({
      messages: [{ content: 'hello' }],
      context: {
        userId: 'TEST-USER',
        sessionId: 'TEST-SESSION',
      },
    });

    // Supervisor stream should be called (fallthrough)
    expect(mockSupervisorStream).toHaveBeenCalled();
    // Direct agent invoke should NOT be called
    expect(mockAgentInvoke).not.toHaveBeenCalled();
  });

  it('should fall through to supervisor LLM when targetAgentId is unknown', async () => {
    const adapter = getSupervisorGraphAdapter();

    await adapter.invoke({
      messages: [{ content: 'hello' }],
      context: {
        userId: 'TEST-USER',
        sessionId: 'TEST-SESSION',
        options: {
          targetAgentId: 'nonexistent-agent',
        },
      },
    });

    // Supervisor stream should be called (fallthrough after warning)
    expect(mockSupervisorStream).toHaveBeenCalled();
    // Direct agent invoke should NOT be called
    expect(mockAgentInvoke).not.toHaveBeenCalled();
  });
});
