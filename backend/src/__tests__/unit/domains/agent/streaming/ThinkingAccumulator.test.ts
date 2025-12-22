/**
 * @module ThinkingAccumulator.test
 *
 * Unit tests for ThinkingAccumulator.
 * Tests accumulation of Claude extended thinking chunks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ThinkingAccumulator,
  createThinkingAccumulator,
} from '@/domains/agent/streaming';

describe('ThinkingAccumulator', () => {
  let accumulator: ThinkingAccumulator;

  beforeEach(() => {
    accumulator = new ThinkingAccumulator();
  });

  describe('append()', () => {
    it('should append chunks', () => {
      accumulator.append('Hello');
      accumulator.append(' World');

      expect(accumulator.getContent()).toBe('Hello World');
    });

    it('should ignore empty chunks', () => {
      accumulator.append('Hello');
      accumulator.append('');
      accumulator.append(' World');

      expect(accumulator.getContent()).toBe('Hello World');
      expect(accumulator.getChunkCount()).toBe(2);
    });

    it('should handle unicode content', () => {
      accumulator.append('思考中...');
      accumulator.append(' 🤔');

      expect(accumulator.getContent()).toBe('思考中... 🤔');
    });

    it('should preserve whitespace', () => {
      accumulator.append('  spaces  ');
      accumulator.append('\ttabs\t');
      accumulator.append('\nnewlines\n');

      expect(accumulator.getContent()).toBe('  spaces  \ttabs\t\nnewlines\n');
    });
  });

  describe('isComplete()', () => {
    it('should return false initially', () => {
      expect(accumulator.isComplete()).toBe(false);
    });

    it('should return false after appending', () => {
      accumulator.append('Thinking...');
      expect(accumulator.isComplete()).toBe(false);
    });

    it('should return true after markComplete()', () => {
      accumulator.markComplete();
      expect(accumulator.isComplete()).toBe(true);
    });
  });

  describe('markComplete()', () => {
    it('should mark thinking as complete', () => {
      accumulator.append('Some thinking');
      expect(accumulator.isComplete()).toBe(false);

      accumulator.markComplete();
      expect(accumulator.isComplete()).toBe(true);
    });

    it('should be idempotent', () => {
      accumulator.markComplete();
      accumulator.markComplete();
      accumulator.markComplete();

      expect(accumulator.isComplete()).toBe(true);
    });
  });

  describe('getContent()', () => {
    it('should return empty string when no chunks', () => {
      expect(accumulator.getContent()).toBe('');
    });

    it('should return joined chunks', () => {
      accumulator.append('Part 1');
      accumulator.append('Part 2');
      accumulator.append('Part 3');

      expect(accumulator.getContent()).toBe('Part 1Part 2Part 3');
    });

    it('should return same content multiple times', () => {
      accumulator.append('Content');

      expect(accumulator.getContent()).toBe('Content');
      expect(accumulator.getContent()).toBe('Content');
      expect(accumulator.getContent()).toBe('Content');
    });
  });

  describe('getChunkCount()', () => {
    it('should return 0 initially', () => {
      expect(accumulator.getChunkCount()).toBe(0);
    });

    it('should count appended chunks', () => {
      accumulator.append('1');
      expect(accumulator.getChunkCount()).toBe(1);

      accumulator.append('2');
      expect(accumulator.getChunkCount()).toBe(2);

      accumulator.append('3');
      expect(accumulator.getChunkCount()).toBe(3);
    });
  });

  describe('reset()', () => {
    it('should clear accumulated content', () => {
      accumulator.append('Content');
      accumulator.markComplete();

      accumulator.reset();

      expect(accumulator.getContent()).toBe('');
      expect(accumulator.getChunkCount()).toBe(0);
      expect(accumulator.isComplete()).toBe(false);
    });

    it('should allow re-accumulation after reset', () => {
      accumulator.append('First');
      accumulator.reset();
      accumulator.append('Second');

      expect(accumulator.getContent()).toBe('Second');
    });
  });

  describe('hasContent()', () => {
    it('should return false initially', () => {
      expect(accumulator.hasContent()).toBe(false);
    });

    it('should return true after append', () => {
      accumulator.append('Content');
      expect(accumulator.hasContent()).toBe(true);
    });

    it('should return false after reset', () => {
      accumulator.append('Content');
      accumulator.reset();
      expect(accumulator.hasContent()).toBe(false);
    });
  });

  describe('createThinkingAccumulator()', () => {
    it('should create new instances', () => {
      const acc1 = createThinkingAccumulator();
      const acc2 = createThinkingAccumulator();

      expect(acc1).not.toBe(acc2);
    });

    it('should create independent accumulators', () => {
      const acc1 = createThinkingAccumulator();
      const acc2 = createThinkingAccumulator();

      acc1.append('Content 1');
      acc2.append('Content 2');

      expect(acc1.getContent()).toBe('Content 1');
      expect(acc2.getContent()).toBe('Content 2');
    });

    it('should return ThinkingAccumulator instances', () => {
      const acc = createThinkingAccumulator();
      expect(acc).toBeInstanceOf(ThinkingAccumulator);
    });
  });

  describe('realistic streaming scenario', () => {
    it('should handle typical Claude thinking stream', () => {
      // Simulate Claude extended thinking stream
      accumulator.append('Let me analyze this request');
      accumulator.append(' by breaking it down into steps.');
      accumulator.append('\n\n1. First, I need to understand the context.');
      accumulator.append('\n2. Then, I\'ll formulate a response.');

      // Message content starts
      expect(accumulator.isComplete()).toBe(false);
      accumulator.markComplete();
      expect(accumulator.isComplete()).toBe(true);

      const fullThinking = accumulator.getContent();
      expect(fullThinking).toContain('Let me analyze');
      expect(fullThinking).toContain('breaking it down');
      expect(fullThinking).toContain('1. First');
      expect(fullThinking).toContain('2. Then');
    });

    it('should handle empty thinking (no extended thinking)', () => {
      // No thinking chunks received
      expect(accumulator.hasContent()).toBe(false);
      expect(accumulator.getContent()).toBe('');

      // Message starts immediately
      accumulator.markComplete();
      expect(accumulator.hasContent()).toBe(false);
    });
  });
});
