/**
 * GraphExecutor.executeStreaming() Unit Tests
 *
 * Tests for the streaming execution path of GraphExecutor, which yields one
 * StreamingGraphStep per graph node boundary during progressive delivery.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  GraphExecutor,
  createGraphExecutor,
  IStreamableGraph,
  StreamingGraphStep,
} from '@/domains/agent/orchestration/execution/GraphExecutor';
// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const TIMEOUT_MS = 5_000;

/**
 * Build a minimal StreamingGraphStep.
 */
function buildStep(stepNumber: number): StreamingGraphStep {
  return {
    messages: [],
    toolExecutions: [],
    stepNumber,
    usedModel: null,
  };
}

/**
 * Create a mock IStreamableGraph that yields the provided steps.
 */
function makeStreamableGraph(steps: StreamingGraphStep[]): IStreamableGraph {
  return {
    async *stream() {
      for (const step of steps) {
        yield step;
      }
    },
  };
}

/**
 * Create a graph WITHOUT stream() to test the "not supported" error path.
 * Cast as IStreamableGraph to satisfy the constructor, but stream() is missing.
 */
function makeGraphWithoutStream(): IStreamableGraph {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {} as any;
}

// ---------------------------------------------------------------------------

describe('GraphExecutor.executeStreaming()', () => {

  // Case 1: yields correct steps
  describe('Case 1: yields correct steps', () => {
    it('yields a StreamingGraphStep for every step the graph emits', async () => {
      const expectedSteps = [buildStep(1), buildStep(2), buildStep(3)];
      const graph = makeStreamableGraph(expectedSteps);
      const executor = createGraphExecutor(graph);

      const received: StreamingGraphStep[] = [];
      for await (const step of executor.executeStreaming({}, { timeoutMs: TIMEOUT_MS })) {
        received.push(step);
      }

      expect(received).toHaveLength(3);
    });

    it('passes through the full step object unchanged', async () => {
      const step: StreamingGraphStep = {
        messages: [],
        toolExecutions: [],
        stepNumber: 1,
        usedModel: 'claude-sonnet-4-5',
      };
      const graph = makeStreamableGraph([step]);
      const executor = new GraphExecutor(graph);

      const received: StreamingGraphStep[] = [];
      for await (const s of executor.executeStreaming({}, { timeoutMs: TIMEOUT_MS })) {
        received.push(s);
      }

      expect(received[0]).toEqual(step);
    });

    it('yields steps in the same order the graph emits them', async () => {
      const steps = [buildStep(1), buildStep(2), buildStep(3)];
      const graph = makeStreamableGraph(steps);
      const executor = createGraphExecutor(graph);

      const received: StreamingGraphStep[] = [];
      for await (const step of executor.executeStreaming({}, { timeoutMs: TIMEOUT_MS })) {
        received.push(step);
      }

      expect(received.map(s => s.stepNumber)).toEqual([1, 2, 3]);
    });
  });

  // Case 2: throws when graph lacks stream()
  describe('Case 2: throws when graph lacks stream()', () => {
    it('throws an error when the graph does not implement IStreamableGraph', async () => {
      const batchOnlyGraph = makeGraphWithoutStream();
      const executor = new GraphExecutor(batchOnlyGraph);

      await expect(async () => {
        // We must attempt to iterate to trigger the throw
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of executor.executeStreaming({}, { timeoutMs: TIMEOUT_MS })) {
          // no-op
        }
      }).rejects.toThrow('Graph does not support streaming');
    });

    it('error message mentions streaming or execute()', async () => {
      const batchOnlyGraph = makeGraphWithoutStream();
      const executor = new GraphExecutor(batchOnlyGraph);

      let caughtError: Error | undefined;
      try {
        for await (const _ of executor.executeStreaming({}, { timeoutMs: TIMEOUT_MS })) {
          // no-op
        }
      } catch (err) {
        caughtError = err as Error;
      }

      expect(caughtError?.message).toMatch(/stream/i);
    });
  });

  // Case 3: propagates stream errors
  describe('Case 3: propagates stream errors mid-iteration', () => {
    it('rethrows the error thrown by the graph stream', async () => {
      const boom = new Error('Graph exploded mid-stream');
      const faultyGraph: IStreamableGraph = {
        async *stream() {
          yield buildStep(1);
          throw boom;
        },
      };
      const executor = new GraphExecutor(faultyGraph);

      await expect(async () => {
        for await (const _ of executor.executeStreaming({}, { timeoutMs: TIMEOUT_MS })) {
          // consume first step, then the error is thrown on next iteration
        }
      }).rejects.toThrow('Graph exploded mid-stream');
    });

    it('still yields steps that were emitted before the error', async () => {
      const faultyGraph: IStreamableGraph = {
        async *stream() {
          yield buildStep(1);
          yield buildStep(2);
          throw new Error('Failure after 2 steps');
        },
      };
      const executor = new GraphExecutor(faultyGraph);

      const received: StreamingGraphStep[] = [];
      try {
        for await (const step of executor.executeStreaming({}, { timeoutMs: TIMEOUT_MS })) {
          received.push(step);
        }
      } catch {
        // expected — we just want to check what was received before the error
      }

      expect(received).toHaveLength(2);
    });
  });

  // Case 4: handles empty stream
  describe('Case 4: handles empty stream', () => {
    it('completes without yielding when stream is immediately done', async () => {
      const emptyGraph = makeStreamableGraph([]);
      const executor = new GraphExecutor(emptyGraph);

      const received: StreamingGraphStep[] = [];
      for await (const step of executor.executeStreaming({}, { timeoutMs: TIMEOUT_MS })) {
        received.push(step);
      }

      expect(received).toHaveLength(0);
    });

    it('does not throw on an empty stream', async () => {
      const emptyGraph = makeStreamableGraph([]);
      const executor = new GraphExecutor(emptyGraph);

      await expect(async () => {
        for await (const _ of executor.executeStreaming({}, { timeoutMs: TIMEOUT_MS })) {
          // no-op
        }
      }).not.toThrow();
    });
  });

  // Factory function
  describe('createGraphExecutor()', () => {
    it('creates a GraphExecutor instance', () => {
      const graph = makeGraphWithoutStream();
      const executor = createGraphExecutor(graph);
      expect(executor).toBeInstanceOf(GraphExecutor);
    });
  });
});
