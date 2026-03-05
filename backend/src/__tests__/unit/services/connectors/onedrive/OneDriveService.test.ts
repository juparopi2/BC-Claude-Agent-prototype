/**
 * OneDriveService Unit Tests (PRD-101)
 *
 * Tests the OneDrive Graph API wrapper service, covering:
 * - getDriveInfo: mapping raw Graph drive response to DriveInfo DTO
 * - listFolder: root and specific folder listing, pagination via @odata.nextLink
 * - downloadFileContent: binary buffer retrieval, correct drive path usage
 * - getDownloadUrl: pre-authenticated URL extraction, error on missing URL
 * - executeDeltaQuery: change detection with 'modified' and 'deleted' changeType,
 *   deltaLink and nextPageLink handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// MOCKS (hoisted so vi.mock factories can reference them)
// ============================================================================

const mockFindUnique = vi.hoisted(() => vi.fn());

const mockGetValidToken = vi.hoisted(() => vi.fn());
const mockGet = vi.hoisted(() => vi.fn());
const mockGetBuffer = vi.hoisted(() => vi.fn());
const mockGetWithPagination = vi.hoisted(() => vi.fn());

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
    connections: {
      findUnique: mockFindUnique,
    },
  },
}));

vi.mock('@/services/connectors/GraphTokenManager', () => ({
  getGraphTokenManager: vi.fn(() => ({
    getValidToken: mockGetValidToken,
  })),
}));

vi.mock('@/services/connectors/onedrive/GraphHttpClient', () => ({
  getGraphHttpClient: vi.fn(() => ({
    get: mockGet,
    getBuffer: mockGetBuffer,
    getWithPagination: mockGetWithPagination,
  })),
}));

// Import after mocks
import {
  OneDriveService,
  getOneDriveService,
  __resetOneDriveService,
} from '@/services/connectors/onedrive/OneDriveService';

// ============================================================================
// TEST CONSTANTS
// ============================================================================

const CONNECTION_ID = 'CONN-11111111-2222-3333-4444-555566667777';
const DRIVE_ID = 'DRIVE-123';
const MOCK_TOKEN = 'mock-token';

/** Default DB response for getConnectionDriveInfo */
const DEFAULT_CONNECTION_ROW = {
  microsoft_drive_id: DRIVE_ID,
  microsoft_tenant_id: 'TENANT-1',
};

// ============================================================================
// HELPERS
// ============================================================================

/** Build a minimal Graph driveItem object */
function buildRawDriveItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'item-001',
    name: 'TestFile.docx',
    size: 2048,
    lastModifiedDateTime: '2024-06-01T10:00:00Z',
    webUrl: 'https://example.sharepoint.com/TestFile.docx',
    eTag: '"etag-abc"',
    parentReference: {
      id: 'parent-folder-id',
      path: '/drives/DRIVE-123/root:',
    },
    file: {
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    ...overrides,
  };
}

/** Build a minimal folder driveItem */
function buildRawFolderItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'folder-001',
    name: 'Documents',
    size: 0,
    lastModifiedDateTime: '2024-05-15T08:00:00Z',
    webUrl: 'https://example.sharepoint.com/Documents',
    eTag: null,
    folder: { childCount: 5 },
    parentReference: {
      id: 'root-id',
      path: '/drives/DRIVE-123/root:',
    },
    ...overrides,
  };
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('OneDriveService', () => {
  let service: OneDriveService;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetOneDriveService();
    service = getOneDriveService();

    // Default DB response: connection exists with a driveId
    mockFindUnique.mockResolvedValue(DEFAULT_CONNECTION_ROW);

    // Default token
    mockGetValidToken.mockResolvedValue(MOCK_TOKEN);
  });

  // ==========================================================================
  // getDriveInfo
  // ==========================================================================

  describe('getDriveInfo', () => {
    it('returns a mapped DriveInfo from Graph API response', async () => {
      const rawDrive = {
        id: 'drive-123',
        name: 'My Drive',
        driveType: 'business',
        owner: { user: { displayName: 'Test User' } },
        quota: { total: 1073741824, used: 536870912 },
      };
      mockGet.mockResolvedValue(rawDrive);

      const result = await service.getDriveInfo(CONNECTION_ID);

      expect(result).toEqual({
        driveId: 'drive-123',
        driveName: 'My Drive',
        driveType: 'business',
        ownerDisplayName: 'Test User',
        totalBytes: 1073741824,
        usedBytes: 536870912,
      });
    });

    it('calls getValidToken with the connectionId', async () => {
      mockGet.mockResolvedValue({
        id: 'drive-abc',
        name: 'OneDrive',
        driveType: 'personal',
        owner: { user: { displayName: 'Alice' } },
        quota: { total: 5368709120, used: 1073741824 },
      });

      await service.getDriveInfo(CONNECTION_ID);

      expect(mockGetValidToken).toHaveBeenCalledWith(CONNECTION_ID);
    });

    it('calls Graph API at /me/drive', async () => {
      mockGet.mockResolvedValue({
        id: 'drive-x',
        name: 'X Drive',
        driveType: 'personal',
        owner: { user: { displayName: 'Bob' } },
        quota: { total: 0, used: 0 },
      });

      await service.getDriveInfo(CONNECTION_ID);

      expect(mockGet).toHaveBeenCalledWith('/me/drive', MOCK_TOKEN);
    });

    it('uses default driveType "personal" when Graph response omits the field', async () => {
      mockGet.mockResolvedValue({
        id: 'drive-fallback',
        name: 'Fallback Drive',
        owner: { user: { displayName: 'Charlie' } },
        quota: { total: 0, used: 0 },
        // driveType intentionally omitted
      });

      const result = await service.getDriveInfo(CONNECTION_ID);

      expect(result.driveType).toBe('personal');
    });
  });

  // ==========================================================================
  // listFolder
  // ==========================================================================

  describe('listFolder', () => {
    it('returns mapped items for root (no folderId)', async () => {
      const rawItem = buildRawDriveItem();
      mockGet.mockResolvedValue({ value: [rawItem] });

      const result = await service.listFolder(CONNECTION_ID);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
        id: 'item-001',
        name: 'TestFile.docx',
        isFolder: false,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: 2048,
        lastModifiedAt: '2024-06-01T10:00:00Z',
        webUrl: 'https://example.sharepoint.com/TestFile.docx',
        eTag: '"etag-abc"',
        parentId: 'parent-folder-id',
        parentPath: '/drives/DRIVE-123/root:',
      });
      expect(result.nextPageToken).toBeNull();
    });

    it('calls /drives/{driveId}/root/children when no folderId provided', async () => {
      mockGet.mockResolvedValue({ value: [] });

      await service.listFolder(CONNECTION_ID);

      expect(mockGet).toHaveBeenCalledWith(
        `/drives/${DRIVE_ID}/root/children`,
        MOCK_TOKEN
      );
    });

    it('returns mapped items for a specific folder', async () => {
      const rawFolder = buildRawFolderItem();
      const rawFile = buildRawDriveItem({ id: 'item-nested', name: 'Nested.xlsx' });
      mockGet.mockResolvedValue({ value: [rawFolder, rawFile] });

      const FOLDER_ID = 'FOLDER-ABC-123';
      const result = await service.listFolder(CONNECTION_ID, FOLDER_ID);

      expect(result.items).toHaveLength(2);
      // folder item
      expect(result.items[0]?.isFolder).toBe(true);
      expect(result.items[0]?.id).toBe('folder-001');
      // file item
      expect(result.items[1]?.isFolder).toBe(false);
      expect(result.items[1]?.name).toBe('Nested.xlsx');
    });

    it('calls /drives/{driveId}/items/{folderId}/children when folderId is provided', async () => {
      mockGet.mockResolvedValue({ value: [] });

      const FOLDER_ID = 'FOLDER-XYZ-789';
      await service.listFolder(CONNECTION_ID, FOLDER_ID);

      expect(mockGet).toHaveBeenCalledWith(
        `/drives/${DRIVE_ID}/items/${FOLDER_ID}/children`,
        MOCK_TOKEN
      );
    });

    it('extracts nextPageToken from @odata.nextLink', async () => {
      const skiptoken = 'page2skiptoken==';
      const nextLink = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root/children?$skiptoken=${encodeURIComponent(skiptoken)}`;

      mockGet.mockResolvedValue({
        value: [buildRawDriveItem()],
        '@odata.nextLink': nextLink,
      });

      const result = await service.listFolder(CONNECTION_ID);

      expect(result.nextPageToken).toBe(skiptoken);
    });

    it('uses the full nextLink as nextPageToken when $skiptoken is absent from the URL', async () => {
      const nextLink = 'https://graph.microsoft.com/v1.0/drives/DRIVE-123/root/children?$top=200&noskiptoken=xyz';

      mockGet.mockResolvedValue({
        value: [],
        '@odata.nextLink': nextLink,
      });

      const result = await service.listFolder(CONNECTION_ID);

      // When $skiptoken is missing from URL params, falls back to full nextLink
      expect(result.nextPageToken).toBe(nextLink);
    });

    it('appends $skiptoken to path when pageToken is provided', async () => {
      const pageToken = 'continuationtoken==';
      mockGet.mockResolvedValue({ value: [] });

      await service.listFolder(CONNECTION_ID, undefined, pageToken);

      const expectedPath = `/drives/${DRIVE_ID}/root/children?$skiptoken=${encodeURIComponent(pageToken)}`;
      expect(mockGet).toHaveBeenCalledWith(expectedPath, MOCK_TOKEN);
    });

    it('maps folder items with isFolder=true when folder facet is present', async () => {
      mockGet.mockResolvedValue({ value: [buildRawFolderItem()] });

      const result = await service.listFolder(CONNECTION_ID);

      expect(result.items[0]?.isFolder).toBe(true);
      expect(result.items[0]?.mimeType).toBeNull();
    });

    it('returns empty items array when Graph response has no value', async () => {
      mockGet.mockResolvedValue({});

      const result = await service.listFolder(CONNECTION_ID);

      expect(result.items).toEqual([]);
      expect(result.nextPageToken).toBeNull();
    });
  });

  // ==========================================================================
  // downloadFileContent
  // ==========================================================================

  describe('downloadFileContent', () => {
    it('returns the buffer from getBuffer', async () => {
      const fakeBuffer = Buffer.from('binary file content');
      mockGetBuffer.mockResolvedValue(fakeBuffer);

      const ITEM_ID = 'FILE-ITEM-001';
      const result = await service.downloadFileContent(CONNECTION_ID, ITEM_ID);

      expect(result.buffer).toBe(fakeBuffer);
      expect(result.buffer.length).toBe(fakeBuffer.length);
    });

    it('returns application/octet-stream as contentType', async () => {
      mockGetBuffer.mockResolvedValue(Buffer.from('data'));

      const result = await service.downloadFileContent(CONNECTION_ID, 'ITEM-X');

      expect(result.contentType).toBe('application/octet-stream');
    });

    it('calls getBuffer with the correct drive path', async () => {
      mockGetBuffer.mockResolvedValue(Buffer.from(''));

      const ITEM_ID = 'FILE-ITEM-002';
      await service.downloadFileContent(CONNECTION_ID, ITEM_ID);

      expect(mockGetBuffer).toHaveBeenCalledWith(
        `/drives/${DRIVE_ID}/items/${ITEM_ID}/content`,
        MOCK_TOKEN
      );
    });

    it('calls getValidToken with connectionId', async () => {
      mockGetBuffer.mockResolvedValue(Buffer.from(''));

      await service.downloadFileContent(CONNECTION_ID, 'ITEM-Y');

      expect(mockGetValidToken).toHaveBeenCalledWith(CONNECTION_ID);
    });
  });

  // ==========================================================================
  // getDownloadUrl
  // ==========================================================================

  describe('getDownloadUrl', () => {
    it('returns @microsoft.graph.downloadUrl from response', async () => {
      const downloadUrl = 'https://storage.blob.core.windows.net/signed-url?token=xyz';
      mockGet.mockResolvedValue({
        '@microsoft.graph.downloadUrl': downloadUrl,
      });

      const ITEM_ID = 'FILE-ITEM-003';
      const result = await service.getDownloadUrl(CONNECTION_ID, ITEM_ID);

      expect(result).toBe(downloadUrl);
    });

    it('calls Graph API with $select=@microsoft.graph.downloadUrl', async () => {
      const downloadUrl = 'https://example.com/download';
      mockGet.mockResolvedValue({ '@microsoft.graph.downloadUrl': downloadUrl });

      const ITEM_ID = 'FILE-ITEM-004';
      await service.getDownloadUrl(CONNECTION_ID, ITEM_ID);

      const expectedPath = `/drives/${DRIVE_ID}/items/${ITEM_ID}?$select=${encodeURIComponent('@microsoft.graph.downloadUrl')}`;
      expect(mockGet).toHaveBeenCalledWith(expectedPath, MOCK_TOKEN);
    });

    it('throws when @microsoft.graph.downloadUrl is absent from response', async () => {
      mockGet.mockResolvedValue({ id: 'FILE-ITEM-005' });

      const ITEM_ID = 'FILE-ITEM-005';

      await expect(service.getDownloadUrl(CONNECTION_ID, ITEM_ID)).rejects.toThrow(
        `No download URL returned for item ${ITEM_ID}`
      );
    });

    it('throws when @microsoft.graph.downloadUrl is an empty string', async () => {
      mockGet.mockResolvedValue({ '@microsoft.graph.downloadUrl': '' });

      const ITEM_ID = 'FILE-ITEM-006';

      await expect(service.getDownloadUrl(CONNECTION_ID, ITEM_ID)).rejects.toThrow(
        `No download URL returned for item ${ITEM_ID}`
      );
    });
  });

  // ==========================================================================
  // executeDeltaQuery
  // ==========================================================================

  describe('executeDeltaQuery', () => {
    it('returns changes with changeType "modified" for normal items', async () => {
      const rawItem = buildRawDriveItem({ id: 'delta-item-001', name: 'Updated.docx' });
      const deltaLinkUrl = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root/delta(token='latest')`;

      mockGet.mockResolvedValue({
        value: [rawItem],
        '@odata.deltaLink': deltaLinkUrl,
      });

      const result = await service.executeDeltaQuery(CONNECTION_ID);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]?.changeType).toBe('modified');
      expect(result.changes[0]?.item.id).toBe('delta-item-001');
      expect(result.changes[0]?.item.name).toBe('Updated.docx');
    });

    it('returns changeType "deleted" for items with a deleted facet', async () => {
      const deletedItem = buildRawDriveItem({
        id: 'delta-item-002',
        name: 'Removed.docx',
        deleted: { state: 'deleted' }, // Graph API deleted facet
      });

      mockGet.mockResolvedValue({
        value: [deletedItem],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/drives/DRIVE-123/root/delta(token=end)',
      });

      const result = await service.executeDeltaQuery(CONNECTION_ID);

      expect(result.changes[0]?.changeType).toBe('deleted');
      expect(result.changes[0]?.item.id).toBe('delta-item-002');
    });

    it('sets deltaLink from @odata.deltaLink in response', async () => {
      const deltaLinkUrl = 'https://graph.microsoft.com/v1.0/drives/DRIVE-123/root/delta(token=abc123)';

      mockGet.mockResolvedValue({
        value: [],
        '@odata.deltaLink': deltaLinkUrl,
      });

      const result = await service.executeDeltaQuery(CONNECTION_ID);

      expect(result.deltaLink).toBe(deltaLinkUrl);
      expect(result.hasMore).toBe(false);
      expect(result.nextPageLink).toBeNull();
    });

    it('sets hasMore=true and nextPageLink when @odata.nextLink is present', async () => {
      const nextLinkUrl = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root/delta?$skiptoken=page2`;

      mockGet.mockResolvedValue({
        value: [buildRawDriveItem()],
        '@odata.nextLink': nextLinkUrl,
      });

      const result = await service.executeDeltaQuery(CONNECTION_ID);

      expect(result.hasMore).toBe(true);
      expect(result.nextPageLink).toBe(nextLinkUrl);
      expect(result.deltaLink).toBeNull();
    });

    it('calls /drives/{driveId}/root/delta when no deltaLink is provided', async () => {
      mockGet.mockResolvedValue({ value: [] });

      await service.executeDeltaQuery(CONNECTION_ID);

      expect(mockGet).toHaveBeenCalledWith(
        `/drives/${DRIVE_ID}/root/delta`,
        MOCK_TOKEN
      );
    });

    it('uses the provided deltaLink as the request URL directly', async () => {
      const absoluteDeltaLink = 'https://graph.microsoft.com/v1.0/drives/DRIVE-123/root/delta(token=resume-token)';

      mockGet.mockResolvedValue({
        value: [],
        '@odata.deltaLink': absoluteDeltaLink,
      });

      await service.executeDeltaQuery(CONNECTION_ID, absoluteDeltaLink);

      // When deltaLink is provided, it is used verbatim — DB lookup is skipped
      expect(mockGet).toHaveBeenCalledWith(absoluteDeltaLink, MOCK_TOKEN);
      // DB should NOT be queried when deltaLink is provided
      expect(mockFindUnique).not.toHaveBeenCalled();
    });

    it('returns empty changes array when response value is empty', async () => {
      mockGet.mockResolvedValue({
        value: [],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/drives/DRIVE-123/root/delta(token=done)',
      });

      const result = await service.executeDeltaQuery(CONNECTION_ID);

      expect(result.changes).toEqual([]);
    });

    it('handles mixed modified and deleted items correctly', async () => {
      const modifiedItem = buildRawDriveItem({ id: 'item-mod', name: 'Modified.txt' });
      const deletedItem = buildRawDriveItem({
        id: 'item-del',
        name: 'Deleted.txt',
        deleted: { state: 'deleted' },
      });

      mockGet.mockResolvedValue({
        value: [modifiedItem, deletedItem],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/drives/DRIVE-123/root/delta(token=x)',
      });

      const result = await service.executeDeltaQuery(CONNECTION_ID);

      expect(result.changes).toHaveLength(2);
      expect(result.changes[0]?.changeType).toBe('modified');
      expect(result.changes[1]?.changeType).toBe('deleted');
    });
  });

  // ==========================================================================
  // Connection error handling (shared DB helper)
  // ==========================================================================

  describe('connection error handling', () => {
    it('throws when connection is not found in DB', async () => {
      mockFindUnique.mockResolvedValue(null);

      await expect(service.listFolder(CONNECTION_ID)).rejects.toThrow(
        `Connection not found: ${CONNECTION_ID}`
      );
    });

    it('throws when connection has no microsoft_drive_id', async () => {
      mockFindUnique.mockResolvedValue({
        microsoft_drive_id: null,
        microsoft_tenant_id: 'TENANT-1',
      });

      await expect(service.listFolder(CONNECTION_ID)).rejects.toThrow(
        `Connection has no drive ID: ${CONNECTION_ID}`
      );
    });
  });

  // ==========================================================================
  // Singleton
  // ==========================================================================

  describe('getOneDriveService singleton', () => {
    it('returns the same instance on successive calls', () => {
      const a = getOneDriveService();
      const b = getOneDriveService();

      expect(a).toBe(b);
    });

    it('returns a new instance after __resetOneDriveService', () => {
      const a = getOneDriveService();
      __resetOneDriveService();
      const b = getOneDriveService();

      expect(a).not.toBe(b);
    });
  });
});
