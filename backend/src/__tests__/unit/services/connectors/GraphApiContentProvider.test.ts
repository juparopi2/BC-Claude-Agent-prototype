/**
 * GraphApiContentProvider Unit Tests (PRD-101)
 *
 * Tests the Microsoft Graph API-backed IFileContentProvider implementation.
 * Covers getContent, isAccessible, and getDownloadUrl with mocked Prisma and
 * OneDriveService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// MOCKS
// ============================================================================

const mockFindFirst = vi.hoisted(() => vi.fn());
const mockDownloadFileContent = vi.hoisted(() => vi.fn());
const mockDownloadFileContentFromDrive = vi.hoisted(() => vi.fn());
const mockGetDownloadUrl = vi.hoisted(() => vi.fn());
const mockGetDownloadUrlFromDrive = vi.hoisted(() => vi.fn());

vi.mock('@/shared/utils/logger', () => ({
  createChildLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('@/infrastructure/database/prisma', () => ({
  prisma: {
    files: {
      findFirst: mockFindFirst,
    },
  },
}));

vi.mock('@/services/connectors/onedrive/OneDriveService', () => ({
  getOneDriveService: vi.fn(() => ({
    downloadFileContent: mockDownloadFileContent,
    downloadFileContentFromDrive: mockDownloadFileContentFromDrive,
    getDownloadUrl: mockGetDownloadUrl,
    getDownloadUrlFromDrive: mockGetDownloadUrlFromDrive,
  })),
}));

// Import after mocks
import {
  GraphApiContentProvider,
  __resetGraphApiContentProvider,
} from '@/services/connectors/GraphApiContentProvider';

// ============================================================================
// TEST SUITE
// ============================================================================

describe('GraphApiContentProvider', () => {
  const USER_ID = 'USER-A1B2C3D4-E5F6-7890-ABCD-EF1234567890';
  const FILE_ID = 'FILE-11111111-2222-3333-4444-555566667777';
  const CONNECTION_ID = 'CONN-1';
  const EXTERNAL_ID = 'ext-123';

  const BASE_FILE_RECORD = {
    connection_id: CONNECTION_ID,
    external_id: EXTERNAL_ID,
    mime_type: 'application/pdf',
    connections: { status: 'connected' },
  };

  let provider: GraphApiContentProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetGraphApiContentProvider();
    provider = new GraphApiContentProvider();
  });

  // ==========================================================================
  // getContent
  // ==========================================================================

  describe('getContent', () => {
    it('returns buffer and mimeType from file record', async () => {
      const fakeBuffer = Buffer.from('PDF binary content');
      mockFindFirst.mockResolvedValue(BASE_FILE_RECORD);
      mockDownloadFileContent.mockResolvedValue({ buffer: fakeBuffer });

      const result = await provider.getContent(FILE_ID, USER_ID);

      expect(result.buffer).toBe(fakeBuffer);
      expect(result.mimeType).toBe('application/pdf');
      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: FILE_ID, user_id: USER_ID },
          select: expect.objectContaining({
            connection_id: true,
            external_id: true,
            mime_type: true,
          }),
        })
      );
      expect(mockDownloadFileContent).toHaveBeenCalledWith(CONNECTION_ID, EXTERNAL_ID);
    });

    it('throws when file not found (prisma returns null)', async () => {
      mockFindFirst.mockResolvedValue(null);

      await expect(provider.getContent(FILE_ID, USER_ID)).rejects.toThrow(
        `File not found or not accessible: ${FILE_ID}`
      );

      expect(mockDownloadFileContent).not.toHaveBeenCalled();
    });

    it('throws when file has no connection_id', async () => {
      mockFindFirst.mockResolvedValue({
        ...BASE_FILE_RECORD,
        connection_id: null,
      });

      await expect(provider.getContent(FILE_ID, USER_ID)).rejects.toThrow(
        `File not found or not accessible: ${FILE_ID}`
      );

      expect(mockDownloadFileContent).not.toHaveBeenCalled();
    });

    it('throws when file has no external_id', async () => {
      mockFindFirst.mockResolvedValue({
        ...BASE_FILE_RECORD,
        external_id: null,
      });

      await expect(provider.getContent(FILE_ID, USER_ID)).rejects.toThrow(
        `File not found or not accessible: ${FILE_ID}`
      );

      expect(mockDownloadFileContent).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // isAccessible
  // ==========================================================================

  describe('isAccessible', () => {
    it('returns true when file exists with connected connection', async () => {
      mockFindFirst.mockResolvedValue(BASE_FILE_RECORD);

      const result = await provider.isAccessible(FILE_ID, USER_ID);

      expect(result).toBe(true);
      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: FILE_ID, user_id: USER_ID },
          select: expect.objectContaining({
            connection_id: true,
            external_id: true,
            connections: { select: { status: true } },
          }),
        })
      );
    });

    it('returns false when file not found', async () => {
      mockFindFirst.mockResolvedValue(null);

      const result = await provider.isAccessible(FILE_ID, USER_ID);

      expect(result).toBe(false);
    });

    it('returns false when connection status is not connected', async () => {
      mockFindFirst.mockResolvedValue({
        ...BASE_FILE_RECORD,
        connections: { status: 'disconnected' },
      });

      const result = await provider.isAccessible(FILE_ID, USER_ID);

      expect(result).toBe(false);
    });

    it('returns false on DB error (does not throw)', async () => {
      mockFindFirst.mockRejectedValue(new Error('DB connection failed'));

      const result = await provider.isAccessible(FILE_ID, USER_ID);

      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // getDownloadUrl
  // ==========================================================================

  describe('getDownloadUrl', () => {
    it('returns URL from OneDriveService', async () => {
      const expectedUrl = 'https://download.example.com/file?token=abc123';
      mockFindFirst.mockResolvedValue(BASE_FILE_RECORD);
      mockGetDownloadUrl.mockResolvedValue(expectedUrl);

      const result = await provider.getDownloadUrl(FILE_ID, USER_ID);

      expect(result).toBe(expectedUrl);
      expect(mockGetDownloadUrl).toHaveBeenCalledWith(CONNECTION_ID, EXTERNAL_ID);
    });

    it('throws when file not found', async () => {
      mockFindFirst.mockResolvedValue(null);

      await expect(provider.getDownloadUrl(FILE_ID, USER_ID)).rejects.toThrow(
        `File not found or not accessible: ${FILE_ID}`
      );

      expect(mockGetDownloadUrl).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // PRD-110: external_drive_id routing
  // ==========================================================================

  describe('getContent — PRD-110 external_drive_id routing', () => {
    it('downloads from external_drive_id when set', async () => {
      const REMOTE_DRIVE_ID = 'REMOTE-DRIVE-001';
      const fakeBuffer = Buffer.from('shared file content');
      mockFindFirst.mockResolvedValue({
        ...BASE_FILE_RECORD,
        external_drive_id: REMOTE_DRIVE_ID,
      });
      mockDownloadFileContentFromDrive.mockResolvedValue({ buffer: fakeBuffer });

      const result = await provider.getContent(FILE_ID, USER_ID);

      expect(result.buffer).toBe(fakeBuffer);
      expect(mockDownloadFileContentFromDrive).toHaveBeenCalledWith(
        CONNECTION_ID,
        REMOTE_DRIVE_ID,
        EXTERNAL_ID
      );
      expect(mockDownloadFileContent).not.toHaveBeenCalled();
    });

    it('falls back to connection drive when external_drive_id is null', async () => {
      const fakeBuffer = Buffer.from('regular file content');
      mockFindFirst.mockResolvedValue({
        ...BASE_FILE_RECORD,
        external_drive_id: null,
      });
      mockDownloadFileContent.mockResolvedValue({ buffer: fakeBuffer });

      const result = await provider.getContent(FILE_ID, USER_ID);

      expect(result.buffer).toBe(fakeBuffer);
      expect(mockDownloadFileContent).toHaveBeenCalledWith(CONNECTION_ID, EXTERNAL_ID);
      expect(mockDownloadFileContentFromDrive).not.toHaveBeenCalled();
    });
  });

  describe('getDownloadUrl — PRD-110 external_drive_id routing', () => {
    it('routes to getDownloadUrlFromDrive when external_drive_id is set', async () => {
      const REMOTE_DRIVE_ID = 'REMOTE-DRIVE-001';
      const expectedUrl = 'https://remote-drive.example.com/file?token=xyz';
      mockFindFirst.mockResolvedValue({
        ...BASE_FILE_RECORD,
        external_drive_id: REMOTE_DRIVE_ID,
      });
      mockGetDownloadUrlFromDrive.mockResolvedValue(expectedUrl);

      const result = await provider.getDownloadUrl(FILE_ID, USER_ID);

      expect(result).toBe(expectedUrl);
      expect(mockGetDownloadUrlFromDrive).toHaveBeenCalledWith(
        CONNECTION_ID,
        REMOTE_DRIVE_ID,
        EXTERNAL_ID
      );
      expect(mockGetDownloadUrl).not.toHaveBeenCalled();
    });

    it('routes to getDownloadUrl when external_drive_id is null', async () => {
      const expectedUrl = 'https://download.example.com/file?token=abc';
      mockFindFirst.mockResolvedValue({
        ...BASE_FILE_RECORD,
        external_drive_id: null,
      });
      mockGetDownloadUrl.mockResolvedValue(expectedUrl);

      const result = await provider.getDownloadUrl(FILE_ID, USER_ID);

      expect(result).toBe(expectedUrl);
      expect(mockGetDownloadUrl).toHaveBeenCalledWith(CONNECTION_ID, EXTERNAL_ID);
      expect(mockGetDownloadUrlFromDrive).not.toHaveBeenCalled();
    });
  });
});
