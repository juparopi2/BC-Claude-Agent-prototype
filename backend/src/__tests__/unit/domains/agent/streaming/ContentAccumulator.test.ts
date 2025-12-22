/**
 * @module ContentAccumulator.test
 *
 * Unit tests for ContentAccumulator.
 * Tests accumulation of message content chunks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ContentAccumulator,
  createContentAccumulator,
} from '@/domains/agent/streaming';

describe('ContentAccumulator', () => {
  let accumulator: ContentAccumulator;

  beforeEach(() => {
    accumulator = new ContentAccumulator();
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
      accumulator.append('Hola ');
      accumulator.append('mundo 🌍');

      expect(accumulator.getContent()).toBe('Hola mundo 🌍');
    });

    it('should preserve whitespace', () => {
      accumulator.append('  spaces  ');
      accumulator.append('\ttabs\t');
      accumulator.append('\nnewlines\n');

      expect(accumulator.getContent()).toBe('  spaces  \ttabs\t\nnewlines\n');
    });

    it('should handle markdown content', () => {
      accumulator.append('# Heading\n');
      accumulator.append('\n');
      accumulator.append('- Item 1\n');
      accumulator.append('- Item 2');

      expect(accumulator.getContent()).toBe('# Heading\n\n- Item 1\n- Item 2');
    });

    it('should handle code blocks', () => {
      accumulator.append('```typescript\n');
      accumulator.append('const x = 1;\n');
      accumulator.append('```');

      expect(accumulator.getContent()).toBe('```typescript\nconst x = 1;\n```');
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

      accumulator.reset();

      expect(accumulator.getContent()).toBe('');
      expect(accumulator.getChunkCount()).toBe(0);
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

  describe('createContentAccumulator()', () => {
    it('should create new instances', () => {
      const acc1 = createContentAccumulator();
      const acc2 = createContentAccumulator();

      expect(acc1).not.toBe(acc2);
    });

    it('should create independent accumulators', () => {
      const acc1 = createContentAccumulator();
      const acc2 = createContentAccumulator();

      acc1.append('Content 1');
      acc2.append('Content 2');

      expect(acc1.getContent()).toBe('Content 1');
      expect(acc2.getContent()).toBe('Content 2');
    });

    it('should return ContentAccumulator instances', () => {
      const acc = createContentAccumulator();
      expect(acc).toBeInstanceOf(ContentAccumulator);
    });
  });

  describe('realistic streaming scenario', () => {
    it('should handle typical Claude response stream', () => {
      // Simulate Claude streaming response
      accumulator.append('Based on');
      accumulator.append(' your request');
      accumulator.append(', here is');
      accumulator.append(' my analysis:\n\n');
      accumulator.append('1. First point\n');
      accumulator.append('2. Second point');

      const fullContent = accumulator.getContent();
      expect(fullContent).toContain('Based on your request');
      expect(fullContent).toContain('here is my analysis');
      expect(fullContent).toContain('1. First point');
    });

    it('should handle multi-turn conversation', () => {
      // First turn
      accumulator.append('First response');
      const firstResponse = accumulator.getContent();

      // Reset for second turn
      accumulator.reset();
      accumulator.append('Second response');
      const secondResponse = accumulator.getContent();

      expect(firstResponse).toBe('First response');
      expect(secondResponse).toBe('Second response');
    });
  });
});
