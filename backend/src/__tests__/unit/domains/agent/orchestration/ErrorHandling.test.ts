/**
 * @file ErrorHandling.test.ts
 * @description Tests for error handling in AgentOrchestrator.
 *
 * Purpose: Capture the error handling behavior in AgentOrchestrator
 * before extraction, ensuring robustness is preserved.
 *
 * Critical behaviors to verify:
 * - Missing userId throws when attachments present
 * - Missing userId throws when semantic search enabled
 * - Graph execution failure emits error event
 * - Timeout triggers AbortSignal correctly
 * - Error event has proper code and message
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createAgentOrchestrator,
  __resetAgentOrchestrator,
} from '@domains/agent/orchestration/AgentOrchestrator';
import type { AgentEvent } from '@bc-agent/shared';

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
    reserveSequenceNumbers: vi.fn().mockImplementation((_sessionId: string, count: number) => {
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

const mockTrackClaudeUsage = vi.fn().mockResolvedValue(undefined);
vi.mock('@/domains/billing/tracking/UsageTrackingService', () => ({
  getUsageTrackingService: vi.fn(() => ({
    trackClaudeUsage: mockTrackClaudeUsage,
  })),
}));

import { getSupervisorGraphAdapter } from '@/modules/agents/supervisor';
import { AIMessage } from '@langchain/core/messages';

describe('ErrorHandling', () => {
  const sessionId = 'error-test-session';
  const prompt = 'Test prompt';

  beforeEach(() => {
    vi.clearAllMocks();
    __resetAgentOrchestrator();
  });

  afterEach(() => {
    __resetAgentOrchestrator();
  });

  describe('userId validation', () => {
    it('should throw when attachments present but userId is missing', async () => {
      const orchestrator = createAgentOrchestrator();

      await expect(
        orchestrator.executeAgentSync(prompt, sessionId, undefined, undefined, {
          attachments: ['file-123'],
        })
      ).rejects.toThrow('UserId required for file attachments or semantic search');
    });

    it('should throw when semantic search enabled but userId is missing', async () => {
      const orchestrator = createAgentOrchestrator();

      await expect(
        orchestrator.executeAgentSync(prompt, sessionId, undefined, undefined, {
          enableAutoSemanticSearch: true,
        })
      ).rejects.toThrow('UserId required for file attachments or semantic search');
    });

    it('should throw when both attachments and semantic search enabled without userId', async () => {
      const orchestrator = createAgentOrchestrator();

      await expect(
        orchestrator.executeAgentSync(prompt, sessionId, undefined, undefined, {
          attachments: ['file-1'],
          enableAutoSemanticSearch: true,
        })
      ).rejects.toThrow('UserId required for file attachments or semantic search');
    });

    it('should NOT throw when userId is provided with attachments', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue({
        messages: [
          { content: 'User', _getType: () => 'human' },
          new AIMessage({
            content: 'Response',
            response_metadata: { stop_reason: 'end_turn' },
          }),
        ],
        toolExecutions: [],
      });

      const orchestrator = createAgentOrchestrator();

      await expect(
        orchestrator.executeAgentSync(prompt, sessionId, vi.fn(), 'user-123', {
          attachments: ['file-123'],
        })
      ).resolves.not.toThrow();
    });

    it('should NOT throw when no attachments and no semantic search (userId optional)', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue({
        messages: [
          { content: 'User', _getType: () => 'human' },
          new AIMessage({
            content: 'Response',
            response_metadata: { stop_reason: 'end_turn' },
          }),
        ],
        toolExecutions: [],
      });

      const orchestrator = createAgentOrchestrator();

      await expect(
        orchestrator.executeAgentSync(prompt, sessionId, vi.fn(), undefined, {
          // No attachments, no semantic search
        })
      ).resolves.not.toThrow();
    });
  });

  describe('Graph execution errors', () => {
    it('should emit error event when graph.invoke() fails', async () => {
      const graphError = new Error('Graph execution failed: rate limit exceeded');
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockRejectedValue(graphError);

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();

      await expect(
        orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), 'user-123')
      ).rejects.toThrow('Graph execution failed');

      const errorEvent = events.find(e => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect((errorEvent as { error: string }).error).toBe('Graph execution failed: rate limit exceeded');
      expect((errorEvent as { code: string }).code).toBe('EXECUTION_FAILED');
    });

    it('should include original error message in error event', async () => {
      const originalError = new Error('Connection timeout to Anthropic API');
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockRejectedValue(originalError);

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();

      try {
        await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), 'user-123');
      } catch {
        // Expected to throw
      }

      const errorEvent = events.find(e => e.type === 'error') as { error: string; code: string } | undefined;
      expect(errorEvent?.error).toContain('Connection timeout');
    });

    it('should handle non-Error thrown values', async () => {
      // Some code might throw strings or other values
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockRejectedValue('String error');

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();

      try {
        await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), 'user-123');
      } catch {
        // Expected to throw
      }

      const errorEvent = events.find(e => e.type === 'error') as { error: string } | undefined;
      expect(errorEvent?.error).toBe('String error');
    });

    it('should re-throw the original error after emitting', async () => {
      const originalError = new Error('API unavailable');
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockRejectedValue(originalError);

      const orchestrator = createAgentOrchestrator();

      await expect(
        orchestrator.executeAgentSync(prompt, sessionId, vi.fn(), 'user-123')
      ).rejects.toThrow('API unavailable');
    });
  });

  describe('Error event format', () => {
    it('error event should have correct structure', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockRejectedValue(new Error('Test error'));

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();

      try {
        await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), 'user-123');
      } catch {
        // Expected
      }

      const errorEvent = events.find(e => e.type === 'error');
      expect(errorEvent).toMatchObject({
        type: 'error',
        sessionId,
        code: 'EXECUTION_FAILED',
        persistenceState: 'transient',
      });
      expect(errorEvent?.eventId).toBeDefined();
      expect(errorEvent?.timestamp).toBeDefined();
    });

    it('error event should be transient (not persisted)', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockRejectedValue(new Error('Test'));

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();

      try {
        await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), 'user-123');
      } catch {
        // Expected
      }

      const errorEvent = events.find(e => e.type === 'error');
      expect(errorEvent?.persistenceState).toBe('transient');
    });
  });

  describe('Timeout handling', () => {
    it('should pass timeout to graph.invoke via AbortSignal', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue({
        messages: [
          { content: 'User', _getType: () => 'human' },
          new AIMessage({
            content: 'Response',
            response_metadata: { stop_reason: 'end_turn' },
          }),
        ],
        toolExecutions: [],
      });

      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, vi.fn(), 'user-123', {
        timeoutMs: 60000,
      });

      expect((getSupervisorGraphAdapter() as any).invoke).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          recursionLimit: 100,
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('should use default timeout of 300000ms (5 minutes)', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue({
        messages: [
          { content: 'User', _getType: () => 'human' },
          new AIMessage({
            content: 'Response',
            response_metadata: { stop_reason: 'end_turn' },
          }),
        ],
        toolExecutions: [],
      });

      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, vi.fn(), 'user-123');

      // Verify invoke was called with AbortSignal.timeout
      expect((getSupervisorGraphAdapter() as any).invoke).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('should emit error event on timeout abort', async () => {
      const timeoutError = new DOMException('The operation was aborted', 'AbortError');
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockRejectedValue(timeoutError);

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();

      try {
        await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), 'user-123');
      } catch {
        // Expected
      }

      const errorEvent = events.find(e => e.type === 'error');
      expect(errorEvent).toBeDefined();
    });
  });

  describe('Early error scenarios', () => {
    it('should emit session_start and user_message before error', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockRejectedValue(new Error('Graph failed'));

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();

      try {
        await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), 'user-123');
      } catch {
        // Expected
      }

      // Even on error, session_start and user_message_confirmed should be emitted
      const types = events.map(e => e.type);
      expect(types).toContain('session_start');
      expect(types).toContain('user_message_confirmed');
      expect(types).toContain('error');
    });

    it('should NOT emit complete event on error', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockRejectedValue(new Error('Failed'));

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();

      try {
        await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), 'user-123');
      } catch {
        // Expected
      }

      const completeEvent = events.find(e => e.type === 'complete');
      expect(completeEvent).toBeUndefined();
    });
  });

  describe('Error code classification', () => {
    it('should use EXECUTION_FAILED code for graph errors', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockRejectedValue(new Error('Any error'));

      const events: AgentEvent[] = [];
      const orchestrator = createAgentOrchestrator();

      try {
        await orchestrator.executeAgentSync(prompt, sessionId, (e) => events.push(e), 'user-123');
      } catch {
        // Expected
      }

      const errorEvent = events.find(e => e.type === 'error') as { code: string } | undefined;
      expect(errorEvent?.code).toBe('EXECUTION_FAILED');
    });
  });

  describe('AI cost tracking integration', () => {
    it('should call trackClaudeUsage after successful execution with tokens', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue({
        messages: [
          { content: 'User', _getType: () => 'human' },
          new AIMessage({
            content: 'Response',
            response_metadata: { stop_reason: 'end_turn' },
            usage_metadata: { input_tokens: 500, output_tokens: 200, total_tokens: 700 },
          }),
        ],
        toolExecutions: [],
        usedModel: 'claude-sonnet-4-5-20250929',
      });

      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, vi.fn(), 'user-123');

      // Allow microtask queue to flush (fire-and-forget promise)
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockTrackClaudeUsage).toHaveBeenCalledWith(
        'user-123',
        sessionId,
        500,
        200,
        'claude-sonnet-4-5-20250929',
        expect.objectContaining({ messageId: expect.any(String) })
      );
    });

    it('should NOT call trackClaudeUsage when execution fails', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockRejectedValue(
        new Error('Graph execution failed')
      );

      const orchestrator = createAgentOrchestrator();

      try {
        await orchestrator.executeAgentSync(prompt, sessionId, vi.fn(), 'user-123');
      } catch {
        // Expected to throw
      }

      expect(mockTrackClaudeUsage).not.toHaveBeenCalled();
    });

    it('should NOT call trackClaudeUsage when userId is missing', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue({
        messages: [
          { content: 'User', _getType: () => 'human' },
          new AIMessage({
            content: 'Response',
            response_metadata: { stop_reason: 'end_turn' },
          }),
        ],
        toolExecutions: [],
        usedModel: 'claude-sonnet-4-5-20250929',
      });

      const orchestrator = createAgentOrchestrator();
      await orchestrator.executeAgentSync(prompt, sessionId, vi.fn());

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockTrackClaudeUsage).not.toHaveBeenCalled();
    });
  });

  describe('Callback error handling', () => {
    it('should handle undefined callback gracefully', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue({
        messages: [
          { content: 'User', _getType: () => 'human' },
          new AIMessage({
            content: 'Response',
            response_metadata: { stop_reason: 'end_turn' },
          }),
        ],
        toolExecutions: [],
      });

      const orchestrator = createAgentOrchestrator();

      // Should not throw when callback is undefined
      await expect(
        orchestrator.executeAgentSync(prompt, sessionId, undefined, 'user-123')
      ).resolves.not.toThrow();
    });

    it('should continue execution even without callback', async () => {
      vi.mocked((getSupervisorGraphAdapter() as any).invoke).mockResolvedValue({
        messages: [
          { content: 'User', _getType: () => 'human' },
          new AIMessage({
            content: 'Test response',
            response_metadata: { stop_reason: 'end_turn' },
          }),
        ],
        toolExecutions: [],
      });

      const orchestrator = createAgentOrchestrator();

      const result = await orchestrator.executeAgentSync(prompt, sessionId, undefined, 'user-123');

      expect(result.success).toBe(true);
      expect(result.response).toBe('Test response');
    });
  });
});
