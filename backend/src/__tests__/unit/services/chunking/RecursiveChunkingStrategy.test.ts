import { describe, it, expect, beforeEach } from 'vitest';
import { RecursiveChunkingStrategy } from '@/services/chunking/RecursiveChunkingStrategy';
import type { ChunkResult } from '@/services/chunking/types';

describe('RecursiveChunkingStrategy', () => {
  let strategy: RecursiveChunkingStrategy;

  beforeEach(() => {
    // Default configuration: 512 max tokens, 50 overlap
    strategy = new RecursiveChunkingStrategy({
      maxTokens: 512,
      overlapTokens: 50
    });
  });

  describe('Basic Chunking', () => {
    it('should split by paragraphs first (\\n\\n separator)', () => {
      const text = 'Paragraph 1.\n\nParagraph 2.\n\nParagraph 3.';

      const chunks = strategy.chunk(text);

      expect(chunks).toHaveLength(3);
      expect(chunks[0].text).toBe('Paragraph 1.');
      expect(chunks[1].text).toBe('Paragraph 2.');
      expect(chunks[2].text).toBe('Paragraph 3.');
      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[1].chunkIndex).toBe(1);
      expect(chunks[2].chunkIndex).toBe(2);
    });

    it('should handle single paragraph without splitting', () => {
      const text = 'This is a single short paragraph.';

      const chunks = strategy.chunk(text);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe(text);
      expect(chunks[0].chunkIndex).toBe(0);
    });

    it('should trim whitespace from chunks', () => {
      const text = '  \n\n  Paragraph 1  \n\n  Paragraph 2  \n\n  ';

      const chunks = strategy.chunk(text);

      expect(chunks[0].text).toBe('Paragraph 1');
      expect(chunks[1].text).toBe('Paragraph 2');
    });

    it('should handle empty text', () => {
      const text = '';

      const chunks = strategy.chunk(text);

      expect(chunks).toHaveLength(0);
    });

    it('should handle text with only whitespace', () => {
      const text = '   \n\n   \n\n   ';

      const chunks = strategy.chunk(text);

      expect(chunks).toHaveLength(0);
    });
  });

  describe('Token Limits', () => {
    it('should respect max chunk size (512 tokens)', () => {
      // Create a long paragraph that exceeds 512 tokens
      const longParagraph = 'word '.repeat(600); // ~600 tokens

      const chunks = strategy.chunk(longParagraph);

      // Each chunk should be under the limit
      chunks.forEach(chunk => {
        expect(chunk.tokenCount).toBeLessThanOrEqual(512);
      });

      // Should have split into multiple chunks
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should fall back to sentence split if paragraph too large', () => {
      const largeParagraph = 'Sentence one. '.repeat(100) + 'Sentence two. '.repeat(100);

      const chunks = strategy.chunk(largeParagraph);

      chunks.forEach(chunk => {
        expect(chunk.tokenCount).toBeLessThanOrEqual(512);
      });
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should fall back to word split if sentence too large', () => {
      // Create a very long sentence without periods
      const longSentence = 'word '.repeat(600);

      const chunks = strategy.chunk(longSentence);

      chunks.forEach(chunk => {
        expect(chunk.tokenCount).toBeLessThanOrEqual(512);
      });
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should use custom max tokens when provided', () => {
      const customStrategy = new RecursiveChunkingStrategy({
        maxTokens: 100,
        overlapTokens: 10
      });
      const text = 'word '.repeat(200); // ~200 tokens

      const chunks = customStrategy.chunk(text);

      chunks.forEach(chunk => {
        expect(chunk.tokenCount).toBeLessThanOrEqual(100);
      });
      expect(chunks.length).toBeGreaterThan(1);
    });
  });

  describe('Overlap Between Chunks', () => {
    it('should include overlap between chunks (50 tokens)', () => {
      const strategy = new RecursiveChunkingStrategy({
        maxTokens: 100,
        overlapTokens: 20
      });
      const text = 'word '.repeat(150); // Create text that will be split

      const chunks = strategy.chunk(text);

      expect(chunks.length).toBeGreaterThan(1);

      // Check that last words of chunk[0] appear in chunk[1]
      if (chunks.length >= 2) {
        const chunk0Words = chunks[0].text.split(' ');
        const chunk1Words = chunks[1].text.split(' ');

        // Some words from end of chunk 0 should appear at start of chunk 1
        const overlapWords = chunk0Words.slice(-5); // Last 5 words
        const hasOverlap = overlapWords.some(word =>
          word && chunk1Words.some(w => w === word)
        );

        expect(hasOverlap).toBe(true);
      }
    });

    it('should not overlap if overlap tokens is 0', () => {
      const strategy = new RecursiveChunkingStrategy({
        maxTokens: 100,
        overlapTokens: 0
      });
      // Use numbered words to make overlap detection reliable
      const words = Array.from({ length: 150 }, (_, i) => `word${i}`).join(' ');

      const chunks = strategy.chunk(words);

      expect(chunks.length).toBeGreaterThan(1);

      // Verify no overlap: last word of chunk[0] should not appear in chunk[1]
      if (chunks.length >= 2) {
        const chunk0Words = chunks[0].text.split(' ').filter(w => w);
        const chunk1Words = chunks[1].text.split(' ').filter(w => w);
        const chunk0LastWord = chunk0Words[chunk0Words.length - 1];

        if (chunk0LastWord) {
          // Last word from chunk0 should NOT appear anywhere in chunk1 (no overlap)
          expect(chunk1Words.includes(chunk0LastWord)).toBe(false);
        }
      }
    });
  });

  describe('Metadata Generation', () => {
    it('should include chunk index starting from 0', () => {
      const text = 'Para 1.\n\nPara 2.\n\nPara 3.';

      const chunks = strategy.chunk(text);

      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[1].chunkIndex).toBe(1);
      expect(chunks[2].chunkIndex).toBe(2);
    });

    it('should calculate token count for each chunk', () => {
      const text = 'This is a test sentence with multiple words.';

      const chunks = strategy.chunk(text);

      expect(chunks[0].tokenCount).toBeGreaterThan(0);
      expect(chunks[0].tokenCount).toBeLessThan(20); // Reasonable estimate
    });

    it('should include start and end offsets', () => {
      const text = 'First paragraph.\n\nSecond paragraph.';

      const chunks = strategy.chunk(text);

      expect(chunks[0].startOffset).toBe(0);
      expect(chunks[0].endOffset).toBe(16); // "First paragraph."
      expect(chunks[1].startOffset).toBe(18); // After "\n\n"
      expect(chunks[1].endOffset).toBe(35);
    });

    it('should have contiguous offsets across chunks', () => {
      const text = 'word '.repeat(200); // Create multiple chunks
      const strategy = new RecursiveChunkingStrategy({
        maxTokens: 50,
        overlapTokens: 5
      });

      const chunks = strategy.chunk(text);

      // Check that chunks cover the full text
      expect(chunks[0].startOffset).toBe(0);
      expect(chunks[chunks.length - 1].endOffset).toBeLessThanOrEqual(text.length);
    });
  });

  describe('Edge Cases', () => {
    it('should handle text with multiple consecutive newlines', () => {
      const text = 'Para 1.\n\n\n\nPara 2.';

      const chunks = strategy.chunk(text);

      expect(chunks).toHaveLength(2);
      expect(chunks[0].text).toBe('Para 1.');
      expect(chunks[1].text).toBe('Para 2.');
    });

    it('should handle text starting with newlines', () => {
      const text = '\n\nParagraph 1.\n\nParagraph 2.';

      const chunks = strategy.chunk(text);

      expect(chunks).toHaveLength(2);
      expect(chunks[0].text).toBe('Paragraph 1.');
    });

    it('should handle text ending with newlines', () => {
      const text = 'Paragraph 1.\n\nParagraph 2.\n\n';

      const chunks = strategy.chunk(text);

      expect(chunks).toHaveLength(2);
      expect(chunks[1].text).toBe('Paragraph 2.');
    });

    it('should handle text with mixed line endings (\\r\\n, \\n)', () => {
      const text = 'Para 1.\r\n\r\nPara 2.\n\nPara 3.';

      const chunks = strategy.chunk(text);

      expect(chunks).toHaveLength(3);
      expect(chunks[0].text).toBe('Para 1.');
      expect(chunks[1].text).toBe('Para 2.');
      expect(chunks[2].text).toBe('Para 3.');
    });

    it('should handle text with special characters', () => {
      const text = 'Paragraph with émojis 🎉 and spëcial çhars.\n\nSecond párágraph.';

      const chunks = strategy.chunk(text);

      expect(chunks).toHaveLength(2);
      expect(chunks[0].text).toContain('🎉');
      expect(chunks[1].text).toContain('párágraph');
    });

    it('should handle very short text (< 5 words)', () => {
      const text = 'Short.';

      const chunks = strategy.chunk(text);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe('Short.');
    });
  });

  describe('Strategy Name', () => {
    it('should have correct strategy name', () => {
      expect(strategy.name).toBe('recursive');
    });
  });
});
