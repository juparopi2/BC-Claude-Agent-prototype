/**
 * BlobContentProvider Unit Tests (PRD-100)
 *
 * Tests the blob-storage-backed IFileContentProvider implementation.
 * Covers getContent and isAccessible methods with mocked FileRepository
 * and FileUploadService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// MOCKS
// ============================================================================

const mockFindById = vi.hoisted(() => vi.fn());
const mockDownloadFromBlob = vi.hoisted(() => vi.fn());

vi.mock('@/services/files/repository/FileRepository', () => ({
  getFileRepository: vi.fn(() => ({
    findById: mockFindById,
  })),
}));

vi.mock('@/services/files/FileUploadService', () => ({
  getFileUploadService: vi.fn(() => ({
    downloadFromBlob: mockDownloadFromBlob,
  })),
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
  BlobContentProvider,
  __resetBlobContentProvider,
} from '@/services/connectors/BlobContentProvider';

// ============================================================================
// TEST SUITE
// ============================================================================

describe('BlobContentProvider', () => {
  const USER_ID = 'USER-A1B2C3D4-E5F6-7890-ABCD-EF1234567890';
  const FILE_ID = 'FILE-11111111-2222-3333-4444-555566667777';
  const BLOB_PATH = 'users/USER-A1B2C3D4-E5F6-7890-ABCD-EF1234567890/files/report.pdf';

  let provider: BlobContentProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetBlobContentProvider();
    provider = new BlobContentProvider();
  });

  // ==========================================================================
  // getContent
  // ==========================================================================

  describe('getContent', () => {
    it('returns buffer and mimeType when file exists', async () => {
      const fakeBuffer = Buffer.from('PDF content here');
      mockFindById.mockResolvedValue({
        id: FILE_ID,
        blobPath: BLOB_PATH,
        mimeType: 'application/pdf',
      });
      mockDownloadFromBlob.mockResolvedValue(fakeBuffer);

      const result = await provider.getContent(FILE_ID, USER_ID);

      expect(result.buffer).toBe(fakeBuffer);
      expect(result.mimeType).toBe('application/pdf');
      expect(mockFindById).toHaveBeenCalledWith(USER_ID, FILE_ID);
      expect(mockDownloadFromBlob).toHaveBeenCalledWith(BLOB_PATH);
    });

    it('throws when file not found', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(provider.getContent(FILE_ID, USER_ID)).rejects.toThrow(
        `File not found: ${FILE_ID}`
      );

      expect(mockDownloadFromBlob).not.toHaveBeenCalled();
    });

    it('throws when file has no blobPath', async () => {
      mockFindById.mockResolvedValue({
        id: FILE_ID,
        blobPath: null,
        mimeType: null,
        isFolder: true,
      });

      await expect(provider.getContent(FILE_ID, USER_ID)).rejects.toThrow(
        `File has no blob path: ${FILE_ID}`
      );

      expect(mockDownloadFromBlob).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // isAccessible
  // ==========================================================================

  describe('isAccessible', () => {
    it('returns true when file exists with blobPath', async () => {
      mockFindById.mockResolvedValue({
        id: FILE_ID,
        blobPath: BLOB_PATH,
      });

      const result = await provider.isAccessible(FILE_ID, USER_ID);

      expect(result).toBe(true);
    });

    it('returns false when file not found', async () => {
      mockFindById.mockResolvedValue(null);

      const result = await provider.isAccessible(FILE_ID, USER_ID);

      expect(result).toBe(false);
    });

    it('returns false when file has no blobPath', async () => {
      mockFindById.mockResolvedValue({
        id: FILE_ID,
        blobPath: null,
      });

      const result = await provider.isAccessible(FILE_ID, USER_ID);

      expect(result).toBe(false);
    });

    it('returns false when an error occurs', async () => {
      mockFindById.mockRejectedValue(new Error('DB connection failed'));

      const result = await provider.isAccessible(FILE_ID, USER_ID);

      expect(result).toBe(false);
    });
  });
});
