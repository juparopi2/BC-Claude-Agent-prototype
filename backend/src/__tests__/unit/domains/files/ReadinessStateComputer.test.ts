/**
 * ReadinessStateComputer Unit Tests
 *
 * Tests for computing unified readiness state from processing and embedding statuses.
 * This is a pure domain logic component with no external dependencies.
 *
 * Coverage Target: 100% (pure function, all state combinations)
 */

import { describe, it, expect } from 'vitest';
import { ReadinessStateComputer } from '@/domains/files/status/ReadinessStateComputer';
import type { ProcessingStatus, EmbeddingStatus, FileReadinessState } from '@bc-agent/shared';

describe('ReadinessStateComputer', () => {
  const computer = new ReadinessStateComputer();

  // ========== SUITE 1: FAILED STATE (HIGHEST PRIORITY) ==========
  describe('Failed State (highest priority)', () => {
    it('returns "failed" when processing_status is failed', () => {
      expect(computer.compute('failed', 'pending')).toBe('failed');
    });

    it('returns "failed" when processing_status is failed and embedding_status is completed', () => {
      expect(computer.compute('failed', 'completed')).toBe('failed');
    });

    it('returns "failed" when embedding_status is failed', () => {
      expect(computer.compute('completed', 'failed')).toBe('failed');
    });

    it('returns "failed" when embedding_status is failed and processing is pending', () => {
      expect(computer.compute('pending', 'failed')).toBe('failed');
    });

    it('returns "failed" when both statuses are failed', () => {
      expect(computer.compute('failed', 'failed')).toBe('failed');
    });
  });

  // ========== SUITE 2: PROCESSING STATE ==========
  describe('Processing State', () => {
    it('returns "processing" when processing_status is pending', () => {
      expect(computer.compute('pending', 'pending')).toBe('processing');
    });

    it('returns "processing" when processing_status is processing', () => {
      expect(computer.compute('processing', 'pending')).toBe('processing');
    });

    it('returns "processing" when embedding_status is pending after processing completed', () => {
      expect(computer.compute('completed', 'pending')).toBe('processing');
    });

    it('returns "processing" when embedding_status is processing', () => {
      expect(computer.compute('completed', 'processing')).toBe('processing');
    });

    it('returns "processing" when processing is done but embedding just started', () => {
      expect(computer.compute('completed', 'processing')).toBe('processing');
    });
  });

  // ========== SUITE 3: READY STATE ==========
  describe('Ready State', () => {
    it('returns "ready" when both statuses are completed', () => {
      expect(computer.compute('completed', 'completed')).toBe('ready');
    });
  });

  // ========== SUITE 4: STATE TRANSITION MATRIX ==========
  describe('State Transition Matrix (exhaustive)', () => {
    const processingStatuses: ProcessingStatus[] = ['pending', 'processing', 'completed', 'failed'];
    const embeddingStatuses: EmbeddingStatus[] = ['pending', 'processing', 'completed', 'failed'];

    // Define expected results for all 16 combinations
    const expectedResults: Record<ProcessingStatus, Record<EmbeddingStatus, FileReadinessState>> = {
      pending: {
        pending: 'processing',
        processing: 'processing',
        completed: 'processing', // Edge case: embedding done before processing (should not happen in practice)
        failed: 'failed',
      },
      processing: {
        pending: 'processing',
        processing: 'processing',
        completed: 'processing', // Edge case: embedding done before processing (should not happen in practice)
        failed: 'failed',
      },
      completed: {
        pending: 'processing',
        processing: 'processing',
        completed: 'ready',
        failed: 'failed',
      },
      failed: {
        pending: 'failed',
        processing: 'failed',
        completed: 'failed',
        failed: 'failed',
      },
    };

    // Generate test for each combination
    for (const procStatus of processingStatuses) {
      for (const embStatus of embeddingStatuses) {
        const expected = expectedResults[procStatus][embStatus];
        it(`compute(${procStatus}, ${embStatus}) => ${expected}`, () => {
          expect(computer.compute(procStatus, embStatus)).toBe(expected);
        });
      }
    }
  });

  // ========== SUITE 5: EDGE CASES ==========
  describe('Edge Cases', () => {
    it('handles the typical happy path: pending -> processing -> completed', () => {
      // Simulate upload flow
      expect(computer.compute('pending', 'pending')).toBe('processing');
      expect(computer.compute('processing', 'pending')).toBe('processing');
      expect(computer.compute('completed', 'pending')).toBe('processing');
      expect(computer.compute('completed', 'processing')).toBe('processing');
      expect(computer.compute('completed', 'completed')).toBe('ready');
    });

    it('handles failure during processing phase', () => {
      expect(computer.compute('pending', 'pending')).toBe('processing');
      expect(computer.compute('processing', 'pending')).toBe('processing');
      expect(computer.compute('failed', 'pending')).toBe('failed');
    });

    it('handles failure during embedding phase', () => {
      expect(computer.compute('completed', 'pending')).toBe('processing');
      expect(computer.compute('completed', 'processing')).toBe('processing');
      expect(computer.compute('completed', 'failed')).toBe('failed');
    });
  });

  // ========== SUITE 6: INSTANCE CREATION ==========
  describe('Instance Creation', () => {
    it('should be instantiatable', () => {
      const instance = new ReadinessStateComputer();
      expect(instance).toBeInstanceOf(ReadinessStateComputer);
    });

    it('compute method should be callable multiple times', () => {
      const instance = new ReadinessStateComputer();

      // Multiple calls should work independently
      expect(instance.compute('pending', 'pending')).toBe('processing');
      expect(instance.compute('completed', 'completed')).toBe('ready');
      expect(instance.compute('failed', 'pending')).toBe('failed');
    });
  });
});
