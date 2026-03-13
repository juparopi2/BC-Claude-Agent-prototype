/**
 * ContentProviderFactory Unit Tests (PRD-100 + PRD-101)
 *
 * Tests the factory that resolves IFileContentProvider implementations
 * based on file source type.
 *
 * Covers:
 * - 'local' → BlobContentProvider (via getBlobContentProvider)
 * - 'onedrive' → GraphApiContentProvider (PRD-101)
 * - 'sharepoint' → GraphApiContentProvider (same as OneDrive, via Microsoft Graph drives API)
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

const mockGraphApiProvider = vi.hoisted(() => ({
  getContent: vi.fn(),
  isAccessible: vi.fn(),
  getDownloadUrl: vi.fn(),
}));

vi.mock('@/services/connectors/BlobContentProvider', () => ({
  getBlobContentProvider: vi.fn(() => mockBlobProvider),
}));

vi.mock('@/services/connectors/GraphApiContentProvider', () => ({
  getGraphApiContentProvider: vi.fn(() => mockGraphApiProvider),
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

    it("returns GraphApiContentProvider for 'onedrive' source type", () => {
      const provider = factory.getProvider('onedrive');

      expect(provider).toBe(mockGraphApiProvider);
    });

    it("returns GraphApiContentProvider for 'sharepoint' source type", () => {
      const provider = factory.getProvider('sharepoint');

      expect(provider).toBe(mockGraphApiProvider);
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
