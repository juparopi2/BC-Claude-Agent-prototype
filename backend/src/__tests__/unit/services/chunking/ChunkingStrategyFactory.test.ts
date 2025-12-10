import { ChunkingStrategyFactory } from '../../../../services/chunking/ChunkingStrategyFactory';
import { RecursiveChunkingStrategy } from '../../../../services/chunking/RecursiveChunkingStrategy';
import { SemanticChunkingStrategy } from '../../../../services/chunking/SemanticChunkingStrategy';
import { RowBasedChunkingStrategy } from '../../../../services/chunking/RowBasedChunkingStrategy';
import { ChunkingOptions } from '../../../../services/chunking/types';

describe('ChunkingStrategyFactory', () => {
  const defaultOptions: ChunkingOptions = {
    maxTokens: 512,
    overlap: 50
  };

  describe('create', () => {
    it('should create RecursiveChunkingStrategy when type is recursive', () => {
      const strategy = ChunkingStrategyFactory.create('recursive', defaultOptions);
      expect(strategy).toBeInstanceOf(RecursiveChunkingStrategy);
      expect(strategy).toBeInstanceOf(RecursiveChunkingStrategy);
      // internal state verification skipped as properties are private
    });

    it('should create SemanticChunkingStrategy when type is semantic', () => {
      const strategy = ChunkingStrategyFactory.create('semantic', defaultOptions);
      expect(strategy).toBeInstanceOf(SemanticChunkingStrategy);
    });

    it('should create RowBasedChunkingStrategy when type is row-based', () => {
      const strategy = ChunkingStrategyFactory.create('row-based', defaultOptions);
      expect(strategy).toBeInstanceOf(RowBasedChunkingStrategy);
    });

    it('should throw error for unknown strategy type', () => {
      expect(() => {
        // @ts-ignore - Testing invalid input
        ChunkingStrategyFactory.create('unknown', defaultOptions);
      }).toThrow('Unknown chunking strategy: unknown');
    });
  });

  describe('createForFileType', () => {
    it('should return row-based strategy for CSV files', () => {
      const strategy = ChunkingStrategyFactory.createForFileType('text/csv', defaultOptions);
      expect(strategy).toBeInstanceOf(RowBasedChunkingStrategy);
    });

    it('should return row-based strategy for Excel files', () => {
      const strategy = ChunkingStrategyFactory.createForFileType('application/vnd.ms-excel', defaultOptions);
      expect(strategy).toBeInstanceOf(RowBasedChunkingStrategy);
    });

    it('should return semantic strategy for Markdown files', () => {
      const strategy = ChunkingStrategyFactory.createForFileType('text/markdown', defaultOptions);
      expect(strategy).toBeInstanceOf(SemanticChunkingStrategy);
    });

    it('should return semantic strategy for Plain Text files', () => {
      const strategy = ChunkingStrategyFactory.createForFileType('text/plain', defaultOptions);
      expect(strategy).toBeInstanceOf(SemanticChunkingStrategy);
    });

    it('should return recursive strategy for PDF files (default)', () => {
      const strategy = ChunkingStrategyFactory.createForFileType('application/pdf', defaultOptions);
      expect(strategy).toBeInstanceOf(RecursiveChunkingStrategy);
    });

    it('should return recursive strategy for unknown types', () => {
      const strategy = ChunkingStrategyFactory.createForFileType('application/octet-stream', defaultOptions);
      expect(strategy).toBeInstanceOf(RecursiveChunkingStrategy);
    });
  });
});
