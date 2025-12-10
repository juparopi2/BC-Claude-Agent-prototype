import { describe, it, expect, beforeEach } from 'vitest';
import { RowBasedChunkingStrategy } from '@/services/chunking/RowBasedChunkingStrategy';
import type { ChunkResult } from '@/services/chunking/types';

describe('RowBasedChunkingStrategy', () => {
  let strategy: RowBasedChunkingStrategy;

  beforeEach(() => {
    // Default configuration: 512 max tokens, 50 overlap (overlap less relevant for tables)
    strategy = new RowBasedChunkingStrategy({
      maxTokens: 512,
      overlapTokens: 0 // Tables don't need overlap
    });
  });

  describe('Markdown Table Chunking', () => {
    it('should detect and chunk markdown tables by rows', () => {
      const table = `| Name | Age | City |
|------|-----|------|
| John | 30 | NYC |
| Jane | 25 | LA |
| Bob | 35 | SF |`;

      const chunks = strategy.chunk(table);

      // Should have header + rows
      expect(chunks.length).toBeGreaterThan(0);
      // First chunk should include header
      expect(chunks[0].text).toContain('| Name | Age | City |');
    });

    it('should preserve table headers in each chunk', () => {
      const strategy = new RowBasedChunkingStrategy({
        maxTokens: 50, // Small limit to force multiple chunks
        overlapTokens: 0
      });

      const table = `| Product | Price | Stock |
|---------|-------|-------|
| Apple | $1.50 | 100 |
| Banana | $0.80 | 150 |
| Cherry | $2.00 | 80 |
| Date | $3.50 | 50 |`;

      const chunks = strategy.chunk(table);

      // Each chunk should have the header row
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach(chunk => {
        expect(chunk.text).toContain('| Product | Price | Stock |');
      });
    });

    it('should chunk large tables into manageable sizes', () => {
      const strategy = new RowBasedChunkingStrategy({
        maxTokens: 100,
        overlapTokens: 0
      });

      // Create a large table
      const header = '| ID | Name | Value |\n|----|----- |-------|';
      const rows = Array.from({ length: 50 }, (_, i) =>
        `| ${i} | Item${i} | ${i * 10} |`
      ).join('\n');
      const table = header + '\n' + rows;

      const chunks = strategy.chunk(table);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach(chunk => {
        expect(chunk.tokenCount).toBeLessThanOrEqual(100);
      });
    });
  });

  describe('CSV Format Handling', () => {
    it('should detect and chunk CSV data', () => {
      const csv = `Name,Age,City
John,30,NYC
Jane,25,LA
Bob,35,SF`;

      const chunks = strategy.chunk(csv);

      expect(chunks.length).toBeGreaterThan(0);
      // First chunk should include header
      expect(chunks[0].text).toContain('Name,Age,City');
    });

    it('should preserve CSV headers in each chunk', () => {
      const strategy = new RowBasedChunkingStrategy({
        maxTokens: 30,
        overlapTokens: 0
      });

      const csv = `Product,Price,Stock
Apple,1.50,100
Banana,0.80,150
Cherry,2.00,80
Date,3.50,50`;

      const chunks = strategy.chunk(csv);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach(chunk => {
        expect(chunk.text).toContain('Product,Price,Stock');
      });
    });

    it('should handle quoted CSV values', () => {
      const csv = `Name,Description,Price
"Product A","Contains, commas",10.50
"Product B","Normal description",20.00`;

      const chunks = strategy.chunk(csv);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].text).toContain('"Product A"');
    });
  });

  describe('Non-Table Text Handling', () => {
    it('should handle non-table text gracefully', () => {
      const text = 'This is regular text without any table structure.';

      const chunks = strategy.chunk(text);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe(text);
    });

    it('should handle mixed table and text content', () => {
      const mixed = `Here is some context text.

| Name | Value |
|------|-------|
| A | 1 |
| B | 2 |

And here is some concluding text.`;

      const chunks = strategy.chunk(mixed);

      expect(chunks.length).toBeGreaterThan(0);
      // Should contain both table and text
      expect(chunks.some(c => c.text.includes('context text'))).toBe(true);
      expect(chunks.some(c => c.text.includes('| Name | Value |'))).toBe(true);
    });
  });

  describe('Token Limits', () => {
    it('should respect max token limit', () => {
      const strategy = new RowBasedChunkingStrategy({
        maxTokens: 50,
        overlapTokens: 0
      });

      const largeTable = `| A | B | C | D | E |
|---|---|---|---|---|
${Array.from({ length: 30 }, (_, i) => `| ${i} | ${i} | ${i} | ${i} | ${i} |`).join('\n')}`;

      const chunks = strategy.chunk(largeTable);

      chunks.forEach(chunk => {
        expect(chunk.tokenCount).toBeLessThanOrEqual(50);
      });
    });

    it('should split rows if single row exceeds token limit', () => {
      const strategy = new RowBasedChunkingStrategy({
        maxTokens: 30,
        overlapTokens: 0
      });

      // Very wide row
      const table = `| Col1 | Col2 | Col3 | Col4 | Col5 | Col6 | Col7 | Col8 |
|------|------|------|------|------|------|------|------|
| VeryLongValue1 | VeryLongValue2 | VeryLongValue3 | VeryLongValue4 | VeryLongValue5 | VeryLongValue6 | VeryLongValue7 | VeryLongValue8 |`;

      const chunks = strategy.chunk(table);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
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

    it('should handle table with only header', () => {
      const table = `| Name | Age |
|------|-----|`;

      const chunks = strategy.chunk(table);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toContain('| Name | Age |');
    });

    it('should handle malformed table', () => {
      const malformed = `| Name | Age |
| John | 30
| Jane`;

      const chunks = strategy.chunk(malformed);

      // Should still produce chunks
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle CSV with empty lines', () => {
      const csv = `Name,Age

John,30

Jane,25`;

      const chunks = strategy.chunk(csv);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].text).toContain('Name,Age');
    });
  });

  describe('Metadata Generation', () => {
    it('should include correct chunk indices', () => {
      const strategy = new RowBasedChunkingStrategy({
        maxTokens: 50,
        overlapTokens: 0
      });

      const table = `| A | B |
|---|---|
${Array.from({ length: 20 }, (_, i) => `| ${i} | ${i} |`).join('\n')}`;

      const chunks = strategy.chunk(table);

      chunks.forEach((chunk, i) => {
        expect(chunk.chunkIndex).toBe(i);
      });
    });

    it('should calculate token counts', () => {
      const table = `| Name | Age |
|------|-----|
| John | 30 |`;

      const chunks = strategy.chunk(table);

      expect(chunks[0].tokenCount).toBeGreaterThan(0);
    });

    it('should include start and end offsets', () => {
      const text = `Table:

| A | B |
|---|---|
| 1 | 2 |`;

      const chunks = strategy.chunk(text);

      expect(chunks[0].startOffset).toBe(0);
      expect(chunks[0].endOffset).toBeGreaterThan(0);
    });
  });

  describe('Strategy Name', () => {
    it('should have correct strategy name', () => {
      expect(strategy.name).toBe('row-based');
    });
  });
});
