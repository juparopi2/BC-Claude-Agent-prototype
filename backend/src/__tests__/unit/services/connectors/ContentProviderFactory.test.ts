/**
 * ContentProviderFactory Unit Tests (PRD-100)
 *
 * Tests the factory that resolves IFileContentProvider implementations
 * based on file source type.
 *
 * Covers:
 * - 'local' → BlobContentProvider (via getBlobContentProvider)
 * - 'onedrive' → throws not-implemented error (PRD-101)
 * - 'sharepoint' → throws not-implemented error (PRD-103)
 * - unknown → throws unknown source type error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// MOCKS
// ============================================================================

const mockBlobProvider = vi.hoisted(() => ({
  getContent: vi.fn(),
  isAccessible: vi.fn(),
}));

vi.mock('@/services/connectors/BlobContentProvider', () => ({
  getBlobContentProvider: vi.fn(() => mockBlobProvider),
}));

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Import after mocks
import {
  ContentProviderFactory,
  __resetContentProviderFactory,
} from '@/services/connectors/ContentProviderFactory';

// ============================================================================
// TEST SUITE
// ============================================================================

describe('ContentProviderFactory', () => {
  let factory: ContentProviderFactory;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetContentProviderFactory();
    factory = new ContentProviderFactory();
  });

  describe('getProvider', () => {
    it("returns BlobContentProvider for 'local' source type", () => {
      const provider = factory.getProvider('local');

      expect(provider).toBe(mockBlobProvider);
    });

    it("throws 'not implemented' for 'onedrive' source type", () => {
      expect(() => factory.getProvider('onedrive')).toThrow(
        expect.objectContaining({
          message: expect.stringContaining('PRD-101'),
        })
      );
    });

    it("throws 'not implemented' for 'sharepoint' source type", () => {
      expect(() => factory.getProvider('sharepoint')).toThrow(
        expect.objectContaining({
          message: expect.stringContaining('PRD-101'),
        })
      );
    });

    it('throws for unknown source type', () => {
      expect(() => factory.getProvider('dropbox')).toThrow(
        expect.objectContaining({
          message: expect.stringContaining('Unknown source type'),
        })
      );
    });
  });
});
