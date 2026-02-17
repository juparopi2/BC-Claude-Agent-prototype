/**
 * Unit tests for PipelineStateMachine (PRD-01)
 *
 * Tests the backend wrapper around shared pipeline transition logic,
 * including singleton pattern and structured logging integration.
 *
 * @module __tests__/unit/domains/files
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPipelineStateMachine,
  __resetPipelineStateMachine,
  PIPELINE_STATUS,
} from '@/domains/files/state-machine';
import { PipelineTransitionError } from '@bc-agent/shared';

describe('PipelineStateMachine', () => {
  beforeEach(() => {
    // Reset singleton before each test for isolation
    __resetPipelineStateMachine();
  });

  describe('validateTransition()', () => {
    it('should allow valid forward transitions', () => {
      const machine = getPipelineStateMachine();

      // Test the full happy path
      expect(() =>
        machine.validateTransition(PIPELINE_STATUS.REGISTERED, PIPELINE_STATUS.UPLOADED),
      ).not.toThrow();

      expect(() =>
        machine.validateTransition(PIPELINE_STATUS.UPLOADED, PIPELINE_STATUS.QUEUED),
      ).not.toThrow();

      expect(() =>
        machine.validateTransition(PIPELINE_STATUS.QUEUED, PIPELINE_STATUS.EXTRACTING),
      ).not.toThrow();

      expect(() =>
        machine.validateTransition(PIPELINE_STATUS.EXTRACTING, PIPELINE_STATUS.CHUNKING),
      ).not.toThrow();

      expect(() =>
        machine.validateTransition(PIPELINE_STATUS.CHUNKING, PIPELINE_STATUS.EMBEDDING),
      ).not.toThrow();

      expect(() =>
        machine.validateTransition(PIPELINE_STATUS.EMBEDDING, PIPELINE_STATUS.READY),
      ).not.toThrow();
    });

    it('should allow transitions to failed from any non-terminal state', () => {
      const machine = getPipelineStateMachine();

      // All non-terminal states can transition to failed
      expect(() =>
        machine.validateTransition(PIPELINE_STATUS.REGISTERED, PIPELINE_STATUS.FAILED),
      ).not.toThrow();

      expect(() =>
        machine.validateTransition(PIPELINE_STATUS.UPLOADED, PIPELINE_STATUS.FAILED),
      ).not.toThrow();

      expect(() =>
        machine.validateTransition(PIPELINE_STATUS.QUEUED, PIPELINE_STATUS.FAILED),
      ).not.toThrow();

      expect(() =>
        machine.validateTransition(PIPELINE_STATUS.EXTRACTING, PIPELINE_STATUS.FAILED),
      ).not.toThrow();

      expect(() =>
        machine.validateTransition(PIPELINE_STATUS.CHUNKING, PIPELINE_STATUS.FAILED),
      ).not.toThrow();

      expect(() =>
        machine.validateTransition(PIPELINE_STATUS.EMBEDDING, PIPELINE_STATUS.FAILED),
      ).not.toThrow();
    });

    it('should allow retry transition from failed to queued', () => {
      const machine = getPipelineStateMachine();

      // Manual retry path
      expect(() =>
        machine.validateTransition(PIPELINE_STATUS.FAILED, PIPELINE_STATUS.QUEUED),
      ).not.toThrow();
    });

    it('should throw PipelineTransitionError for invalid backward transitions', () => {
      const machine = getPipelineStateMachine();

      // Cannot go backwards
      expect(() => {
        machine.validateTransition(PIPELINE_STATUS.READY, PIPELINE_STATUS.REGISTERED);
      }).toThrow(PipelineTransitionError);

      expect(() => {
        machine.validateTransition(PIPELINE_STATUS.EMBEDDING, PIPELINE_STATUS.QUEUED);
      }).toThrow(PipelineTransitionError);
    });

    it('should throw PipelineTransitionError for invalid skip-ahead transitions', () => {
      const machine = getPipelineStateMachine();

      // Cannot skip stages
      expect(() => {
        machine.validateTransition(PIPELINE_STATUS.REGISTERED, PIPELINE_STATUS.QUEUED);
      }).toThrow(PipelineTransitionError);

      expect(() => {
        machine.validateTransition(PIPELINE_STATUS.UPLOADED, PIPELINE_STATUS.EMBEDDING);
      }).toThrow(PipelineTransitionError);
    });

    it('should throw PipelineTransitionError when transitioning from terminal state', () => {
      const machine = getPipelineStateMachine();

      // READY is terminal — no valid outgoing transitions
      expect(() => {
        machine.validateTransition(PIPELINE_STATUS.READY, PIPELINE_STATUS.UPLOADED);
      }).toThrow(PipelineTransitionError);

      expect(() => {
        machine.validateTransition(PIPELINE_STATUS.READY, PIPELINE_STATUS.FAILED);
      }).toThrow(PipelineTransitionError);
    });

    it('should throw PipelineTransitionError with correct from/to properties', () => {
      const machine = getPipelineStateMachine();

      try {
        machine.validateTransition(PIPELINE_STATUS.READY, PIPELINE_STATUS.REGISTERED);
        expect.fail('Expected PipelineTransitionError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(PipelineTransitionError);
        if (error instanceof PipelineTransitionError) {
          expect(error.from).toBe(PIPELINE_STATUS.READY);
          expect(error.to).toBe(PIPELINE_STATUS.REGISTERED);
          expect(error.message).toContain('ready');
          expect(error.message).toContain('terminal state');
        }
      }
    });

    it('should include valid targets in error message for non-terminal states', () => {
      const machine = getPipelineStateMachine();

      try {
        machine.validateTransition(PIPELINE_STATUS.UPLOADED, PIPELINE_STATUS.EMBEDDING);
        expect.fail('Expected PipelineTransitionError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(PipelineTransitionError);
        if (error instanceof PipelineTransitionError) {
          expect(error.from).toBe(PIPELINE_STATUS.UPLOADED);
          expect(error.to).toBe(PIPELINE_STATUS.EMBEDDING);
          expect(error.message).toContain('queued');
          expect(error.message).toContain('failed');
        }
      }
    });
  });

  describe('Singleton pattern', () => {
    it('should return the same instance on subsequent calls', () => {
      const instance1 = getPipelineStateMachine();
      const instance2 = getPipelineStateMachine();

      expect(instance1).toBe(instance2);
      expect(instance1).toBeInstanceOf(Object);
    });

    it('should return a new instance after reset', () => {
      const instance1 = getPipelineStateMachine();

      __resetPipelineStateMachine();

      const instance2 = getPipelineStateMachine();

      // Different instances (reference inequality)
      expect(instance1).not.toBe(instance2);
    });

    it('should maintain singleton behavior after reset', () => {
      __resetPipelineStateMachine();

      const instance1 = getPipelineStateMachine();
      const instance2 = getPipelineStateMachine();

      expect(instance1).toBe(instance2);
    });
  });
});
