/**
 * @module EventIndexTracker.test
 *
 * Unit tests for EventIndexTracker.
 * Tests the simple counter functionality for event ordering.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  EventIndexTracker,
  createEventIndexTracker,
} from '@/domains/agent/emission';

describe('EventIndexTracker', () => {
  let tracker: EventIndexTracker;

  beforeEach(() => {
    tracker = new EventIndexTracker();
  });

  describe('next()', () => {
    it('should start at 0', () => {
      expect(tracker.next()).toBe(0);
    });

    it('should increment with each call', () => {
      expect(tracker.next()).toBe(0);
      expect(tracker.next()).toBe(1);
      expect(tracker.next()).toBe(2);
      expect(tracker.next()).toBe(3);
    });

    it('should handle many increments', () => {
      for (let i = 0; i < 100; i++) {
        expect(tracker.next()).toBe(i);
      }
      expect(tracker.next()).toBe(100);
    });
  });

  describe('current()', () => {
    it('should return 0 initially', () => {
      expect(tracker.current()).toBe(0);
    });

    it('should return current value without incrementing', () => {
      tracker.next(); // 0
      tracker.next(); // 1
      expect(tracker.current()).toBe(2);
      expect(tracker.current()).toBe(2); // Still 2
      expect(tracker.current()).toBe(2); // Still 2
    });

    it('should reflect value after next()', () => {
      expect(tracker.current()).toBe(0);
      tracker.next();
      expect(tracker.current()).toBe(1);
      tracker.next();
      expect(tracker.current()).toBe(2);
    });
  });

  describe('reset()', () => {
    it('should reset counter to 0', () => {
      tracker.next(); // 0
      tracker.next(); // 1
      tracker.next(); // 2
      expect(tracker.current()).toBe(3);

      tracker.reset();

      expect(tracker.current()).toBe(0);
      expect(tracker.next()).toBe(0);
    });

    it('should work correctly after multiple resets', () => {
      tracker.next();
      tracker.next();
      tracker.reset();

      expect(tracker.next()).toBe(0);
      expect(tracker.next()).toBe(1);

      tracker.reset();

      expect(tracker.next()).toBe(0);
    });
  });

  describe('createEventIndexTracker()', () => {
    it('should create new instances', () => {
      const tracker1 = createEventIndexTracker();
      const tracker2 = createEventIndexTracker();

      expect(tracker1).not.toBe(tracker2);
    });

    it('should create independent trackers', () => {
      const tracker1 = createEventIndexTracker();
      const tracker2 = createEventIndexTracker();

      tracker1.next(); // 0
      tracker1.next(); // 1
      tracker1.next(); // 2

      expect(tracker1.current()).toBe(3);
      expect(tracker2.current()).toBe(0); // Independent
    });

    it('should return EventIndexTracker instances', () => {
      const tracker = createEventIndexTracker();
      expect(tracker).toBeInstanceOf(EventIndexTracker);
    });
  });

  describe('edge cases', () => {
    it('should handle interleaved next() and current() calls', () => {
      expect(tracker.current()).toBe(0);
      expect(tracker.next()).toBe(0);
      expect(tracker.current()).toBe(1);
      expect(tracker.next()).toBe(1);
      expect(tracker.current()).toBe(2);
    });

    it('should handle reset followed by immediate current()', () => {
      tracker.next();
      tracker.next();
      tracker.reset();
      expect(tracker.current()).toBe(0);
    });
  });
});
