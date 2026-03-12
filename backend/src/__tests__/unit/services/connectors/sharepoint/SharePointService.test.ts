/**
 * SharePointService Unit Tests (PRD-111)
 *
 * Tests the SharePoint Graph API wrapper service, covering:
 * - discoverSites: site discovery with search, pagination, personal site filtering
 * - getFollowedSites: followed-sites endpoint with same filtering rules
 * - getLibraries: document library listing, system library filtering, field mapping
 * - browseFolder: root and sub-folder listing, pagination via $skiptoken
 * - executeDeltaQuery: drive-level delta with modified/deleted detection, link handling
 * - executeFolderDeltaQuery: folder-scoped delta with same link/change semantics
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// MOCKS (hoisted so vi.mock factories can reference them)
// ============================================================================

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
  SharePointService,
  getSharePointService,
  __resetSharePointService,
} from '@/services/connectors/sharepoint/SharePointService';

// ============================================================================
// TEST CONSTANTS
// ============================================================================

const CONNECTION_ID = 'CONN-11111111-2222-3333-4444-555566667777';
const SITE_ID = 'contoso.sharepoint.com,site-id-1,web-id-1';
const DRIVE_ID = 'DRIVE-SP-001';
const MOCK_TOKEN = 'mock-token';

// ============================================================================
// HELPERS
// ============================================================================

function buildRawSite(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'contoso.sharepoint.com,site-id-1,web-id-1',
    displayName: 'Team Site',
    description: 'A team site',
    webUrl: 'https://contoso.sharepoint.com/sites/team',
    lastModifiedDateTime: '2024-06-01T10:00:00Z',
    ...overrides,
  };
}

function buildRawDrive(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'DRIVE-SP-001',
    name: 'Documents',
    description: 'Shared Documents',
    webUrl: 'https://contoso.sharepoint.com/sites/team/Shared Documents',
    quota: { used: 1024000 },
    owner: { group: { displayName: 'Team Site' } },
    ...overrides,
  };
}

function buildRawDriveItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'item-001',
    name: 'Report.xlsx',
    size: 4096,
    lastModifiedDateTime: '2024-06-01T10:00:00Z',
    webUrl: 'https://contoso.sharepoint.com/sites/team/Report.xlsx',
    eTag: '"etag-sp-1"',
    parentReference: { id: 'parent-id', path: '/drives/DRIVE-SP-001/root:' },
    file: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    ...overrides,
  };
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('SharePointService', () => {
  let service: SharePointService;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetSharePointService();
    service = getSharePointService();

    // Default token for every test
    mockGetValidToken.mockResolvedValue(MOCK_TOKEN);
  });

  // ==========================================================================
  // discoverSites
  // ==========================================================================

  describe('discoverSites', () => {
    it('returns sites filtering out personal OneDrive sites', async () => {
      const teamSite = buildRawSite();
      const commsSite = buildRawSite({
        id: 'contoso.sharepoint.com,site-id-2,web-id-2',
        displayName: 'Communications Site',
        webUrl: 'https://contoso.sharepoint.com/sites/comms',
      });
      const personalSite = buildRawSite({
        id: 'contoso-my.sharepoint.com,personal-id,personal-web-id',
        displayName: 'John Personal',
        webUrl: 'https://contoso-my.sharepoint.com/personal/john_contoso_com',
      });

      mockGet.mockResolvedValue({ value: [teamSite, commsSite, personalSite] });

      const result = await service.discoverSites(CONNECTION_ID);

      // Personal site must be filtered out
      expect(result.sites).toHaveLength(2);
      expect(result.sites.every(s => !s.webUrl.includes('-my.sharepoint.com/personal/'))).toBe(true);
    });

    it('passes search query parameter in the Graph path', async () => {
      mockGet.mockResolvedValue({ value: [] });

      await service.discoverSites(CONNECTION_ID, 'test');

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('search=test'),
        MOCK_TOKEN
      );
    });

    it('handles pagination via pageToken as absolute URL', async () => {
      const pageToken = 'https://graph.microsoft.com/v1.0/sites?search=*&$skiptoken=abc123&$top=50';
      mockGet.mockResolvedValue({ value: [] });

      await service.discoverSites(CONNECTION_ID, undefined, pageToken);

      // pageToken is a full nextLink URL — third arg must be true (absolute URL)
      expect(mockGet).toHaveBeenCalledWith(pageToken, MOCK_TOKEN, true);
    });

    it('returns empty sites array when no sites returned', async () => {
      mockGet.mockResolvedValue({ value: [] });

      const result = await service.discoverSites(CONNECTION_ID);

      expect(result.sites).toEqual([]);
      expect(result.nextPageToken).toBeNull();
    });

    it('returns nextPageToken from @odata.nextLink', async () => {
      const nextLink = 'https://graph.microsoft.com/v1.0/sites?search=*&$skiptoken=page2token&$top=50';
      mockGet.mockResolvedValue({
        value: [buildRawSite()],
        '@odata.nextLink': nextLink,
      });

      const result = await service.discoverSites(CONNECTION_ID);

      expect(result.nextPageToken).toBe(nextLink);
    });
  });

  // ==========================================================================
  // getFollowedSites
  // ==========================================================================

  describe('getFollowedSites', () => {
    it('returns followed sites', async () => {
      const site = buildRawSite();
      mockGet.mockResolvedValue({ value: [site] });

      const result = await service.getFollowedSites(CONNECTION_ID);

      expect(result.sites).toHaveLength(1);
      expect(result.sites[0]).toEqual({
        siteId: 'contoso.sharepoint.com,site-id-1,web-id-1',
        displayName: 'Team Site',
        description: 'A team site',
        webUrl: 'https://contoso.sharepoint.com/sites/team',
        isPersonalSite: false,
        lastModifiedAt: '2024-06-01T10:00:00Z',
      });
      expect(mockGet).toHaveBeenCalledWith('/me/followedSites', MOCK_TOKEN);
    });

    it('filters personal sites from followed sites result', async () => {
      const personalSite = buildRawSite({
        webUrl: 'https://contoso-my.sharepoint.com/personal/jane_contoso_com',
      });
      const teamSite = buildRawSite({
        id: 'contoso.sharepoint.com,site-id-3,web-id-3',
        displayName: 'HR Site',
        webUrl: 'https://contoso.sharepoint.com/sites/hr',
      });
      mockGet.mockResolvedValue({ value: [personalSite, teamSite] });

      const result = await service.getFollowedSites(CONNECTION_ID);

      expect(result.sites).toHaveLength(1);
      expect(result.sites[0]?.displayName).toBe('HR Site');
    });
  });

  // ==========================================================================
  // getLibraries
  // ==========================================================================

  describe('getLibraries', () => {
    it('returns non-system libraries by default', async () => {
      const docsLib = buildRawDrive({ id: 'DRIVE-DOCS', name: 'Documents' });
      const imagesLib = buildRawDrive({ id: 'DRIVE-IMGS', name: 'Images' });
      // System by name
      const siteAssetsLib = buildRawDrive({ id: 'DRIVE-SA', name: 'Site Assets' });
      // System by facet
      const siteAssetsLib2 = buildRawDrive({ id: 'DRIVE-SYS', name: 'Custom Sys Lib', system: {} });

      mockGet.mockResolvedValue({ value: [docsLib, imagesLib, siteAssetsLib, siteAssetsLib2] });

      const result = await service.getLibraries(CONNECTION_ID, SITE_ID);

      // Only 2 non-system libraries returned
      expect(result.libraries).toHaveLength(2);
      expect(result.libraries.map(l => l.driveId)).toEqual(['DRIVE-DOCS', 'DRIVE-IMGS']);
    });

    it('includes system libraries when includeSystem=true', async () => {
      const docsLib = buildRawDrive({ id: 'DRIVE-DOCS', name: 'Documents' });
      const siteAssetsLib = buildRawDrive({ id: 'DRIVE-SA', name: 'Site Assets' });
      const sysLib = buildRawDrive({ id: 'DRIVE-SYS', name: 'My System', system: {} });
      const styleLib = buildRawDrive({ id: 'DRIVE-STYLE', name: 'Style Library' });

      mockGet.mockResolvedValue({ value: [docsLib, siteAssetsLib, sysLib, styleLib] });

      const result = await service.getLibraries(CONNECTION_ID, SITE_ID, true);

      expect(result.libraries).toHaveLength(4);
    });

    it('maps library fields correctly', async () => {
      const drive = buildRawDrive({
        id: DRIVE_ID,
        name: 'Documents',
        description: 'Shared Documents',
        webUrl: 'https://contoso.sharepoint.com/sites/team/Shared Documents',
        quota: { used: 1024000 },
        owner: { group: { displayName: 'Team Site' } },
      });
      mockGet.mockResolvedValue({ value: [drive] });

      const result = await service.getLibraries(CONNECTION_ID, SITE_ID);

      expect(result.libraries).toHaveLength(1);
      const lib = result.libraries[0]!;
      expect(lib.driveId).toBe(DRIVE_ID);
      expect(lib.displayName).toBe('Documents');
      expect(lib.description).toBe('Shared Documents');
      expect(lib.webUrl).toBe('https://contoso.sharepoint.com/sites/team/Shared Documents');
      expect(lib.sizeBytes).toBe(1024000);
      expect(lib.siteId).toBe(SITE_ID);
      expect(lib.siteName).toBe('Team Site');
      expect(lib.isSystemLibrary).toBe(false);
    });
  });

  // ==========================================================================
  // browseFolder
  // ==========================================================================

  describe('browseFolder', () => {
    it('lists root folder contents when no folderId provided', async () => {
      const rawItem = buildRawDriveItem();
      mockGet.mockResolvedValue({ value: [rawItem] });

      const result = await service.browseFolder(CONNECTION_ID, DRIVE_ID);

      expect(mockGet).toHaveBeenCalledWith(
        `/drives/${DRIVE_ID}/root/children`,
        MOCK_TOKEN
      );
      expect(result.items).toHaveLength(1);
      expect(result.nextPageToken).toBeNull();
    });

    it('lists subfolder contents when folderId provided', async () => {
      const FOLDER_ID = 'SUBFOLDER-001';
      mockGet.mockResolvedValue({ value: [buildRawDriveItem()] });

      await service.browseFolder(CONNECTION_ID, DRIVE_ID, FOLDER_ID);

      expect(mockGet).toHaveBeenCalledWith(
        `/drives/${DRIVE_ID}/items/${FOLDER_ID}/children`,
        MOCK_TOKEN
      );
    });

    it('handles pagination via pageToken appended as $skiptoken', async () => {
      const pageToken = 'sp-continuation-token==';
      mockGet.mockResolvedValue({ value: [] });

      await service.browseFolder(CONNECTION_ID, DRIVE_ID, undefined, pageToken);

      expect(mockGet).toHaveBeenCalledWith(
        `/drives/${DRIVE_ID}/root/children?$skiptoken=${encodeURIComponent(pageToken)}`,
        MOCK_TOKEN
      );
    });

    it('maps items correctly to ExternalFileItem shape', async () => {
      const rawItem = buildRawDriveItem();
      mockGet.mockResolvedValue({ value: [rawItem] });

      const result = await service.browseFolder(CONNECTION_ID, DRIVE_ID);

      expect(result.items[0]).toEqual({
        id: 'item-001',
        name: 'Report.xlsx',
        isFolder: false,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 4096,
        lastModifiedAt: '2024-06-01T10:00:00Z',
        webUrl: 'https://contoso.sharepoint.com/sites/team/Report.xlsx',
        eTag: '"etag-sp-1"',
        parentId: 'parent-id',
        parentPath: '/drives/DRIVE-SP-001/root:',
        childCount: null,
      });
    });

    it('extracts nextPageToken from @odata.nextLink when present', async () => {
      const skiptoken = 'sp-page2token==';
      const nextLink = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root/children?$skiptoken=${encodeURIComponent(skiptoken)}`;
      mockGet.mockResolvedValue({
        value: [buildRawDriveItem()],
        '@odata.nextLink': nextLink,
      });

      const result = await service.browseFolder(CONNECTION_ID, DRIVE_ID);

      expect(result.nextPageToken).toBe(skiptoken);
    });
  });

  // ==========================================================================
  // executeDeltaQuery
  // ==========================================================================

  describe('executeDeltaQuery', () => {
    it('executes first delta call with driveId when no deltaLink provided', async () => {
      mockGet.mockResolvedValue({
        value: [],
        '@odata.deltaLink': `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root/delta(token=init)`,
      });

      await service.executeDeltaQuery(CONNECTION_ID, DRIVE_ID);

      expect(mockGet).toHaveBeenCalledWith(
        `/drives/${DRIVE_ID}/root/delta`,
        MOCK_TOKEN
      );
    });

    it('follows deltaLink as absolute URL when provided', async () => {
      const absoluteDeltaLink = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root/delta(token=resume123)`;
      mockGet.mockResolvedValue({
        value: [],
        '@odata.deltaLink': absoluteDeltaLink,
      });

      await service.executeDeltaQuery(CONNECTION_ID, DRIVE_ID, absoluteDeltaLink);

      // Third arg must be true — tells GraphHttpClient this is an absolute URL
      expect(mockGet).toHaveBeenCalledWith(absoluteDeltaLink, MOCK_TOKEN, true);
    });

    it('detects deleted items with changeType "deleted"', async () => {
      const deletedItem = buildRawDriveItem({
        id: 'sp-deleted-001',
        name: 'OldReport.xlsx',
        deleted: { state: 'deleted' },
      });
      mockGet.mockResolvedValue({
        value: [deletedItem],
        '@odata.deltaLink': `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root/delta(token=end)`,
      });

      const result = await service.executeDeltaQuery(CONNECTION_ID, DRIVE_ID);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]?.changeType).toBe('deleted');
      expect(result.changes[0]?.item.id).toBe('sp-deleted-001');
    });

    it('returns deltaLink and nextPageLink from response', async () => {
      const deltaLinkUrl = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root/delta(token=latest)`;
      mockGet.mockResolvedValue({
        value: [buildRawDriveItem()],
        '@odata.deltaLink': deltaLinkUrl,
      });

      const result = await service.executeDeltaQuery(CONNECTION_ID, DRIVE_ID);

      expect(result.deltaLink).toBe(deltaLinkUrl);
      expect(result.nextPageLink).toBeNull();
      expect(result.hasMore).toBe(false);
    });

    it('sets hasMore=true and nextPageLink when @odata.nextLink present', async () => {
      const nextLinkUrl = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root/delta?$skiptoken=page2`;
      mockGet.mockResolvedValue({
        value: [buildRawDriveItem()],
        '@odata.nextLink': nextLinkUrl,
      });

      const result = await service.executeDeltaQuery(CONNECTION_ID, DRIVE_ID);

      expect(result.hasMore).toBe(true);
      expect(result.nextPageLink).toBe(nextLinkUrl);
      expect(result.deltaLink).toBeNull();
    });

    it('returns modified changeType for normal (non-deleted) items', async () => {
      const item = buildRawDriveItem({ id: 'sp-mod-001', name: 'Updated.docx' });
      mockGet.mockResolvedValue({
        value: [item],
        '@odata.deltaLink': `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root/delta(token=x)`,
      });

      const result = await service.executeDeltaQuery(CONNECTION_ID, DRIVE_ID);

      expect(result.changes[0]?.changeType).toBe('modified');
      expect(result.changes[0]?.item.id).toBe('sp-mod-001');
    });

    it('returns empty changes array when response value is empty', async () => {
      mockGet.mockResolvedValue({
        value: [],
        '@odata.deltaLink': `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root/delta(token=done)`,
      });

      const result = await service.executeDeltaQuery(CONNECTION_ID, DRIVE_ID);

      expect(result.changes).toEqual([]);
    });
  });

  // ==========================================================================
  // executeFolderDeltaQuery
  // ==========================================================================

  describe('executeFolderDeltaQuery', () => {
    const FOLDER_ID = 'SP-FOLDER-ABC-123';

    it('executes first call with driveId and folderId when no deltaLink provided', async () => {
      mockGet.mockResolvedValue({
        value: [],
        '@odata.deltaLink': `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${FOLDER_ID}/delta(token=init)`,
      });

      await service.executeFolderDeltaQuery(CONNECTION_ID, DRIVE_ID, FOLDER_ID);

      expect(mockGet).toHaveBeenCalledWith(
        `/drives/${DRIVE_ID}/items/${FOLDER_ID}/delta`,
        MOCK_TOKEN
      );
    });

    it('follows deltaLink as absolute URL when provided', async () => {
      const absoluteDeltaLink = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${FOLDER_ID}/delta(token=resume)`;
      mockGet.mockResolvedValue({
        value: [],
        '@odata.deltaLink': absoluteDeltaLink,
      });

      await service.executeFolderDeltaQuery(CONNECTION_ID, DRIVE_ID, FOLDER_ID, absoluteDeltaLink);

      // Third arg must be true — absolute URL
      expect(mockGet).toHaveBeenCalledWith(absoluteDeltaLink, MOCK_TOKEN, true);
    });

    it('detects deleted items with changeType "deleted"', async () => {
      const deletedItem = buildRawDriveItem({
        id: 'sp-folder-del-001',
        name: 'Removed.docx',
        deleted: { state: 'deleted' },
      });
      mockGet.mockResolvedValue({
        value: [deletedItem],
        '@odata.deltaLink': `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${FOLDER_ID}/delta(token=end)`,
      });

      const result = await service.executeFolderDeltaQuery(CONNECTION_ID, DRIVE_ID, FOLDER_ID);

      expect(result.changes[0]?.changeType).toBe('deleted');
      expect(result.changes[0]?.item.id).toBe('sp-folder-del-001');
    });

    it('returns deltaLink and nextPageLink from response', async () => {
      const rawItem = buildRawDriveItem({ id: 'sp-folder-item-001', name: 'Presentation.pptx' });
      const deltaLinkUrl = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${FOLDER_ID}/delta(token=latest)`;
      mockGet.mockResolvedValue({
        value: [rawItem],
        '@odata.deltaLink': deltaLinkUrl,
      });

      const result = await service.executeFolderDeltaQuery(CONNECTION_ID, DRIVE_ID, FOLDER_ID);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]?.item.name).toBe('Presentation.pptx');
      expect(result.deltaLink).toBe(deltaLinkUrl);
      expect(result.nextPageLink).toBeNull();
      expect(result.hasMore).toBe(false);
    });

    it('sets hasMore=true and nextPageLink when @odata.nextLink present', async () => {
      const nextLinkUrl = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${FOLDER_ID}/delta?$skiptoken=page2`;
      mockGet.mockResolvedValue({
        value: [buildRawDriveItem()],
        '@odata.nextLink': nextLinkUrl,
      });

      const result = await service.executeFolderDeltaQuery(CONNECTION_ID, DRIVE_ID, FOLDER_ID);

      expect(result.hasMore).toBe(true);
      expect(result.nextPageLink).toBe(nextLinkUrl);
      expect(result.deltaLink).toBeNull();
    });

    it('returns empty changes array when response value is empty', async () => {
      mockGet.mockResolvedValue({
        value: [],
        '@odata.deltaLink': `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${FOLDER_ID}/delta(token=empty)`,
      });

      const result = await service.executeFolderDeltaQuery(CONNECTION_ID, DRIVE_ID, FOLDER_ID);

      expect(result.changes).toEqual([]);
    });
  });

  // ==========================================================================
  // Singleton
  // ==========================================================================

  describe('getSharePointService singleton', () => {
    it('returns the same instance on successive calls', () => {
      const a = getSharePointService();
      const b = getSharePointService();

      expect(a).toBe(b);
    });

    it('returns a new instance after __resetSharePointService', () => {
      const a = getSharePointService();
      __resetSharePointService();
      const b = getSharePointService();

      expect(a).not.toBe(b);
    });
  });
});
