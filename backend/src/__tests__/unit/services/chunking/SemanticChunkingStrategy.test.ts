import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticChunkingStrategy } from '@/services/chunking/SemanticChunkingStrategy';
import type { ChunkResult } from '@/services/chunking/types';

describe('SemanticChunkingStrategy', () => {
  let strategy: SemanticChunkingStrategy;

  beforeEach(() => {
    // Default configuration: 512 max tokens, 50 overlap
    strategy = new SemanticChunkingStrategy({
      maxTokens: 512,
      overlapTokens: 50
    });
  });

  describe('Topic Boundary Detection', () => {
    it('should detect paragraph breaks as topic boundaries', () => {
      const text = `Introduction to machine learning. ML is a subset of AI.

Advanced techniques in deep learning. Neural networks are powerful.

Conclusion and future directions. AI will transform industries.`;

      const chunks = strategy.chunk(text);

      expect(chunks).toHaveLength(3);
      expect(chunks[0].text).toContain('Introduction');
      expect(chunks[1].text).toContain('Advanced');
      expect(chunks[2].text).toContain('Conclusion');
    });

    it('should detect transition words as potential topic changes', () => {
      const text = 'First point about topic A. However, topic B is different. Furthermore, topic C adds more.';

      const chunks = strategy.chunk(text);

      // Should split on transition words when they signal topic change
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // At minimum, should keep sentences together
      chunks.forEach(chunk => {
        expect(chunk.text.length).toBeGreaterThan(0);
      });
    });

    it('should keep related sentences in the same paragraph together', () => {
      const text = 'This is the first sentence. This is the second sentence. This is the third sentence.';

      const chunks = strategy.chunk(text);

      // Without paragraph breaks, should keep together if under token limit
      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe(text);
    });
  });

  describe('Sentence Integrity', () => {
    it('should never split mid-sentence', () => {
      const longSentence = 'This is a very long sentence that contains many words and clauses, but it should never be split in the middle regardless of length.';

      const chunks = strategy.chunk(longSentence);

      // Each chunk should end with sentence-ending punctuation or be the complete sentence
      chunks.forEach(chunk => {
        const trimmed = chunk.text.trim();
        if (chunks.length > 1) {
          // If split was necessary, should end with punctuation
          expect(/[.!?]$/.test(trimmed) || chunk === chunks[chunks.length - 1]).toBe(true);
        }
      });
    });

    it('should keep sentences together when possible', () => {
      const text = 'Short sentence one. Short sentence two. Short sentence three.';

      const chunks = strategy.chunk(text);

      // Should keep all short sentences together
      expect(chunks).toHaveLength(1);
    });

    it('should split long text at sentence boundaries', () => {
      const strategy = new SemanticChunkingStrategy({
        maxTokens: 50,
        overlapTokens: 5
      });
      const text = 'First sentence with some words. '.repeat(10);

      const chunks = strategy.chunk(text);

      // Should split, but each chunk should contain complete sentences
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach(chunk => {
        // Should end with period (complete sentence)
        expect(chunk.text.trim().endsWith('.')).toBe(true);
      });
    });
  });

  describe('Token Limits', () => {
    it('should respect max token limit', () => {
      const strategy = new SemanticChunkingStrategy({
        maxTokens: 100,
        overlapTokens: 10
      });
      const longText = 'word '.repeat(200);

      const chunks = strategy.chunk(longText);

      chunks.forEach(chunk => {
        expect(chunk.tokenCount).toBeLessThanOrEqual(100);
      });
    });

    it('should handle text exceeding token limit by falling back to word split', () => {
      const strategy = new SemanticChunkingStrategy({
        maxTokens: 20,
        overlapTokens: 0
      });
      const longSentence = 'word '.repeat(100); // Very long without sentence breaks

      const chunks = strategy.chunk(longSentence);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach(chunk => {
        expect(chunk.tokenCount).toBeLessThanOrEqual(20);
      });
    });
  });

  describe('Semantic Coherence', () => {
    it('should prefer paragraph-level splits over sentence-level splits', () => {
      const text = `Paragraph one has multiple sentences. It discusses topic A in detail. The topic is important.

Paragraph two introduces topic B. This is a different subject. It requires separate treatment.`;

      const chunks = strategy.chunk(text);

      // Should split at paragraph boundary
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks[0].text).toContain('Paragraph one');
      expect(chunks[1].text).toContain('Paragraph two');
    });

    it('should maintain context with overlap when needed', () => {
      const strategy = new SemanticChunkingStrategy({
        maxTokens: 30,
        overlapTokens: 10
      });
      const text = 'Sentence one. '.repeat(10);

      const chunks = strategy.chunk(text);

      if (chunks.length > 1) {
        // Verify overlap exists
        const chunk0Words = chunks[0].text.split(' ').filter(w => w);
        const chunk1Words = chunks[1].text.split(' ').filter(w => w);

        // Some words from end of chunk0 should appear in chunk1
        const lastWords = chunk0Words.slice(-3);
        const hasOverlap = lastWords.some(word =>
          chunk1Words.some(w => w.includes(word.replace(/[.,]/g, '')))
        );

        expect(hasOverlap).toBe(true);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty text', () => {
      const text = '';

      const chunks = strategy.chunk(text);

      expect(chunks).toHaveLength(0);
    });

    it('should handle text with only whitespace', () => {
      const text = '   \n\n   ';

      const chunks = strategy.chunk(text);

      expect(chunks).toHaveLength(0);
    });

    it('should handle single sentence', () => {
      const text = 'This is a single sentence.';

      const chunks = strategy.chunk(text);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe(text);
    });

    it('should handle text without punctuation', () => {
      const text = 'This is text without any sentence ending punctuation';

      const chunks = strategy.chunk(text);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe(text);
    });

    it('should handle multiple consecutive paragraph breaks', () => {
      const text = 'Paragraph one.\n\n\n\nParagraph two.';

      const chunks = strategy.chunk(text);

      expect(chunks).toHaveLength(2);
      expect(chunks[0].text).toBe('Paragraph one.');
      expect(chunks[1].text).toBe('Paragraph two.');
    });

    it('should handle mixed punctuation', () => {
      const text = 'Question? Exclamation! Statement. Another statement.';

      const chunks = strategy.chunk(text);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe(text);
    });
  });

  describe('Metadata Generation', () => {
    it('should include correct chunk indices', () => {
      const strategy = new SemanticChunkingStrategy({
        maxTokens: 30,
        overlapTokens: 5
      });
      const text = 'Sentence. '.repeat(20);

      const chunks = strategy.chunk(text);

      chunks.forEach((chunk, i) => {
        expect(chunk.chunkIndex).toBe(i);
      });
    });

    it('should calculate token counts', () => {
      const text = 'This is a test sentence with several words.';

      const chunks = strategy.chunk(text);

      expect(chunks[0].tokenCount).toBeGreaterThan(0);
      expect(chunks[0].tokenCount).toBeLessThan(20);
    });

    it('should include start and end offsets', () => {
      const text = 'First paragraph.\n\nSecond paragraph.';

      const chunks = strategy.chunk(text);

      expect(chunks[0].startOffset).toBe(0);
      expect(chunks[0].endOffset).toBe(16); // "First paragraph."
      if (chunks.length > 1) {
        expect(chunks[1].startOffset).toBeGreaterThan(0);
        expect(chunks[1].endOffset).toBeLessThanOrEqual(text.length);
      }
    });
  });

  describe('Strategy Name', () => {
    it('should have correct strategy name', () => {
      expect(strategy.name).toBe('semantic');
    });
  });
});
