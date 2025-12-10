import { ChunkResult } from '../../services/chunking/types';

export class ChunkFixture {
  static createChunk(overrides?: Partial<ChunkResult>): ChunkResult {
    return {
      text: 'Sample chunk text with multiple sentences.',
      chunkIndex: 0,
      tokenCount: 12,
      startOffset: 0,
      endOffset: 42,
      metadata: {
        startIndex: 0,
        endIndex: 42
      },
      ...overrides
    };
  }

  static createMultipleChunks(count: number): ChunkResult[] {
    return Array.from({ length: count }, (_, i) =>
      ChunkFixture.createChunk({
        chunkIndex: i,
        text: `Chunk ${i} content with some text.`,
        startOffset: i * 50,
        endOffset: (i + 1) * 50,
        tokenCount: 10,
        metadata: {
          startIndex: i * 50,
          endIndex: (i + 1) * 50
        }
      })
    );
  }

  // Presets para casos comunes
  static Presets = {
    shortParagraph: () => ChunkFixture.createChunk({
      text: 'This is a short paragraph.',
      tokenCount: 7,
      endOffset: 26,
      metadata: { startIndex: 0, endIndex: 26 }
    }),

    longDocument: () => ChunkFixture.createMultipleChunks(10),

    tableRows: () => ChunkFixture.createChunk({
      text: '| Name | Age |\n|------|-----|\n| John | 30 |',
      tokenCount: 15,
      metadata: {
        isTable: true,
        startIndex: 0,
        endIndex: 45
      }
    })
  };
}
