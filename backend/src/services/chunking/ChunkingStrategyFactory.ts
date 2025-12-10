import { ChunkingStrategy, ChunkingStrategyType, ChunkingOptions } from './types';
import { RecursiveChunkingStrategy } from './RecursiveChunkingStrategy';
import { SemanticChunkingStrategy } from './SemanticChunkingStrategy';
import { RowBasedChunkingStrategy } from './RowBasedChunkingStrategy';

export class ChunkingStrategyFactory {
  /**
   * Creates a chunking strategy based on the specified type.
   * @param type The type of chunking strategy to create.
   * @param options Configuration options for the strategy.
   */
  static create(
    type: ChunkingStrategyType,
    options: ChunkingOptions
  ): ChunkingStrategy {
    switch (type) {
      case 'recursive':
        return new RecursiveChunkingStrategy(options);
      case 'semantic':
        return new SemanticChunkingStrategy(options);
      case 'row-based':
        return new RowBasedChunkingStrategy(options);
      default:
        throw new Error(`Unknown chunking strategy: ${type}`);
    }
  }

  /**
   * Determines and creates the appropriate chunking strategy based on the file's MIME type.
   * @param mimeType The MIME type of the file.
   * @param options Configuration options for the strategy.
   * @param mimeType 
   */
  static createForFileType(mimeType: string, options: ChunkingOptions): ChunkingStrategy {
    const type = ChunkingStrategyFactory.getStrategyTypeForMimeType(mimeType);
    return ChunkingStrategyFactory.create(type, options);
  }

  /**
   * Helper to determine strategy type from MIME type.
   */
  static getStrategyTypeForMimeType(mimeType: string): ChunkingStrategyType {
    if (mimeType === 'text/csv' || mimeType === 'application/vnd.ms-excel' || mimeType.includes('spreadsheet')) {
      return 'row-based';
    }
    
    if (mimeType === 'text/markdown' || mimeType === 'text/plain') {
      return 'semantic';
    }

    // Default for PDFs, Word docs, code files, etc. where strict hierarchy matters
    return 'recursive'; 
  }
}
