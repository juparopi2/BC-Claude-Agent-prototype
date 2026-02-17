/**
 * Tests for Pipeline Status Constants (PRD-01)
 *
 * @module @bc-agent/shared/constants/__tests__/pipeline-status.test
 */

import { describe, it, expect } from 'vitest';
import {
  PIPELINE_STATUS,
  PIPELINE_TRANSITIONS,
  canTransition,
  getValidTransitions,
  getTransitionErrorMessage,
  PipelineTransitionError,
  type PipelineStatus,
} from '../pipeline-status';

// ============================================================================
// TEST DATA
// ============================================================================

/**
 * All 8 pipeline status values for parametric testing.
 */
const ALL_STATUSES: readonly PipelineStatus[] = [
  PIPELINE_STATUS.REGISTERED,
  PIPELINE_STATUS.UPLOADED,
  PIPELINE_STATUS.QUEUED,
  PIPELINE_STATUS.EXTRACTING,
  PIPELINE_STATUS.CHUNKING,
  PIPELINE_STATUS.EMBEDDING,
  PIPELINE_STATUS.READY,
  PIPELINE_STATUS.FAILED,
] as const;

/**
 * Valid transitions (14 pairs) for parametric testing.
 * Format: [from, to, description]
 */
const VALID_TRANSITIONS: Array<[PipelineStatus, PipelineStatus, string]> = [
  [PIPELINE_STATUS.REGISTERED, PIPELINE_STATUS.UPLOADED, 'registered -> uploaded'],
  [PIPELINE_STATUS.REGISTERED, PIPELINE_STATUS.FAILED, 'registered -> failed'],
  [PIPELINE_STATUS.UPLOADED, PIPELINE_STATUS.QUEUED, 'uploaded -> queued'],
  [PIPELINE_STATUS.UPLOADED, PIPELINE_STATUS.FAILED, 'uploaded -> failed'],
  [PIPELINE_STATUS.QUEUED, PIPELINE_STATUS.EXTRACTING, 'queued -> extracting'],
  [PIPELINE_STATUS.QUEUED, PIPELINE_STATUS.FAILED, 'queued -> failed'],
  [PIPELINE_STATUS.EXTRACTING, PIPELINE_STATUS.CHUNKING, 'extracting -> chunking'],
  [PIPELINE_STATUS.EXTRACTING, PIPELINE_STATUS.FAILED, 'extracting -> failed'],
  [PIPELINE_STATUS.CHUNKING, PIPELINE_STATUS.EMBEDDING, 'chunking -> embedding'],
  [PIPELINE_STATUS.CHUNKING, PIPELINE_STATUS.FAILED, 'chunking -> failed'],
  [PIPELINE_STATUS.EMBEDDING, PIPELINE_STATUS.READY, 'embedding -> ready'],
  [PIPELINE_STATUS.EMBEDDING, PIPELINE_STATUS.FAILED, 'embedding -> failed'],
  [PIPELINE_STATUS.FAILED, PIPELINE_STATUS.QUEUED, 'failed -> queued (retry)'],
];

/**
 * Invalid transitions (50 pairs) generated from the 64-pair matrix minus the 14 valid + 1 no-op (ready -> ready).
 * Note: ready has no outgoing transitions (terminal state).
 */
const INVALID_TRANSITIONS: Array<[PipelineStatus, PipelineStatus, string]> = [
  // From REGISTERED (6 invalid)
  [PIPELINE_STATUS.REGISTERED, PIPELINE_STATUS.REGISTERED, 'registered -> registered'],
  [PIPELINE_STATUS.REGISTERED, PIPELINE_STATUS.QUEUED, 'registered -> queued'],
  [PIPELINE_STATUS.REGISTERED, PIPELINE_STATUS.EXTRACTING, 'registered -> extracting'],
  [PIPELINE_STATUS.REGISTERED, PIPELINE_STATUS.CHUNKING, 'registered -> chunking'],
  [PIPELINE_STATUS.REGISTERED, PIPELINE_STATUS.EMBEDDING, 'registered -> embedding'],
  [PIPELINE_STATUS.REGISTERED, PIPELINE_STATUS.READY, 'registered -> ready'],

  // From UPLOADED (6 invalid)
  [PIPELINE_STATUS.UPLOADED, PIPELINE_STATUS.REGISTERED, 'uploaded -> registered'],
  [PIPELINE_STATUS.UPLOADED, PIPELINE_STATUS.UPLOADED, 'uploaded -> uploaded'],
  [PIPELINE_STATUS.UPLOADED, PIPELINE_STATUS.EXTRACTING, 'uploaded -> extracting'],
  [PIPELINE_STATUS.UPLOADED, PIPELINE_STATUS.CHUNKING, 'uploaded -> chunking'],
  [PIPELINE_STATUS.UPLOADED, PIPELINE_STATUS.EMBEDDING, 'uploaded -> embedding'],
  [PIPELINE_STATUS.UPLOADED, PIPELINE_STATUS.READY, 'uploaded -> ready'],

  // From QUEUED (6 invalid)
  [PIPELINE_STATUS.QUEUED, PIPELINE_STATUS.REGISTERED, 'queued -> registered'],
  [PIPELINE_STATUS.QUEUED, PIPELINE_STATUS.UPLOADED, 'queued -> uploaded'],
  [PIPELINE_STATUS.QUEUED, PIPELINE_STATUS.QUEUED, 'queued -> queued'],
  [PIPELINE_STATUS.QUEUED, PIPELINE_STATUS.CHUNKING, 'queued -> chunking'],
  [PIPELINE_STATUS.QUEUED, PIPELINE_STATUS.EMBEDDING, 'queued -> embedding'],
  [PIPELINE_STATUS.QUEUED, PIPELINE_STATUS.READY, 'queued -> ready'],

  // From EXTRACTING (6 invalid)
  [PIPELINE_STATUS.EXTRACTING, PIPELINE_STATUS.REGISTERED, 'extracting -> registered'],
  [PIPELINE_STATUS.EXTRACTING, PIPELINE_STATUS.UPLOADED, 'extracting -> uploaded'],
  [PIPELINE_STATUS.EXTRACTING, PIPELINE_STATUS.QUEUED, 'extracting -> queued'],
  [PIPELINE_STATUS.EXTRACTING, PIPELINE_STATUS.EXTRACTING, 'extracting -> extracting'],
  [PIPELINE_STATUS.EXTRACTING, PIPELINE_STATUS.EMBEDDING, 'extracting -> embedding'],
  [PIPELINE_STATUS.EXTRACTING, PIPELINE_STATUS.READY, 'extracting -> ready'],

  // From CHUNKING (6 invalid)
  [PIPELINE_STATUS.CHUNKING, PIPELINE_STATUS.REGISTERED, 'chunking -> registered'],
  [PIPELINE_STATUS.CHUNKING, PIPELINE_STATUS.UPLOADED, 'chunking -> uploaded'],
  [PIPELINE_STATUS.CHUNKING, PIPELINE_STATUS.QUEUED, 'chunking -> queued'],
  [PIPELINE_STATUS.CHUNKING, PIPELINE_STATUS.EXTRACTING, 'chunking -> extracting'],
  [PIPELINE_STATUS.CHUNKING, PIPELINE_STATUS.CHUNKING, 'chunking -> chunking'],
  [PIPELINE_STATUS.CHUNKING, PIPELINE_STATUS.READY, 'chunking -> ready'],

  // From EMBEDDING (6 invalid)
  [PIPELINE_STATUS.EMBEDDING, PIPELINE_STATUS.REGISTERED, 'embedding -> registered'],
  [PIPELINE_STATUS.EMBEDDING, PIPELINE_STATUS.UPLOADED, 'embedding -> uploaded'],
  [PIPELINE_STATUS.EMBEDDING, PIPELINE_STATUS.QUEUED, 'embedding -> queued'],
  [PIPELINE_STATUS.EMBEDDING, PIPELINE_STATUS.EXTRACTING, 'embedding -> extracting'],
  [PIPELINE_STATUS.EMBEDDING, PIPELINE_STATUS.CHUNKING, 'embedding -> chunking'],
  [PIPELINE_STATUS.EMBEDDING, PIPELINE_STATUS.EMBEDDING, 'embedding -> embedding'],

  // From READY (8 invalid - terminal state)
  [PIPELINE_STATUS.READY, PIPELINE_STATUS.REGISTERED, 'ready -> registered'],
  [PIPELINE_STATUS.READY, PIPELINE_STATUS.UPLOADED, 'ready -> uploaded'],
  [PIPELINE_STATUS.READY, PIPELINE_STATUS.QUEUED, 'ready -> queued'],
  [PIPELINE_STATUS.READY, PIPELINE_STATUS.EXTRACTING, 'ready -> extracting'],
  [PIPELINE_STATUS.READY, PIPELINE_STATUS.CHUNKING, 'ready -> chunking'],
  [PIPELINE_STATUS.READY, PIPELINE_STATUS.EMBEDDING, 'ready -> embedding'],
  [PIPELINE_STATUS.READY, PIPELINE_STATUS.READY, 'ready -> ready'],
  [PIPELINE_STATUS.READY, PIPELINE_STATUS.FAILED, 'ready -> failed'],

  // From FAILED (6 invalid)
  [PIPELINE_STATUS.FAILED, PIPELINE_STATUS.REGISTERED, 'failed -> registered'],
  [PIPELINE_STATUS.FAILED, PIPELINE_STATUS.UPLOADED, 'failed -> uploaded'],
  [PIPELINE_STATUS.FAILED, PIPELINE_STATUS.EXTRACTING, 'failed -> extracting'],
  [PIPELINE_STATUS.FAILED, PIPELINE_STATUS.CHUNKING, 'failed -> chunking'],
  [PIPELINE_STATUS.FAILED, PIPELINE_STATUS.EMBEDDING, 'failed -> embedding'],
  [PIPELINE_STATUS.FAILED, PIPELINE_STATUS.READY, 'failed -> ready'],
  [PIPELINE_STATUS.FAILED, PIPELINE_STATUS.FAILED, 'failed -> failed'],
];

// ============================================================================
// TESTS
// ============================================================================

describe('PIPELINE_STATUS constants', () => {
  it('should have exactly 8 status values', () => {
    const statusValues = Object.values(PIPELINE_STATUS);
    expect(statusValues).toHaveLength(8);
  });

  it('should contain all expected status values', () => {
    expect(PIPELINE_STATUS.REGISTERED).toBe('registered');
    expect(PIPELINE_STATUS.UPLOADED).toBe('uploaded');
    expect(PIPELINE_STATUS.QUEUED).toBe('queued');
    expect(PIPELINE_STATUS.EXTRACTING).toBe('extracting');
    expect(PIPELINE_STATUS.CHUNKING).toBe('chunking');
    expect(PIPELINE_STATUS.EMBEDDING).toBe('embedding');
    expect(PIPELINE_STATUS.READY).toBe('ready');
    expect(PIPELINE_STATUS.FAILED).toBe('failed');
  });

  it('should have unique status values', () => {
    const statusValues = Object.values(PIPELINE_STATUS);
    const uniqueValues = new Set(statusValues);
    expect(uniqueValues.size).toBe(statusValues.length);
  });
});

describe('PIPELINE_TRANSITIONS integrity', () => {
  it('should have transition rules for all 8 statuses', () => {
    const transitionKeys = Object.keys(PIPELINE_TRANSITIONS);
    expect(transitionKeys).toHaveLength(8);
    ALL_STATUSES.forEach((status) => {
      expect(PIPELINE_TRANSITIONS).toHaveProperty(status);
    });
  });

  it('should only contain valid PipelineStatus values as targets', () => {
    const allStatusValues = Object.values(PIPELINE_STATUS);
    Object.entries(PIPELINE_TRANSITIONS).forEach(([_from, targets]) => {
      targets.forEach((target) => {
        expect(allStatusValues).toContain(target);
      });
    });
  });

  it('should have correct transition counts per state', () => {
    expect(PIPELINE_TRANSITIONS[PIPELINE_STATUS.REGISTERED]).toHaveLength(2); // uploaded, failed
    expect(PIPELINE_TRANSITIONS[PIPELINE_STATUS.UPLOADED]).toHaveLength(2); // queued, failed
    expect(PIPELINE_TRANSITIONS[PIPELINE_STATUS.QUEUED]).toHaveLength(2); // extracting, failed
    expect(PIPELINE_TRANSITIONS[PIPELINE_STATUS.EXTRACTING]).toHaveLength(2); // chunking, failed
    expect(PIPELINE_TRANSITIONS[PIPELINE_STATUS.CHUNKING]).toHaveLength(2); // embedding, failed
    expect(PIPELINE_TRANSITIONS[PIPELINE_STATUS.EMBEDDING]).toHaveLength(2); // ready, failed
    expect(PIPELINE_TRANSITIONS[PIPELINE_STATUS.READY]).toHaveLength(0); // terminal
    expect(PIPELINE_TRANSITIONS[PIPELINE_STATUS.FAILED]).toHaveLength(1); // queued (retry)
  });
});

describe('canTransition() - 64-pair transition matrix', () => {
  it.each(VALID_TRANSITIONS)('should allow valid transition: %s', (from, to, _description) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each(INVALID_TRANSITIONS)('should reject invalid transition: %s', (from, to, _description) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('should have tested all 64 state pairs (8x8)', () => {
    const totalPairs = ALL_STATUSES.length * ALL_STATUSES.length;
    const testedPairs = VALID_TRANSITIONS.length + INVALID_TRANSITIONS.length;
    expect(testedPairs).toBe(totalPairs);
  });
});

describe('getValidTransitions()', () => {
  it('should return correct transitions for REGISTERED', () => {
    const transitions = getValidTransitions(PIPELINE_STATUS.REGISTERED);
    expect(transitions).toEqual([PIPELINE_STATUS.UPLOADED, PIPELINE_STATUS.FAILED]);
  });

  it('should return correct transitions for UPLOADED', () => {
    const transitions = getValidTransitions(PIPELINE_STATUS.UPLOADED);
    expect(transitions).toEqual([PIPELINE_STATUS.QUEUED, PIPELINE_STATUS.FAILED]);
  });

  it('should return correct transitions for QUEUED', () => {
    const transitions = getValidTransitions(PIPELINE_STATUS.QUEUED);
    expect(transitions).toEqual([PIPELINE_STATUS.EXTRACTING, PIPELINE_STATUS.FAILED]);
  });

  it('should return correct transitions for EXTRACTING', () => {
    const transitions = getValidTransitions(PIPELINE_STATUS.EXTRACTING);
    expect(transitions).toEqual([PIPELINE_STATUS.CHUNKING, PIPELINE_STATUS.FAILED]);
  });

  it('should return correct transitions for CHUNKING', () => {
    const transitions = getValidTransitions(PIPELINE_STATUS.CHUNKING);
    expect(transitions).toEqual([PIPELINE_STATUS.EMBEDDING, PIPELINE_STATUS.FAILED]);
  });

  it('should return correct transitions for EMBEDDING', () => {
    const transitions = getValidTransitions(PIPELINE_STATUS.EMBEDDING);
    expect(transitions).toEqual([PIPELINE_STATUS.READY, PIPELINE_STATUS.FAILED]);
  });

  it('should return empty array for READY (terminal state)', () => {
    const transitions = getValidTransitions(PIPELINE_STATUS.READY);
    expect(transitions).toEqual([]);
  });

  it('should return correct transitions for FAILED (retry)', () => {
    const transitions = getValidTransitions(PIPELINE_STATUS.FAILED);
    expect(transitions).toEqual([PIPELINE_STATUS.QUEUED]);
  });

  it('should return readonly array for all states', () => {
    ALL_STATUSES.forEach((status) => {
      const transitions = getValidTransitions(status);
      expect(Array.isArray(transitions)).toBe(true);
      // Verify it's a readonly array by checking the type constraint
      expect(Object.isFrozen(transitions) || transitions === PIPELINE_TRANSITIONS[status]).toBe(true);
    });
  });
});

describe('getTransitionErrorMessage()', () => {
  it('should return descriptive message for terminal state (READY)', () => {
    const message = getTransitionErrorMessage(PIPELINE_STATUS.READY, PIPELINE_STATUS.QUEUED);
    expect(message).toContain('ready');
    expect(message).toContain('queued');
    expect(message).toContain('terminal state');
    expect(message).toContain('no valid transitions');
  });

  it('should return descriptive message with valid targets for non-terminal states', () => {
    const message = getTransitionErrorMessage(PIPELINE_STATUS.REGISTERED, PIPELINE_STATUS.QUEUED);
    expect(message).toContain('registered');
    expect(message).toContain('queued');
    expect(message).toContain('uploaded');
    expect(message).toContain('failed');
    expect(message).toContain('valid targets');
  });

  it('should list all valid targets for states with multiple transitions', () => {
    const message = getTransitionErrorMessage(PIPELINE_STATUS.UPLOADED, PIPELINE_STATUS.REGISTERED);
    expect(message).toContain('queued');
    expect(message).toContain('failed');
  });

  it('should handle single valid target (FAILED -> QUEUED)', () => {
    const message = getTransitionErrorMessage(PIPELINE_STATUS.FAILED, PIPELINE_STATUS.READY);
    expect(message).toContain('failed');
    expect(message).toContain('ready');
    expect(message).toContain('queued');
  });

  it('should format messages consistently across all invalid transitions', () => {
    INVALID_TRANSITIONS.forEach(([from, to]) => {
      const message = getTransitionErrorMessage(from, to);
      expect(message).toMatch(/Cannot transition from '[\w]+' to '[\w]+'/);
    });
  });
});

describe('PipelineTransitionError', () => {
  it('should have correct error name', () => {
    const error = new PipelineTransitionError(PIPELINE_STATUS.REGISTERED, PIPELINE_STATUS.QUEUED);
    expect(error.name).toBe('PipelineTransitionError');
  });

  it('should store from and to properties', () => {
    const from = PIPELINE_STATUS.UPLOADED;
    const to = PIPELINE_STATUS.REGISTERED;
    const error = new PipelineTransitionError(from, to);
    expect(error.from).toBe(from);
    expect(error.to).toBe(to);
  });

  it('should use getTransitionErrorMessage for error message', () => {
    const from = PIPELINE_STATUS.QUEUED;
    const to = PIPELINE_STATUS.UPLOADED;
    const error = new PipelineTransitionError(from, to);
    const expectedMessage = getTransitionErrorMessage(from, to);
    expect(error.message).toBe(expectedMessage);
  });

  it('should be an instance of Error', () => {
    const error = new PipelineTransitionError(PIPELINE_STATUS.READY, PIPELINE_STATUS.FAILED);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(PipelineTransitionError);
  });

  it('should have descriptive message for terminal state transition', () => {
    const error = new PipelineTransitionError(PIPELINE_STATUS.READY, PIPELINE_STATUS.QUEUED);
    expect(error.message).toContain('terminal state');
  });

  it('should have descriptive message with valid targets for non-terminal state', () => {
    const error = new PipelineTransitionError(PIPELINE_STATUS.CHUNKING, PIPELINE_STATUS.QUEUED);
    expect(error.message).toContain('embedding');
    expect(error.message).toContain('failed');
    expect(error.message).toContain('valid targets');
  });

  it('should preserve from and to in all invalid transition scenarios', () => {
    INVALID_TRANSITIONS.forEach(([from, to]) => {
      const error = new PipelineTransitionError(from, to);
      expect(error.from).toBe(from);
      expect(error.to).toBe(to);
      expect(error.message).toContain(from);
      expect(error.message).toContain(to);
    });
  });
});
