import { describe, it, expect } from 'vitest';
import { parseCitations, hasCitations, CITATION_REGEX } from '@/lib/utils/citationParser';

describe('citationParser', () => {
  describe('CITATION_REGEX', () => {
    it('should match files with extensions', () => {
      expect('[document.pdf]').toMatch(CITATION_REGEX);
      expect('[data.xlsx]').toMatch(CITATION_REGEX);
      expect('[image.png]').toMatch(CITATION_REGEX);
    });

    it('should NOT match references without extensions', () => {
      CITATION_REGEX.lastIndex = 0;
      expect('[1]').not.toMatch(CITATION_REGEX);
      expect('[reference]').not.toMatch(CITATION_REGEX);
    });

    it('should NOT match markdown links', () => {
      // This tests that [text](url) doesn't match incorrectly
      const text = '[link](https://example.com)';
      CITATION_REGEX.lastIndex = 0;
      const matches = text.match(CITATION_REGEX);
      expect(matches).toBeNull();
    });
  });

  describe('parseCitations', () => {
    it('should parse text with single citation', () => {
      const result = parseCitations('Check [document.pdf] for details');
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ type: 'text', content: 'Check ' });
      expect(result[1]).toEqual({ type: 'citation', content: 'document.pdf', fileId: null });
      expect(result[2]).toEqual({ type: 'text', content: ' for details' });
    });

    it('should parse text with multiple citations', () => {
      const result = parseCitations('See [doc.pdf] and [data.xlsx]');
      expect(result).toHaveLength(4);
      expect(result.filter(s => s.type === 'citation')).toHaveLength(2);
    });

    it('should match fileId from fileMap', () => {
      const fileMap = new Map([['document.pdf', 'file-123']]);
      const result = parseCitations('Check [document.pdf]', fileMap);
      expect(result[1]?.fileId).toBe('file-123');
    });

    it('should return null fileId for unmatched files', () => {
      const fileMap = new Map([['other.pdf', 'file-456']]);
      const result = parseCitations('Check [document.pdf]', fileMap);
      expect(result[1]?.fileId).toBeNull();
    });

    it('should handle text without citations', () => {
      const result = parseCitations('No citations here');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ type: 'text', content: 'No citations here' });
    });
  });

  describe('hasCitations', () => {
    it('should return true when citations exist', () => {
      expect(hasCitations('Check [doc.pdf]')).toBe(true);
    });

    it('should return false when no citations', () => {
      expect(hasCitations('No citations here')).toBe(false);
    });
  });
});
